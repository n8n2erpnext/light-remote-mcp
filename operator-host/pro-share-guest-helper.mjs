// P2-I4B2 private Guest OAuth Helper adapter. Reuses the existing A/B V2
// HMAC proof, PG043 Short ID, Redis pending and enrolled-owner device channel.
// Does NOT provide execution/Helper-ready. Pro Share is OFF by default.
import crypto from 'node:crypto';
import {SHORT_ID_RE} from '../lib/gold-device-short-id.mjs';
import {GoldAbV2PendingRedis} from '../lib/gold-ab-v2-pending-redis.mjs';
import {goldAbV2OwnerHttpConfig} from './gold-ab-v2-owner-http.mjs';
import {goldAbV2HelperKey,verifyGoldAbV2HelperTarget,
 GoldAbV2HelperProofError} from '../lib/gold-ab-v2-helper-proof.mjs';
const RESOLVE='/v1/plugin/pro-share/target-resolve';
const ISSUE='/v1/plugin/pro-share/request-issue';
const deny=(reason,status=403)=>{throw new GoldAbV2HelperProofError(reason,status)};
export function createGoldProShareGuestHelper({
 env=process.env,storage,store,accounts,devices,connections,enrollments,
 readJson,sendJson,now=Date.now
}={}){
 const enabled=env.LR_GOLD_PRO_SHARE_GUEST_AB_TARGET_QUERY==='1';
 const issueEnabled=env.LR_GOLD_PRO_SHARE_GUEST_AB_REQUEST_ISSUE==='1';
 if(issueEnabled&&!enabled)deny('pro_share_guest_issue_requires_target',503);
 if(enabled&&(env.LR_GOLD_PRO_SHARE_CORE!=='1'||
    env.LR_GOLD_AB_V2_HELPER_TARGET_QUERY!=='1'))
  deny('pro_share_guest_target_core_required',503);
 if(!enabled)return async(req,res,url)=>{
  if(![RESOLVE,ISSUE].includes(url.pathname))return false;
  sendJson(res,404,{ok:false,error:'not_found'});return true;
 };
 const cfg=goldAbV2OwnerHttpConfig(env),key=goldAbV2HelperKey(env);
 if(!cfg.enabled||!storage?.pool?.query||!storage?.redis?.set||
    !storage?.redis?.eval||!storage?.prefix||
    !store?.assertEligibleGuestRequest||!accounts||!devices||
    !connections||!enrollments||
    typeof readJson!=='function'||typeof sendJson!=='function')
  deny('pro_share_guest_helper_dependencies_missing',503);
 const pending=issueEnabled?new GoldAbV2PendingRedis({
  redis:storage.redis,prefix:storage.prefix,sealingKey:cfg.sealingKey}):null;
 return async(req,res,url)=>{
  if(![RESOLVE,ISSUE].includes(url.pathname))return false;
  const issue=url.pathname===ISSUE;
  if(issue&&!issueEnabled){sendJson(res,404,{ok:false,error:'not_found'});return true;}
  if(req.method!=='POST'){
   sendJson(res,405,{ok:false,error:'method_not_allowed'});return true;
  }
  try{
   const p=await verifyGoldAbV2HelperTarget({
    proof:await readJson(req),key,redis:storage.redis,
    prefix:storage.prefix,now:now(),expectedPurpose:issue?'issue':'resolve'});
   const guest=accounts.assertOperational(p.accountId);
   if(guest?.accountId!==p.accountId||guest.emailVerified!==true||
      String(guest.plan||'free').toLowerCase()!=='free')
    deny('pro_share_guest_verified_free_required');
   if(!SHORT_ID_RE.test(p.targetQuery))
    deny('pro_share_guest_exact_short_id_required',400);
   // The Guest can see ONLY the exact Short ID explicitly shared by the
   // Pro owner, never all devices belonging to the owner or Pro Team.
   const found=await storage.pool.query(`SELECT s.short_id,d.device_id,d.owner_account_id,
     d.display_name,d.node_id,d.platform,d.state
     FROM lr_gold_device_short_ids s
     JOIN lr_devices d ON d.device_id=s.device_id
     JOIN lr_gold_pro_share_devices sh ON sh.owner_account_id=d.owner_account_id
       AND sh.device_id=d.device_id
     JOIN lr_gold_pro_share_seats seat ON seat.owner_account_id=sh.owner_account_id
       AND seat.status='accepted' AND seat.guest_account_id=$2
     WHERE s.short_id=$1 LIMIT 2`,[p.targetQuery,p.accountId]);
   if(found.rowCount!==1){
    sendJson(res,200,{ok:true,status:'not_found',total:0,matches:[],
     helperReady:false,approvalState:'not_issued',
     nextAction:'ask_owner_to_share_exact_device'});
    return true;
   }
   const row=found.rows[0],owner=row.owner_account_id,deviceId=row.device_id;
   if(!cfg.allowedAccounts.has(owner)||!cfg.allowedDevices.has(deviceId))
    deny('pro_share_owner_device_not_allowlisted',404);
   const ownerAccount=accounts.assertOperational(owner);
   if(ownerAccount?.accountId!==owner||ownerAccount.emailVerified!==true)
    deny('pro_share_owner_not_verified');
   const device=devices.get(deviceId),binding=enrollments.binding(deviceId),
    policy=enrollments.policyView(deviceId);
   if(device.deviceId!==deviceId||device.accountId!==owner||
      device.state!=='online'||device.revokedAt||
      binding.deviceId!==deviceId||binding.accountId!==owner||
      binding.revokedAt||device.publicIdentityKey!==binding.publicIdentityKey||
      policy.accountId!==owner||policy.policyProfile==='disabled'||
      !Array.isArray(policy.approvedCapabilities)||!policy.approvedCapabilities.length)
    deny('pro_share_device_enrollment_or_policy_denied');
   const connection=connections.assertConnected(deviceId);
   if(connection.deviceId!==deviceId||connection.accountId!==owner||
      connection.state!=='connected'||!connection.connectionId||
      Number(connection.hardExpiresAt)<=now())
    deny('pro_share_connection_unavailable',409);
   await store.assertEligibleGuestRequest({
    authenticatedGuestAccountId:p.accountId,device,connection
   });
   if(!issue){
    sendJson(res,200,{ok:true,status:'single',total:1,
     matches:[{deviceId,shortId:row.short_id,
      name:row.display_name,platform:row.platform,online:true}],
     helperReady:false,approvalState:'not_issued',
     nextAction:'agent_may_issue_guest_ab'});
    return true;
   }
   if(p.selectedDeviceId!==deviceId)
    deny('pro_share_guest_exact_device_required',409);
   // One more seat/device/connection recheck before creation; the owner must
   // still verify B in their own signed-in account later.
   const latest=connections.assertConnected(deviceId);
   if(latest.connectionId!==connection.connectionId||
      latest.deviceId!==deviceId||latest.accountId!==owner)
    deny('pro_share_guest_connection_changed',409);
   await store.assertEligibleGuestRequest({
    authenticatedGuestAccountId:p.accountId,device:devices.get(deviceId),
    connection:latest
   });
   const issued=await pending.issue({ownerAccountId:owner,
    actorAccountId:p.accountId,agentId:p.agentId,
    clientId:'oauth-'+crypto.createHash('sha256').update(p.clientId).digest('hex'),
    deviceId,connectionId:latest.connectionId,shortId:row.short_id,
    requestKey:p.requestKey,purpose:'pro-share-guest'});
   const fresh=issued.state==='pending'&&typeof issued.bCode==='string';
   sendJson(res,200,{ok:true,status:fresh?'v2_pending_unapproved':'not_ready',
    helperReady:false,approvalState:issued.state,
    requestId:issued.requestId,attempt:issued.attempt,expiresAt:issued.expiresAt,
    shortId:row.short_id,deviceId,
    ...(fresh?{bCode:issued.bCode}:{}),
    nextAction:fresh?'owner_guest_b_approval_required':'guest_request_not_ready'});
  }catch(error){
   const trusted=error instanceof GoldAbV2HelperProofError;
   const status=trusted?error.status:
    Number.isInteger(error?.status)?error.status:503;
   sendJson(res,[400,401,403,404,409,429,503].includes(status)?status:503,
    {ok:false,error:trusted?error.message:'pro_share_guest_helper_unavailable'});
  }
  return true;
 };
}
