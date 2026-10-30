// Gold P2-I2d: Operator-owned, owner-session HTTP bridge for Redis A/B V2
// pending list/view/refresh/deny and separately gated owner B approve.
// No Helper-ready or automatic Agent attachment.
// No live route is active without explicit owner+device allowlists and key.
// Public account portal / Local Wall are NOT wired in this milestone.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {GoldAbV2PendingRedis,AB_V2_B_RE} from '../lib/gold-ab-v2-pending-redis.mjs';
import {GoldAbV2GrantBridgeError} from './gold-ab-v2-grant-coordinator.mjs';
import {GoldAbV2WallOwnerConsent,GoldAbV2WallConsentError} from '../lib/gold-ab-v2-wall-owner-consent.mjs';
import {GoldAbV2OwnerPendingAdapter,GoldAbV2OwnerPendingError} from '../lib/gold-ab-v2-owner-pending-adapter.mjs';

const ID_RE=/^[A-Za-z0-9._:-]{1,160}$/;
const RATE_LUA=[
 "local n=redis.call('INCR',KEYS[1])",
 "if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end",
 "if n>tonumber(ARGV[2]) then return 0 end",
 "return 1"
].join('\n');
const deny=(error,status=403)=>{throw new GoldAbV2OwnerPendingError(error,status);};
function ids(input){
 const raw=String(input||'');
 if(!raw||raw.length>4000)deny('abv2_owner_allowlist_required',503);
 const values=raw.split(',').map(x=>x.trim());
 if(values.some(x=>!ID_RE.test(x)))deny('abv2_owner_allowlist_invalid',503);
 return new Set(values);
}
export function goldAbV2OwnerHttpConfig(env=process.env){
 const enabled=env.LR_GOLD_AB_V2_OWNER_PENDING_HTTP==='1';
 if(!enabled)return {enabled:false};
 const root=fs.realpathSync(String(env.LIGHT_REMOTE_GOLD_ROOT||''));
 const keyPath=fs.realpathSync(String(env.LR_GOLD_AB_V2_SEAL_KEY_FILE||''));
 if(!keyPath.startsWith(root+path.sep)||!fs.statSync(keyPath).isFile()||
    (fs.statSync(keyPath).mode&0o077)!==0)
  deny('abv2_seal_file_permissions_invalid',503);
 const sealingKey=fs.readFileSync(keyPath);
 if(sealingKey.length!==32)deny('abv2_seal_key_length_invalid',503);
 const origin=String(env.LR_GOLD_AB_V2_OWNER_ORIGIN||'').trim();
 let parsed;try{parsed=new URL(origin)}catch{deny('abv2_owner_origin_invalid',503)}
 if(parsed.protocol!=='https:'||parsed.origin!==origin||parsed.username||parsed.password)
  deny('abv2_owner_origin_invalid',503);
 return {enabled:true,sealingKey,origin,allowedAccounts:ids(env.LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS),
  allowedDevices:ids(env.LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES)};
}
export function createGoldAbV2Csrf({sealingKey,origin,sessionToken}={}){
 if(!Buffer.isBuffer(sealingKey)||sealingKey.length!==32||
  typeof origin!=='string'||!origin.startsWith('https://')||
  typeof sessionToken!=='function')deny('abv2_csrf_config_invalid',503);
 const key=crypto.createHmac('sha256',sealingKey).update('light-remote:abv2:owner-csrf:v1').digest();
 const nonce=(req,deviceId)=>{
  if(!ID_RE.test(deviceId))deny('abv2_device_invalid',400);
  const token=sessionToken(req);
  if(typeof token!=='string'||token.length<20||token.length>4096)
   deny('abv2_owner_session_required',401);
  return crypto.createHmac('sha256',key).update(token+'|'+deviceId).digest('base64url');
 };
 const verify=(req,deviceId)=>{
  if(req?.headers?.['sec-fetch-site']==='cross-site')return false;
  const suppliedOrigin=String(req?.headers?.origin||'');
  if(suppliedOrigin&&suppliedOrigin!==origin)return false;
  const received=String(req?.headers?.['x-light-abv2-csrf']||'');
  if(!/^[A-Za-z0-9_-]{43}$/.test(received))return false;
  const a=Buffer.from(received,'utf8'),b=Buffer.from(nonce(req,deviceId),'utf8');
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
 };
 return {nonce,verify};
}
export function createGoldAbV2OwnerHttp({
 enabled=false,adapter=null,csrf=null,rateLimit=null,readJson=null,sendJson=null,
 approveOwner=null,issueWallConsent=null
}={}){
 if(enabled&&(!adapter||!csrf||typeof rateLimit!=='function'||
   typeof readJson!=='function'||typeof sendJson!=='function'))
  deny('abv2_owner_http_dependencies_required',503);
 return async(req,res,url)=>{
  const match=url.pathname.match(/^\/v1\/accounts\/ab-v2\/devices\/([A-Za-z0-9._:-]+)\/(csrf|pending)(?:\/(av2_[a-f0-9]{32})(?:\/(refresh|deny|approve|consent))?)?$/);
  if(!match)return false;
  if(!enabled){sendJson(res,404,{ok:false,error:'not_found'});return true;}
  try{
   const [,deviceId,resource,requestId,mutation]=match;
   // Reject unsupported methods before touching rate storage.
   const isCsrf=resource==='csrf'&&!requestId&&!mutation&&req.method==='GET';
   const isList=resource==='pending'&&!requestId&&!mutation&&req.method==='GET';
   const isView=resource==='pending'&&requestId&&!mutation&&req.method==='GET';
   const isWrite=resource==='pending'&&requestId&&mutation&&req.method==='POST';
   if(mutation==='consent'&&typeof issueWallConsent!=='function'){
    sendJson(res,404,{ok:false,error:'not_found'});return true;
   }
   if(mutation==='approve'&&typeof approveOwner!=='function'){
    sendJson(res,404,{ok:false,error:'not_found'});return true;
   }
   if(!isCsrf&&!isList&&!isView&&!isWrite){
    sendJson(res,405,{ok:false,error:'method_not_allowed'});return true;
   }
   if(isWrite&&!csrf.verify(req,deviceId))deny('abv2_owner_mutation_denied',403);
   // Verify owner and target BEFORE creating any Redis rate-limit key.
   // This prevents anonymous/foreign-device requests filling rate storage.
   await adapter.guard(req,deviceId,'http_preflight');
   await rateLimit(req,deviceId,Boolean(isWrite));
   let payload;
   if(isCsrf){
    await adapter.guard(req,deviceId,'csrf');
    payload={csrf:csrf.nonce(req,deviceId)};
   }else if(resource==='pending'&&!requestId&&!mutation&&req.method==='GET'){
    payload=await adapter.list(req,{deviceId,limit:5});
   }else if(resource==='pending'&&requestId&&!mutation&&req.method==='GET'){
    payload=await adapter.view(req,{deviceId,requestId});
   }else if(resource==='pending'&&requestId&&mutation&&req.method==='POST'){
    if(!csrf.verify(req,deviceId))deny('abv2_owner_mutation_denied',403);
    const body=await readJson(req);
    if(!body||typeof body!=='object'||Array.isArray(body))deny('abv2_body_invalid',400);
    if(mutation==='consent'){
     if(!Number.isSafeInteger(body.expectedAttempt)||body.expectedAttempt<1)
      deny('abv2_wall_consent_attempt_invalid',400);
     payload=await issueWallConsent(req,{deviceId,requestId,
      expectedAttempt:body.expectedAttempt});
    }else if(mutation==='approve'){
     if(!Number.isSafeInteger(body.expectedAttempt)||body.expectedAttempt<1||
        !AB_V2_B_RE.test(String(body.bCode||'')))deny('abv2_owner_b_invalid',400);
     const result=await approveOwner(req,{deviceId,requestId,
      expectedAttempt:body.expectedAttempt,bCode:body.bCode});
     payload={state:result.state,requestId:result.requestId,agentId:result.agentId,
      approvedAt:result.approvedAt,expiresAt:result.expiresAt,
      absoluteExpiresAt:result.absoluteExpiresAt};
    }else payload=mutation==='refresh'
     ?await adapter.refresh(req,{deviceId,requestId,expectedAttempt:body.expectedAttempt})
     :await adapter.deny(req,{deviceId,requestId});
   }else {sendJson(res,405,{ok:false,error:'method_not_allowed'});return true;}
   sendJson(res,200,{ok:true,...payload});
  }catch(error){
   const own=error instanceof GoldAbV2OwnerPendingError||
    error instanceof GoldAbV2GrantBridgeError||error instanceof GoldAbV2WallConsentError;
   const status=own&&[400,401,403,404,409,429,503].includes(error.status)?error.status:503;
   sendJson(res,status,{ok:false,error:own?error.message:'abv2_owner_unavailable'});
  }
  return true;
 };
}
export function createGoldAbV2OwnerHttpFromOperator({env=process.env,storage,
 requireAccount,accountSessionToken,accounts,devices,connections,enrollments,
 readJson,sendJson,grantOperator=null}={}){
 const config=goldAbV2OwnerHttpConfig(env);
 if(!config.enabled)return createGoldAbV2OwnerHttp({enabled:false,sendJson});
 if(!storage?.redis?.eval||!storage.prefix)deny('abv2_redis_required',503);
 const csrf=createGoldAbV2Csrf({sealingKey:config.sealingKey,origin:config.origin,
  sessionToken:accountSessionToken});
 const pending=new GoldAbV2PendingRedis({redis:storage.redis,prefix:storage.prefix,
  sealingKey:config.sealingKey});
 const adapter=new GoldAbV2OwnerPendingAdapter({
  pending,
  authenticateOwner:req=>requireAccount(req,{touch:false}),
  getDevice:deviceId=>devices.get(deviceId),
  getConnection:deviceId=>connections.get(deviceId),
  verifyEnrolledConnection:({ownerAccountId,device,deviceId})=>{
   const binding=enrollments.binding(deviceId),policy=enrollments.policyView(deviceId);
   return binding.accountId===ownerAccountId&&
    typeof binding.publicIdentityKey==='string'&&binding.publicIdentityKey.length>0&&
    binding.publicIdentityKey===device.publicIdentityKey&&
    !binding.revokedAt&&policy.accountId===ownerAccountId&&
    Number.isSafeInteger(policy.policyRevision)&&policy.policyRevision>=1;
  },
  authorizeOwnerAction:({ownerAccountId,device,deviceId})=>{
   const operational=accounts.assertOperational(ownerAccountId);
   const policy=enrollments.policyView(deviceId);
   return operational?.accountId===ownerAccountId&&device.state==='online'&&
    policy.accountId===ownerAccountId&&policy.policyProfile!=='disabled'&&
    Array.isArray(policy.approvedCapabilities)&&policy.approvedCapabilities.length>0;
  },
  verifyOwnerMutation:({request,deviceId})=>csrf.verify(request,deviceId),
  isFeatureEnabled:({ownerAccountId,deviceId})=>config.allowedAccounts.has(ownerAccountId)&&
   config.allowedDevices.has(deviceId)
 });
 const wallConsentEnabled=env.LR_GOLD_AB_V2_WALL_OWNER_CONSENT==='1';
 if(wallConsentEnabled&&(env.LR_GOLD_AB_V2_WALL_SIGNED_APPROVE!=='1'||
    env.LR_GOLD_AB_V2_ACCOUNT_UI!=='1'))
  deny('abv2_wall_consent_dependencies_off',503);
 const wallConsent=wallConsentEnabled?new GoldAbV2WallOwnerConsent({
  redis:storage.redis,prefix:storage.prefix,sealingKey:config.sealingKey}):null;
 const issueWallConsent=wallConsent?async(req,{deviceId,requestId,expectedAttempt})=>{
  if(req?.headers?.origin!==config.origin||
     req?.headers?.['sec-fetch-site']==='cross-site'||
     !csrf.verify(req,deviceId))
   deny('abv2_wall_consent_origin_csrf_denied',403);
  const scope=await adapter.guard(req,deviceId,'issue_wall_owner_consent',{mutation:true});
  const row=await adapter.view(req,{deviceId,requestId});
  if(row.state!=='pending'||row.attempt!==expectedAttempt)
   deny('abv2_wall_consent_pending_changed',409);
  return wallConsent.issue({...scope,requestId,expectedAttempt,
   requestExpiresAt:row.expiresAt});
 }:null;
 const rateLimit=async(req,deviceId,mutation)=>{
  // The preflight has already proved this account owns the exact device.
  // Account/device budget prevents session-token churn creating Redis keys.
  const identity=requireAccount(req,{touch:false});
  const owner=identity?.account?.accountId;
  if(typeof owner!=='string'||!config.allowedAccounts.has(owner))
   deny('abv2_owner_session_required',401);
  const key=storage.prefix+'abv2:owner-http-rate:'+crypto.createHmac('sha256',config.sealingKey)
   .update(owner+'|'+deviceId+'|'+(mutation?'mutation':'read')).digest('hex');
  const ok=await storage.redis.eval(RATE_LUA,
   {keys:[key],arguments:['60000',mutation?'12':'60']});
  if(Number(ok)!==1)deny('abv2_owner_http_rate_limited',429);
 };
 if(env.LR_GOLD_AB_V2_OWNER_APPROVE_HTTP==='1'&&typeof grantOperator!=='function')
  deny('abv2_owner_approve_grant_bridge_required',503);
 return createGoldAbV2OwnerHttp({enabled:true,adapter,csrf,rateLimit,readJson,sendJson,
  approveOwner:env.LR_GOLD_AB_V2_OWNER_APPROVE_HTTP==='1'?grantOperator:null,
  issueWallConsent});
}
