const { callOperator, execOperator } = require('../lib/operator');
function sid(value){ const v=String(value||''); if(!/^[A-Za-z0-9._:-]{1,128}$/.test(v)) throw new Error('invalid_session_id'); return v; }
function id(value){ const v=String(value||''); if(!/^[0-9a-f-]{20,}$/i.test(v)) throw new Error('invalid_job_id'); return v; }
function execPayload(value){
  if(!value) throw new Error('missing_payload');
  const d=JSON.parse(Buffer.from(String(value),'base64url').toString('utf8'));
  if(typeof d.script!=='string'||!d.script.trim()) throw new Error('invalid_script');
  const operationId=String(d.operationId||'').trim();
  if(!/^[A-Za-z0-9._:-]{16,128}$/.test(operationId)) throw new Error('invalid_operation_id');
  return { action:'exec_batch', operationId, script:d.script, cwd:d.cwd||'/home/ubuntu',
    timeoutMs:Math.max(1000,Math.min(Number(d.timeoutMs)||600000,7200000)),
    waitMs:Math.max(0,Math.min(Number(d.waitMs)||7000,7000)), sessionId:String(d.sessionId||'chatgpt'), note:String(d.note||'') };
}
module.exports=async function handler(req,res){
  const started=Date.now(); let action=String(req.query.action||'capabilities');
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'method_not_allowed'});
  try {
    let upstream;
    if(action==='capabilities') upstream=await callOperator('/operator/capabilities');
    else if(action==='session-open') { const d=req.query.p?JSON.parse(Buffer.from(String(req.query.p),'base64url').toString('utf8')):{}; const openId=String(d.openId||'').trim(); if(!/^[A-Za-z0-9._:-]{16,128}$/.test(openId)) throw new Error('invalid_session_open_id'); upstream=await callOperator('/operator/sessions/open',{method:'POST',body:{openId,label:String(d.label||''),workspace:String(d.workspace||'')}}); }
    else if(action==='session-resume') upstream=await callOperator(`/operator/sessions/${encodeURIComponent(sid(req.query.sid))}/resume`,{method:'POST',body:{}});
    else if(action==='session-close') upstream=await callOperator(`/operator/sessions/${encodeURIComponent(sid(req.query.sid))}/close`,{method:'POST',body:{}});
    else if(action==='session') upstream=await callOperator(`/operator/sessions/${encodeURIComponent(sid(req.query.sid))}`);
    else if(action==='sessions') upstream=await callOperator('/operator/sessions');
    else if(action==='session-stats') upstream=await callOperator(`/operator/session-stats?hours=${encodeURIComponent(String(req.query.hours||'168'))}`);
    else if(action==='exec') upstream=await execOperator(execPayload(req.query.p));
    else if(action==='job') upstream=await callOperator(`/operator/jobs/${encodeURIComponent(id(req.query.id))}`);
    else if(action==='output') {
      const q=new URLSearchParams({stream:req.query.stream==='stderr'?'stderr':'stdout',full:req.query.full==='1'?'1':'0',
        offset:String(Math.max(0,Number(req.query.offset)||0)),limit:String(Math.max(1,Math.min(Number(req.query.limit)||4194304,8388608)))});
      upstream=await callOperator(`/operator/output/${encodeURIComponent(id(req.query.id))}?${q}`);
    } else throw new Error('invalid_action');
    console.log(JSON.stringify({event:'operator_bridge',action,sessionId:req.query.sid||upstream?.session?.sessionId||upstream?.job?.sessionId||null,status:200,durationMs:Date.now()-started}));
    return res.status(200).json({ok:true,bridge:'vercel',action,upstream});
  } catch(e){ const status=e.status||400; console.warn(JSON.stringify({event:'operator_bridge',action,sessionId:req.query.sid||null,status,error:e.message,durationMs:Date.now()-started})); return res.status(status).json({ok:false,error:e.message,upstream:e.payload||null}); }
};
