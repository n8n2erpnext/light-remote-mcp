/**
 * Gold signed Device Channel connectivity, PostgreSQL 17 authority only.
 *
 * Never trusts owner/device/node from a request body. A separate, owner-
 * provisioned verifier authenticates the device's signed channel envelope
 * and returns its immutable device identity. PostgreSQL is the sole source
 * of connection state. No legacy JSON or Redis authority.
 */
import crypto from 'node:crypto';

const ID=/^[a-zA-Z0-9._:-]{1,160}$/;
const err=(code,status=403)=>Object.assign(new Error(code),{code,status});
const id=v=>{const x=String(v||'');if(!ID.test(x))throw err('gold_channel_invalid_identifier',400);return x};
const maxTtl=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw err('gold_channel_invalid_lease',400);return v};
const epoch=v=>new Date(v).getTime();
const SAFE_REASONS=new Set(['client_disconnect','device_offline','replaced','operator_revoke','lease_expired']);
export class GoldPgDeviceChannelAuthority{
 constructor({pool,verifyChannelEnvelope,now=()=>Date.now(),
  planDeviceCap={free:2,pro:10,vip:30}}={}){
  if(!pool?.connect||!pool?.query)throw Error('gold_channel_pg_pool_required');
  if(typeof verifyChannelEnvelope!=='function')
   throw Error('gold_channel_signed_device_verifier_required');
  Object.assign(this,{pool,verifyChannelEnvelope,now,planDeviceCap});
 }
 async tx(fn){
  const c=await this.pool.connect();let began=false;
  try{
   await c.query('BEGIN');began=true;
   const out=await fn(c);await c.query('COMMIT');began=false;return out;
  }catch(error){if(began)await c.query('ROLLBACK').catch(()=>{});throw error}
  finally{c.release()}
 }
 async principal(purpose,signedEnvelope){
  const proof=await this.verifyChannelEnvelope({purpose,signedEnvelope});
  if(proof?.authorized!==true||!proof.ownerAccountId||
    !proof.deviceId||!proof.nodeId)
   throw err('gold_channel_device_proof_invalid',401);
  if(!proof.payload||typeof proof.payload!=='object'||
    Array.isArray(proof.payload))throw err('gold_channel_signed_payload_invalid',401);
  return {owner:id(proof.ownerAccountId),device:id(proof.deviceId),
   node:id(proof.nodeId),payload:proof.payload};
 }
 async lockedDevice(c,p){
  // Share the owner-wide cap lock with GoldPgCoreAuthority.connectDevice.
  // A device-only lock would let two newly enrolled devices race the Free
  // two-device cap across separate Gold Channel worker processes.
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',
   ['gold:connect:'+p.owner]);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
   ['gold:device:'+p.device]);
  const result=await c.query(
   "SELECT d.device_id,d.node_id,d.state,a.status,a.plan "+
   "FROM lr_devices d JOIN lr_accounts a ON a.account_id=d.owner_account_id "+
   "WHERE d.device_id=$1 AND d.owner_account_id=$2 AND d.node_id=$3 "+
   "FOR UPDATE OF d,a",[p.device,p.owner,p.node]);
  const row=result.rows?.[0];
  if(!row||row.status!=='active'||row.state==='revoked')
   throw err('gold_channel_owner_device_disabled');
  return row;
 }
 async expire(c,connectionId,reason,{cancelQueued=true}={}){
  const conn=id(connectionId),cause=String(reason||'lease_expired');
  // These actions run within one transaction and serialize against a
  // current device/channel lease mutation.
  await c.query(
   "UPDATE lr_ab_requests SET state='denied',consumed_at=now() "+
   "WHERE connection_id=$1 AND state='pending'",[conn]);
  await c.query(
   "UPDATE lr_ab_grants SET closed_at=now() "+
   "WHERE connection_id=$1 AND closed_at IS NULL",[conn]);
  await c.query(
   "UPDATE lr_remote_sessions SET closed_at=now(),hold_reason=$2 "+
   "WHERE connection_id=$1 AND closed_at IS NULL",[conn,cause]);
  if(cancelQueued)await c.query(
   "UPDATE lr_jobs SET state='canceled',finished_at=now(),last_error=$2 "+
   "WHERE state='queued' AND (device_id,owner_account_id) IN "+
   "(SELECT device_id,account_id FROM lr_device_connections "+
   "WHERE connection_id=$1)",
   [conn,cause]);
  await c.query(
   "UPDATE lr_device_connections SET closed_at=now(),close_reason=$2 "+
   "WHERE connection_id=$1 AND closed_at IS NULL",[conn,cause]);
 }
 async connect({signedEnvelope}={}){
  const p=await this.principal('connect',signedEnvelope);
  const leaseMs=p.payload.leaseMs??86400000;
  const reconnectGraceMs=p.payload.reconnectGraceMs??3600000;
  maxTtl(leaseMs,900000,86400000);
  maxTtl(reconnectGraceMs,900000,3600000);
  return this.tx(async c=>{
   const device=await this.lockedDevice(c,p);
   const active=await c.query(
    "SELECT connection_id,hard_expires_at,reconnect_grace_ms "+
    "FROM lr_device_connections WHERE account_id=$1 AND device_id=$2 "+
    "AND closed_at IS NULL ORDER BY connected_at DESC FOR UPDATE",
    [p.owner,p.device]);
   const live=(active.rows||[]).filter(row=>
    epoch(row.hard_expires_at)>this.now());
   // Never try to reconcile incompatible imported parallel leases by taking
   // the newest one: an unexpired grant on the other would remain usable.
   if(live.length>1)throw err('gold_channel_multiple_active_connections',409);
   const reused=live[0]||null;
   for(const row of active.rows||[]){
    if(epoch(row.hard_expires_at)<=this.now()){
     // Historical/expired connection should close its A/B authority, but
     // must NOT cancel queued work on another still-live same-device lease.
     // lr_jobs V20 has no connection_id; V21 work remains unaccepted.
     await this.expire(c,row.connection_id,'lease_expired',
      {cancelQueued:!reused});
    }
   }
   if(reused){
    await c.query(
     "UPDATE lr_device_connections SET last_activity_at=now() "+
     "WHERE connection_id=$1",[reused.connection_id]);
    await c.query(
     "UPDATE lr_devices SET state='online',last_seen_at=now(),updated_at=now() "+
     "WHERE device_id=$1",[p.device]);
    return {connectionId:reused.connection_id,deviceId:p.device,
     accountId:p.owner,expiresAt:epoch(reused.hard_expires_at),
     reconnectGraceMs:reused.reconnect_grace_ms,reused:true};
   }
   const count=await c.query(
    "SELECT COUNT(DISTINCT device_id)::integer AS count FROM lr_device_connections "+
    "WHERE account_id=$1 AND closed_at IS NULL AND hard_expires_at>now()",
    [p.owner]);
   if(Number(count.rows?.[0]?.count||0)>=Number(this.planDeviceCap[device.plan]||0))
    throw err('gold_channel_device_plan_cap',429);
   const connectionId='conn_'+crypto.randomUUID(),expiresAt=this.now()+leaseMs;
   const saved=await c.query(
    "INSERT INTO lr_device_connections(connection_id,account_id,device_id,"+
    "plan,hard_expires_at,reconnect_grace_ms) "+
    "VALUES($1,$2,$3,$4,to_timestamp($5/1000.0),$6) RETURNING connection_id",
    [connectionId,p.owner,p.device,device.plan,expiresAt,reconnectGraceMs]);
   if(saved.rows?.length!==1)throw err('gold_channel_connect_failed',503);
   await c.query(
    "UPDATE lr_devices SET state='online',last_seen_at=now(),updated_at=now() "+
    "WHERE device_id=$1",[p.device]);
   return {connectionId,deviceId:p.device,accountId:p.owner,expiresAt,
    reconnectGraceMs,reused:false};
  });
 }
 async lockedConnection(c,p,connectionId){
  const conn=id(connectionId);
  const result=await c.query(
   "SELECT connection_id,hard_expires_at,reconnect_grace_ms,closed_at "+
   "FROM lr_device_connections WHERE connection_id=$1 AND account_id=$2 "+
   "AND device_id=$3 FOR UPDATE",[conn,p.owner,p.device]);
  const row=result.rows?.[0];
  if(!row||row.closed_at||epoch(row.hard_expires_at)<=this.now())
   throw err('gold_channel_connection_invalid_or_expired');
  return row;
 }
 async renew({signedEnvelope}={}){
  const p=await this.principal('renew',signedEnvelope);
  const connectionId=id(p.payload.connectionId);
  return this.tx(async c=>{
   await this.lockedDevice(c,p);
   const prior=await this.lockedConnection(c,p,connectionId);
   await c.query(
    "UPDATE lr_device_connections SET last_activity_at=now() "+
    "WHERE connection_id=$1",[prior.connection_id]);
   await c.query(
    "UPDATE lr_devices SET state='online',last_seen_at=now(),updated_at=now() "+
    "WHERE device_id=$1",[p.device]);
   return {connectionId:prior.connection_id,deviceId:p.device,accountId:p.owner,
    expiresAt:epoch(prior.hard_expires_at),reconnectGraceMs:prior.reconnect_grace_ms,
    renewed:true};
  });
 }
 async setGrace({signedEnvelope}={}){
  const p=await this.principal('grace',signedEnvelope);
  const connectionId=id(p.payload.connectionId);
  const reconnectGraceMs=p.payload.reconnectGraceMs;
  maxTtl(reconnectGraceMs,900000,3600000);
  return this.tx(async c=>{
   await this.lockedDevice(c,p);
   const prior=await this.lockedConnection(c,p,connectionId);
   await c.query(
    "UPDATE lr_device_connections SET reconnect_grace_ms=$2,"+
    "last_activity_at=now() WHERE connection_id=$1",
    [prior.connection_id,reconnectGraceMs]);
   return {connectionId:prior.connection_id,deviceId:p.device,
    expiresAt:epoch(prior.hard_expires_at),reconnectGraceMs};
  });
 }
 async disconnect({signedEnvelope}={}){
  const p=await this.principal('disconnect',signedEnvelope);
  const connectionId=id(p.payload.connectionId);
  const reason=p.payload.reason??'client_disconnect';
  if(!SAFE_REASONS.has(reason))throw err('gold_channel_disconnect_reason_invalid',400);
  return this.tx(async c=>{
   await this.lockedDevice(c,p);
   const row=await this.lockedConnection(c,p,connectionId);
   const concurrent=await c.query(
    "SELECT connection_id FROM lr_device_connections "+
    "WHERE device_id=$1 AND account_id=$2 AND connection_id<>$3 "+
    "AND closed_at IS NULL AND hard_expires_at>now() FOR UPDATE",
    [p.device,p.owner,row.connection_id]);
   const hasOtherLive=(concurrent.rows?.length||0)>0;
   await this.expire(c,row.connection_id,reason,{cancelQueued:!hasOtherLive});
   if(!hasOtherLive)await c.query(
    "UPDATE lr_devices SET state='offline',updated_at=now() "+
    "WHERE device_id=$1 AND state<>'revoked'",[p.device]);
   return {connectionId:row.connection_id,deviceId:p.device,
    accountId:p.owner,closed:true,closeReason:reason};
  });
 }
 /**
  * Database-authoritative lease expiry cleanup for devices that vanished
  * without sending a signed disconnect. Bounded and race-safe across Gold
  * Core processes; never fabricates signed device proof on their behalf.
  */
 async reapExpired({limit=64}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>128)
   throw err('gold_channel_reaper_limit_invalid',400);
  // Read without an early row lock: never hold a connection lock and then
  // take the owner/device advisory locks in the opposite order of connect().
  const candidates=await this.pool.query(
   "SELECT connection_id,account_id,device_id "+
   "FROM lr_device_connections WHERE closed_at IS NULL "+
   "AND hard_expires_at<=now() ORDER BY hard_expires_at,connection_id LIMIT $1",
   [limit]);
  let expired=0,skipped=0;
  for(const candidate of candidates.rows||[]){
   const conn=id(candidate.connection_id),owner=id(candidate.account_id);
   const device=id(candidate.device_id);
   const changed=await this.tx(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',
     ['gold:connect:'+owner]);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
     ['gold:device:'+device]);
    const owned=await c.query(
     "SELECT device_id FROM lr_devices WHERE device_id=$1 "+
     "AND owner_account_id=$2 FOR UPDATE",[device,owner]);
    if(owned.rows?.length!==1)throw err('gold_channel_reaper_device_mismatch');
    const current=await c.query(
     "SELECT connection_id,hard_expires_at,closed_at "+
     "FROM lr_device_connections WHERE connection_id=$1 "+
     "AND account_id=$2 AND device_id=$3 FOR UPDATE",
     [conn,owner,device]);
    const row=current.rows?.[0];
    if(!row||row.closed_at||epoch(row.hard_expires_at)>this.now())
     return false; // renewed/revoked/cleaned by another worker
    const siblings=await c.query(
     "SELECT connection_id FROM lr_device_connections "+
     "WHERE device_id=$1 AND account_id=$2 AND connection_id<>$3 "+
     "AND closed_at IS NULL AND hard_expires_at>now() FOR UPDATE",
     [device,owner,conn]);
    const live=(siblings.rows?.length||0)>0;
    await this.expire(c,conn,'lease_expired',{cancelQueued:!live});
    if(!live)await c.query(
     "UPDATE lr_devices SET state='offline',updated_at=now() "+
     "WHERE device_id=$1 AND owner_account_id=$2 AND state<>'revoked'",
     [device,owner]);
    return true;
   });
   if(changed)expired++;else skipped++;
  }
  return {scanned:(candidates.rows||[]).length,expired,skipped};
 }
}
