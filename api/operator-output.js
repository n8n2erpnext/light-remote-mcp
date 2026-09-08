const { callOperator } = require('../lib/operator');
module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
  const id=String(req.query.id||''); if(!/^[0-9a-f-]{20,}$/i.test(id))return res.status(400).json({ok:false,error:'invalid_job_id'});
  const q=new URLSearchParams(); q.set('stream',req.query.stream==='stderr'?'stderr':'stdout'); q.set('full',req.query.full==='1'?'1':'0');
  q.set('offset',String(Math.max(0,Number(req.query.offset)||0))); q.set('limit',String(Math.max(1,Math.min(Number(req.query.limit)||4194304,8388608))));
  try{return res.status(200).json({ok:true,bridge:'vercel',upstream:await callOperator(`/operator/output/${encodeURIComponent(id)}?${q}`)});}
  catch(e){return res.status(e.status||502).json({ok:false,error:e.message,upstream:e.payload||null});}
};
