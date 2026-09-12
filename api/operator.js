const crypto = require("node:crypto");
const { callOperator, execOperator } = require('../lib/operator');
const { sealOperatorPayload } = require('../lib/operator-crypto');
const { aid, field, jobId, normalizeDeviceHeartbeat, normalizeDevicePolicy, normalizeDeviceRevoke, normalizeEnrollmentApprove, normalizeEnrollmentCancel, normalizeEnrollmentBegin, normalizeEnrollmentPoll, normalizeNodeDrain, normalizeExecPayload, normalizeSessionOpenPayload, payloadFor, sid } = require('../lib/operator-request');

function enrollmentSourceHash(req){ const ip=String(req.headers?.["x-forwarded-for"]||"unknown").split(",")[0].trim().slice(0,128); return crypto.createHash("sha256").update("v07-enrollment:"+ip).digest("hex"); }

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
  const compactClientActions=new Set(['list-devices','session-open','session-resume','session-hold','session-close','session','exec','job','output']);
  const compactPlusResponse=()=>plus&&(action==='connect'||action==='connect-poll'||(plusClientValid&&compactClientActions.has(action)));
  const call=(path,options={})=>callOperator(path,{...options,bridgeSession});
  const plusCall=(path,options={})=>callOperator(path,{...options,plusSession});
  const clientCall=(path,options={})=>callOperator(path,{...options,plusClient});
  const clientDevice=value=>{const v=String(value||'').trim();if(!/^[A-Za-z0-9._:-]{1,128}$/.test(v)){const e=new Error('invalid_plus_device_id');e.status=400;throw e;}return v;};
  try {
    let upstream;
    if(plus){
      if(action==='connect') {
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
        upstream=await callOperator('/plus/connect/poll',{method:'POST',body:{continuation}});
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
        if(action==='list-devices'){if(!usingClient){const e=new Error('agent_client_required');e.status=401;throw e;}upstream=await clientCall('/plus/client/devices');}
        else if(usingClient&&action==='session-open'){const d=payloadFor(req),deviceId=clientDevice(d.deviceId||d.device),body=normalizeSessionOpenPayload(d);upstream=await clientCall('/plus/client/sessions/open',{method:'POST',body:{...body,deviceId}});}
        else if(usingClient&&action==='session-resume') upstream=await clientCall(`/plus/client/sessions/${encodeURIComponent(sid(field(req,'sid')))}/resume?deviceId=${encodeURIComponent(clientDevice(field(req,'device')))}`,{method:'POST',body:{deviceId:clientDevice(field(req,'device'))}});
        else if(usingClient&&action==='session-hold') upstream=await clientCall(`/plus/client/sessions/${encodeURIComponent(sid(field(req,'sid')))}/hold?deviceId=${encodeURIComponent(clientDevice(field(req,'device')))}`,{method:'POST',body:{deviceId:clientDevice(field(req,'device')),reason:String(field(req,'reason','transport_lost')).slice(0,80)}});
        else if(usingClient&&action==='session-close') upstream=await clientCall(`/plus/client/sessions/${encodeURIComponent(sid(field(req,'sid')))}/close?deviceId=${encodeURIComponent(clientDevice(field(req,'device')))}`,{method:'POST',body:{deviceId:clientDevice(field(req,'device'))}});
        else if(usingClient&&action==='session') upstream=await clientCall(`/plus/client/sessions/${encodeURIComponent(sid(field(req,'sid')))}?deviceId=${encodeURIComponent(clientDevice(field(req,'device')))}`);
        else if(usingClient&&action==='exec'){const d=payloadFor(req),deviceId=clientDevice(d.deviceId||d.device),payload=normalizeExecPayload(d);upstream=await clientCall('/plus/client/execute',{method:'POST',body:{deviceId,envelope:sealOperatorPayload(payload)},timeoutMs:9500});}
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
