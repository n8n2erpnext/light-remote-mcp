// P2-I4C2 guarded Guest OAuth poll. Read-only durable grant proof;
// NEVER attach Agent Client or create a working session until the separate
// cross-account queue/dispatch authority and signed terminal slot exist.
import crypto from 'node:crypto';
import {GoldAbV2PendingRedis} from '../lib/gold-ab-v2-pending-redis.mjs';
import {goldAbV2OwnerHttpConfig} from './gold-ab-v2-owner-http.mjs';
import {goldAbV2HelperKey,GoldAbV2HelperProofError} from '../lib/gold-ab-v2-helper-proof.mjs';
import {verifyGoldAbV2HelperPoll} from '../lib/gold-ab-v2-helper-poll-proof.mjs';
const ROUTE='/v1/plugin/pro-share/request-poll';
const deny=(reason,status=403)=>{throw new GoldAbV2HelperProofError(reason,status)};
export function createGoldProShareGuestPoll({
 env=process.env,storage,store,accounts,devices,connections,enrollments,
 accessGrants,readJson,sendJson,now=Date.now
}={}){
 const enabled=env.LR_GOLD_PRO_SHARE_GUEST_AB_POLL==='1';
 if(enabled&&(
  env.LR_GOLD_PRO_SHARE_CORE!=='1'||
  env.LR_GOLD_PRO_SHARE_GUEST_AB_REQUEST_ISSUE!=='1'||
  env.LR_GOLD_PRO_SHARE_GUEST_B_APPROVE!=='1'||
  env.LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE!=='1'))
  deny('pro_share_guest_poll_prerequisite_off',503);
 if(!enabled)return async(req,res,url)=>{
  if(url.pathname!==ROUTE)return false;
  sendJson(res,404,{ok:false,error:'not_found'});return true;
 };
 const cfg=goldAbV2OwnerHttpConfig(env);
 if(!cfg.enabled||!storage?.pool?.query||!storage?.redis?.eval||
    !storage?.redis?.set||!storage?.prefix||!store?.assertEligibleGuestRequest||
    !accounts||!devices||!connections||!enrollments||
    !accessGrants?.assert||typeof readJson!=='function'||
    typeof sendJson!=='function')
  deny('pro_share_guest_poll_dependencies_missing',503);
 const key=goldAbV2HelperKey(env),pending=new GoldAbV2PendingRedis({
  redis:storage.redis,prefix:storage.prefix,sealingKey:cfg.sealingKey});
 const validate=async p=>{
  const actor=accounts.assertOperational(p.accountId);
  if(actor.accountId!==p.accountId||actor.emailVerified!==true||
     String(actor.plan||'free').toLowerCase()!=='free')
   deny('pro_share_guest_verified_free_required',403);
  const dev=devices.get(p.deviceId),owner=dev.accountId;
  if(!owner||owner===p.accountId||
     !cfg.allowedAccounts.has(owner)||!cfg.allowedDevices.has(p.deviceId))
   deny('pro_share_guest_owner_or_device_denied',404);
  const ownerAccount=accounts.assertOperational(owner);
  if(ownerAccount.accountId!==owner||ownerAccount.emailVerified!==true||
     !['pro','vip'].includes(String(ownerAccount.plan||'').toLowerCase()))
   deny('pro_share_owner_eligibility_denied',403);
  const binding=enrollments.binding(p.deviceId);
  const policy=enrollments.policyView(p.deviceId);
  if(dev.deviceId!==p.deviceId||dev.state!=='online'||dev.revokedAt||
     binding.deviceId!==p.deviceId||binding.accountId!==owner||
     binding.revokedAt||dev.publicIdentityKey!==binding.publicIdentityKey||
     policy.accountId!==owner||policy.policyProfile==='disabled'||
     !Number.isSafeInteger(policy.policyRevision)||policy.policyRevision<1||
     !Array.isArray(policy.approvedCapabilities)||!policy.approvedCapabilities.length)
   deny('pro_share_guest_enrollment_or_policy_denied',403);
  const cn=connections.assertConnected(p.deviceId);
  if(cn.deviceId!==p.deviceId||cn.accountId!==owner||
     cn.state!=='connected'||!cn.connectionId||
     Number(cn.hardExpiresAt)<=now())
   deny('pro_share_guest_connection_denied',409);
  const allowed=await store.assertEligibleGuestRequest({
   authenticatedGuestAccountId:p.accountId,device:dev,connection:cn});
  if(allowed.ownerAccountId!==owner||allowed.deviceId!==p.deviceId||
     allowed.connectionId!==cn.connectionId||
     allowed.grantPurpose!=='pro-share-guest'||
     !Number.isSafeInteger(allowed.permissionRevision))
   deny('pro_share_guest_eligible_scope_mismatch',403);
  return {dev,owner,cn,revision:allowed.permissionRevision};
 };
 return async(req,res,url)=>{
  if(url.pathname!==ROUTE)return false;
  if(req.method!=='POST'){
   sendJson(res,405,{ok:false,error:'method_not_allowed'});return true;
  }
  try{
   const p=await verifyGoldAbV2HelperPoll({
    proof:await readJson(req),key,redis:storage.redis,
    prefix:storage.prefix,now:now(),expectedPurpose:'guest-poll'});
   const first=await validate(p);
   const short=await storage.pool.query(
    'SELECT s.short_id FROM lr_gold_device_short_ids s WHERE s.device_id=$1',
    [p.deviceId]);
   if(short.rowCount!==1||short.rows?.[0]?.short_id!==p.shortId)
    deny('pro_share_guest_short_id_mismatch',409);
   const clientHash='oauth-'+crypto.createHash('sha256').update(p.clientId).digest('hex');
   const state=await pending.agentPoll({requestId:p.requestId,
    actorAccountId:p.accountId,agentId:p.agentId,clientId:clientHash,
    connectionId:first.cn.connectionId});
   if(state.requestId!==p.requestId)deny('pro_share_guest_request_changed',403);
   if(state.state!=='granted'){
    sendJson(res,200,{ok:true,status:'approval_pending',requestId:p.requestId,
     approvalState:state.state,helperReady:false,
     nextAction:'owner_guest_b_approval_or_pg_commit_required'});
    return true;
   }
   const receipt=await pending.grantReceipt({ownerAccountId:first.owner,
    deviceId:p.deviceId,connectionId:first.cn.connectionId,requestId:p.requestId});
   const grantId='dag_v2_'+p.requestId.slice(4);
   if(receipt.state!=='granted'||receipt.requestId!==p.requestId||
      receipt.owner!==first.owner||receipt.actor!==p.accountId||
      receipt.purpose!=='pro-share-guest'||
      receipt.agent!==p.agentId||receipt.client!==clientHash||
      receipt.device!==p.deviceId||receipt.connection!==first.cn.connectionId||
      receipt.grantId!==grantId||!Number.isSafeInteger(receipt.approvedAt))
    deny('pro_share_guest_receipt_scope_invalid',403);
   const rows=await storage.pool.query(
    'SELECT g.grant_id,g.account_id,g.purpose,g.connection_owner_account_id,'+
    'g.device_id,g.connection_id,g.agent_id,g.approved_at,g.expires_at,'+
    'g.absolute_expires_at,g.closed_at,m.close_reason '+
    'FROM lr_ab_grants g JOIN lr_gold_ab_grant_metadata m ON m.grant_id=g.grant_id '+
    'WHERE g.grant_id=$1',[grantId]);
   const g=rows.rows?.[0];
   if(rows.rowCount!==1||g.grant_id!==grantId||
      g.account_id!==p.accountId||g.purpose!=='pro-share-guest'||
      g.connection_owner_account_id!==first.owner||
      g.device_id!==p.deviceId||g.connection_id!==first.cn.connectionId||
      g.agent_id!==p.agentId||g.closed_at!==null||g.close_reason!=null||
      new Date(g.approved_at).getTime()!==receipt.approvedAt||
      new Date(g.absolute_expires_at).getTime()!==receipt.approvedAt+86400000||
      !(new Date(g.expires_at).getTime()>now())||
      !(new Date(g.absolute_expires_at).getTime()>now()))
    deny('pro_share_guest_pg_grant_not_active',409);
   const grant=accessGrants.assert(grantId,{
    accountId:p.accountId,agentId:p.agentId,
    deviceId:p.deviceId,connectionId:first.cn.connectionId,touch:false});
   if(grant.purpose!=='pro-share-guest'||grant.accountId!==p.accountId||
      grant.approvedAt!==receipt.approvedAt||
      grant.absoluteExpiresAt!==receipt.approvedAt+86400000)
    deny('pro_share_guest_native_grant_not_active',409);
   // Critical: revoke, remove Guest, rotate connection, or downgrade after
   // database read must fail BEFORE any future native Agent attachment.
   const last=await validate(p);
   if(last.owner!==first.owner||last.cn.connectionId!==first.cn.connectionId||
      last.revision!==first.revision)
    deny('pro_share_guest_permission_or_connection_changed',409);
   sendJson(res,200,{ok:true,status:'guest_grant_verified_dispatch_hold',
    approvalState:'granted',requestId:p.requestId,deviceId:p.deviceId,
    shortId:p.shortId,agentId:p.agentId,helperReady:false,
    nextAction:'guest_dispatch_not_yet_enabled'});
  }catch(error){
   const known=error instanceof GoldAbV2HelperProofError;
   const status=known?error.status:Number.isInteger(error?.status)?error.status:503;
   sendJson(res,[400,401,403,404,409,429,503].includes(status)?status:503,
    {ok:false,error:known?error.message:'pro_share_guest_poll_unavailable'});
  }
  return true;
 };
}
