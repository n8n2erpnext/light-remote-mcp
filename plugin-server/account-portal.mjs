import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { callOperatorJson } from './operator-client.mjs';
import { PUBLIC_ORIGIN } from './config.mjs';
import { mailConfig, sendMagicLogin, sendPasswordReset, sendUpgradeRequested, sendWelcome } from './mailer.mjs';
import { beginGoogleAuth, finishGoogleAuth, googleAuthStatus } from './google-auth.mjs';

const COOKIE='__Host-light_remote_account';
const RECOVERY_FILE=String(process.env.LIGHT_REMOTE_ACCOUNT_RECOVERY_FILE||'/etc/light-remote-direct/account-recovery.json');
const portalFile=name=>fileURLToPath(new URL(`./account-portal/${name}`,import.meta.url));
const publicAuthRate=new Map();
function clientIp(req){return String(req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim().slice(0,96);}
function allowPublicAuth(req,action,{limit=5,windowMs=15*60_000}={}){prunePublicAuthRate();const now=Date.now(),key=`${action}:${clientIp(req)}`,prior=publicAuthRate.get(key);if(!prior||prior.resetAt<=now){publicAuthRate.set(key,{count:1,resetAt:now+windowMs});return true;}if(prior.count>=limit)return false;prior.count++;return true;}
function prunePublicAuthRate(){const now=Date.now();for(const [k,v] of publicAuthRate)if(v.resetAt<=now)publicAuthRate.delete(k);}

function parseCookies(header=''){
  const out={};
  for(const part of String(header).split(';')){
    const i=part.indexOf('=');
    if(i<1)continue;
    out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function sessionToken(req){return String(parseCookies(req.headers?.cookie||'')[COOKIE]||'');}
function setSessionCookie(res,token,expiresAt){
  const maxAge=Math.max(60,Math.floor((Number(expiresAt)-Date.now())/1000));
  res.set('Set-Cookie',`${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict; Priority=High`);
}
function clearSessionCookie(res){res.set('Set-Cookie',`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Priority=High`);}
function sameOriginMutation(req){
  const site=String(req.headers?.['sec-fetch-site']||'').toLowerCase();
  if(site==='cross-site')return false;
  if(site==='same-origin')return true;
  const origin=String(req.headers?.origin||'').trim();
  if(!origin)return true;
  try{
    if(new URL(origin).origin===PUBLIC_ORIGIN)return true;
    const host=String(req.headers?.['x-forwarded-host']||req.headers?.host||'').split(',')[0].trim();
    return new URL(origin).host===host;
  }catch{return false;}
}
function method(req,res,expected){
  if(req.method===expected)return true;
  res.status(405).json({ok:false,error:'method_not_allowed'});
  return false;
}
function requireAccount(req,res){
  const token=sessionToken(req);
  if(!token){res.status(401).json({ok:false,error:'account_session_required'});return null;}
  return token;
}
function headers(token){return token?{'x-light-account-session':token}:{};}
function fail(res,error){
  const status=Number(error?.status)||502;
  const message=error?.payload?.error||error?.message||'account_unavailable';
  return res.status(status).json({ok:false,error:String(message)});
}
function sendPortal(res,name,type='html'){
  return res.type(type).send(fs.readFileSync(portalFile(name)));
}
function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function recoveryRecord(token){
  try{
    if(!token||!fs.existsSync(RECOVERY_FILE))return null;
    const row=JSON.parse(fs.readFileSync(RECOVERY_FILE,'utf8'));
    if(row?.schemaVersion!==1||row?.used===true||Number(row?.expiresAt)<=Date.now())return null;
    const got=crypto.createHash('sha256').update(String(token)).digest('hex');
    const want=String(row?.tokenSha256||'');
    const a=Buffer.from(got),b=Buffer.from(want);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
    return row;
  }catch{return null;}
}
function recoveryHtml(row,token,message=''){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Recover Light Remote account</title><link rel="stylesheet" href="/account/assets/portal.css"></head><body><main class="auth-shell"><section class="auth-card"><div class="auth-brand"><img src="/account/assets/light-remote-mark.svg" alt=""><div><strong>Light Remote</strong><div class="muted">Remote MCP</div></div></div><h1>Recover Direct account</h1><p>Set the password that Light Remote Direct should use for this account.</p>${message?`<div class="auth-error">${esc(message)}</div>`:''}<form method="post" action="/account/recover"><input type="hidden" name="token" value="${esc(token)}"><label class="field"><span>Email</span><input type="email" value="${esc(row.email)}" readonly></label><label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" minlength="10" required autofocus></label><label class="field"><span>Confirm password</span><input type="password" name="confirm" autocomplete="new-password" minlength="10" required></label><div class="auth-actions"><button class="btn btn-primary" type="submit">Update Direct password</button></div></form><div class="auth-switch">This link is single-use and expires automatically.</div></section></main></body></html>`;
}
async function accountRecovery(req,res){
  res.set('Cache-Control','no-store');
  res.set('Pragma','no-cache');
  res.set('Content-Security-Policy',"default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const token=String((req.method==='GET'?req.query?.token:req.body?.token)||'');
  const row=recoveryRecord(token);
  if(!row)return res.status(404).type('text').send('Recovery link invalid or expired.');
  if(req.method==='GET')return res.type('html').send(recoveryHtml(row,token));
  if(req.method!=='POST')return res.status(405).type('text').send('Method not allowed.');
  if(!sameOriginMutation(req))return res.status(403).type('text').send('Cross-site request denied.');
  const password=String(req.body?.password||''),confirm=String(req.body?.confirm||'');
  if(password.length<10||password.length>1024)return res.status(400).type('html').send(recoveryHtml(row,token,'Password must be between 10 and 1024 characters.'));
  if(password!==confirm)return res.status(400).type('html').send(recoveryHtml(row,token,'Passwords do not match.'));
  try{
    await callOperatorJson('POST',`/v1/admin/accounts/${encodeURIComponent(row.accountId)}/password-reset`,{password});
    const logged=await callOperatorJson('POST','/v1/accounts/login',{email:row.email,password});
    setSessionCookie(res,logged.token,logged.session?.expiresAt);
    fs.unlinkSync(RECOVERY_FILE);
    accountAudit('recover','success');
    return res.redirect(303,'/account');
  }catch(error){
    accountAudit('recover','error',error?.payload?.error||error?.message||'recovery_failed');
    return res.status(Number(error?.status)||500).type('html').send(recoveryHtml(row,token,'Recovery failed. Please retry.'));
  }
}

function accountAudit(action,status,error=''){console.log(JSON.stringify({event:'account_portal',action,status,...(error?{error:String(error).slice(0,80)}:{})}));}
async function accountApi(req,res){
  const action=String(req.query?.action||'').trim();
  const mutations=new Set(['register','login','logout','password-change','password-reset-request','password-reset-complete','magic-request','enrollment-approve','device-revoke','device-remove','device-update','devices-revoke-all','redeem-license','main-device','main-device-clear','upgrade-request']);
  if(mutations.has(action)&&!sameOriginMutation(req)){accountAudit(action,'cross_site_denied');return res.status(403).json({ok:false,error:'cross_site_request_denied'});}
  try{
    if(action==='register'||action==='login'){
      if(!method(req,res,'POST'))return;
      const allowed=allowPublicAuth(req,action,action==='register'?{limit:4,windowMs:60*60_000}:{limit:12,windowMs:15*60_000});if(!allowed)return res.status(429).json({ok:false,error:'account_rate_limited'});
      const target=action==='register'?'/v1/plugin/accounts/register':'/v1/accounts/login';
      const upstream=await callOperatorJson('POST',target,{email:req.body?.email,password:req.body?.password,issueSession:true});
      setSessionCookie(res,upstream.token,upstream.session?.expiresAt);
      if(action==='register')sendWelcome({to:upstream.account?.email}).catch(error=>accountAudit('welcome-mail','error',error?.message||'mail_failed'));
      accountAudit(action,'success');
      return res.status(action==='register'?201:200).json({ok:true,account:upstream.account,session:upstream.session});
    }
    if(action==='password-reset-request'){
      if(!method(req,res,'POST'))return;
      if(!allowPublicAuth(req,action,{limit:5,windowMs:30*60_000}))return res.status(429).json({ok:false,error:'account_rate_limited'});
      const issued=await callOperatorJson('POST','/v1/plugin/accounts/password-reset/request',{email:req.body?.email});
      if(issued?.issued&&issued?.token&&issued?.account?.email){
        const resetUrl=`${PUBLIC_ORIGIN}/account/reset?token=${encodeURIComponent(issued.token)}`;
        await sendPasswordReset({to:issued.account.email,resetUrl}).catch(error=>accountAudit('password-reset-mail','error',error?.message||'mail_failed'));
      }
      return res.status(200).json({ok:true,accepted:true});
    }
    if(action==='password-reset-complete'){
      if(!method(req,res,'POST'))return;
      const upstream=await callOperatorJson('POST','/v1/plugin/accounts/password-reset/consume',{token:req.body?.token,password:req.body?.password});
      setSessionCookie(res,upstream.token,upstream.session?.expiresAt);
      return res.status(200).json({ok:true,account:upstream.account,session:upstream.session});
    }
    if(action==='magic-request'){
      if(!method(req,res,'POST'))return;
      if(!allowPublicAuth(req,action,{limit:5,windowMs:30*60_000}))return res.status(429).json({ok:false,error:'account_rate_limited'});
      const issued=await callOperatorJson('POST','/v1/plugin/accounts/magic/request',{email:req.body?.email});
      if(issued?.issued&&issued?.token&&issued?.account?.email){
        const loginUrl=`${PUBLIC_ORIGIN}/account/magic?token=${encodeURIComponent(issued.token)}`;
        await sendMagicLogin({to:issued.account.email,loginUrl}).catch(error=>accountAudit('magic-mail','error',error?.message||'mail_failed'));
      }
      return res.status(200).json({ok:true,accepted:true});
    }
    if(action==='auth-capabilities'){
      if(!method(req,res,'GET'))return;
      return res.status(200).json({ok:true,google:googleAuthStatus(),mailConfigured:Boolean(mailConfig())});
    }
    if(action==='me'||action==='devices'||action==='usage'){
      if(!method(req,res,'GET'))return;
      const token=requireAccount(req,res);if(!token)return;
      const target=action==='usage'
        ?`/v1/accounts/usage?months=${Math.max(1,Math.min(Number(req.query?.months)||6,24))}`
        :`/v1/accounts/${action}`;
      return res.status(200).json(await callOperatorJson('GET',target,null,headers(token)));
    }
    if(action==='logout'){
      if(!method(req,res,'POST'))return;
      const token=sessionToken(req);
      if(token)await callOperatorJson('POST','/v1/accounts/logout',{},headers(token)).catch(()=>{});
      clearSessionCookie(res);
      return res.status(200).json({ok:true,loggedOut:true});
    }
    if(action==='password-change'){
      if(!method(req,res,'POST'))return;
      const token=requireAccount(req,res);if(!token)return;
      const upstream=await callOperatorJson('POST','/v1/accounts/password',{currentPassword:req.body?.currentPassword,newPassword:req.body?.newPassword},headers(token));
      setSessionCookie(res,upstream.token,upstream.session?.expiresAt);
      accountAudit(action,'success');
      return res.status(200).json({ok:true,account:upstream.account,session:upstream.session});
    }
    const token=requireAccount(req,res);if(!token)return;
    if(action==='upgrade-request'){
      if(req.method==='GET')return res.status(200).json(await callOperatorJson('GET','/v1/accounts/upgrade-request',null,headers(token)));
      if(!method(req,res,'POST'))return;
      const out=await callOperatorJson('POST','/v1/accounts/upgrade-request',{plan:req.body?.plan||'pro'},headers(token));
      sendUpgradeRequested({to:out.account?.email,plan:out.request?.plan||req.body?.plan||'pro'}).catch(error=>accountAudit('upgrade-mail','error',error?.message||'mail_failed'));
      return res.status(201).json(out);
    }
    if(action==='enrollment-approve'){
      if(!method(req,res,'POST'))return;
      return res.status(200).json(await callOperatorJson('POST','/v1/accounts/enrollments/approve',{code:req.body?.code},headers(token)));
    }
    if(action==='device-update'||action==='device-revoke'||action==='device-remove'){
      if(!method(req,res,'POST'))return;
      const id=String(req.body?.deviceId||'').trim();
      if(!/^[A-Za-z0-9._:-]{1,128}$/.test(id))return res.status(400).json({ok:false,error:'invalid_device_id'});
      const suffix=action==='device-update'?'update':action==='device-revoke'?'revoke':'remove';
      const body=action==='device-update'?{force:req.body?.force===true}:{};
      return res.status(200).json(await callOperatorJson('POST',`/v1/accounts/devices/${encodeURIComponent(id)}/${suffix}`,body,headers(token)));
    }
    if(action==='devices-revoke-all'){
      if(!method(req,res,'POST'))return;
      return res.status(200).json(await callOperatorJson('POST','/v1/accounts/devices/revoke-all',{},headers(token)));
    }
    if(action==='main-device'){
      if(!method(req,res,'POST'))return;
      return res.status(200).json(await callOperatorJson('POST','/v1/accounts/main-device',{deviceId:req.body?.deviceId},headers(token)));
    }
    if(action==='main-device-clear'){
      if(!method(req,res,'POST'))return;
      return res.status(200).json(await callOperatorJson('POST','/v1/accounts/main-device/clear',{},headers(token)));
    }
    if(action==='redeem-license'){
      if(!method(req,res,'POST'))return;
      return res.status(200).json(await callOperatorJson('POST','/v1/accounts/redeem-license',{key:req.body?.key},headers(token)));
    }
    return res.status(400).json({ok:false,error:'unknown_account_action'});
  }catch(error){if(action==='login'||action==='register')accountAudit(action,'error',error?.payload?.error||error?.message||'account_unavailable');return fail(res,error);}
}

async function accountMagic(req,res){
  try{
    const token=String(req.query?.token||'');if(!token)throw Object.assign(new Error('magic_token_required'),{status:400});
    const upstream=await callOperatorJson('POST','/v1/plugin/accounts/magic/consume',{token});
    setSessionCookie(res,upstream.token,upstream.session?.expiresAt);accountAudit('magic-login','success');return res.redirect(303,'/account');
  }catch(error){accountAudit('magic-login','error',error?.payload?.error||error?.message||'magic_login_failed');return res.redirect(303,'/account/login?error=magic_link_invalid');}
}
function accountGoogleBegin(_req,res){
  try{return res.redirect(302,beginGoogleAuth().url);}
  catch(error){accountAudit('google-begin','error',error?.message||'google_oauth_unavailable');return res.redirect(303,'/account/login?error=google_unavailable');}
}
async function accountGoogleCallback(req,res){
  try{
    const identity=await finishGoogleAuth({state:req.query?.state,code:req.query?.code});
    const upstream=await callOperatorJson('POST','/v1/plugin/auth/google',identity);
    setSessionCookie(res,upstream.token,upstream.session?.expiresAt);
    if(upstream.created)sendWelcome({to:upstream.account?.email}).catch(error=>accountAudit('welcome-mail','error',error?.message||'mail_failed'));
    accountAudit('google-login','success');return res.redirect(303,'/account');
  }catch(error){accountAudit('google-login','error',error?.payload?.error||error?.message||'google_login_failed');return res.redirect(303,'/account/login?error=google_login_failed');}
}

export function registerAccountPortal(app){
  app.get(['/account','/account/'],(_q,r)=>sendPortal(r,'index.html'));
  app.get(['/account/usage','/account/usage/'],(_q,r)=>sendPortal(r,'usage.html'));
  app.get(['/account/billing','/account/billing/'],(_q,r)=>sendPortal(r,'billing.html'));
  app.get(['/account/settings','/account/settings/'],(_q,r)=>sendPortal(r,'settings.html'));
  app.get(['/account/login','/account/login/'],(_q,r)=>sendPortal(r,'login.html'));
  app.get(['/account/register','/account/register/'],(_q,r)=>sendPortal(r,'register.html'));
  app.get(['/account/reset','/account/reset/'],(_q,r)=>sendPortal(r,'reset.html'));
  app.get('/account/magic',accountMagic);
  app.get('/account/google',accountGoogleBegin);
  app.get('/account/google/callback',accountGoogleCallback);
  app.get('/account/recover',accountRecovery);
  app.post('/account/recover',accountRecovery);
  app.get('/account/assets/portal.css',(_q,r)=>sendPortal(r,'portal.css','text/css'));
  app.get('/account/assets/theme.js',(_q,r)=>sendPortal(r,'theme.js','application/javascript'));
  app.get('/account/assets/light-remote-mark.svg',(_q,r)=>sendPortal(r,'light-remote-mark.svg','image/svg+xml'));
  app.get('/account/assets/chatgpt-logo.svg',(_q,r)=>sendPortal(r,'chatgpt-logo.svg','image/svg+xml'));
  app.get('/account/assets/google-g.svg',(_q,r)=>sendPortal(r,'google-g.svg','image/svg+xml'));
  app.get('/account/assets/light-remote.ico',(_q,r)=>sendPortal(r,'light-remote.ico','image/x-icon'));
  app.all('/account/api',accountApi);
}
