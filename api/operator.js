const crypto = require("node:crypto");
const { callOperator, execOperator } = require('../lib/operator');
const { sealOperatorPayload } = require('../lib/operator-crypto');
const { aid, field, jobId, normalizeDeviceHeartbeat, normalizeDevicePolicy, normalizeDeviceRevoke, normalizeEnrollmentApprove, normalizeEnrollmentCancel, normalizeEnrollmentBegin, normalizeEnrollmentPoll, normalizeNodeDrain, normalizeExecPayload, normalizeSessionOpenPayload, payloadFor, sid } = require('../lib/operator-request');

function enrollmentSourceHash(req){ const ip=String(req.headers?.["x-forwarded-for"]||"unknown").split(",")[0].trim().slice(0,128); return crypto.createHash("sha256").update("v07-enrollment:"+ip).digest("hex"); }

module.exports=async function handler(req,res){
  const started=Date.now();
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  if(!['GET','POST'].includes(req.method)) return res.status(405).json({ok:false,error:'method_not_allowed'});
  const action=String(field(req,'action','capabilities'));
  const wantsPlus=String(field(req,'via',''))==='plus';
  const plus=wantsPlus && req.method==='GET' && String(process.env.VERCEL_ENV||'')==='preview';
  if(wantsPlus&&!plus) return res.status(403).json({ok:false,error:'plus_bridge_preview_only'});
  const bridgeSession=String(req.headers?.['x-bridge-session']||'');
  const call=(path,options={})=>callOperator(path,{...options,bridgeSession});
  const plusCall=(path,options={})=>callOperator(path,options);
  try {
    let upstream;
    if(plus){
      if(action==='capabilities') upstream=await plusCall('/plus/capabilities');
      else if(action==='devices') upstream=await plusCall('/plus/devices');
      else if(action==='fleet') upstream=await plusCall('/plus/fleet');
      else if(action==='device') upstream=await plusCall(`/plus/devices/${encodeURIComponent(String(field(req,'id','')))}`);
      else if(action==='sessions') upstream=await plusCall('/plus/sessions');
      else if(action==='session-open') upstream=await plusCall('/plus/sessions/open',{method:'POST',body:normalizeSessionOpenPayload(payloadFor(req))});
      else if(action==='session-resume') upstream=await plusCall(`/plus/sessions/${encodeURIComponent(sid(field(req,'sid')))}/resume`,{method:'POST',body:{agentId:aid(field(req,'aid'))}});
      else if(action==='session-close') upstream=await plusCall(`/plus/sessions/${encodeURIComponent(sid(field(req,'sid')))}/close`,{method:'POST',body:{agentId:aid(field(req,'aid'))}});
      else if(action==='session') upstream=await plusCall(`/plus/sessions/${encodeURIComponent(sid(field(req,'sid')))}?agentId=${encodeURIComponent(aid(field(req,'aid')))}`);
      else if(action==='exec') upstream=await plusCall('/plus/execute',{method:'POST',body:sealOperatorPayload(normalizeExecPayload(payloadFor(req))),timeoutMs:9500});
      else if(action==='job') upstream=await plusCall(`/plus/jobs/${encodeURIComponent(jobId(field(req,'id')))}?agentId=${encodeURIComponent(aid(field(req,'aid')))}`);
      else if(action==='output'){
        const q=new URLSearchParams({agentId:aid(field(req,'aid')),stream:field(req,'stream')==='stderr'?'stderr':'stdout',full:['1','true','yes'].includes(String(field(req,'full','0')).toLowerCase())?'1':'0',offset:String(Math.max(0,Number(field(req,'offset',0))||0)),limit:String(Math.max(1,Math.min(Number(field(req,'limit',4194304))||4194304,8388608)))});
        upstream=await plusCall(`/plus/output/${encodeURIComponent(jobId(field(req,'id')))}?${q}`);
      } else { const e=new Error('plus_action_not_allowed'); e.status=403; throw e; }
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
    else if(action==='session-open') upstream=await call('/operator/sessions/open',{method:'POST',body:normalizeSessionOpenPayload(payloadFor(req))});
    else if(action==='session-resume') upstream=await call(`/operator/sessions/${encodeURIComponent(sid(field(req,'sid')))}/resume`,{method:'POST',body:{agentId:aid(field(req,'aid'))}});
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
    return res.status(200).json({ok:true,bridge:'vercel',action,upstream});
  } catch(e){
    const status=e.status||400;
    console.warn(JSON.stringify({event:'operator_bridge',method:req.method,action,status,error:e.message,durationMs:Date.now()-started}));
    return res.status(status).json({ok:false,error:e.message,upstream:e.payload||null});
  }
};
