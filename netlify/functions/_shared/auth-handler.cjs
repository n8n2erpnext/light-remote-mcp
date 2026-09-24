const {callOperator}=require('./operator-netlify.cjs');
const COOKIE='__Host-light_remote_account';

function method(req,res,expected){if(req.method===expected)return true;res.status(405).json({ok:false,error:'method_not_allowed'});return false}
function parseCookies(header=''){const out={};for(const part of String(header).split(';')){const i=part.indexOf('=');if(i<1)continue;out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim())}return out}
function sessionToken(req){return String(parseCookies(req.headers?.cookie||'')[COOKIE]||'')}
function setSessionCookie(res,token,expiresAt){const maxAge=Math.max(60,Math.floor((Number(expiresAt)-Date.now())/1000));res.setHeader('Set-Cookie',`${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict; Priority=High`)}
function clearSessionCookie(res){res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Priority=High`)}
function sameOriginMutation(req){const site=String(req.headers?.['sec-fetch-site']||'').toLowerCase();if(site==='cross-site')return false;const origin=String(req.headers?.origin||'');if(!origin)return true;try{const host=String(req.headers?.['x-forwarded-host']||req.headers?.host||'').split(',')[0].trim();return new URL(origin).host===host}catch{return false}}
function noStore(res){res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive')}
function accountRequired(req,res){const token=sessionToken(req);if(!token){res.status(401).json({ok:false,error:'account_session_required'});return null}return token}

async function accountAction(req,res,action){
 const mutations=new Set(['register','login','logout','enrollment-approve','device-revoke','device-remove','device-update','devices-revoke-all','redeem-license','main-device','main-device-clear']);
 if(mutations.has(action)&&!sameOriginMutation(req))return res.status(403).json({ok:false,error:'cross_site_request_denied'});
 if(action==='register'||action==='login'){
  if(!method(req,res,'POST'))return;
  const upstream=await callOperator(`/account/${action}`,{method:'POST',body:{email:req.body?.email,password:req.body?.password,ownerPassword:req.body?.ownerPassword,ownerCode:req.body?.ownerCode},timeoutMs:9000});
  setSessionCookie(res,upstream.token,upstream.session?.expiresAt);
  return res.status(action==='register'?201:200).json({ok:true,account:upstream.account,session:upstream.session});
 }
 if(action==='me'||action==='devices'||action==='usage'){
  if(!method(req,res,'GET'))return;const token=accountRequired(req,res);if(!token)return;
  return res.status(200).json(await callOperator(`/account/${action}`,{accountSession:token,timeoutMs:9000}));
 }
 if(action==='logout'){
  if(!method(req,res,'POST'))return;const token=sessionToken(req);
  if(token)await callOperator('/account/logout',{method:'POST',body:{},accountSession:token,timeoutMs:9000}).catch(()=>{});
  clearSessionCookie(res);return res.status(200).json({ok:true,loggedOut:true});
 }
 if(action==='enrollment-approve'){
  if(!method(req,res,'POST'))return;const token=accountRequired(req,res);if(!token)return;
  return res.status(200).json(await callOperator('/account/enrollments/approve',{method:'POST',body:{code:req.body?.code},accountSession:token,timeoutMs:9000}));
 }
 if(action==='device-update'){
  if(!method(req,res,'POST'))return;const token=accountRequired(req,res);if(!token)return;
  const id=String(req.body?.deviceId||'').trim();if(!/^[A-Za-z0-9._:-]{1,128}$/.test(id))return res.status(400).json({ok:false,error:'invalid_device_id'});
  if(req.body?.force!==true)return res.status(428).json({ok:false,error:'force_update_confirmation_required'});
  return res.status(200).json(await callOperator(`/account/devices/${encodeURIComponent(id)}/update`,{method:'POST',body:{force:true},accountSession:token,timeoutMs:9000}));
 }
 if(action==='device-revoke'||action==='device-remove'){
  if(!method(req,res,'POST'))return;const token=accountRequired(req,res);if(!token)return;
  const id=String(req.body?.deviceId||'').trim();if(!/^[A-Za-z0-9._:-]{1,128}$/.test(id))return res.status(400).json({ok:false,error:'invalid_device_id'});
  const verb=action==='device-revoke'?'revoke':'remove';
  return res.status(200).json(await callOperator(`/account/devices/${encodeURIComponent(id)}/${verb}`,{method:'POST',body:{},accountSession:token,timeoutMs:9000}));
 }
 if(action==='devices-revoke-all'){
  if(!method(req,res,'POST'))return;const token=accountRequired(req,res);if(!token)return;
  return res.status(200).json(await callOperator('/account/devices/revoke-all',{method:'POST',body:{},accountSession:token,timeoutMs:9000}));
 }
 if(action==='main-device'){
  if(!method(req,res,'POST'))return;const token=accountRequired(req,res);if(!token)return;
  const deviceId=String(req.body?.deviceId||'').trim();if(!/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId))return res.status(400).json({ok:false,error:'invalid_device_id'});
  return res.status(200).json(await callOperator('/account/main-device',{method:'POST',body:{deviceId},accountSession:token,timeoutMs:9000}));
 }
 if(action==='main-device-clear'){
  if(!method(req,res,'POST'))return;const token=accountRequired(req,res);if(!token)return;
  return res.status(200).json(await callOperator('/account/main-device/clear',{method:'POST',body:{},accountSession:token,timeoutMs:9000}));
 }
 if(action==='redeem-license'){
  if(!method(req,res,'POST'))return;const token=accountRequired(req,res);if(!token)return;
  const key=String(req.body?.key||'').trim();if(key.length<10||key.length>80)return res.status(400).json({ok:false,error:'license_key_invalid'});
  return res.status(200).json(await callOperator('/account/redeem-license',{method:'POST',body:{key},accountSession:token,timeoutMs:9000}));
 }
 return res.status(400).json({ok:false,error:'unknown_account_action'});
}

module.exports=async function handler(req,res){
 noStore(res);
 const action=String(req.query?.action||'').trim();
 try{
  if(action)return await accountAction(req,res,action);
  if(!method(req,res,'POST'))return;
  const username=String(req.body?.username||''),password=String(req.body?.password||'');
  if(!username||username.length>128||!password||password.length>1024)return res.status(400).json({ok:false,error:'invalid_login_payload'});
  const upstream=await callOperator('/operator/auth/login',{method:'POST',body:{username,password},timeoutMs:9000});
  return res.status(200).json({ok:true,session:upstream.session});
 }catch(error){
  const status=error.status||502;
  return res.status(status).json({ok:false,error:error.payload?.error||error.message});
 }
};
