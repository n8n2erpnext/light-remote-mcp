// P2-I2g/h OAuth Helper discovery and Agent-first pending REQUEST source gate.
// No owner B approval, durable grant issuance or Helper-ready in this module.
import crypto from 'node:crypto';
import {resolvePermittedDeviceTarget,summarizePermittedDeviceDiscovery,
 listOwnerShortIdDevices,SHORT_ID_RE}
 from '../lib/gold-device-short-id.mjs';
import {GoldAbV2PendingRedis} from '../lib/gold-ab-v2-pending-redis.mjs';
import {goldAbV2OwnerHttpConfig} from './gold-ab-v2-owner-http.mjs';
import {goldAbV2HelperKey,verifyGoldAbV2HelperTarget,GoldAbV2HelperProofError}
 from '../lib/gold-ab-v2-helper-proof.mjs';
const deny=(reason,status=403)=>{throw new GoldAbV2HelperProofError(reason,status)};
const DISCOVER='/v1/plugin/abv2/device-discover';
const RESOLVE='/v1/plugin/abv2/target-resolve';
const ISSUE='/v1/plugin/abv2/request-issue';
const RECOVER='/v1/plugin/abv2/request-recover';
export function createGoldAbV2HelperTarget({
 env=process.env,storage,accounts,devices,enrollments,connections,readJson,sendJson
}={}){
 const enabled=env.LR_GOLD_AB_V2_HELPER_TARGET_QUERY==='1';
 const issueEnabled=env.LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE==='1';
 const recoverEnabled=issueEnabled&&env.LR_GOLD_AB_V2_HELPER_POLL_ATTACH==='1';
 if(issueEnabled&&!enabled)deny('abv2_helper_issue_requires_resolve',503);
 if(!enabled)return async(req,res,url)=>{
  if(![DISCOVER,RESOLVE,ISSUE,RECOVER].includes(url.pathname))return false;
  sendJson(res,404,{ok:false,error:'not_found'});return true;
 };
 const config=goldAbV2OwnerHttpConfig(env);
 if(!config.enabled)deny('abv2_operator_gate_off',503);
 const key=goldAbV2HelperKey(env);
 if(!storage?.pool?.query||!storage?.redis?.set||!storage?.prefix||
    !accounts||!devices||!enrollments||!connections||
    typeof readJson!=='function'||typeof sendJson!=='function')
  deny('abv2_helper_dependencies_required',503);
 const pending=issueEnabled?new GoldAbV2PendingRedis({redis:storage.redis,
  prefix:storage.prefix,sealingKey:config.sealingKey}):null;
 return async(req,res,url)=>{
  if(![DISCOVER,RESOLVE,ISSUE,RECOVER].includes(url.pathname))return false;
  if((url.pathname===ISSUE&&!issueEnabled)||
    (url.pathname===RECOVER&&!recoverEnabled)){
   sendJson(res,404,{ok:false,error:'not_found'});return true;
  }
  if(req.method!=='POST'){
   sendJson(res,405,{ok:false,error:'method_not_allowed'});return true;
  }
  try{
   const issue=url.pathname===ISSUE;
   const discover=url.pathname===DISCOVER;
   const proof=await readJson(req);
   const p=await verifyGoldAbV2HelperTarget({proof,key,
    redis:storage.redis,prefix:storage.prefix,
    expectedPurpose:issue?'issue':url.pathname===RECOVER?'recover':
     discover?'discover':'resolve'});
   const account=accounts.assertOperational(p.accountId);
   if(account?.accountId!==p.accountId||account?.emailVerified!==true)
    deny('abv2_helper_owner_not_verified',403);
   // PG043 is NOT in the migration lock. Never create or backfill here.
   const schema=await storage.pool.query(
    "SELECT to_regclass('public.lr_gold_device_short_ids') IS NOT NULL AS present");
   if(schema.rows?.[0]?.present!==true)
    deny('abv2_short_id_schema_not_ready',503);
   if(url.pathname===RECOVER){
    const clientId='oauth-'+crypto.createHash('sha256')
     .update(p.clientId).digest('hex');
    const recovered=await pending.recoverAgent({actorAccountId:p.accountId,
     agentId:p.agentId,clientId});
    if(recovered.state==='none'||recovered.state==='ambiguous'){
     sendJson(res,200,{ok:true,status:recovered.state,
      helperReady:false,nextAction:recovered.state==='ambiguous'?
       'poll_exact_request_explicitly':'no_abv2_request_to_recover'});
     return true;
    }
    // Recovery is NOT an authorization. Revalidate the same enrolled
    // device/connection and immutable owner Short ID before revealing B.
    const d=devices.get(recovered.deviceId);
    const binding=enrollments.binding(recovered.deviceId);
    const policy=enrollments.policyView(recovered.deviceId);
    const cn=connections.assertConnected(recovered.deviceId);
    if(d.deviceId!==recovered.deviceId||d.accountId!==p.accountId||
       d.state!=='online'||d.revokedAt||
       binding.deviceId!==recovered.deviceId||
       binding.accountId!==p.accountId||binding.revokedAt||
       binding.publicIdentityKey!==d.publicIdentityKey||
       policy.accountId!==p.accountId||policy.policyProfile==='disabled'||
       !Array.isArray(policy.approvedCapabilities)||!policy.approvedCapabilities.length||
       cn.deviceId!==recovered.deviceId||cn.accountId!==p.accountId||
       cn.connectionId!==recovered.connectionId||cn.closedAt||
       Number(cn.hardExpiresAt)<=Date.now())
     deny('abv2_recover_enrollment_or_connection_changed',409);
    const short=await storage.pool.query(
     'SELECT s.short_id FROM lr_gold_device_short_ids s JOIN lr_devices d ON d.device_id=s.device_id WHERE d.owner_account_id=$1 AND s.device_id=$2',
     [p.accountId,recovered.deviceId]);
    if(short.rowCount!==1||short.rows[0].short_id!==recovered.shortId)
     deny('abv2_recover_short_id_changed',409);
    sendJson(res,200,{ok:true,status:recovered.state,
     requestId:recovered.requestId,deviceId:recovered.deviceId,
     shortId:recovered.shortId,expiresAt:recovered.expiresAt,
     attempt:recovered.attempt,
     ...(recovered.state==='pending'?{bCode:recovered.bCode}:{}),
     helperReady:false,nextAction:recovered.state==='pending'?
      'owner_enter_b_in_account':'verified_grant_poll_required'});
    return true;
   }
   const ownerRows=await listOwnerShortIdDevices(storage.pool,
    {accountId:p.accountId,limit:500});
   const permitted=[];
   for(const row of ownerRows){
    try{
     const d=devices.get(row.deviceId);
     const binding=enrollments.binding(row.deviceId);
     const policy=enrollments.policyView(row.deviceId);
     if(d.accountId!==p.accountId||d.deviceId!==row.deviceId||
        d.state==='revoked'||d.publicIdentityKey!==binding.publicIdentityKey||
        binding.revokedAt||binding.accountId!==p.accountId||
        policy.accountId!==p.accountId||
        policy.policyProfile==='disabled'||!policy.approvedCapabilities?.length)
      continue;
     const connection=connections.get(row.deviceId);
     permitted.push({...row,state:d.state,
      online:d.state==='online'&&connection?.state==='connected'&&
       Number(connection.hardExpiresAt)>Date.now()});
    }catch{/* revoked/unknown device not discoverable */}
   }
   if(discover){
    const listing=summarizePermittedDeviceDiscovery({
     permittedDevices:permitted,query:p.targetQuery,
     onlineOnly:p.onlineOnly,limit:5
    });
    sendJson(res,200,{ok:true,...listing,
     status:'device_discovery',resolution:listing.status,
     // PG listing is intentionally bounded to 500 account-owned devices.
     // Never falsely call 500 entries an exact whole-account count.
     complete:ownerRows.length<500,helperReady:false,
     approvalState:'not_issued',requestCreated:false,
     nextAction:'select_exact_device_before_request'});
    return true;
   }
   const match=resolvePermittedDeviceTarget({permittedDevices:permitted,
    query:p.targetQuery,limit:5});
   if(!issue){
    sendJson(res,200,{ok:true,status:match.status,total:match.total,
     matches:match.matches.map(m=>({...m,online:Boolean(
      permitted.find(x=>x.deviceId===m.deviceId)?.online)})),
     helperReady:false,approvalState:'not_issued',
     nextAction:match.status==='single'?'agent_request_not_enabled':
      match.status==='ambiguous'?'choose_exact_device':'specify_target'});
    return true;
   }
   // An issue must name the EXACT Short ID selected from the discovery
   // response and bind that device in the signed OAuth-derived proof.
   // Partial name, ambiguous match and silent Main all denied.
   if(!SHORT_ID_RE.test(p.targetQuery)||match.status!=='single'||
      match.matches[0]?.shortId!==p.targetQuery||
      match.matches[0]?.deviceId!==p.selectedDeviceId)
    deny('abv2_helper_exact_target_required',409);
   const chosen=permitted.find(x=>x.deviceId===p.selectedDeviceId);
   if(!chosen?.online)deny('abv2_helper_device_offline',409);
   // Re-read current enrolled connection immediately before issuance.
   const connection=connections.assertConnected(p.selectedDeviceId);
   if(connection.deviceId!==p.selectedDeviceId||
      connection.accountId!==p.accountId||
      !connection.connectionId||Number(connection.hardExpiresAt)<=Date.now())
    deny('abv2_helper_connection_changed',409);
   const issued=await pending.issue({
    ownerAccountId:p.accountId,actorAccountId:p.accountId,
    agentId:p.agentId,
    // Opaque OAuth client JWT is never stored in pending Redis.
    clientId:'oauth-'+crypto.createHash('sha256').update(p.clientId).digest('hex'),
    deviceId:p.selectedDeviceId,connectionId:connection.connectionId,
    shortId:chosen.shortId,requestKey:p.requestKey
   });
   const pendingState=issued.state==='pending'&&typeof issued.bCode==='string';
   sendJson(res,200,{ok:true,status:pendingState?'v2_pending_unapproved':'not_ready',
    helperReady:false,approvalState:issued.state,requestId:issued.requestId,
    attempt:issued.attempt,expiresAt:issued.expiresAt,
    shortId:chosen.shortId,deviceId:chosen.deviceId,
    ...(pendingState?{bCode:issued.bCode}:{}),
    requestKey:p.requestKey,reused:Boolean(issued.reused),
    nextAction:pendingState?
      (env.LR_GOLD_AB_V2_OWNER_APPROVE_HTTP==='1'&&
       env.LR_GOLD_AB_V2_ACCOUNT_APPROVE_UI==='1'
       ?'owner_enter_b_in_account':'owner_approval_not_enabled')
      :'request_expired_or_pending_grant'});
  }catch(error){
   const status=error instanceof GoldAbV2HelperProofError?error.status:503;
   sendJson(res,[400,401,403,404,405,409,429,503].includes(status)?status:503,
    {ok:false,error:error instanceof GoldAbV2HelperProofError?
     error.message:'abv2_helper_request_unavailable'});
  }
  return true;
 };
}
