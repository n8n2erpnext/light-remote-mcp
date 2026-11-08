import {apiPath} from '../lib/api-contract.mjs';
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
  clock=Date.now,random=crypto.randomBytes,
  operatorCall=callOperatorJson
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
  // T06: Native-only read model. The Owner access is checked against the
  // live Redis family and the Portal session BEFORE reaching Operator, where
  // the same Owner/session pair is checked independently once more.
  function inventoryPageInput(page){
    if(page===null||page===undefined)return null;
    if(!page||typeof page!=='object'||Array.isArray(page)||
       Object.keys(page).some(k=>!['kind','cursor','limit'].includes(k))||
       !['devices','grants','usage','jobs','sessions'].includes(page.kind)||
       (page.cursor!=null&&(typeof page.cursor!=='string'||page.cursor.length>512||
        (page.cursor&&!/^[A-Za-z0-9_-]+$/.test(page.cursor))))||
       (page.limit!==undefined&&(!Number.isSafeInteger(page.limit)||page.limit<1||page.limit>100)))
       deny('desktop_inventory_page_invalid');
    return {kind:page.kind,...(page.cursor?{cursor:page.cursor}:{}),
      ...(page.limit===undefined?{}:{limit:page.limit})};
  }
  async function snapshot(accessToken,page=null){
    const record=await get('access',accessToken);
    if(record.purpose!=='desktop_owner_v4')deny('desktop_token_invalid');
    const family=await principalFor(record);
    if(typeof operatorCall!=='function')
      deny('desktop_snapshot_unavailable');
    const inventory=inventoryPageInput(page);
    const result=await operatorCall('POST',apiPath('operatorOwnerSnapshot'),{
      accountId:family.accountId,accountSessionId:family.accountSessionId,
      ...(inventory?{page:inventory}:{})
    });
    const allowedPageSource=inventory?.kind==='usage'?['owner_current_month_usage']:
      inventory?.kind==='jobs'?['postgresql_owner_job_history','in_memory_current_window']:
      inventory?.kind==='sessions'?['redis_retained_session_window','in_memory_current_window']:
      ['owner_live_membership_revision'];
    const retention=result?.coverage?.retention;
    const redisSessionPage=inventory?.kind==='sessions'&&
      result?.coverage?.source==='redis_retained_session_window';
    const sessionRetentionValid=redisSessionPage?
      retention&&typeof retention==='object'&&!Array.isArray(retention)&&
      retention.snapshotTtlSeconds===604800&&
      Number.isSafeInteger(retention.terminalPruneAfterMs)&&
      retention.terminalPruneAfterMs>=0&&
      retention.terminalPruneAfterMs<=365*24*60*60*1000&&
      retention.immutableAudit===false:
      retention===undefined;
    if(!sessionRetentionValid)
      deny('desktop_snapshot_retention_unverified');
    if(result?.ok!==true||result.accountId!==family.accountId||
       (inventory?result.kind!==inventory.kind||!Array.isArray(result.rows)||
        result.rows.length>100||!allowedPageSource.includes(result.coverage?.source):
        !Array.isArray(result.devices)||!Array.isArray(result.sessions)||
        !Array.isArray(result.grants)||!Array.isArray(result.jobs)||
        !Array.isArray(result.events)))
      deny('desktop_snapshot_unavailable');
    // Do not send raw Redis/Owner family identifiers or other token state.
    return result;
  }
  // Server-internal T04 Owner-family proof. This is NEVER mounted as a
  // browser or WebView HTTP response; public /session stays restricted to
  // the sanitized projection without family identifiers or bearer secrets.
  async function inspectForWallSso(accessToken){
    const record=await get('access',accessToken);
    if(record.purpose!=='desktop_owner_v4')deny('desktop_token_invalid');
    const family=await principalFor(record);
    return Object.freeze({
      verified:true,isOwner:true,accountId:family.accountId,
      familyId:family.familyId,
      resource:DESKTOP_OWNER_RESOURCE,scope:DESKTOP_OWNER_SCOPE
    });
  }
  async function familyCurrentForWallSso(accountId,familyId){
    if(!ACCOUNT.test(String(accountId||''))||
       !TOKEN.test(String(familyId||'')))return false;
    try{
      const family=await get('family',familyId);
      if(family.purpose!=='desktop_owner_v4'||
         family.accountId!==accountId||family.familyId!==familyId)
        return false;
      await principalFor({
        accountId:family.accountId,accountSessionId:family.accountSessionId,
        familyId:family.familyId
      });
      return true;
    }catch{return false;}
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
    // The authorization-code issuer and token exchange are separate modules.
    // Expired, absent and malformed one-time codes all mean invalid
    // credentials, not a service outage. Do not reveal which check failed.
    const raw=String(e?.code||'');
    const reason=['desktop_consent_missing','desktop_consent_invalid',
      'desktop_code_invalid'].includes(raw)
      ?'desktop_owner_verification_required':raw;
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
  async function routeSnapshot(req,res){
    if(!nativeOnly(req,res))return;
    try{
      if(req.method!=='POST'||Object.keys(req.query||{}).length||
         Object.keys(req.body||{}).some(k=>k!=='page'))
        deny('desktop_native_client_required');
      const auth=String(req.headers?.authorization||'');
      if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth))
        deny('desktop_token_invalid');
      return res.status(200).json(await snapshot(auth.slice(7),req.body?.page??null));
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
    exchange,refresh,inspect,logout,snapshot,
    inspectForWallSso,familyCurrentForWallSso,
    routeExchange,routeRefresh,routeSession,routeLogout,routeSnapshot
  });
}
export function registerDesktopOwnerTokenRoutes(app,options={}){
  if(options.enabled!==true)return {enabled:false,routes:0};
  const service=createDesktopOwnerTokenService(options);
  app.post(apiPath('ownerToken'),service.routeExchange);
  app.post(apiPath('ownerRefresh'),service.routeRefresh);
  app.get(apiPath('ownerSession'),service.routeSession);
  app.post(apiPath('ownerLogout'),service.routeLogout);
  // Additional, independent feature gate. Source compilation is not a release.
  if(options.readEnabled===true)
    app.post(apiPath('ownerSnapshot'),service.routeSnapshot);
  return {enabled:true,routes:options.readEnabled===true?5:4,service};
}
