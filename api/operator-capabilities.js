const { callOperator } = require('../lib/operator');
module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
  try{return res.status(200).json({ok:true,bridge:'vercel',upstream:await callOperator('/operator/capabilities')});}
  catch(e){return res.status(e.status||502).json({ok:false,error:e.message,upstream:e.payload||null});}
};
