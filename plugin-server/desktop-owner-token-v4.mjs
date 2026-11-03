/**
 * Desktop V4 Owner session authority, separate from ChatGPT MCP OAuth.
 * This module is mounted only with the strict default-OFF Desktop feature.
 * Persistent Redis stores hashed opaque credentials, never raw tokens.
 * Access is read-only and does not authorize an Agent, Wall or local device.
 */
import crypto from 'node:crypto';
import {callOperatorJson} from './operator-client.mjs';
import {DESKTOP_OWNER_RESOURCE,DESKTOP_OWNER_SCOPE} from './desktop-auth-v4-contract.mjs';

export const DESKTOP_ACCESS_TTL_MS=10*60_000;
export const DESKTOP_SESSION_TTL_MS=7*24*60*60_000;

const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const SESSION=/^acctsess_[a-f0-9-]{36}$/;
const ACCOUNT=/^[A-Za-z0-9._:-]{1,128}$/;
const INSTALL=/^[A-Za-z0-9_-]{43}$/;
const hash=value=>crypto.createHash('sha256').update(String(value),'utf8').digest('hex');
function deny(code){throw Object.assign(new Error(code),{code});}
function secretHeaders(req){
  // Endpoint is for OS-native HTTPS, not browsers or cookie-based authorization.
  // Do not allow a cross-origin page to read credentials or use account cookies.
  if(req.headers?.origin || req.headers?.cookie ||
     String(req.headers?.['sec-fetch-site']||'').toLowerCase()==='cross-site')
    deny('desktop_native_client_required');
}
export async function verifyPortalSessionInternal(accountId, accountSessionId){
  if(!ACCOUNT.test(String(accountId||'')) || !SESSION.test(String(accountSessionId||'')))
    return false;
  try{
    const out=await callOperatorJson('POST','/v1/accounts/desktop-session-check',
      {accountId,sessionId:accountSessionId});
    return out?.ok===true && out?.active===true;
  }catch{return false;}
}
export function createDesktopOwnerTokenService({
  redis,prefix,consumeCode,verifyPortalSession=verifyPortalSessionInternal,
  clock=Date.now,random=crypto.randomBytes
}={}){
  if(!redis||!['get','getDel','set','del'].every(fn=>typeof redis[fn]==='function') ||
     !/^lr:gold:[a-z0-9_-]+:$/.test(String(prefix||''))||
     typeof consumeCode!=='function'||typeof verifyPortalSession!=='function')
    deny('desktop_token_storage_unavailable');
  const key=(kind,value)=>prefix+'desktop-v4:'+kind+':'+hash(value);
  const now=()=>Number(clock());
  const newSecret=()=>random(32).toString('base64url');
  async function store(kind,value,body,ttlMs){
    if(!Number.isSafeInteger(ttlMs)||ttlMs<1000)deny('desktop_session_expired');
    if(await redis.set(key(kind,value),JSON.stringify(body),{
      EX:Math.ceil(ttlMs/1000),NX:true
    })!=='OK')deny('desktop_token_storage_unavailable');
  }
  async function get(kind,value,once=false){
    if(!TOKEN.test(String(value||'')))deny('desktop_token_invalid');
    const raw=once?await redis.getDel(key(kind,value)):await redis.get(key(kind,value));
    if(!raw)deny('desktop_token_invalid');
    try{return JSON.parse(raw)}catch{deny('desktop_token_invalid')}
  }
  async function principalFor(record){
    if(!record||!TOKEN.test(String(record.familyId||'')))deny('desktop_session_invalid');
    const family=await get('family',record.familyId);
    if(family.accountId!==record.accountId||
       family.accountSessionId!==record.accountSessionId||
       family.familyId!==record.familyId||
       Number(family.expiresAt)<=now()||
       !(await verifyPortalSession(family.accountId,family.accountSessionId)))
      deny('desktop_session_revoked');
    return family;
  }
  function publicProjection(family){
    return Object.freeze({
      verified:true, accountId:family.accountId,
      scope:DESKTOP_OWNER_SCOPE,resource:DESKTOP_OWNER_RESOURCE,
      expiresAt:family.expiresAt
    });
  }
  async function issue(family){
    const remain=family.expiresAt-now();
    if(remain<1000)deny('desktop_session_expired');
    const accessToken=newSecret(),refreshToken=newSecret();
    const meta={
      purpose:'desktop_owner_v4', accountId:family.accountId,
      accountSessionId:family.accountSessionId,familyId:family.familyId
    };
    await store('access',accessToken,meta,Math.min(DESKTOP_ACCESS_TTL_MS,remain));
    await store('refresh',refreshToken,meta,remain);
    return {
      token_type:'Bearer',access_token:accessToken,
      expires_in:Math.ceil(Math.min(DESKTOP_ACCESS_TTL_MS,remain)/1000),
      refresh_token:refreshToken,scope:DESKTOP_OWNER_SCOPE,
      resource:DESKTOP_OWNER_RESOURCE,account_id:family.accountId
    };
  }
  async function exchange({code,verifier,redirectUri,installNonce,state}={}){
    const grant=await consumeCode({code,verifier,redirectUri,installNonce,state});
    if(grant?.purpose!=='desktop_owner_verified_once'||
       !ACCOUNT.test(String(grant.accountId||''))||
       !SESSION.test(String(grant.accountSessionId||''))||
       grant.resource!==DESKTOP_OWNER_RESOURCE||
       grant.scope!==DESKTOP_OWNER_SCOPE||
       !INSTALL.test(String(installNonce||'')) ||
       !(await verifyPortalSession(grant.accountId,grant.accountSessionId)))
      deny('desktop_owner_verification_required');
    const expiresAt=Math.min(now()+DESKTOP_SESSION_TTL_MS,
      Number(grant.accountSessionExpiresAt));
    if(!Number.isSafeInteger(expiresAt)||expiresAt-now()<1000)
      deny('desktop_session_expired');
    const familyId=newSecret();
    const family={
      purpose:'desktop_owner_v4',familyId,
      accountId:grant.accountId,accountSessionId:grant.accountSessionId,
      installBinding:hash(installNonce),issuedAt:now(),expiresAt
    };
    await store('family',familyId,family,expiresAt-now());
    return await issue(family);
  }
  async function refresh(refreshToken){
    // Atomically burn the former refresh before issuing another. A racing
    // second request fails closed and cannot reuse an old token.
    const record=await get('refresh',refreshToken,true);
    if(record.purpose!=='desktop_owner_v4')deny('desktop_token_invalid');
    const family=await principalFor(record);
    return await issue(family);
  }
  async function inspect(accessToken){
    const record=await get('access',accessToken);
    if(record.purpose!=='desktop_owner_v4')deny('desktop_token_invalid');
    return publicProjection(await principalFor(record));
  }
  async function logout(token){
    // An expired access may be replaced by active refresh in the OS vault.
    // Family delete invalidates ALL access/refresh descendants.
    let row;
    try{row=await get('access',token)}
    catch{row=await get('refresh',token)}
    const family=await principalFor(row);
    await redis.del(key('family',family.familyId));
    return {ok:true,revoked:true};
  }
  function error(res,e){
    const reason=String(e?.code||'');
    const allowed=new Set([
      'desktop_token_invalid','desktop_session_revoked',
      'desktop_session_invalid','desktop_session_expired',
      'desktop_owner_verification_required','desktop_native_client_required'
    ]);
    const code=allowed.has(reason)?reason:'desktop_authorization_unavailable';
    const status=code==='desktop_native_client_required'?403:
      code==='desktop_authorization_unavailable'?503:401;
    return res.status(status).json({ok:false,error:code});
  }
  function nativeOnly(req,res){
    res.set('Cache-Control','no-store');
    res.set('Pragma','no-cache');
    res.set('Referrer-Policy','no-referrer');
    res.set('X-Content-Type-Options','nosniff');
    try{
      secretHeaders(req);
      if(req.method!=='GET' && req.method!=='POST')
        deny('desktop_native_client_required');
      if(req.method==='POST' &&
         String(req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json')
        deny('desktop_native_client_required');
      return true;
    }catch(e){error(res,e);return false}
  }
  async function routeExchange(req,res){
    if(!nativeOnly(req,res))return;
    try{
      const b=req.body||{};
      return res.status(200).json(await exchange({
        code:b.code,verifier:b.code_verifier,redirectUri:b.redirect_uri,
        installNonce:b.install_nonce,state:b.state
      }));
    }catch(e){return error(res,e)}
  }
  async function routeRefresh(req,res){
    if(!nativeOnly(req,res))return;
    try{return res.status(200).json(await refresh(req.body?.refresh_token))}
    catch(e){return error(res,e)}
  }
  async function routeSession(req,res){
    if(!nativeOnly(req,res))return;
    try{
      const token=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'');
      return res.status(200).json({ok:true,...await inspect(token)});
    }catch(e){return error(res,e)}
  }
  async function routeLogout(req,res){
    if(!nativeOnly(req,res))return;
    try{
      const token=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'')
        ||req.body?.refresh_token;
      return res.status(200).json(await logout(token));
    }catch(e){return error(res,e)}
  }
  return Object.freeze({
    exchange,refresh,inspect,logout,
    routeExchange,routeRefresh,routeSession,routeLogout
  });
}
export function registerDesktopOwnerTokenRoutes(app,options={}){
  if(options.enabled!==true)return {enabled:false,routes:0};
  const service=createDesktopOwnerTokenService(options);
  app.post('/account/desktop/v4/token',service.routeExchange);
  app.post('/account/desktop/v4/refresh',service.routeRefresh);
  app.get('/account/desktop/v4/session',service.routeSession);
  app.post('/account/desktop/v4/logout',service.routeLogout);
  return {enabled:true,routes:4,service};
}
