const crypto = require("node:crypto");
const { callOperator, execOperator } = require('./operator-netlify.cjs');
const { sealOperatorPayload } = require('./operator-crypto-netlify.cjs');
const { aid, field, jobId, normalizeDeviceHeartbeat, normalizeDevicePolicy, normalizeDeviceRevoke, normalizeEnrollmentApprove, normalizeEnrollmentCancel, normalizeEnrollmentBegin, normalizeEnrollmentPoll, normalizeNodeDrain, normalizeShellId, normalizeExecPayload, normalizeSessionOpenPayload, payloadFor, sid } = require('./operator-request.cjs');
const { toolHelperHint, toolHelperView } = require('./plus-tool-helper.cjs');

function enrollmentSourceHash(req){ const ip=String(req.headers?.["x-forwarded-for"]||"unknown").split(",")[0].trim().slice(0,128); return crypto.createHash("sha256").update("v07-enrollment:"+ip).digest("hex"); }

function connectionHelperView(value={}) {
  const status=String(value.status||'need_a_code');
  const base={protocol:'light-remote-plus-v1',endpoint:'/api/operator?via=plus&action=connection-helper',status};
  if(status==='approval_required') return {...value,helper:{...base,nextAction:'owner_approve_b_then_poll',instruction:'Ask the owner to enter the returned B code on the exact Wall that produced A, approve it, then call connection-helper again with nextPayload.',nextPayload:{continuation:value.continuation}}};
  if(status==='ready') return {...value,helper:{...base,nextAction:'load_tool_helper',instruction:'Connection and working context are ready. Keep the opaque client token private; reuse the returned context and immediately load the Tool Helper instead of reading repo source for tool syntax.',toolHelper:toolHelperHint(),rules:['Reuse context.deviceId/context.sessionId after READY.','Pair each additional device independently with its own A/B flow.','Never expose client/continuation capabilities to the user.']}};
  return {...value,helper:{...base,nextAction:'provide_a_code',instruction:'Get a fresh A code from the target Local Wall, then call connection-helper with {aCode,agentId,label}. Do not send client on the first pairing.'}};
}

function pairingRecovery(continuation){
  const parts=String(continuation||'').split('.');
  if(parts.length!==4||parts[0]!=='o1'||parts[1]!=='pair')return null;
  try{
    const value=JSON.parse(Buffer.from(parts[2],'base64url').toString('utf8'));
    const requestId=String(value?.requestId||''),pollToken=String(value?.pollToken||'');
    if(!/^pa_[A-Za-z0-9_-]{20,80}$/.test(requestId)||!/^[A-Za-z0-9_-]{32,128}$/.test(pollToken))return null;
    return {requestId,pollToken};
  }catch{return null;}
}
async function pollPairing(continuation){
  try{return await callOperator('/plus/connect/poll',{method:'POST',body:{continuation}});}
  catch(error){
    const recovery=pairingRecovery(continuation);
    if(error.status===401&&recovery)return callOperator('/plus/connect/recover',{method:'POST',body:recovery});
    throw error;
  }
}


module.exports=async function handler(req,res){
  const started=Date.now();
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy','no-referrer');
  if(!['GET','POST'].includes(req.method)) return res.status(405).json({ok:false,error:'method_not_allowed'});
  const action=String(field(req,'action','capabilities'));
  const wantsPlus=String(field(req,'via',''))==='plus';
  const plus=wantsPlus && req.method==='GET';
  if(wantsPlus&&!plus) return res.status(405).json({ok:false,error:'plus_bridge_get_only'});
  const bridgeSession=String(req.headers?.['x-bridge-session']||'');
  const plusSession=String(field(req,'ps','')).trim();
  const plusClient=String(field(req,'client','')).trim();
  const plusClientValid=/^o1\.client\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(plusClient);
  const compactClientActions=new Set(['tool-helper','context','list-devices','session-open','session-resume','session-hold','session-close','session','exec','fs','process-start','process-input','process-output','process-list','process-stop','search-start','search-results','search-cancel','scp','transfer-begin','transfer-chunk','transfer-status','transfer-commit','transfer-cancel','job','output']);
  const compactPlusResponse=()=>plus&&(action==='connection-helper'||action==='connect'||action==='connect-poll'||(plusClientValid&&compactClientActions.has(action)));
  const call=(path,options={})=>callOperator(path,{...options,bridgeSession});
  const plusCall=(path,options={})=>callOperator(path,{...options,plusSession});
  const clientCall=(path,options={})=>{const body=options.body&&typeof options.body==='object'&&!Array.isArray(options.body)?{...options.body,bridgeReceivedAt:started}:options.body;return callOperator(path,{...options,...(body===undefined?{}:{body}),plusClient});};
  const clientDevice=value=>{const v=String(value||'').trim();if(!/^[A-Za-z0-9._:-]{1,128}$/.test(v)){const e=new Error('invalid_plus_device_id');e.status=400;throw e;}return v;};
  try {
    let upstream;
    if(plus){
      if(action==='connection-helper') {
        if(!String(req.query?.p||'').trim()) upstream=connectionHelperView({ok:false,status:'need_a_code',error:'pairing_code_required'});
        else {
          const d=payloadFor(req);
          if(d.continuation){
            const continuation=String(d.continuation||'').trim();
            if(!/^o1\.pair\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(continuation)){const e=new Error('invalid_pairing_continuation');e.status=400;throw e;}
            upstream=connectionHelperView(await pollPairing(continuation));
          } else {
            const raw=String(d.aCode||'').trim().toUpperCase().replace(/-/g,'');
            if(!/^[A-Z2-9]{8}$/.test(raw)){upstream=connectionHelperView({ok:false,status:'need_a_code',error:raw?'invalid_pairing_code':'pairing_code_required'});}
            else {
              const agentId=aid(d.agentId),label=String(d.label||'ChatGPT').trim().slice(0,120);
              let client=null;if(d.client!=null&&String(d.client).trim()){client=String(d.client).trim();if(!/^o1\.client\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(client)){const e=new Error('invalid_agent_client');e.status=400;throw e;}}
              upstream=connectionHelperView(await callOperator('/plus/connect/begin',{method:'POST',body:{aCode:`${raw.slice(0,4)}-${raw.slice(4)}`,agentId,label,client}}));
            }
          }
        }
      }
      else if(action==='connect') {
        if(!String(req.query?.p||'').trim()){const e=new Error('pairing_code_required');e.status=428;e.payload={ok:false,status:'need_a_code',error:e.message};throw e;}
        const d=payloadFor(req),raw=String(d.aCode||'').trim().toUpperCase().replace(/-/g,'');
        if(!raw){const e=new Error('pairing_code_required');e.status=428;e.payload={ok:false,status:'need_a_code',error:e.message};throw e;}
        if(!/^[A-Z2-9]{8}$/.test(raw)){const e=new Error('invalid_pairing_code');e.status=400;e.payload={ok:false,status:'need_a_code',error:e.message};throw e;}
        const agentId=aid(d.agentId),label=String(d.label||'ChatGPT').trim().slice(0,120);
        let client=null;if(d.client!=null&&String(d.client).trim()){client=String(d.client).trim();if(!/^o1\.client\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(client)){const e=new Error('invalid_agent_client');e.status=400;throw e;}}
        upstream=await callOperator('/plus/connect/begin',{method:'POST',body:{aCode:`${raw.slice(0,4)}-${raw.slice(4)}`,agentId,label,client}});
      }
      else if(action==='connect-poll') {
        const d=payloadFor(req),continuation=String(d.continuation||'').trim();
        if(!/^o1\.pair\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(continuation)){const e=new Error('invalid_pairing_continuation');e.status=400;throw e;}
        upstream=await pollPairing(continuation);
      }
      else if(action==='devices-bootstrap') upstream=await callOperator('/plus/bootstrap/devices');
      else if(action==='authorize-begin') {
        const d=payloadFor(req), agentId=aid(d.agentId), label=String(d.label||'ChatGPT Plus').trim().slice(0,120), deviceId=String(d.deviceId||'').trim();
        if(!/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId)){const e=new Error('invalid_plus_device_id');e.status=400;throw e;}
        upstream=await callOperator('/plus/auth/begin',{method:'POST',body:{agentId,label,deviceId}});
      }
      else if(action==='authorize-poll') {
        const d=payloadFor(req), requestId=String(d.requestId||'').trim(), pollToken=String(d.pollToken||'').trim();
        if(!/^pa_[A-Za-z0-9_-]{20,80}$/.test(requestId)){const e=new Error('invalid_plus_request_id');e.status=400;throw e;}
        if(!/^[A-Za-z0-9_-]{32,128}$/.test(pollToken)){const e=new Error('invalid_plus_poll_token');e.status=400;throw e;}
        upstream=await callOperator('/plus/auth/poll',{method:'POST',body:{requestId,pollToken}});
      }
      else {
        const usingClient=plusClientValid;
        if(action==='tool-helper'){
          if(!usingClient){const e=new Error('agent_client_required');e.status=401;throw e;}
          const current=await clientCall('/plus/client/context',{method:'POST',body:{}});
          upstream=toolHelperView(current);
        }
        else if(action==='context'){
          if(!usingClient){const e=new Error('agent_client_required');e.status=401;throw e;}
          const d=String(req.query?.p||'').trim()?payloadFor(req):{},body={};
          if(d.deviceId!=null||d.device!=null)body.deviceId=clientDevice(d.deviceId||d.device);
          if(d.workspace!=null)body.workspace=String(d.workspace||'').slice(0,512);
          if(d.gracePreset!=null)body.gracePreset=String(d.gracePreset||'60m').slice(0,16);
          upstream=await clientCall('/plus/client/context',{method:'POST',body});
        }
        else if(action==='list-devices'){if(!usingClient){const e=new Error('agent_client_required');e.status=401;throw e;}upstream=await clientCall('/plus/client/devices');}
        else if(usingClient&&action==='session-open'){const d=payloadFor(req),deviceId=clientDevice(d.deviceId||d.device),body=normalizeSessionOpenPayload(d);upstream=await clientCall('/plus/client/sessions/open',{method:'POST',body:{...body,deviceId}});}
        else if(usingClient&&action==='session-resume') upstream=await clientCall(`/plus/client/sessions/${encodeURIComponent(sid(field(req,'sid')))}/resume?deviceId=${encodeURIComponent(clientDevice(field(req,'device')))}`,{method:'POST',body:{deviceId:clientDevice(field(req,'device'))}});
        else if(usingClient&&action==='session-hold') upstream=await clientCall(`/plus/client/sessions/${encodeURIComponent(sid(field(req,'sid')))}/hold?deviceId=${encodeURIComponent(clientDevice(field(req,'device')))}`,{method:'POST',body:{deviceId:clientDevice(field(req,'device')),reason:String(field(req,'reason','transport_lost')).slice(0,80)}});
        else if(usingClient&&action==='session-close') upstream=await clientCall(`/plus/client/sessions/${encodeURIComponent(sid(field(req,'sid')))}/close?deviceId=${encodeURIComponent(clientDevice(field(req,'device')))}`,{method:'POST',body:{deviceId:clientDevice(field(req,'device'))}});
        else if(usingClient&&action==='session') upstream=await clientCall(`/plus/client/sessions/${encodeURIComponent(sid(field(req,'sid')))}?deviceId=${encodeURIComponent(clientDevice(field(req,'device')))}`);
        else if(usingClient&&action==='exec'){const d=payloadFor(req),deviceId=clientDevice(d.deviceId||d.device),payload=normalizeExecPayload(d);upstream=await clientCall('/plus/client/execute',{method:'POST',body:{deviceId,envelope:sealOperatorPayload(payload)},timeoutMs:9500});}
        else if(usingClient&&action==='fs'){
          const d=payloadFor(req),deviceId=clientDevice(d.deviceId||d.device),fs=d.fs;
          if(!fs||typeof fs!=='object'||Array.isArray(fs)){const e=new Error('invalid_fs_payload');e.status=400;throw e;}
          const payload={action:'fs',operationId:aid(d.operationId),sessionId:sid(d.sessionId),agentId:aid(d.agentId),nodeId:d.nodeId==null?undefined:clientDevice(d.nodeId),fs,waitMs:Math.max(0,Math.min(Number(d.waitMs)||7000,8000))};
          upstream=await clientCall('/plus/client/execute',{method:'POST',body:{deviceId,envelope:sealOperatorPayload(payload)},timeoutMs:9500});
        }
        else if(usingClient&&action.startsWith('process-')){
          const d=payloadFor(req),deviceId=clientDevice(d.deviceId||d.device);
          const op=action.slice('process-'.length);
          if(!['start','input','output','list','stop'].includes(op)){const e=new Error('invalid_process_action');e.status=400;throw e;}
          const process={op};
          if(op==='start'){process.script=String(d.script||'');process.cwd=d.cwd==null?undefined:String(d.cwd);process.shell=normalizeShellId(d.shell);process.timeoutMs=d.timeoutMs==null?undefined:Number(d.timeoutMs);process.requiredCapabilities=Array.isArray(d.requiredCapabilities)?d.requiredCapabilities:undefined;}
          if(op==='input'){process.processId=String(d.processId||'');process.data=String(d.data||'');process.eof=Boolean(d.eof);}
          if(op==='output'){process.processId=String(d.processId||'');process.stream=d.stream==='stderr'?'stderr':'stdout';process.offset=Math.max(0,Number(d.offset)||0);process.limit=Math.max(1,Math.min(Number(d.limit)||262144,1048576));}
          if(op==='stop'){process.processId=String(d.processId||'');process.force=Boolean(d.force);}
          const payload={action:'process',operationId:aid(d.operationId),sessionId:sid(d.sessionId),agentId:aid(d.agentId),nodeId:d.nodeId==null?undefined:clientDevice(d.nodeId),process,waitMs:Math.max(0,Math.min(Number(d.waitMs)||7000,8000))};
          upstream=await clientCall('/plus/client/execute',{method:'POST',body:{deviceId,envelope:sealOperatorPayload(payload)},timeoutMs:9500});
        }
        else if(usingClient&&action.startsWith('terminal-')){
          const d=payloadFor(req),deviceId=clientDevice(d.deviceId||d.device),op=action.slice('terminal-'.length);
          if(!['start','input','output','resize','signal','list','stop'].includes(op)){const e=new Error('invalid_terminal_action');e.status=400;throw e;}
          const terminal={op};
          if(op==='start'){terminal.shell=normalizeShellId(d.shell);terminal.cwd=d.cwd==null?undefined:String(d.cwd);terminal.cols=Math.max(20,Math.min(Number(d.cols)||120,500));terminal.rows=Math.max(5,Math.min(Number(d.rows)||32,200));terminal.term=d.term==null?undefined:String(d.term).slice(0,64);}
          if(op==='input'){terminal.terminalId=String(d.terminalId||'');terminal.data=String(d.data||'');}
          if(op==='output'){terminal.terminalId=String(d.terminalId||'');terminal.offset=Math.max(0,Number(d.offset)||0);terminal.limit=Math.max(1,Math.min(Number(d.limit)||262144,1048576));}
          if(op==='resize'){terminal.terminalId=String(d.terminalId||'');terminal.cols=Math.max(20,Math.min(Number(d.cols)||120,500));terminal.rows=Math.max(5,Math.min(Number(d.rows)||32,200));}
          if(op==='signal'){terminal.terminalId=String(d.terminalId||'');terminal.signal=String(d.signal||'interrupt').toLowerCase();}
          if(op==='stop'){terminal.terminalId=String(d.terminalId||'');terminal.force=Boolean(d.force);}
          const payload={action:'terminal',operationId:aid(d.operationId),sessionId:sid(d.sessionId),agentId:aid(d.agentId),nodeId:d.nodeId==null?undefined:clientDevice(d.nodeId),terminal,waitMs:Math.max(0,Math.min(Number(d.waitMs)||7000,8000))};
          upstream=await clientCall('/plus/client/execute',{method:'POST',body:{deviceId,envelope:sealOperatorPayload(payload)},timeoutMs:9500});
        }
        else if(usingClient&&action.startsWith('search-')){
          const d=payloadFor(req),deviceId=clientDevice(d.deviceId||d.device),op=action.slice('search-'.length);
          if(!['start','results','cancel'].includes(op)){const e=new Error('invalid_search_action');e.status=400;throw e;}
          const search={op};
          if(op==='start'){search.path=String(d.path||'');search.searchType=d.searchType==='files'?'files':'content';search.pattern=String(d.pattern||'');search.literalSearch=Boolean(d.literalSearch);search.ignoreCase=d.ignoreCase!==false;search.filePattern=d.filePattern==null?'':String(d.filePattern);search.contextLines=Math.max(0,Math.min(Number(d.contextLines)||0,20));search.maxResults=Math.max(1,Math.min(Number(d.maxResults)||200,1000));}
          if(op==='results'){search.searchId=String(d.searchId||'');search.offset=Math.max(0,Number(d.offset)||0);search.limit=Math.max(1,Math.min(Number(d.limit)||100,500));}
          if(op==='cancel')search.searchId=String(d.searchId||'');
          const payload={action:'search',operationId:aid(d.operationId),sessionId:sid(d.sessionId),agentId:aid(d.agentId),nodeId:d.nodeId==null?undefined:clientDevice(d.nodeId),search,waitMs:Math.max(0,Math.min(Number(d.waitMs)||7000,8000))};
          upstream=await clientCall('/plus/client/execute',{method:'POST',body:{deviceId,envelope:sealOperatorPayload(payload)},timeoutMs:9500});
        }
        else if(usingClient&&action==='scp'){
          const d=payloadFor(req),deviceId=clientDevice(d.deviceId||d.device),scp=d.scp;
          if(!scp||typeof scp!=='object'||Array.isArray(scp)){const e=new Error('invalid_scp_payload');e.status=400;throw e;}
          const payload={action:'scp',operationId:aid(d.operationId),sessionId:sid(d.sessionId),agentId:aid(d.agentId),nodeId:d.nodeId==null?undefined:clientDevice(d.nodeId),scp,waitMs:Math.max(0,Math.min(Number(d.waitMs)||7000,8000))};
          upstream=await clientCall('/plus/client/execute',{method:'POST',body:{deviceId,envelope:sealOperatorPayload(payload)},timeoutMs:9500});
        }
        else if(usingClient&&action.startsWith('transfer-')){
          const d=payloadFor(req),deviceId=clientDevice(d.deviceId||d.device),op=action.slice('transfer-'.length);
          if(!['begin','chunk','status','commit','cancel'].includes(op)){const e=new Error('invalid_transfer_action');e.status=400;throw e;}
          if(op==='begin'){
            const body={deviceId,purpose:'operator-payload',totalBytes:Number(d.totalBytes),totalChunks:Number(d.totalChunks),sha256:String(d.sha256||'')};
            upstream=await clientCall('/plus/client/transfers',{method:'POST',body,timeoutMs:9500});
          }else{
            const transferId=String(d.transferId||'').trim();if(!/^lt_[A-Za-z0-9_-]{20,80}$/.test(transferId)){const e=new Error('invalid_transfer_id');e.status=400;throw e;}
            const suffix=op==='chunk'?'chunk':op;
            const body=op==='chunk'?{deviceId,index:Number(d.index),data:String(d.data||''),sha256:String(d.sha256||'')}:{deviceId};
            upstream=await clientCall(`/plus/client/transfers/${encodeURIComponent(transferId)}/${suffix}`,{method:'POST',body,timeoutMs:9500});
          }
        }
        else if(usingClient&&action==='job') upstream=await clientCall(`/plus/client/jobs/${encodeURIComponent(jobId(field(req,'id')))}?deviceId=${encodeURIComponent(clientDevice(field(req,'device')))}`);
        else if(usingClient&&action==='output'){const q=new URLSearchParams({deviceId:clientDevice(field(req,'device')),stream:field(req,'stream')==='stderr'?'stderr':'stdout',full:['1','true','yes'].includes(String(field(req,'full','0')).toLowerCase())?'1':'0',offset:String(Math.max(0,Number(field(req,'offset',0))||0)),limit:String(Math.max(1,Math.min(Number(field(req,'limit',4194304))||4194304,8388608)))});upstream=await clientCall(`/plus/client/output/${encodeURIComponent(jobId(field(req,'id')))}?${q}`);}
        else {
          if(!/^o1\.plus\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(plusSession)){const e=new Error('plus_session_required');e.status=401;throw e;}
          if(action==='capabilities') upstream=await plusCall('/plus/capabilities');
          else if(action==='devices') upstream=await plusCall('/plus/devices');
      else if(action==='fleet') upstream=await plusCall('/plus/fleet');
      else if(action==='device') upstream=await plusCall(`/plus/devices/${encodeURIComponent(String(field(req,'id','')))}`);
      else if(action==='device-connection') upstream=await plusCall(`/plus/devices/${encodeURIComponent(String(field(req,'id','')))}/connection`);
      else if(action==='sessions') upstream=await plusCall('/plus/sessions');
      else if(action==='session-open') upstream=await plusCall('/plus/sessions/open',{method:'POST',body:normalizeSessionOpenPayload(payloadFor(req))});
      else if(action==='session-resume') upstream=await plusCall(`/plus/sessions/${encodeURIComponent(sid(field(req,'sid')))}/resume`,{method:'POST',body:{agentId:aid(field(req,'aid'))}});
      else if(action==='session-hold') upstream=await plusCall(`/plus/sessions/${encodeURIComponent(sid(field(req,'sid')))}/hold`,{method:'POST',body:{agentId:aid(field(req,'aid')),reason:String(field(req,'reason','transport_lost')).slice(0,80)}});
      else if(action==='session-close') upstream=await plusCall(`/plus/sessions/${encodeURIComponent(sid(field(req,'sid')))}/close`,{method:'POST',body:{agentId:aid(field(req,'aid'))}});
      else if(action==='session') upstream=await plusCall(`/plus/sessions/${encodeURIComponent(sid(field(req,'sid')))}?agentId=${encodeURIComponent(aid(field(req,'aid')))}`);
      else if(action==='exec') upstream=await plusCall('/plus/execute',{method:'POST',body:sealOperatorPayload(normalizeExecPayload(payloadFor(req))),timeoutMs:9500});
      else if(action==='job') upstream=await plusCall(`/plus/jobs/${encodeURIComponent(jobId(field(req,'id')))}?agentId=${encodeURIComponent(aid(field(req,'aid')))}`);
      else if(action==='output'){
        const q=new URLSearchParams({agentId:aid(field(req,'aid')),stream:field(req,'stream')==='stderr'?'stderr':'stdout',full:['1','true','yes'].includes(String(field(req,'full','0')).toLowerCase())?'1':'0',offset:String(Math.max(0,Number(field(req,'offset',0))||0)),limit:String(Math.max(1,Math.min(Number(field(req,'limit',4194304))||4194304,8388608)))});
        upstream=await plusCall(`/plus/output/${encodeURIComponent(jobId(field(req,'id')))}?${q}`);
        } else { const e=new Error('plus_action_not_allowed'); e.status=403; throw e; }
        }
      }
    } else
    if(action==='capabilities') upstream=await call('/operator/capabilities');
    else if(action==='enrollment-begin') upstream=await call('/operator/enrollments/begin',{method:'POST',body:{...normalizeEnrollmentBegin(payloadFor(req)),sourceHash:enrollmentSourceHash(req)}});
    else if(action==='enrollment-poll') upstream=await call('/operator/enrollments/poll',{method:'POST',body:normalizeEnrollmentPoll(payloadFor(req))});
    else if(action==='enrollments') upstream=await call('/operator/enrollments');
    else if(action==='enrollment-cancel') upstream=await call('/operator/enrollments/cancel',{method:'POST',body:normalizeEnrollmentCancel(payloadFor(req))});
    else if(action==='enrollment-approve') upstream=await call('/operator/enrollments/approve',{method:'POST',body:normalizeEnrollmentApprove(payloadFor(req))});
    else if(action==='device-heartbeat') { const body=normalizeDeviceHeartbeat(payloadFor(req)); upstream=await call(`/operator/devices/${encodeURIComponent(body.deviceId)}/heartbeat`,{method:'POST',body}); }
    else if(action==='device-policy') { const body=normalizeDevicePolicy(payloadFor(req)); upstream=await call(`/operator/devices/${encodeURIComponent(body.deviceId)}/policy`,{method:'POST',body}); }
    else if(action==='device-revoke') { const body=normalizeDeviceRevoke(payloadFor(req)); upstream=await call(`/operator/devices/${encodeURIComponent(body.deviceId)}/revoke`,{method:'POST',body}); }
    else if(action==='devices') upstream=await call('/operator/devices');
    else if(action==='fleet') upstream=await call('/operator/fleet');
    else if(action==='node-drain') { const body=normalizeNodeDrain(payloadFor(req)); upstream=await call(`/operator/fleet/${encodeURIComponent(body.nodeId)}/drain`,{method:'POST',body}); }
    else if(action==='device') upstream=await call(`/operator/devices/${encodeURIComponent(String(field(req,'id','')))}`);
    else if(action==='device-connection') upstream=await call(`/operator/devices/${encodeURIComponent(String(field(req,'id','')))}/connection`);
    else if(action==='device-connect') upstream=await call(`/operator/devices/${encodeURIComponent(String(field(req,'id','')))}/connection/connect`,{method:'POST',body:payloadFor(req)});
    else if(action==='device-disconnect') upstream=await call(`/operator/devices/${encodeURIComponent(String(field(req,'id','')))}/connection/disconnect`,{method:'POST',body:payloadFor(req)});
    else if(action==='device-connection-grace') upstream=await call(`/operator/devices/${encodeURIComponent(String(field(req,'id','')))}/connection/grace`,{method:'POST',body:payloadFor(req)});
    else if(action==='session-open') upstream=await call('/operator/sessions/open',{method:'POST',body:normalizeSessionOpenPayload(payloadFor(req))});
    else if(action==='session-resume') upstream=await call(`/operator/sessions/${encodeURIComponent(sid(field(req,'sid')))}/resume`,{method:'POST',body:{agentId:aid(field(req,'aid'))}});
    else if(action==='session-hold') upstream=await call(`/operator/sessions/${encodeURIComponent(sid(field(req,'sid')))}/hold`,{method:'POST',body:{agentId:aid(field(req,'aid')),reason:String(field(req,'reason','transport_lost')).slice(0,80)}});
    else if(action==='session-close') upstream=await call(`/operator/sessions/${encodeURIComponent(sid(field(req,'sid')))}/close`,{method:'POST',body:{agentId:aid(field(req,'aid'))}});
    else if(action==='session') upstream=await call(`/operator/sessions/${encodeURIComponent(sid(field(req,'sid')))}?agentId=${encodeURIComponent(aid(field(req,'aid')))}`);
    else if(action==='sessions') upstream=await call('/operator/sessions');
    else if(action==='session-stats') upstream=await call(`/operator/session-stats?hours=${encodeURIComponent(String(field(req,'hours','168')))}`);
    else if(action==='exec') upstream=await execOperator(normalizeExecPayload(payloadFor(req)),{bridgeSession});
    else if(action==='job') upstream=await call(`/operator/jobs/${encodeURIComponent(jobId(field(req,'id')))}?agentId=${encodeURIComponent(aid(field(req,'aid')))}`);
    else if(action==='output') {
      const fullRaw=String(field(req,'full','0')).toLowerCase();
      const q=new URLSearchParams({
        agentId:aid(field(req,'aid')),
        stream:field(req,'stream')==='stderr'?'stderr':'stdout',
        full:['1','true','yes'].includes(fullRaw)?'1':'0',
        offset:String(Math.max(0,Number(field(req,'offset',0))||0)),
        limit:String(Math.max(1,Math.min(Number(field(req,'limit',4194304))||4194304,8388608)))
      });
      upstream=await call(`/operator/output/${encodeURIComponent(jobId(field(req,'id')))}?${q}`);
    } else {
      const e=new Error('invalid_action'); e.status=400; throw e;
    }
    const sessionId=field(req,'sid','')||upstream?.session?.sessionId||upstream?.job?.sessionId||null;
    const agentId=field(req,'aid','')||upstream?.session?.agentId||upstream?.job?.agentId||null;
    console.log(JSON.stringify({event:'operator_bridge',method:req.method,action,sessionId,agentId,nodeId:upstream?.session?.nodeId||upstream?.job?.nodeId||'arm',status:200,durationMs:Date.now()-started}));
    if(compactPlusResponse()) return res.status(200).json(upstream);
    return res.status(200).json({ok:true,bridge:'vercel',action,upstream});
  } catch(e){
    const status=e.status||400;
    if(compactPlusResponse()&&e.payload&&typeof e.payload==='object')return res.status(status).json(e.payload);
    console.warn(JSON.stringify({event:'operator_bridge',method:req.method,action,status,error:e.message,durationMs:Date.now()-started}));
    return res.status(status).json({ok:false,error:e.message,upstream:e.payload||null});
  }
};
