// Gold P2-I4C3c2b2: bind only an ALREADY authenticated Device-signed
// Guest launch in the durable Gold ledger. This breaks the former circular
// "claim must be running before verified launch can bind claim" dependency.
// Never use a command send ACK, an unsigned process ID, or caller metadata.
// Source-only; not routed to Guest/owner HTTP or a live Device handler.
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PROCESS=/^lp_[A-Za-z0-9_-]{20,80}$/;
const deny=(reason,status=409)=>{const e=Error(reason);e.status=status;throw e};
export class GoldProShareGuestLaunchBindPg {
 constructor({pool,env=process.env}={}){
  if(!pool?.connect)deny('guest_launch_bind_pg_required',503);
  this.enabled=env.LR_GOLD_PRO_SHARE_GUEST_LAUNCH_BIND==='1';
  if(this.enabled&&[
   'LR_GOLD_PRO_SHARE_CORE','LR_GOLD_PRO_SHARE_GUEST_QUEUE',
   'LR_GOLD_PRO_SHARE_GUEST_SLOTS',
   'LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE',
   'LR_GOLD_PRO_SHARE_GUEST_SIGNED_LAUNCH',
   'LR_GOLD_PRO_SHARE_GUEST_OUTBOUND_PREPARE'
  ].some(k=>env[k]!=='1'))deny('guest_launch_bind_dependencies_off',503);
  this.pool=pool;
 }
 async bindFromSignedLedger({jobId}={}){
  if(!this.enabled)deny('guest_launch_bind_disabled',404);
  if(!UUID.test(jobId||''))deny('guest_launch_bind_job_invalid',400);
  const db=await this.pool.connect();let active=false;
  try{
   await db.query('BEGIN');active=true;
   // Same ordering as Guest slot and owner M4 admission. Never lock rows
   // first then acquire these advisory keys (deadlock on concurrent acquire).
   const device=await db.query(
    'SELECT device_id FROM lr_gold_pro_share_guest_jobs WHERE job_id=$1',[jobId]);
   if(device.rowCount!==1)deny('guest_launch_bind_job_missing',404);
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    ['lr_gold_pro_share_guest_slot:'+device.rows[0].device_id]);
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    ['lr_gold_m4_resource:'+device.rows[0].device_id]);
   const r=await db.query(`SELECT g.job_id,g.operation_id,
    g.owner_account_id,g.guest_account_id,g.device_id,
    g.agent_id,g.grant_id,g.connection_id,g.permission_revision,
    g.state AS queue_state,s.state AS slot_state,s.process_id AS slot_pid,
    o.state AS outbound_state,o.command_id,o.payload_sha256,
    o.ticket_envelope,
    w.state AS m4_state,
    j.status AS ledger_status,j.exit_code AS ledger_exit_code,
    j.public_view AS signed_job,
    c.account_id AS claim_owner,c.worker_state AS claim_state,
    c.process_id AS claim_pid
    FROM lr_gold_pro_share_guest_jobs g
    JOIN lr_gold_pro_share_guest_slots s ON s.job_id=g.job_id
      AND s.operation_id=g.operation_id AND
      s.owner_account_id=g.owner_account_id AND
      s.guest_account_id=g.guest_account_id AND
      s.device_id=g.device_id AND
      s.grant_id=g.grant_id AND s.connection_id=g.connection_id
    JOIN lr_gold_pro_share_guest_outbound o ON o.job_id=g.job_id
      AND o.operation_id=g.operation_id AND
      o.owner_account_id=g.owner_account_id AND
      o.guest_account_id=g.guest_account_id AND
      o.device_id=g.device_id AND o.grant_id=g.grant_id
      AND o.connection_id=g.connection_id
    JOIN lr_gold_personal_agent_work w ON w.job_id=g.job_id
      AND w.account_id=g.owner_account_id AND w.device_id=g.device_id
    JOIN lr_gold_job_records j ON j.job_id=g.job_id
      AND j.account_id=g.owner_account_id AND j.device_id=g.device_id
    JOIN lr_gold_device_resource_claims c ON c.job_id=g.job_id
      AND c.account_id=g.owner_account_id AND c.device_id=g.device_id
    WHERE g.job_id=$1
    FOR UPDATE OF g,s,o,w,j,c`,[jobId]);
   if(r.rowCount!==1)deny('guest_launch_bind_canonical_scope_missing',403);
   const x=r.rows[0];
   if(device.rows[0].device_id!==x.device_id)
    deny('guest_launch_bind_device_changed',409);
   const j=x.signed_job,d=j?.guestDelegation,t=x.ticket_envelope?.ticket;
   if(x.job_id!==jobId||x.queue_state!=='unknown'||
      x.slot_state!=='unknown'||x.slot_pid!=null||
      x.outbound_state!=='unknown'||x.m4_state!=='unknown'||
      x.claim_owner!==x.owner_account_id||
      x.claim_state!=='admitting'||x.claim_pid!=null||
      x.ledger_status!=='ok'||x.ledger_exit_code!==0||
      j?.signedResultVerified!==true||
      j.signedGuestDelegationVerified!==true||
      j.jobRole!=='process_launch'||
      j.effectState!=='result_observed'||
      j.jobId!==jobId||j.accountId!==x.owner_account_id||
      j.deviceId!==x.device_id||j.status!=='ok'||
      j.exitCode!==0||
      !Number.isSafeInteger(j.finishedAt)||j.finishedAt<=0||
      d?.purpose!=='pro-share-guest'||
      d.jobId!==jobId||
      d.ownerAccountId!==x.owner_account_id||
      d.guestAccountId!==x.guest_account_id||
      d.deviceId!==x.device_id||
      d.agentId!==x.agent_id||
      d.grantId!==x.grant_id||
      d.connectionId!==x.connection_id||
      d.operationId!==x.operation_id||
      Number(d.permissionRevision)!==Number(x.permission_revision)||
      d.payloadSha256!==x.payload_sha256||
      d.commandId!==x.command_id||
      !PROCESS.test(d.processId||'')||
      t?.purpose!=='pro-share-guest-process'||
      t.jobId!==jobId||t.commandId!==x.command_id||
      t.ownerAccountId!==x.owner_account_id||
      t.guestAccountId!==x.guest_account_id||
      t.agentId!==x.agent_id||t.grantId!==x.grant_id||
      t.connectionId!==x.connection_id||
      t.operationId!==x.operation_id||
      t.deviceId!==x.device_id||
      t.payloadSha256!==x.payload_sha256||
      Number(t.permissionRevision)!==Number(x.permission_revision))
    deny('guest_launch_bind_signed_receipt_provenance_invalid',403);
   // The signed launch receipt, not a supplied PID, is the only source.
   const claim=await db.query(`UPDATE lr_gold_device_resource_claims
    SET process_id=$4,worker_state='running',
     launch_observed_at=clock_timestamp()
    WHERE job_id=$1 AND account_id=$2 AND device_id=$3
      AND worker_state='admitting' AND process_id IS NULL
    RETURNING job_id`,[jobId,x.owner_account_id,x.device_id,d.processId]);
   if(claim.rowCount!==1)deny('guest_launch_m4_claim_transition_conflict');
   const slot=await db.query(`UPDATE lr_gold_pro_share_guest_slots
    SET process_id=$4,state='submitted',updated_at=clock_timestamp()
    WHERE job_id=$1 AND owner_account_id=$2 AND device_id=$3
      AND state='unknown' AND process_id IS NULL
    RETURNING job_id`,[jobId,x.owner_account_id,x.device_id,d.processId]);
   if(slot.rowCount!==1)deny('guest_launch_slot_transition_conflict');
   await db.query('COMMIT');active=false;
   return Object.freeze({bound:true,jobId,processId:d.processId,
    ownerAccountId:x.owner_account_id,deviceId:x.device_id,
    terminalAckStillRequired:true});
  }catch(e){if(active)await db.query('ROLLBACK').catch(()=>{});throw e}
  finally{db.release()}
 }
}
