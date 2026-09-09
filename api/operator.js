const { callOperator, execOperator } = require('../lib/operator');
const { requireBridgeCaller } = require('../lib/caller-auth');
const { aid, field, jobId, normalizeExecPayload, normalizeSessionOpenPayload, payloadFor, sid } = require('../lib/operator-request');

module.exports=async function handler(req,res){
  const started=Date.now();
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  if(!['GET','POST'].includes(req.method)) return res.status(405).json({ok:false,error:'method_not_allowed'});
  if(!requireBridgeCaller(req,res)) return;
  const action=String(field(req,'action','capabilities'));
  try {
    let upstream;
    if(action==='capabilities') upstream=await callOperator('/operator/capabilities');
    else if(action==='devices') upstream=await callOperator('/operator/devices');
    else if(action==='device') upstream=await callOperator(`/operator/devices/${encodeURIComponent(String(field(req,'id','')))}`);
    else if(action==='session-open') upstream=await callOperator('/operator/sessions/open',{method:'POST',body:normalizeSessionOpenPayload(payloadFor(req))});
    else if(action==='session-resume') upstream=await callOperator(`/operator/sessions/${encodeURIComponent(sid(field(req,'sid')))}/resume`,{method:'POST',body:{agentId:aid(field(req,'aid'))}});
    else if(action==='session-close') upstream=await callOperator(`/operator/sessions/${encodeURIComponent(sid(field(req,'sid')))}/close`,{method:'POST',body:{agentId:aid(field(req,'aid'))}});
    else if(action==='session') upstream=await callOperator(`/operator/sessions/${encodeURIComponent(sid(field(req,'sid')))}?agentId=${encodeURIComponent(aid(field(req,'aid')))}`);
    else if(action==='sessions') upstream=await callOperator('/operator/sessions');
    else if(action==='session-stats') upstream=await callOperator(`/operator/session-stats?hours=${encodeURIComponent(String(field(req,'hours','168')))}`);
    else if(action==='exec') upstream=await execOperator(normalizeExecPayload(payloadFor(req)));
    else if(action==='job') upstream=await callOperator(`/operator/jobs/${encodeURIComponent(jobId(field(req,'id')))}?agentId=${encodeURIComponent(aid(field(req,'aid')))}`);
    else if(action==='output') {
      const fullRaw=String(field(req,'full','0')).toLowerCase();
      const q=new URLSearchParams({
        agentId:aid(field(req,'aid')),
        stream:field(req,'stream')==='stderr'?'stderr':'stdout',
        full:['1','true','yes'].includes(fullRaw)?'1':'0',
        offset:String(Math.max(0,Number(field(req,'offset',0))||0)),
        limit:String(Math.max(1,Math.min(Number(field(req,'limit',4194304))||4194304,8388608)))
      });
      upstream=await callOperator(`/operator/output/${encodeURIComponent(jobId(field(req,'id')))}?${q}`);
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
