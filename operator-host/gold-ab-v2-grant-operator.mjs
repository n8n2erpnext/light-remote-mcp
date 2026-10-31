// Gold P2-I2h2b: verified Operator owner-account adapter, SOURCE ONLY.
// Not added to public routes until native PostgreSQL/Redis E2E is accepted.
import {GoldAbV2PendingRedis} from '../lib/gold-ab-v2-pending-redis.mjs';
import {goldAbV2OwnerHttpConfig,createGoldAbV2Csrf}
 from './gold-ab-v2-owner-http.mjs';
import {createGoldAbV2GrantCoordinator,GoldAbV2GrantBridgeError}
 from './gold-ab-v2-grant-coordinator.mjs';
const deny=(message,status=403)=>{throw new GoldAbV2GrantBridgeError(message,status)};
export function createGoldAbV2GrantOperator({
 env=process.env,storage,requireAccount,accountSessionToken,
 accounts,devices,connections,enrollments,accessGrants,goldRegistries,
 expectedPurpose='device',authorizeGuest=null
}={}){
 if(env.LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE!=='1')return null;
 if(env.LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE!=='1')
  deny('abv2_grant_issue_gate_off',503);
 const config=goldAbV2OwnerHttpConfig(env);
 if(!config.enabled)deny('abv2_grant_owner_gate_off',503);
 if(!storage?.redis?.eval||!storage?.pool?.query||!storage?.prefix||
    typeof requireAccount!=='function'||typeof accountSessionToken!=='function'||
    !accounts||!devices||!connections||!enrollments||!accessGrants||
    typeof goldRegistries?.flush!=='function')
  deny('abv2_grant_operator_dependencies_missing',503);
 const csrf=createGoldAbV2Csrf({sealingKey:config.sealingKey,
  origin:config.origin,sessionToken:accountSessionToken});
 const pending=new GoldAbV2PendingRedis({redis:storage.redis,
  prefix:storage.prefix,sealingKey:config.sealingKey});
 const authorizeOwner=async(req,deviceId)=>{
  // No user-controlled account/Agent/client/connection fields are accepted.
  // This adapter is for authenticated /account cookies only; signed Wall
  // approval needs a separately verified device-channel adapter.
  if(req?.headers?.origin!==config.origin||
     req?.headers?.['sec-fetch-site']==='cross-site'||
     !csrf.verify(req,deviceId))
   deny('abv2_grant_origin_csrf_denied',403);
  const identity=requireAccount(req,{touch:false});
  const account=identity?.account,owner=account?.accountId;
  if(!owner||account.status==='disabled'||account.status==='deleted'||
     !config.allowedAccounts.has(owner)||!config.allowedDevices.has(deviceId))
   deny('abv2_grant_owner_denied',403);
  const op=accounts.assertOperational(owner);
  if(op?.accountId!==owner||op.emailVerified!==true)
   deny('abv2_grant_verified_owner_required',403);
  const device=devices.get(deviceId),binding=enrollments.binding(deviceId);
  const policy=enrollments.policyView(deviceId);
  if(device.deviceId!==deviceId||device.accountId!==owner||
     device.state!=='online'||device.revokedAt||
     device.publicIdentityKey!==binding.publicIdentityKey||
     binding.accountId!==owner||binding.deviceId!==deviceId||binding.revokedAt||
     policy.accountId!==owner||policy.policyProfile==='disabled'||
     !Number.isSafeInteger(policy.policyRevision)||policy.policyRevision<1||
     !Array.isArray(policy.approvedCapabilities)||!policy.approvedCapabilities.length)
   deny('abv2_grant_enrollment_or_policy_denied',403);
  const connection=connections.assertConnected(deviceId);
  if(connection.accountId!==owner||connection.deviceId!==deviceId||
     connection.state!=='connected'||!connection.connectionId||
     Number(connection.hardExpiresAt)<=Date.now())
   deny('abv2_grant_connection_denied',409);
  return {ownerAccountId:owner,deviceId,connectionId:connection.connectionId,
   connectionExpiresAt:Number(connection.hardExpiresAt)};
 };
 return createGoldAbV2GrantCoordinator({enabled:true,pending,
  accessGrants,authorizeOwner,expectedPurpose,authorizeGuest,
  flushGrants:()=>goldRegistries.flush(),
  confirmPersisted:async scope=>{
   const result=await storage.pool.query(
    'SELECT g.grant_id,g.account_id,g.purpose,g.device_id,g.connection_id,g.agent_id,g.approved_at,g.absolute_expires_at,g.closed_at,'+
    (expectedPurpose==='pro-share-guest'?'g.connection_owner_account_id,':'')+
    'm.close_reason FROM lr_ab_grants g JOIN lr_gold_ab_grant_metadata m ON m.grant_id=g.grant_id WHERE g.grant_id=$1',
    [scope.grantId]);
   const r=result?.rows?.[0];
   return Boolean(r&&r.grant_id===scope.grantId&&
    r.account_id===(scope.actorAccountId||scope.ownerAccountId)&&
    (expectedPurpose!=='pro-share-guest'||
      (r.purpose==='pro-share-guest'&&r.connection_owner_account_id===scope.ownerAccountId))&&
    r.device_id===scope.deviceId&&
    r.connection_id===scope.connectionId&&r.agent_id===scope.agentId&&
    (scope.phase==='staged'?(r.closed_at!=null&&r.close_reason==='abv2_uncommitted'):
     (scope.phase==='active'&&r.closed_at==null))&&
    new Date(r.approved_at).getTime()===scope.approvedAt&&
    new Date(r.absolute_expires_at).getTime()===scope.absoluteExpiresAt);
  }});
}
