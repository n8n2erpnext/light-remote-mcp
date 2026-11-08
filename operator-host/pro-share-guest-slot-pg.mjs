// Gold P2-I4C3 candidate only. Cross-Operator PG guest slot is durable and
// deliberately non-expiring. No live Guest command/Agent attach is wired.
// A send/launch ACK is NOT terminal proof. Only Gold M6's durable receipt
// ledger written by the verified device channel may retire an active slot.
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const PROCESS=/^lp_[A-Za-z0-9_-]{20,80}$/;
export class GoldProShareGuestSlotError extends Error{
 constructor(reason,status=409){super(reason);this.name='GoldProShareGuestSlotError';this.status=status;}
}
const fail=(why,status=409)=>{throw new GoldProShareGuestSlotError(why,status)};
const id=(v,reason)=>{if(typeof v!=='string'||!ID.test(v))fail(reason,400);return v};
const active=['reserved','unknown','submitted'];
export class GoldProShareGuestSlotPg{
 constructor({pool,env=process.env,verifySignedLaunch=null}={}){
  if(!pool?.connect||typeof pool.connect!=='function')fail('guest_slot_pg_required',503);
  this.pool=pool;this.enabled=env.LR_GOLD_PRO_SHARE_GUEST_SLOTS==='1';
  this.m4Bridge=env.LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE==='1';
  this.verifySignedLaunch=typeof verifySignedLaunch==='function'?verifySignedLaunch:null;
  if(this.m4Bridge&&(!this.enabled||
   env.LR_GOLD_PRO_SHARE_CORE!=='1'||
   env.LR_GOLD_PRO_SHARE_GUEST_QUEUE!=='1'))
   fail('guest_slot_m4_prerequisites_off',503);
  if(this.enabled&&env.LR_GOLD_PRO_SHARE_CORE!=='1')
   fail('guest_slot_core_prerequisite_off',503);
 }
 _enabled(){if(!this.enabled)fail('guest_slots_disabled',404)}
 async _tx(fn){
  const client=await this.pool.connect();let tx=false;
  try{
   await client.query('BEGIN');tx=true;
   const value=await fn(client);
   await client.query('COMMIT');tx=false;return value;
  }catch(error){if(tx)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
 async _locked(db,deviceId){
  // Same collision-resistant transaction boundary across all Operator
  // replicas. Never use a per-process Map or expiring Redis lease here.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',
   ['lr_gold_pro_share_guest_slot:'+deviceId]);
 }
 async _reconcileLocked(db,{deviceId,ownerAccountId=null}){
  // With M4 enabled, only GoldGuestTerminalSettlementPg may move Guest,
  // M3 work and M4 claim atomically. Never silently retire just the slot.
  if(this.m4Bridge)return [];
  // This ledger is written after the enrolled Device signed terminal proof
  // is verified and the M6 receipt was persisted. This method cannot create
  // a receipt and cannot infer terminal success from a missing process.
  const out=await db.query(`UPDATE lr_gold_pro_share_guest_slots s
   SET state='terminal',terminal_state=a.terminal_state,
       terminal_acked_at=a.acked_at,updated_at=clock_timestamp()
   FROM lr_gold_terminal_receipt_acks a
   WHERE s.device_id=$1
     AND ($2::text IS NULL OR s.owner_account_id=$2)
     AND s.state IN ('unknown','submitted')
     AND s.process_id IS NOT NULL
     AND s.owner_account_id=a.account_id
     AND s.device_id=a.device_id AND s.job_id=a.job_id
     AND s.process_id=a.process_id
     AND a.terminal_state IN ('finished','stopped','timeout','error')
     AND a.finished_at_ms>0
   RETURNING s.operation_id`,[deviceId,ownerAccountId]);
  const settled=out.rows?.map(r=>r.operation_id)||[];
  if(settled.length){
   const q=await db.query(`UPDATE lr_gold_pro_share_guest_jobs
     SET state='terminal',updated_at=clock_timestamp()
     WHERE operation_id=ANY($1::text[]) AND state='unknown'
     RETURNING operation_id`,[settled]);
   if(q.rowCount!==settled.length)
    fail('guest_queue_terminal_transition_conflict',503);
  }
  return settled;
 }
 async acquire({ownerAccountId,deviceId,guestAccountId,operationId,jobId,
   grantId,connectionId,maxConcurrent=1}={}){
  this._enabled();
  const owner=id(ownerAccountId,'guest_slot_owner_invalid'),
   device=id(deviceId,'guest_slot_device_invalid'),
   guest=id(guestAccountId,'guest_slot_actor_invalid'),
   op=id(operationId,'guest_slot_operation_invalid'),
   job=id(jobId,'guest_slot_job_invalid'),
   grant=id(grantId,'guest_slot_grant_invalid'),
   conn=id(connectionId,'guest_slot_connection_invalid');
  if(owner===guest||op.length<16||maxConcurrent!==1)
   fail('guest_slot_scope_invalid',400);
  return this._tx(async db=>{
   await this._locked(db,device);
   // A signed receipt may have been committed by another Operator while
   // this replica was down. Do not depend on a volatile callback.
   await this._reconcileLocked(db,{deviceId:device});
   const prior=await db.query(
    'SELECT * FROM lr_gold_pro_share_guest_slots WHERE operation_id=$1 FOR UPDATE',[op]);
   if(prior.rowCount){
    const x=prior.rows[0];
    if(x.owner_account_id!==owner||x.device_id!==device||
       x.guest_account_id!==guest||x.job_id!==job||
       x.grant_id!==grant||x.connection_id!==conn)
     fail('guest_slot_operation_conflict',409);
    // Never dispatch a logical operation twice, even if its prior slot
    // reached terminal/denied after an ambiguous external side effect.
    return {acquired:false,reason:'guest_slot_operation_already_recorded'};
   }
   const occupied=await db.query(
    "SELECT operation_id FROM lr_gold_pro_share_guest_slots WHERE device_id=$1 AND state IN ('reserved','unknown','submitted') FOR UPDATE",
    [device]);
   if(occupied.rowCount)return {acquired:false,reason:'guest_slot_device_busy'};
   const ins=await db.query(`INSERT INTO lr_gold_pro_share_guest_slots
    (operation_id,owner_account_id,guest_account_id,device_id,job_id,grant_id,connection_id,state)
    VALUES($1,$2,$3,$4,$5,$6,$7,'reserved')
    ON CONFLICT DO NOTHING RETURNING operation_id`,[op,owner,guest,device,job,grant,conn]);
   if(ins.rowCount!==1)fail('guest_slot_unique_claim_conflict',409);
   const exact={operationId:op,ownerAccountId:owner,deviceId:device,
    guestAccountId:guest,jobId:job,grantId:grant,connectionId:conn};
   return Object.freeze({
    acquired:true,...exact,
    release:()=>this.cancelBeforeDispatch(exact),
    markDispatchAttempt:()=>this.markDispatchAttempt(exact)
   });
  });
 }
 async cancelBeforeDispatch(evidence={}){
  this._enabled();
  const op=id(evidence.operationId,'guest_slot_operation_invalid');
  const dev=id(evidence.deviceId,'guest_slot_device_invalid');
  return this._tx(async db=>{
   await this._locked(db,dev);
   // The durable outbound may have been PREPARED but not attempted.
   // Canceling just the Guest slot would strand its canonical M4 claim,
   // because M4 cleanup refuses any existing outbound record.
   if(this.m4Bridge){
    const outbound=await db.query(
     'SELECT job_id FROM lr_gold_pro_share_guest_outbound WHERE job_id=$1',
     [evidence.jobId]);
    if(outbound.rowCount)
     fail('guest_slot_outbound_exists_cannot_cancel',409);
   }
   const r=await db.query(`UPDATE lr_gold_pro_share_guest_slots
    SET state='cancelled',updated_at=clock_timestamp()
    WHERE operation_id=$1 AND device_id=$2 AND owner_account_id=$3
      AND guest_account_id=$4 AND job_id=$5 AND grant_id=$6
      AND connection_id=$7 AND state='reserved'
    RETURNING operation_id`,
    [op,dev,evidence.ownerAccountId,evidence.guestAccountId,
     evidence.jobId,evidence.grantId,evidence.connectionId]);
   if(r.rowCount!==1)return false;
   const changed=await db.query(`UPDATE lr_gold_pro_share_guest_jobs
    SET state='cancelled',updated_at=clock_timestamp()
    WHERE operation_id=$1 AND job_id=$2 AND state='queued'
    RETURNING operation_id`,[op,evidence.jobId]);
   if(changed.rowCount!==1)fail('guest_queue_precall_cancel_conflict',503);
   return true;
  });
 }
 async markDispatchAttempt(evidence={}){
  this._enabled();
  const op=id(evidence.operationId,'guest_slot_operation_invalid'),
   dev=id(evidence.deviceId,'guest_slot_device_invalid');
  return this._tx(async db=>{
   await this._locked(db,dev);
   // Persist UNKNOWN BEFORE invoking the OS dispatch callback; a crash at
   // this point is conservative (a possible effect, not proof of execution).
   // One PG transaction moves BOTH authoritative queue and reservation to
   // UNKNOWN. Crash cannot leave a queue marked dispatchable while a
   // possibly-running OS effect exists. Rollback keeps both RESERVED/QUEUED.
   const queued=await db.query(`UPDATE lr_gold_pro_share_guest_jobs
    SET state='unknown',updated_at=clock_timestamp()
    WHERE operation_id=$1 AND job_id=$2 AND state='queued'
    RETURNING operation_id`,[op,evidence.jobId]);
   if(queued.rowCount!==1)fail('guest_queue_unknown_transition_conflict',409);
   const r=await db.query(`UPDATE lr_gold_pro_share_guest_slots
    SET state='unknown',dispatch_attempted_at=clock_timestamp(),
      updated_at=clock_timestamp()
    WHERE operation_id=$1 AND device_id=$2 AND owner_account_id=$3
      AND guest_account_id=$4 AND job_id=$5 AND grant_id=$6
      AND connection_id=$7 AND state='reserved'
    RETURNING operation_id`,
    [op,dev,evidence.ownerAccountId,evidence.guestAccountId,
     evidence.jobId,evidence.grantId,evidence.connectionId]);
   if(r.rowCount!==1)fail('guest_slot_dispatch_attempt_conflict');
   if(this.m4Bridge){
    // Same PG transaction as Guest queue+slot UNKNOWN: a crash must not
    // strand an apparently queued owner Gold job after an effect is possible.
    const m=await db.query(`UPDATE lr_gold_personal_agent_work
     SET state='unknown'
     WHERE job_id=$1 AND account_id=$2 AND device_id=$3
      AND state='running' RETURNING job_id`,
     [evidence.jobId,evidence.ownerAccountId,dev]);
    if(m.rowCount!==1)fail('guest_m4_unknown_work_transition_failed',503);
    const j=await db.query(`UPDATE lr_gold_job_records
     SET status='running',
      public_view=jsonb_set(jsonb_set(public_view,
       '{status}','"running"'::jsonb,true),
       '{effectState}','"unknown"'::jsonb,true),
      updated_at=clock_timestamp()
     WHERE job_id=$1 AND account_id=$2 AND device_id=$3
      AND status='queued' RETURNING job_id`,
     [evidence.jobId,evidence.ownerAccountId,dev]);
    if(j.rowCount!==1)fail('guest_m4_unknown_ledger_transition_failed',503);
   }
   return {persistedUnknown:true,operationId:op};
  });
 }
 async bindVerifiedProcess({ownerAccountId,deviceId,jobId,processId}={}){
  this._enabled();
  // Trusted Operator adapter ONLY, after verifying signed Agent launch.
  // No public route may expose this method or take a caller-supplied
  // processId as proof. Without a verified process binding, UNKNOWN stays.
  const owner=id(ownerAccountId,'guest_slot_owner_invalid'),
   dev=id(deviceId,'guest_slot_device_invalid'),
   job=id(jobId,'guest_slot_job_invalid');
  if(!PROCESS.test(String(processId||'')))fail('guest_slot_process_invalid',400);
  // Never accept a raw process ID as verified launch. A future server
  // adapter must inject a trusted, database-backed signed-launch verifier;
  // the current source-only reconciler intentionally has none.
  // In M4 Guest mode only the independent signed Gold ledger binder
  // may atomically change both the M4 claim and Guest slot. The historical
  // slot-only method would violate the owner resource fence.
  if(this.m4Bridge)
   fail('guest_slot_use_atomic_m4_guest_launch_binder',409);
  if(!this.verifySignedLaunch)
   fail('guest_slot_verified_launch_authority_not_wired',503);
  if(await this.verifySignedLaunch({ownerAccountId:owner,deviceId:dev,
   jobId:job,processId})!==true)
   fail('guest_slot_signed_launch_not_verified',403);
  return this._tx(async db=>{
   await this._locked(db,dev);
   const r=await db.query(`UPDATE lr_gold_pro_share_guest_slots
    SET process_id=$4,state='submitted',updated_at=clock_timestamp()
    WHERE owner_account_id=$1 AND device_id=$2 AND job_id=$3
      AND state IN ('unknown','submitted')
      AND (process_id IS NULL OR process_id=$4)
    RETURNING operation_id`,[owner,dev,job,processId]);
   if(r.rowCount!==1)fail('guest_slot_verified_launch_not_found');
   await this._reconcileLocked(db,{deviceId:dev,ownerAccountId:owner});
   return {bound:true,operationId:r.rows[0].operation_id};
  });
 }
 async reconcileSignedTerminal({ownerAccountId,deviceId,jobId,processId}={}){
  this._enabled();
  if(this.m4Bridge)
   fail('guest_slot_use_atomic_m6_terminal_settlement',409);
  const owner=id(ownerAccountId,'guest_slot_owner_invalid'),
   dev=id(deviceId,'guest_slot_device_invalid'),
   job=id(jobId,'guest_slot_job_invalid');
  if(!PROCESS.test(String(processId||'')))fail('guest_slot_process_invalid',400);
  return this._tx(async db=>{
   await this._locked(db,dev);
   // Caller hints do not prove terminal: the persisted ACK ledger does.
   const r=await db.query(`UPDATE lr_gold_pro_share_guest_slots s
     SET state='terminal',terminal_state=a.terminal_state,
       terminal_acked_at=a.acked_at,updated_at=clock_timestamp()
     FROM lr_gold_terminal_receipt_acks a
     WHERE s.owner_account_id=$1 AND s.device_id=$2 AND s.job_id=$3
       AND s.process_id=$4 AND s.state IN ('unknown','submitted')
       AND a.account_id=s.owner_account_id AND a.device_id=s.device_id
       AND a.job_id=s.job_id AND a.process_id=s.process_id
       AND a.terminal_state IN ('finished','stopped','timeout','error')
       AND a.finished_at_ms>0
     RETURNING s.operation_id`,[owner,dev,job,processId]);
   if(r.rowCount){
    const changed=await db.query(`UPDATE lr_gold_pro_share_guest_jobs
     SET state='terminal',updated_at=clock_timestamp()
     WHERE operation_id=$1 AND job_id=$2 AND state='unknown'
     RETURNING operation_id`,[r.rows[0].operation_id,job]);
    if(changed.rowCount!==1)fail('guest_queue_terminal_transition_conflict',503);
   }
   return {released:r.rowCount===1,
    reason:r.rowCount===1?'durable_verified_terminal':'terminal_ack_not_confirmed'};
  });
 }
 // Called after Gold M6 has committed its signed Agent receipt to PG. It
 // derives completion from the SAME ledger, not the caller's terminal claim.
 // Also safe after restart: a new Operator can reconcile previous ACKs.
 async reconcileDevice({ownerAccountId,deviceId}={}){
  this._enabled();
  if(this.m4Bridge)
   fail('guest_slot_use_atomic_m6_terminal_settlement',409);
  const owner=id(ownerAccountId,'guest_slot_owner_invalid'),
   dev=id(deviceId,'guest_slot_device_invalid');
  return this._tx(async db=>{
   await this._locked(db,dev);
   const settled=await this._reconcileLocked(db,{
    deviceId:dev,ownerAccountId:owner});
   return {settled: settled.length,operationIds:settled};
  });
 }
 async inspectDevice(deviceId){
  this._enabled();
  const device=id(deviceId,'guest_slot_device_invalid');
  const rows=await this.pool.query(
   "SELECT operation_id,job_id,state,process_id FROM lr_gold_pro_share_guest_slots WHERE device_id=$1 AND state IN ('reserved','unknown','submitted')",[device]);
  return rows.rows||[];
 }
}
