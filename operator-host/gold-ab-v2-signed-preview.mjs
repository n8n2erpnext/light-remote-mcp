// Gold P2-I2f source only. Enrolled Agent signed channel -> owner Wall preview.
// OFF by default. No account cookie, no plaintext B, no approve or mutations.
import {GoldAbV2PendingRedis} from '../lib/gold-ab-v2-pending-redis.mjs';
import {safeGoldAbV2Pending} from '../lib/gold-ab-v2-owner-pending-adapter.mjs';
import {goldAbV2OwnerHttpConfig} from './gold-ab-v2-owner-http.mjs';
import {EnrollmentError} from './enrollment-registry.mjs';

// Preserve the Operator's canonical HTTP error→status mapping.
export class GoldAbV2SignedPreviewError extends EnrollmentError{
 constructor(message,status=403){super(message);this.status=status;this.name='GoldAbV2SignedPreviewError';}
}
const deny=(why,status=403)=>{throw new GoldAbV2SignedPreviewError(why,status)};
export function createGoldAbV2SignedPreview({
 env=process.env,storage,accounts,devices,connections,enrollments
}={}){
 // BOTH switches must be explicitly enabled, and the same protected key,
 // owner/device allowlists and exact Gold origin must be supplied.
 if(env.LR_GOLD_AB_V2_WALL_PENDING_PREVIEW!=='1')return null;
 const config=goldAbV2OwnerHttpConfig(env);
 if(!config.enabled)deny('abv2_operator_owner_gate_off',503);
 if(!storage?.redis?.eval||!storage.redis.zRange||!storage.prefix||
    !accounts||!devices||!connections||!enrollments)
  deny('abv2_signed_preview_dependencies_required',503);
 const pending=new GoldAbV2PendingRedis({redis:storage.redis,
  prefix:storage.prefix,sealingKey:config.sealingKey});
 return async function signedPreview(ctx){
  // Caller MUST first run verifiedChannelContext(envelope,
  // 'abv2-pending-preview'): Ed25519, nonce/replay, rate limit.
  // Only this proof-derived principal is admissible.
  if(!ctx?.proof?.binding||ctx.proof.binding!==ctx.binding||
     !ctx.device||ctx.device.deviceId!==ctx.binding.deviceId)
   deny('abv2_signed_proof_required',401);
  const ownerAccountId=ctx.binding.accountId,deviceId=ctx.binding.deviceId;
  if(!config.allowedAccounts.has(ownerAccountId)||!config.allowedDevices.has(deviceId))
   deny('abv2_wall_preview_not_allowed',404);
  const stored=devices.get(deviceId);
  if(stored.accountId!==ownerAccountId||stored.deviceId!==deviceId||
     stored.state!=='online'||stored.state==='revoked'||
     stored.publicIdentityKey!==ctx.binding.publicIdentityKey)
   deny('abv2_device_binding_mismatch',403);
  const binding=enrollments.binding(deviceId),policy=enrollments.policyView(deviceId);
  if(binding.revokedAt||binding.accountId!==ownerAccountId||
     binding.publicIdentityKey!==ctx.binding.publicIdentityKey||
     policy.accountId!==ownerAccountId||
     policy.policyProfile==='disabled'||!policy.approvedCapabilities?.length)
   deny('abv2_device_policy_denied',403);
  const account=accounts.assertOperational(ownerAccountId);
  if(account?.accountId!==ownerAccountId||account.emailVerified!==true)
   deny('abv2_verified_owner_required',403);
  const accountEmail=String(account.email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail))
   deny('abv2_owner_email_invalid',403);
  const connection=connections.assertConnected(deviceId);
  if(connection.accountId!==ownerAccountId||connection.deviceId!==deviceId||
     !connection.connectionId||
     Number(connection.hardExpiresAt)<=Date.now())
   deny('abv2_device_connection_invalid',409);
  const rows=await pending.listDevicePending({ownerAccountId,deviceId,
   connectionId:connection.connectionId,limit:5});
  if(!Array.isArray(rows)||rows.length>5)
   deny('abv2_pending_result_invalid',503);
  return {ok:true,deviceId,accountEmail,
   ownerApproveEnabled:env.LR_GOLD_AB_V2_WALL_SIGNED_APPROVE==='1'&&
    env.LR_GOLD_AB_V2_WALL_OWNER_CONSENT==='1',
   pending:rows.map(safeGoldAbV2Pending)};
 };
}
