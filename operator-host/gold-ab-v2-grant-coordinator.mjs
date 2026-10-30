// P2-I2h2b: INTERNAL-ONLY Redis B receipt -> durable Agent grant bridge.
// Never mount a public owner/Agent route without independent authentication,
// CSRF, origin, current enrollment, policy and connection revalidation.
// Redis approved != PostgreSQL durable grant, and neither implies Helper ready.
const REQUEST_RE=/^av2_[a-f0-9]{32}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
export class GoldAbV2GrantBridgeError extends Error{
 constructor(message,status=409){super(message);this.status=status;this.name='GoldAbV2GrantBridgeError';}
}
const fail=(msg,status=409)=>{throw new GoldAbV2GrantBridgeError(msg,status)};
export function createGoldAbV2GrantCoordinator({
 pending,accessGrants,authorizeOwner,flushGrants,confirmPersisted,
 enabled=false,now=Date.now
}={}){
 if(!enabled)return null;
 if(!pending||!['approve','grantReceipt','commitGrant'].every(x=>typeof pending[x]==='function')||
    typeof accessGrants?.approveVerifiedV2!=='function'||
    typeof accessGrants?.assert!=='function'||
    ![authorizeOwner,flushGrants,confirmPersisted,now].every(x=>typeof x==='function'))
   fail('abv2_grant_bridge_dependencies_missing',503);
 async function authorization(req,deviceId){
  const s=await authorizeOwner(req,deviceId);
  if(s?.deviceId!==deviceId||!ID.test(s.ownerAccountId||'')||
     !ID.test(s.connectionId||'')||
     !Number.isFinite(Number(s.connectionExpiresAt))||
     Number(s.connectionExpiresAt)<=now())
   fail('abv2_grant_connection_or_owner_denied',403);
  return s;
 }
 return async function approveAndCommit(req,{
  deviceId,requestId,expectedAttempt,bCode
 }={}){
  if(!ID.test(deviceId||'')||!REQUEST_RE.test(requestId||'')||
    !Number.isSafeInteger(expectedAttempt)||expectedAttempt<1)
   fail('abv2_grant_request_invalid',400);
  const s=await authorization(req,deviceId);
  const id={ownerAccountId:s.ownerAccountId,deviceId,connectionId:s.connectionId,requestId};
  let receipt;
  try{receipt=await pending.grantReceipt(id)}
  catch(error){
   if(!String(error?.message||'').includes('abv2_b_not_verified'))throw error;
   // Only this transition verifies the user's entered B, with Redis TIME
   // and current request attempt, after current owner session/CSRF/policy.
   if(typeof bCode!=='string')fail('abv2_owner_b_required',400);
   try{await pending.approve({...id,expectedAttempt,bCode})}
   catch(e){
    // Concurrent request may have verified B before us; never ignore
    // invalid B, bad scope, stale attempt, locked, denied or expired.
    if(!String(e?.message||'').includes('abv2_request_not_pending'))throw e;
   }
   receipt=await pending.grantReceipt(id);
  }
  if(receipt?.requestId!==requestId||
     !['approved','granted'].includes(receipt?.state)||
     receipt.attempt!==expectedAttempt||
     receipt.owner!==s.ownerAccountId||receipt.actor!==s.ownerAccountId||
     receipt.device!==deviceId||receipt.connection!==s.connectionId||
     !ID.test(receipt.agent||'')||
     !/^oauth-[a-f0-9]{64}$/.test(receipt.client||'')||
     !Number.isSafeInteger(receipt.approvedAt)||receipt.approvedAt<=0||
     receipt.approvedAt>now()+30000)
   fail('abv2_grant_receipt_invalid',403);
  const grantId='dag_v2_'+requestId.slice(4);
  if(receipt.grantId!=null&&receipt.grantId!==grantId)
   fail('abv2_grant_receipt_conflict',409);
  // Recheck owner/session/current signed enrollment AND connection after
  // the potentially delayed Redis verification and before mutating grant.
  const fresh=await authorization(req,deviceId);
  if(fresh.ownerAccountId!==s.ownerAccountId||
     fresh.connectionId!==s.connectionId)
   fail('abv2_grant_connection_changed',409);
  // Deterministic, per-Agent idempotent, no new 24h on retry.
  const grant=accessGrants.approveVerifiedV2({
   requestId,ownerAccountId:s.ownerAccountId,agentId:receipt.agent,
   deviceId,connectionId:s.connectionId,
   connectionExpiresAt:fresh.connectionExpiresAt,
   verifiedAt:receipt.approvedAt,label:receipt.agent
  });
  // Crucial: Gold native registry persists asynchronously. No "granted"
  // indication or successful response before a real durable PG readback.
  await flushGrants();
  const persisted=await confirmPersisted({grantId,requestId,
   ownerAccountId:s.ownerAccountId,deviceId,connectionId:s.connectionId,
   agentId:receipt.agent,approvedAt:receipt.approvedAt,
   absoluteExpiresAt:grant.absoluteExpiresAt});
  if(persisted!==true)fail('abv2_grant_not_durable',503);
  const final=await authorization(req,deviceId);
  if(final.ownerAccountId!==s.ownerAccountId||
     final.connectionId!==s.connectionId)
   fail('abv2_grant_connection_changed',409);
  accessGrants.assert(grantId,{accountId:s.ownerAccountId,
   deviceId,connectionId:s.connectionId,agentId:receipt.agent,touch:false});
  // Redis marker is idempotent; failure after PG commit is safe to replay.
  const committed=await pending.commitGrant({...id,attempt:receipt.attempt,
   approvedAt:receipt.approvedAt,grantId});
  if(committed?.state!=='granted'||committed.grantId!==grantId)
   fail('abv2_grant_redis_commit_mismatch',503);
  return {state:'granted',requestId,grantId,agentId:receipt.agent,
   approvedAt:receipt.approvedAt,
   expiresAt:Math.min(grant.expiresAt,grant.absoluteExpiresAt),
   absoluteExpiresAt:grant.absoluteExpiresAt,reused:Boolean(grant.reused)};
 };
}
