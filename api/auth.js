const { callOperator } = require('../lib/operator');
const { sessionToken, setSessionCookie, clearSessionCookie, sameOriginMutation, noStore } = require('../lib/account-web');

function method(req, res, expected) {
  if (req.method === expected) return true;
  res.status(405).json({ ok:false, error:'method_not_allowed' });
  return false;
}
function accountSession(req) { return sessionToken(req); }
function accountRequired(req, res) {
  const token=accountSession(req);
  if (!token) { res.status(401).json({ok:false,error:'account_session_required'}); return null; }
  return token;
}
async function accountAction(req,res,action){
  const mutations=new Set(['register','login','logout','enrollment-approve','device-revoke','devices-revoke-all']);
  if(mutations.has(action)&&!sameOriginMutation(req))return res.status(403).json({ok:false,error:'cross_site_request_denied'});
  if(action==='register'||action==='login'){
    if(!method(req,res,'POST'))return;
    const upstream=await callOperator(`/account/${action}`,{method:'POST',body:{email:req.body?.email,password:req.body?.password,ownerPassword:req.body?.ownerPassword,ownerCode:req.body?.ownerCode},timeoutMs:9000});
    setSessionCookie(res,upstream.token,upstream.session?.expiresAt);
    return res.status(action==='register'?201:200).json({ok:true,account:upstream.account,session:upstream.session});
  }
  if(action==='me'||action==='devices'){
    if(!method(req,res,'GET'))return; const token=accountRequired(req,res); if(!token)return;
    const upstream=await callOperator(`/account/${action}`,{accountSession:token,timeoutMs:9000});
    return res.status(200).json(upstream);
  }
  if(action==='logout'){
    if(!method(req,res,'POST'))return; const token=accountSession(req);
    if(token)await callOperator('/account/logout',{method:'POST',body:{},accountSession:token,timeoutMs:9000}).catch(()=>{});
    clearSessionCookie(res); return res.status(200).json({ok:true,loggedOut:true});
  }
  if(action==='enrollment-approve'){
    if(!method(req,res,'POST'))return; const token=accountRequired(req,res); if(!token)return;
    const upstream=await callOperator('/account/enrollments/approve',{method:'POST',body:{code:req.body?.code},accountSession:token,timeoutMs:9000});
    return res.status(200).json(upstream);
  }
  if(action==='device-revoke'){
    if(!method(req,res,'POST'))return; const token=accountRequired(req,res); if(!token)return;
    const id=String(req.body?.deviceId||'').trim(); if(!/^[A-Za-z0-9._:-]{1,128}$/.test(id))return res.status(400).json({ok:false,error:'invalid_device_id'});
    const upstream=await callOperator(`/account/devices/${encodeURIComponent(id)}/revoke`,{method:'POST',body:{},accountSession:token,timeoutMs:9000});
    return res.status(200).json(upstream);
  }
  if(action==='devices-revoke-all'){
    if(!method(req,res,'POST'))return; const token=accountRequired(req,res); if(!token)return;
    const upstream=await callOperator('/account/devices/revoke-all',{method:'POST',body:{},accountSession:token,timeoutMs:9000});
    return res.status(200).json(upstream);
  }
  return res.status(400).json({ok:false,error:'unknown_account_action'});
}

module.exports = async function handler(req, res) {
  noStore(res);
  const action=String(req.query?.action||'').trim();
  try {
    if(action)return await accountAction(req,res,action);
    if(!method(req,res,'POST'))return;
    const username=String(req.body?.username||''),password=String(req.body?.password||'');
    if(!username||username.length>128||!password||password.length>1024)return res.status(400).json({ok:false,error:'invalid_login_payload'});
    const upstream=await callOperator('/operator/auth/login',{method:'POST',body:{username,password},timeoutMs:9000});
    return res.status(200).json({ok:true,session:upstream.session});
  } catch(error) {
    const status=error.status||502;
    return res.status(status).json({ok:false,error:error.payload?.error||error.message});
  }
};
