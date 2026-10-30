// P2-I2h2e signed enrolled device → owner Local Wall B approval.
// Dedicated action, distinct from read-only preview. OFF by default.
// The caller MUST authenticate the Wall owner locally + CSRF BEFORE signing;
// Operator independently verifies signed binding, current owner, enrollment,
// policy, connection and PG 2-phase durability. Not a Helper ready endpoint.
import {GoldAbV2PendingRedis,AB_V2_B_RE} from '../lib/gold-ab-v2-pending-redis.mjs';
import {GoldAbV2WallOwnerConsent} from '../lib/gold-ab-v2-wall-owner-consent.mjs';
import {goldAbV2OwnerHttpConfig} from './gold-ab-v2-owner-http.mjs';
import {GoldAbV2GrantBridgeError,createGoldAbV2GrantCoordinator}
 from './gold-ab-v2-grant-coordinator.mjs';
const deny=(why,status=403)=>{throw new GoldAbV2GrantBridgeError(why,status)};
const REQUEST=/^av2_[a-f0-9]{32}$/;
const IDENT=/^[A-Za-z0-9._:-]{1,160}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function createGoldAbV2SignedApproval({
 env=process.env,storage,accounts,devices,connections,enrollments,
 accessGrants,goldRegistries,now=Date.now
}={}){
 if(env.LR_GOLD_AB_V2_WALL_SIGNED_APPROVE!=='1')return null;
 if(env.LR_GOLD_AB_V2_WALL_OWNER_CONSENT!=='1'||
    env.LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE!=='1'||
    env.LR_GOLD_AB_V2_OWNER_APPROVE_HTTP!=='1'||
    env.LR_GOLD_AB_V2_WALL_PENDING_PREVIEW!=='1'||
    env.LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE!=='1'||
    env.LR_GOLD_AB_V2_HELPER_TARGET_QUERY!=='1')
  deny('abv2_wall_approve_requires_owner_grant_gate',503);
 const cfg=goldAbV2OwnerHttpConfig(env);
 if(!cfg.enabled||!storage?.pool?.query||!storage?.redis?.eval||!storage.prefix||
    !accounts||!devices||!connections||!enrollments||!accessGrants||
    typeof goldRegistries?.flush!=='function')deny('abv2_wall_grant_dependencies_invalid',503);
 const consent=new GoldAbV2WallOwnerConsent({redis:storage.redis,
  prefix:storage.prefix,sealingKey:cfg.sealingKey,now});
 const pending=new GoldAbV2PendingRedis({
  redis:storage.redis,prefix:storage.prefix,sealingKey:cfg.sealingKey
 });
 const authorizeOwner=async ctx=>{
  if(!ctx?.proof?.binding||ctx.proof.binding!==ctx.binding||
     !ctx.binding||!ctx.device||
     ctx.device.deviceId!==ctx.binding.deviceId||
     ctx.payload?.action!=='approve'||ctx.payload?.ownerLoggedIn!==true)
   deny('abv2_wall_signed_owner_proof_required',403);
  const {accountId:owner,deviceId,publicIdentityKey:key}=ctx.binding;
  if(!IDENT.test(owner||'')||!IDENT.test(deviceId||'')||
     !cfg.allowedAccounts.has(owner)||!cfg.allowedDevices.has(deviceId))
   deny('abv2_wall_owner_not_allowlisted',404);
  const verified=accounts.assertOperational(owner);
  if(verified?.accountId!==owner||verified.emailVerified!==true)
   deny('abv2_wall_owner_not_verified',403);
  const email=String(verified.email||'').trim().toLowerCase();
  const claimed=String(ctx.payload?.wallUsername||'').trim().toLowerCase();
  if(!EMAIL.test(email)||claimed!==email)
   deny('abv2_wall_owner_email_mismatch',403);
  const device=devices.get(deviceId),binding=enrollments.binding(deviceId),
    policy=enrollments.policyView(deviceId);
  if(device.deviceId!==deviceId||device.accountId!==owner||
     device.state!=='online'||device.publicIdentityKey!==key||
     binding.deviceId!==deviceId||binding.accountId!==owner||
     binding.publicIdentityKey!==key||binding.revokedAt||
     policy.accountId!==owner||policy.policyProfile==='disabled'||
     !Number.isSafeInteger(policy.policyRevision)||policy.policyRevision<1||
     !Array.isArray(policy.approvedCapabilities)||!policy.approvedCapabilities.length)
   deny('abv2_wall_enrollment_or_policy_denied',403);
  const connection=connections.assertConnected(deviceId);
  if(connection.deviceId!==deviceId||connection.accountId!==owner||
     connection.state!=='connected'||!IDENT.test(connection.connectionId||'')||
     !Number.isFinite(Number(connection.hardExpiresAt))||
     Number(connection.hardExpiresAt)<=now())
   deny('abv2_wall_connection_changed',409);
  return {ownerAccountId:owner,deviceId,
   connectionId:connection.connectionId,
   connectionExpiresAt:Number(connection.hardExpiresAt)};
 };
 const coordinator=createGoldAbV2GrantCoordinator({enabled:true,pending,
  accessGrants,now,authorizeOwner:(ctx,deviceId)=>{
   if(ctx?.binding?.deviceId!==deviceId)deny('abv2_wall_wrong_device',403);
   return authorizeOwner(ctx);
  },flushGrants:()=>goldRegistries.flush(),
  confirmPersisted:async scope=>{
   const out=await storage.pool.query(
    'SELECT g.grant_id,g.account_id,g.device_id,g.connection_id,g.agent_id,g.approved_at,g.absolute_expires_at,g.closed_at,m.close_reason FROM lr_ab_grants g JOIN lr_gold_ab_grant_metadata m ON m.grant_id=g.grant_id WHERE g.grant_id=$1',
    [scope.grantId]);
   const r=out?.rows?.[0];
   return Boolean(r&&r.grant_id===scope.grantId&&r.account_id===scope.ownerAccountId&&
    r.device_id===scope.deviceId&&r.connection_id===scope.connectionId&&
    r.agent_id===scope.agentId&&new Date(r.approved_at).getTime()===scope.approvedAt&&
    new Date(r.absolute_expires_at).getTime()===scope.absoluteExpiresAt&&
    (scope.phase==='staged'
      ?r.closed_at!=null&&r.close_reason==='abv2_uncommitted'
      :scope.phase==='active'&&r.closed_at==null));
  }});
 return async ctx=>{
  const p=ctx?.payload;
  if(!p||p.action!=='approve'||!REQUEST.test(p.requestId||'')||
     !Number.isSafeInteger(p.expectedAttempt)||p.expectedAttempt<1||
     !AB_V2_B_RE.test(String(p.bCode||''))||
     !/^[A-Za-z0-9_-]{32}$/.test(String(p.consentCode||'')))
   deny('abv2_wall_approval_payload_invalid',400);
  const owner=await authorizeOwner(ctx);
  // Server-issued one-time consent, minted under authenticated /account
  // session+CSRF; device-signed ownerLoggedIn alone is NEVER authority.
  await consent.consume({...owner,requestId:p.requestId,
   expectedAttempt:p.expectedAttempt,consentCode:p.consentCode});
  const out=await coordinator(ctx,{deviceId:owner.deviceId,requestId:p.requestId,
   expectedAttempt:p.expectedAttempt,bCode:p.bCode});
  return {ok:true,state:out.state,requestId:out.requestId,
   agentId:out.agentId,approvedAt:out.approvedAt,
   expiresAt:out.expiresAt,absoluteExpiresAt:out.absoluteExpiresAt};
 };
}
