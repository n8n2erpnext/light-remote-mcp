// P2-I4C3b2: staged signed OAuth producer, never a Guest command endpoint.
// No script, terminal, filesystem content or OS-effect payload accepted.
// Source OFF; no MCP tool exposes this path before integrated release.
import {goldAbV2HelperKey,GoldAbV2HelperProofError}
 from '../lib/gold-ab-v2-helper-proof.mjs';
import {verifyGoldGuestQueueProof} from '../lib/gold-pro-share-guest-queue-proof.mjs';
import {goldAbV2OwnerHttpConfig} from './gold-ab-v2-owner-http.mjs';
import {GoldProShareGuestQueuePg} from './pro-share-guest-queue-pg.mjs';
const ROUTE='/v1/plugin/pro-share/guest-queue/enqueue';
const deny=(reason,status=403)=>{throw new GoldAbV2HelperProofError(reason,status)};
export function createGoldProShareGuestQueueHttp({
 env=process.env,storage,store,accounts,devices,connections,enrollments,
 accessGrants,agentClients,readJson,sendJson,now=Date.now,createQueue=null
}={}){
 const enabled=env.LR_GOLD_PRO_SHARE_GUEST_QUEUE_HTTP==='1';
 if(!enabled)return async(req,res,url)=>{
  if(url.pathname!==ROUTE)return false;
  sendJson(res,404,{ok:false,error:'not_found'});return true;
 };
 if(env.LR_GOLD_PRO_SHARE_CORE!=='1'||
    env.LR_GOLD_PRO_SHARE_GUEST_AB_POLL!=='1'||
    env.LR_GOLD_PRO_SHARE_GUEST_BIND!=='1'||
    env.LR_GOLD_PRO_SHARE_GUEST_QUEUE!=='1'||
    env.LR_GOLD_PRO_SHARE_GUEST_SLOTS!=='1'||
    env.LR_GOLD_PRO_SHARE_GUEST_SIGNED_LAUNCH!=='1')
  deny('guest_queue_http_dependencies_flags_off',503);
 const cfg=goldAbV2OwnerHttpConfig(env);
 if(!cfg.enabled||!storage?.pool?.connect||!storage?.redis?.set||
    !storage?.prefix||!store?.authorizeOperation||!accounts||
    !devices||!connections||!enrollments||!accessGrants?.assert||
    !agentClients?.findActive||typeof readJson!=='function'||
    typeof sendJson!=='function')
  deny('guest_queue_http_dependencies_missing',503);
 const key=goldAbV2HelperKey(env),trusted=new WeakMap();
 const getFree=id=>{
  const a=accounts.assertOperational(id);
  return a.accountId===id&&a.emailVerified===true&&
   String(a.plan||'free').toLowerCase()==='free';
 };
 const fresh=id=>{
  if(!cfg.allowedDevices.has(id))deny('guest_queue_device_not_allowlisted',404);
  const d=devices.get(id);
  if(!d||d.deviceId!==id||!cfg.allowedAccounts.has(d.accountId)||
     d.state!=='online'||d.revokedAt)
   deny('guest_queue_owner_device_denied',403);
  const e=enrollments.binding(id),p=enrollments.policyView(id);
  if(e?.deviceId!==id||e.accountId!==d.accountId||
     e.revokedAt||e.publicIdentityKey!==d.publicIdentityKey||
     p?.accountId!==d.accountId||p.policyProfile==='disabled'||
     !Number.isSafeInteger(p.policyRevision)||p.policyRevision<1)
   deny('guest_queue_enrollment_policy_denied',403);
  const cn=connections.assertConnected(id);
  if(cn.deviceId!==id||cn.accountId!==d.accountId||
     cn.state!=='connected'||Number(cn.hardExpiresAt)<=now())
   deny('guest_queue_connection_denied',409);
  // No optimistic capability grant: both enrolled policy and current device
  // advertisement must explicitly permit the requested OS family.
  const caps=Array.isArray(d.effectiveCapabilities)?d.effectiveCapabilities:
   Array.isArray(d.capabilities)?d.capabilities:[];
  return {device:d,connection:cn,nodeId:d.nodeId,
   approvedCapabilities:Array.isArray(p.approvedCapabilities)?p.approvedCapabilities:[],
   routeCapabilities:caps};
 };
 const queue=(typeof createQueue==='function'?createQueue:
  args=>new GoldProShareGuestQueuePg(args))({
   env,pool:storage.pool,store,accessGrants,agentClients,
   authenticateOAuth:async opaque=>trusted.get(opaque)||null,
   accountActive:id=>{try{
    return accounts.assertOperational(id).accountId===id;
   }catch{return false}},
   guestVerifiedFree:id=>{try{return getFree(id)}catch{return false}},
   loadFreshContext:async id=>fresh(id),now
  });
 return async(req,res,url)=>{
  if(url.pathname!==ROUTE)return false;
  if(req.method!=='POST'){
   sendJson(res,405,{ok:false,error:'method_not_allowed'});return true;
  }
  try{
   const verified=await verifyGoldGuestQueueProof({
    proof:await readJson(req),key,redis:storage.redis,
    prefix:storage.prefix,now:now()});
   const opaque=Object.freeze({source:'internal-verified-oauth-proof'});
   trusted.set(opaque,Object.freeze({verified:true,
    accountId:verified.accountId,clientId:verified.clientId}));
   try{
    const {job,reused}=await queue.enqueue({
     opaqueOAuthContext:opaque,deviceId:verified.deviceId,
     requestKey:verified.requestKey,operation:verified.operation,
     requiredCapabilities:[...verified.requiredCapabilities]
    });
    if(job?.actorAccountId!==verified.accountId||
       job?.deviceId!==verified.deviceId)
     deny('guest_queue_postwrite_principal_mismatch',503);
    sendJson(res,200,{ok:true,status:'guest_queue_dispatch_hold',
     jobId:job.jobId,reused:reused===true,
     helperReady:false,nextAction:'guest_dispatch_not_yet_enabled'});
   }finally{trusted.delete(opaque)}
  }catch(error){
   const status=Number(error?.status)||503;
   sendJson(res,[400,401,403,404,409,429,503].includes(status)?status:503,
    {ok:false,error:error instanceof GoldAbV2HelperProofError?
      error.message:'guest_queue_unavailable'});
  }
  return true;
 };
}
