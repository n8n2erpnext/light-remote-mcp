// Gold P2-I4C3c2b3b: M6 signed terminal settlement of a previously
// bound Guest process. No RPC, no fleet enqueue, no inferred process exit.
// Existing M6 code writes lr_gold_terminal_receipt_acks ONLY after Device
// signed terminal verification. This class consumes the durable receipt.
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const deny=(code,status=409)=>{const e=Error(code);e.status=status;throw e};
const endStates=new Set(['finished','stopped','timeout','error']);
export class GoldGuestTerminalSettlementPg {
 constructor({pool,env=process.env}={}){
  if(!pool?.connect)deny('guest_terminal_pg_required',503);
  this.enabled=env.LR_GOLD_PRO_SHARE_GUEST_TERMINAL_SETTLE==='1';
  if(this.enabled&&[
   'LR_GOLD_PRO_SHARE_CORE','LR_GOLD_PRO_SHARE_GUEST_QUEUE',
   'LR_GOLD_PRO_SHARE_GUEST_SLOTS','LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE',
   'LR_GOLD_PRO_SHARE_GUEST_LAUNCH_BIND'
  ].some(k=>env[k]!=='1'))deny('guest_terminal_prerequisites_off',503);
  this.pool=pool;
 }
 async settle({jobId}={}){
  if(!this.enabled)deny('guest_terminal_disabled',404);
  if(!UUID.test(jobId||''))deny('guest_terminal_job_uuid_required',400);
  const db=await this.pool.connect();let tx=false;
  try{
   await db.query('BEGIN');tx=true;
   // Read device identity before taking matching advisory locks in the
   // existing Guest-slot -> M4 order.
   const device=await db.query(
    'SELECT device_id FROM lr_gold_pro_share_guest_jobs WHERE job_id=$1',[jobId]);
   if(device.rowCount!==1)deny('guest_terminal_job_not_found',404);
   const dev=device.rows[0].device_id;
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    ['lr_gold_pro_share_guest_slot:'+dev]);
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    ['lr_gold_m4_resource:'+dev]);
   const checked=await db.query(`SELECT g.job_id,g.operation_id,
     g.owner_account_id,g.guest_account_id,g.device_id,
     g.agent_id,g.grant_id,g.connection_id,g.permission_revision,
     g.operation_id,g.operation AS guest_operation,
     o.state AS outbound_state,o.command_id,o.payload_sha256,
     o.ticket_envelope,
     g.state AS queue_state,s.state AS slot_state,
     s.process_id AS slot_pid,s.terminal_state AS slot_terminal_state,
     s.terminal_acked_at AS slot_terminal_acked_at,
     w.state AS m3_state,w.disposition AS m3_disposition,
     j.status AS launch_job_status,j.public_view AS launch_evidence,
     c.job_id AS claim_job,c.account_id AS claim_owner,
     c.device_id AS claim_device,c.process_id AS claim_pid,
     c.worker_state AS claim_state,
     a.account_id AS ack_owner,a.device_id AS ack_device,
     a.job_id AS ack_job,a.process_id AS ack_pid,
     a.terminal_state,a.finished_at_ms,a.acked_at
    FROM lr_gold_pro_share_guest_jobs g
    JOIN lr_gold_pro_share_guest_slots s ON s.job_id=g.job_id
      AND s.operation_id=g.operation_id
      AND s.owner_account_id=g.owner_account_id
      AND s.guest_account_id=g.guest_account_id
      AND s.device_id=g.device_id
      AND s.grant_id=g.grant_id AND s.connection_id=g.connection_id
    JOIN lr_gold_pro_share_guest_outbound o ON o.job_id=g.job_id
      AND o.operation_id=g.operation_id
      AND o.owner_account_id=g.owner_account_id
      AND o.guest_account_id=g.guest_account_id
      AND o.device_id=g.device_id AND o.grant_id=g.grant_id
      AND o.connection_id=g.connection_id
    JOIN lr_gold_personal_agent_work w ON w.job_id=g.job_id
      AND w.account_id=g.owner_account_id AND w.device_id=g.device_id
    JOIN lr_gold_job_records j ON j.job_id=g.job_id
      AND j.account_id=g.owner_account_id AND j.device_id=g.device_id
    LEFT JOIN lr_gold_device_resource_claims c ON c.job_id=g.job_id
    LEFT JOIN lr_gold_terminal_receipt_acks a
      ON a.account_id=g.owner_account_id
      AND a.device_id=g.device_id AND a.job_id=g.job_id
      AND a.process_id=s.process_id
    WHERE g.job_id=$1
    FOR UPDATE OF g,s,w,j`,[jobId]);
   if(checked.rowCount!==1)deny('guest_terminal_canonical_rows_missing',403);
   const r=checked.rows[0],j=r.launch_evidence,
    proof=j?.guestDelegation,ticket=r.ticket_envelope?.ticket;
   // A duplicate after COMMIT must not be confused with a missing ACK or
   // an arbitrary terminal claim. Require the exact signed ledger, durable
   // M6 ACK and corresponding canonical completed states for idempotency.
   const signedLaunchOk=
    device.rows[0].device_id===r.device_id&&
    r.launch_job_status==='ok'&&
    j?.signedResultVerified===true&&
    j?.signedGuestDelegationVerified===true&&
    j?.jobId===jobId&&j?.accountId===r.owner_account_id&&
    j?.deviceId===r.device_id&&j?.status==='ok'&&
    j?.jobRole==='process_launch'&&
    j?.effectState==='result_observed'&&
    j?.exitCode===0&&
    Number.isSafeInteger(j?.finishedAt)&&j.finishedAt>0&&
    r.guest_operation==='process'&&
    r.outbound_state==='unknown'&&
    proof?.purpose==='pro-share-guest'&&
    proof?.jobId===jobId&&
    proof?.ownerAccountId===r.owner_account_id&&
    proof?.guestAccountId===r.guest_account_id&&
    proof?.deviceId===r.device_id&&
    proof?.processId===r.slot_pid&&
    proof?.agentId===r.agent_id&&
    proof?.grantId===r.grant_id&&
    proof?.connectionId===r.connection_id&&
    proof?.operationId===r.operation_id&&
    Number(proof?.permissionRevision)===Number(r.permission_revision)&&
    proof?.payloadSha256===r.payload_sha256&&
    proof?.commandId===r.command_id&&
    ticket?.purpose==='pro-share-guest-process'&&
    ticket?.jobId===jobId&&ticket?.commandId===r.command_id&&
    ticket?.ownerAccountId===r.owner_account_id&&
    ticket?.guestAccountId===r.guest_account_id&&
    ticket?.deviceId===r.device_id&&
    ticket?.agentId===r.agent_id&&
    ticket?.grantId===r.grant_id&&
    ticket?.connectionId===r.connection_id&&
    ticket?.operationId===r.operation_id&&
    Number(ticket?.permissionRevision)===Number(r.permission_revision)&&
    ticket?.payloadSha256===r.payload_sha256;
   const durableAckOk=
    /^lp_[A-Za-z0-9_-]{20,80}$/.test(r.slot_pid||'')&&
    r.ack_owner===r.owner_account_id&&
    r.ack_device===r.device_id&&
    r.ack_job===jobId&&r.ack_pid===r.slot_pid&&
    endStates.has(r.terminal_state)&&
    Number.isSafeInteger(Number(r.finished_at_ms))&&
    Number(r.finished_at_ms)>0&&r.acked_at!=null;
   if(!signedLaunchOk||!durableAckOk)
    deny('guest_terminal_signed_m6_ack_not_confirmed',409);
   if(r.queue_state==='terminal'||r.slot_state==='terminal'||
      r.m3_state==='finished'){
    const ackedMs=new Date(r.acked_at).getTime();
    const slotAckedMs=r.slot_terminal_acked_at==null?NaN:
      new Date(r.slot_terminal_acked_at).getTime();
    if(r.queue_state!=='terminal'||r.slot_state!=='terminal'||
       r.m3_state!=='finished'||
       r.m3_disposition!=='guest_signed_m6_terminal'||
       r.slot_terminal_state!==r.terminal_state||
       !Number.isFinite(ackedMs)||slotAckedMs!==ackedMs||
       r.claim_job!=null)
      deny('guest_terminal_partial_or_conflicting_completion',409);
    await db.query('COMMIT');tx=false;
    return Object.freeze({settled:true,alreadySettled:true,jobId,
     ownerAccountId:r.owner_account_id,deviceId:dev,
     terminalState:r.terminal_state,receiptPersisted:true,
     m3Released:true,m4Released:true,shouldReissue:false});
   }
   if(r.queue_state!=='unknown'||r.slot_state!=='submitted'||
      r.m3_state!=='unknown'||
      (r.claim_job!=null&&(
       r.claim_job!==jobId||
       r.claim_owner!==r.owner_account_id||
       r.claim_device!==r.device_id||
       r.claim_pid!==r.slot_pid||
       r.claim_state!=='running')))
    deny('guest_terminal_signed_m6_ack_not_confirmed',409);
   const owner=r.owner_account_id;
   // Exact receipt observed: the only permitted M4 deletion is scoped to
   // the same signed PID. Missing M4 claim is allowed only because M6 may
   // have released it already; an unrelated active claim is never touched.
   if(r.claim_job!=null){
    const claim=await db.query(`DELETE FROM lr_gold_device_resource_claims
      WHERE job_id=$1 AND account_id=$2 AND device_id=$3
        AND process_id=$4 AND worker_state='running'
      RETURNING job_id`,[jobId,owner,dev,r.slot_pid]);
    if(claim.rowCount!==1)deny('guest_terminal_m4_claim_lost',409);
   }
   const work=await db.query(`UPDATE lr_gold_personal_agent_work
      SET state='finished',finished_at=clock_timestamp(),
       disposition='guest_signed_m6_terminal'
      WHERE job_id=$1 AND account_id=$2 AND device_id=$3
        AND state='unknown' RETURNING job_id`,[jobId,owner,dev]);
   if(work.rowCount!==1)deny('guest_terminal_m3_transition_failed',409);
   const slot=await db.query(`UPDATE lr_gold_pro_share_guest_slots
      SET state='terminal',terminal_state=$4,
       terminal_acked_at=$5,updated_at=clock_timestamp()
      WHERE job_id=$1 AND owner_account_id=$2 AND device_id=$3
        AND process_id=$6 AND state='submitted'
      RETURNING operation_id`,[
      jobId,owner,dev,r.terminal_state,r.acked_at,r.slot_pid]);
   if(slot.rowCount!==1)deny('guest_terminal_slot_transition_failed',409);
   const queue=await db.query(`UPDATE lr_gold_pro_share_guest_jobs
      SET state='terminal',updated_at=clock_timestamp()
      WHERE job_id=$1 AND owner_account_id=$2 AND device_id=$3
        AND operation_id=$4 AND state='unknown'
      RETURNING job_id`,[jobId,owner,dev,r.operation_id]);
   if(queue.rowCount!==1)deny('guest_terminal_queue_transition_failed',409);
   await db.query('COMMIT');tx=false;
   return Object.freeze({settled:true,jobId,
    ownerAccountId:owner,deviceId:dev,
    terminalState:r.terminal_state,receiptPersisted:true,
    m3Released:true,m4Released:true,shouldReissue:false});
  }catch(error){if(tx)await db.query('ROLLBACK').catch(()=>{});throw error}
  finally{db.release()}
 }
}
