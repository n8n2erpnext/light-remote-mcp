const { callOperator, execOperator } = require('../lib/operator');
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
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'method_not_allowed'});
  try {
    const action=String(req.query.action||'capabilities'); let upstream;
    if(action==='capabilities') upstream=await callOperator('/operator/capabilities');
    else if(action==='exec') upstream=await execOperator(execPayload(req.query.p));
    else if(action==='job') upstream=await callOperator(`/operator/jobs/${encodeURIComponent(id(req.query.id))}`);
    else if(action==='output') {
      const q=new URLSearchParams({stream:req.query.stream==='stderr'?'stderr':'stdout',full:req.query.full==='1'?'1':'0',
        offset:String(Math.max(0,Number(req.query.offset)||0)),limit:String(Math.max(1,Math.min(Number(req.query.limit)||4194304,8388608)))});
      upstream=await callOperator(`/operator/output/${encodeURIComponent(id(req.query.id))}?${q}`);
    } else throw new Error('invalid_action');
    return res.status(200).json({ok:true,bridge:'vercel',action,upstream});
  } catch(e){ return res.status(e.status||400).json({ok:false,error:e.message,upstream:e.payload||null}); }
};
