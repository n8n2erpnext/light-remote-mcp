// Gold P2-I4C3c2b1: one canonical Guest UUID becomes the Owner-scoped
// GoldJobLedger and M4 device resource claim, BEFORE any external effect.
// An unrelated owner session or an arbitrary caller-provided job is invalid.
// No Guest Fleet enqueue/Agent ticket issuer is mounted here.
import {GoldDeviceResourceLocks} from '../lib/gold-device-resource-locks.mjs';
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
export class GoldGuestM4BridgeError extends Error{
 constructor(code,status=409){super(code);this.name='GoldGuestM4BridgeError';this.status=status}
}
const deny=(code,status=409)=>{throw new GoldGuestM4BridgeError(code,status)};
const FIELDS=['jobId','operationId','ownerAccountId','actorAccountId','agentId',
 'deviceId','grantId','connectionId','clientSessionId','permissionRevision',
 'payloadSha256','nodeId'];
const exact=(a,b,keys)=>keys.every(k=>a[k]===b[k]);
export class GoldProShareGuestOwnerM4Pg{
 constructor({pool,env=process.env,resourceLocks=new GoldDeviceResourceLocks({
  capacity:2}),now=Date.now}={}){
  if(!pool?.connect||typeof pool.connect!=='function')
   deny('guest_m4_pool_required',503);
  this.enabled=env.LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE==='1';
  if(this.enabled&&['LR_GOLD_PRO_SHARE_CORE','LR_GOLD_PRO_SHARE_GUEST_QUEUE',
   'LR_GOLD_PRO_SHARE_GUEST_SLOTS','LR_GOLD_PRO_SHARE_GUEST_PAYLOAD_STAGE',
   'LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL'].some(k=>env[k]!=='1'))
   deny('guest_m4_prerequisites_off',503);
  if(this.enabled&&typeof resourceLocks?.tryClaim!=='function')
   deny('guest_m4_resource_lock_required',503);
  this.pool=pool;this.resourceLocks=resourceLocks;this.now=now;
 }
 _on(){if(!this.enabled)deny('guest_m4_bridge_disabled',404)}
 async _tx(fn){
  const db=await this.pool.connect();let active=false;
  try{
   await db.query('BEGIN');active=true;
   const out=await fn(db);
   await db.query('COMMIT');active=false;return out;
  }catch(error){if(active)await db.query('ROLLBACK').catch(()=>{});throw error}
  finally{db.release()}
 }
 async reserve(evidence={}){
  this._on();
  if(!evidence||FIELDS.some(k=>k!=='permissionRevision'&&!ID.test(evidence[k]||''))||
     !UUID.test(evidence.jobId||'')||!SHA.test(evidence.payloadSha256||'')||
     !Number.isSafeInteger(evidence.permissionRevision)||
     evidence.permissionRevision<1||evidence.ownerAccountId===evidence.actorAccountId)
   deny('guest_m4_evidence_invalid',400);
  const e=evidence;
  return this._tx(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    ['lr_gold_pro_share_guest_slot:'+e.deviceId]);
   const q=await db.query(`SELECT g.job_id,g.operation_id,g.owner_account_id,
    g.guest_account_id,g.agent_id,g.client_session_id,g.device_id,
    g.grant_id,g.connection_id,g.permission_revision,
    g.required_capabilities,g.operation,g.state AS job_state,
    s.state AS slot_state,p.payload_sha256,
    a.revision AS share_revision,a.state AS addon_state,
    a.valid_until_ms,se.status AS seat_status,sh.device_id AS shared_device,
    ab.purpose AS ab_purpose,ab.closed_at AS ab_closed_at,
    ab.agent_id AS ab_agent,ab.account_id AS ab_actor,
    ab.expires_at AS ab_expires_at,ab.absolute_expires_at,
    cn.account_id AS connection_owner,cn.closed_at AS connection_closed,
    cn.hard_expires_at AS connection_expires,
    d.owner_account_id AS device_owner,d.state AS device_state,
    d.node_id AS device_node,
    c.account_id AS native_client_owner,c.agent_id AS native_agent,
    c.closed_at AS client_closed,c.expires_at AS client_expires,
    b.grant_id AS bound_grant,b.connection_id AS bound_connection,
    b.grant_purpose AS bound_purpose
    FROM lr_gold_pro_share_guest_jobs g
    JOIN lr_gold_pro_share_guest_slots s
      ON s.job_id=g.job_id AND s.operation_id=g.operation_id
       AND s.owner_account_id=g.owner_account_id
       AND s.guest_account_id=g.guest_account_id
       AND s.device_id=g.device_id AND s.grant_id=g.grant_id
       AND s.connection_id=g.connection_id
    JOIN lr_gold_pro_share_guest_payloads p
      ON p.job_id=g.job_id AND p.operation_id=g.operation_id
       AND p.guest_account_id=g.guest_account_id
    JOIN lr_gold_pro_share_addons a ON a.owner_account_id=g.owner_account_id
    JOIN lr_gold_pro_share_seats se
      ON se.owner_account_id=g.owner_account_id AND
       se.guest_account_id=g.guest_account_id
    JOIN lr_gold_pro_share_devices sh
      ON sh.owner_account_id=g.owner_account_id AND sh.device_id=g.device_id
    JOIN lr_ab_grants ab
      ON ab.grant_id=g.grant_id AND ab.device_id=g.device_id AND
       ab.account_id=g.guest_account_id AND ab.connection_id=g.connection_id
    JOIN lr_device_connections cn
      ON cn.connection_id=g.connection_id AND cn.device_id=g.device_id
    JOIN lr_devices d ON d.device_id=g.device_id
    JOIN lr_agent_clients c ON c.client_session_id=g.client_session_id
    JOIN lr_agent_bindings b
      ON b.client_session_id=c.client_session_id AND b.device_id=g.device_id
    WHERE g.job_id=$1 FOR UPDATE OF g,s,a,ab,cn,c,b`,[e.jobId]);
   if(q.rowCount!==1)deny('guest_m4_canonical_job_missing',403);
   const r=q.rows[0],scope={
    jobId:r.job_id,operationId:r.operation_id,
    ownerAccountId:r.owner_account_id,actorAccountId:r.guest_account_id,
    agentId:r.agent_id,clientSessionId:r.client_session_id,
    deviceId:r.device_id,grantId:r.grant_id,
    connectionId:r.connection_id,
    permissionRevision:Number(r.permission_revision),
    payloadSha256:r.payload_sha256};
   if(!exact(scope,e,FIELDS.filter(k=>k!=='nodeId'))||
      r.operation!=='process'||r.job_state!=='queued'||
      r.slot_state!=='reserved'||r.share_revision===null||
      Number(r.share_revision)!==e.permissionRevision||
      !['trial','active'].includes(r.addon_state)||
      Number(r.valid_until_ms)<=this.now()||
      r.seat_status!=='accepted'||r.shared_device!==e.deviceId||
      r.ab_purpose!=='pro-share-guest'||r.ab_closed_at!=null||
      r.ab_agent!==e.agentId||r.ab_actor!==e.actorAccountId||
      new Date(r.ab_expires_at).getTime()<=this.now()||
      new Date(r.absolute_expires_at).getTime()<=this.now()||
      r.connection_owner!==e.ownerAccountId||r.connection_closed!=null||
      new Date(r.connection_expires).getTime()<=this.now()||
      r.device_owner!==e.ownerAccountId||r.device_state!=='online'||
      r.device_node!==e.nodeId||
      r.native_client_owner!==e.actorAccountId||
      r.native_agent!==e.agentId||r.client_closed!=null||
      new Date(r.client_expires).getTime()<=this.now()||
      r.bound_grant!==e.grantId||r.bound_connection!==e.connectionId||
      r.bound_purpose!=='pro-share-guest')
    deny('guest_m4_fresh_authority_or_scope_denied',403);
   if(!Array.isArray(r.required_capabilities)||
      !r.required_capabilities.includes('filesystem'))
    deny('guest_m4_process_capability_denied',403);
   // A stable server-derived synthetic session is NOT an owner session token.
   const scopedSession='gshare_'+e.jobId;
   const metadata={jobId:e.jobId,operationId:e.operationId,
    accountId:e.ownerAccountId,deviceId:e.deviceId,
    sessionId:scopedSession,agentId:e.agentId,
    nodeId:e.nodeId,status:'queued',route:'outbound-leaf',
    jobRole:'process_launch',effectState:'unknown',
    workerClass:'guest-process',signedResultVerified:false,
    signedGuestDelegationVerified:false,
    guestScope:{purpose:'pro-share-guest',guestAccountId:e.actorAccountId,
     grantId:e.grantId,connectionId:e.connectionId,
     permissionRevision:e.permissionRevision,payloadSha256:e.payloadSha256},
    requiredCapabilities:r.required_capabilities,
    startedAt:this.now(),finishedAt:null,exitCode:null,
    outputStorage:'operator_event_log'};
   await db.query(`INSERT INTO lr_gold_personal_agent_work
    (job_id,account_id,agent_id,session_id,operation_id,state,
     started_at,device_id,resource_key,resource_mode,worker_weight)
    VALUES($1,$2,$3,$4,$5,'running',clock_timestamp(),$6,
     'device:unknown','exclusive',1)`,[e.jobId,e.ownerAccountId,e.agentId,
     scopedSession,e.operationId,e.deviceId]);
   const lock=await this.resourceLocks.tryClaim(db,{
    job_id:e.jobId,account_id:e.ownerAccountId,device_id:e.deviceId,
    resource_key:'device:unknown',resource_mode:'exclusive',
    worker_weight:1
   });
   if(lock?.granted!==true)deny('guest_m4_device_resource_unavailable');
   await db.query(`INSERT INTO lr_gold_job_records
    (job_id,account_id,device_id,session_id,agent_id,operation_id,
     status,started_at,public_view)
    VALUES($1,$2,$3,$4,$5,$6,'queued',clock_timestamp(),$7::jsonb)`,
    [e.jobId,e.ownerAccountId,e.deviceId,scopedSession,
     e.agentId,e.operationId,JSON.stringify(metadata)]);
   return Object.freeze({reserved:true,jobId:e.jobId,
    ownerAccountId:e.ownerAccountId,deviceId:e.deviceId,
    operationId:e.operationId,guestAccountId:e.actorAccountId,
    resourceKey:'device:unknown',effectSubmitted:false});
  });
 }
 // Only for a provably not-attempted effect. Not callable after UNKNOWN.
 async cancelBeforeEffect({jobId,ownerAccountId,deviceId}={}){
  this._on();
  if(!UUID.test(jobId||'')||!ID.test(ownerAccountId||'')||
     !ID.test(deviceId||''))deny('guest_m4_cancel_scope_invalid',400);
  return this._tx(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    ['lr_gold_pro_share_guest_slot:'+deviceId]);
   const locked=await db.query(`SELECT g.state AS queue_state,
      s.state AS slot_state,c.worker_state
     FROM lr_gold_pro_share_guest_jobs g
     JOIN lr_gold_pro_share_guest_slots s ON s.job_id=g.job_id
     JOIN lr_gold_device_resource_claims c ON c.job_id=g.job_id
     WHERE g.job_id=$1 AND g.owner_account_id=$2 AND g.device_id=$3
     FOR UPDATE OF g,s,c`,[jobId,ownerAccountId,deviceId]);
   const row=locked.rows?.[0];
   // If slot was already cancelled by the gate, this is safe only while
   // canonical queue is cancelled and claim has not observed any process.
   if(locked.rowCount!==1||row.queue_state!=='cancelled'||
      row.slot_state!=='cancelled'||row.worker_state!=='admitting')
    deny('guest_m4_cannot_cancel_after_effect',409);
   const gone=await db.query(`DELETE FROM lr_gold_device_resource_claims
    WHERE job_id=$1 AND account_id=$2 AND device_id=$3
      AND worker_state='admitting' AND process_id IS NULL
    RETURNING job_id`,[jobId,ownerAccountId,deviceId]);
   if(gone.rowCount!==1)deny('guest_m4_cancel_claim_mismatch',409);
   await db.query('DELETE FROM lr_gold_personal_agent_work WHERE job_id=$1',
    [jobId]);
   await db.query("DELETE FROM lr_gold_job_records WHERE job_id=$1 AND status='queued'",
    [jobId]);
   return {cancelled:true,jobId};
  });
 }
}
