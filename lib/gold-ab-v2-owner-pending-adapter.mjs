// Gold P2-I2c: server-internal, OWNER ONLY, fail-closed read/Refresh/deny
// adapter for the A/B V2 Redis pending index. No public route or grant.
// WARNING: authenticateOwner MUST derive identity from the Operator's verified
// account session, NEVER a client-supplied accountId or body field.
const ID_RE=/^[A-Za-z0-9._:-]{1,160}$/;
const cleanId=(v,what)=>{if(typeof v!=='string'||!ID_RE.test(v))throw new GoldAbV2OwnerPendingError('abv2_'+what+'_invalid',400);return v;};
export class GoldAbV2OwnerPendingError extends Error{
 constructor(message,status=403){super(message);this.name='GoldAbV2OwnerPendingError';this.status=status;}
}
export function safeGoldAbV2Pending(row){
 if(!row||typeof row!=='object')throw new GoldAbV2OwnerPendingError('abv2_pending_result_invalid',503);
 // Explicit allowlist. Never forward Redis box, B, hashes or index keys.
 const out={requestId:cleanId(row.requestId,'request'),state:String(row.state||''),
  attempt:Number(row.attempt),expiresAt:Number(row.expiresAt)};
 if(!['pending','approved','denied','expired','locked'].includes(out.state)||
   !Number.isSafeInteger(out.attempt)||out.attempt<1||!Number.isFinite(out.expiresAt))
  throw new GoldAbV2OwnerPendingError('abv2_pending_result_invalid',503);
 if(out.state==='pending'){
  if(typeof row.aCode!=='string'||!/^[0-9A-HJKMNP-TV-Z]{6}-[0-9A-HJKMNP-TV-Z]{5}$/.test(row.aCode))
   throw new GoldAbV2OwnerPendingError('abv2_pending_a_invalid',503);
  out.aCode=row.aCode;
 }
 if(typeof row.requester==='string'&&ID_RE.test(row.requester))out.requester=row.requester;
 return out;
}
export class GoldAbV2OwnerPendingAdapter{
 constructor({pending,authenticateOwner,getDevice,getConnection,
  verifyEnrolledConnection,authorizeOwnerAction,verifyOwnerMutation,
  isFeatureEnabled=()=>false}={}){
  if(!pending||!['listDevicePending','wallView','refresh','deny'].every(k=>typeof pending[k]==='function')||
   ![authenticateOwner,getDevice,getConnection,verifyEnrolledConnection,
     authorizeOwnerAction,verifyOwnerMutation,isFeatureEnabled].every(fn=>typeof fn==='function'))
   throw new GoldAbV2OwnerPendingError('abv2_trusted_adapter_dependencies_required',503);
  Object.assign(this,{pending,authenticateOwner,getDevice,getConnection,
   verifyEnrolledConnection,authorizeOwnerAction,verifyOwnerMutation,isFeatureEnabled});
 }
 async guard(request,deviceId,action,{mutation=false}={}){
  if(!request||typeof request!=='object')throw new GoldAbV2OwnerPendingError('abv2_owner_session_required',401);
  const did=cleanId(deviceId,'device');
  // The only owner authority is the server-verified account session callback.
  // Request JSON, claimed owner/Agent/client IDs and device labels are ignored.
  const identity=await this.authenticateOwner(request);
  const account=identity?.account;
  if(!account||!ID_RE.test(account.accountId||''))
   throw new GoldAbV2OwnerPendingError('abv2_owner_session_required',401);
  if(account.status==='disabled'||account.status==='deleted'||account.status==='dormant')
   throw new GoldAbV2OwnerPendingError('abv2_owner_inactive',403);
  const ownerAccountId=account.accountId,device=await this.getDevice(did);
  if(!device||device.deviceId!==did||device.accountId!==ownerAccountId||
   device.state==='revoked'||device.revokedAt)
   throw new GoldAbV2OwnerPendingError('abv2_owner_device_denied',403);
  const connection=await this.getConnection(did);
  if(!connection||connection.state!=='connected'||!ID_RE.test(connection.connectionId||'')||
   (connection.deviceId!=null&&connection.deviceId!==did)||
   (connection.accountId!=null&&connection.accountId!==ownerAccountId)||
   !Number.isFinite(Number(connection.hardExpiresAt))||
   Number(connection.hardExpiresAt)<=Date.now())
   throw new GoldAbV2OwnerPendingError('abv2_device_connection_invalid',409);
  const binding={ownerAccountId,deviceId:did,connectionId:connection.connectionId,
   identity,device,connection,action};
  // All three checks are required on EVERY invocation, including reads:
  // active signed enrollment, action policy, then disabled-by-default flag.
  if(await this.verifyEnrolledConnection(binding)!==true)
   throw new GoldAbV2OwnerPendingError('abv2_enrollment_denied',403);
  if(await this.authorizeOwnerAction(binding)!==true)
   throw new GoldAbV2OwnerPendingError('abv2_owner_policy_denied',403);
  if(await this.isFeatureEnabled(binding)!==true)
   throw new GoldAbV2OwnerPendingError('abv2_owner_pending_disabled',404);
  if(mutation&&await this.verifyOwnerMutation({...binding,request})!==true)
   throw new GoldAbV2OwnerPendingError('abv2_owner_mutation_denied',403);
  return {ownerAccountId,deviceId:did,connectionId:connection.connectionId};
 }
 async list(request,{deviceId,limit=5}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>5)
   throw new GoldAbV2OwnerPendingError('abv2_index_limit_invalid',400);
  const scope=await this.guard(request,deviceId,'list_pending');
  const rows=await this.pending.listDevicePending({...scope,limit});
  if(!Array.isArray(rows)||rows.length>limit)
   throw new GoldAbV2OwnerPendingError('abv2_pending_result_invalid',503);
  return {deviceId:scope.deviceId,connectionId:scope.connectionId,
   pending:rows.map(safeGoldAbV2Pending)};
 }
 async view(request,{deviceId,requestId}={}){
  const id=cleanId(requestId,'request');
  const scope=await this.guard(request,deviceId,'view_pending');
  return safeGoldAbV2Pending(await this.pending.wallView({...scope,requestId:id}));
 }
 async refresh(request,{deviceId,requestId,expectedAttempt}={}){
  const id=cleanId(requestId,'request');
  if(!Number.isSafeInteger(expectedAttempt)||expectedAttempt<1)
   throw new GoldAbV2OwnerPendingError('abv2_attempt_invalid',400);
  const scope=await this.guard(request,deviceId,'refresh_pending',{mutation:true});
  const out=await this.pending.refresh({...scope,requestId:id,expectedAttempt});
  return {requestId:cleanId(out?.requestId,'request'),state:'pending',
   attempt:Number(out.attempt),expiresAt:Number(out.expiresAt)};
 }
 async deny(request,{deviceId,requestId}={}){
  const id=cleanId(requestId,'request');
  const scope=await this.guard(request,deviceId,'deny_pending',{mutation:true});
  const out=await this.pending.deny({...scope,requestId:id});
  if(out?.state!=='denied'||out?.requestId!==id)
   throw new GoldAbV2OwnerPendingError('abv2_pending_result_invalid',503);
  return {requestId:id,state:'denied'};
 }
 // NO approve method. Redis-only 'approved' is never a real 24h A/B grant.
}
