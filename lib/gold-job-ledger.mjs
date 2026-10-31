/** Durable PostgreSQL job metadata for the existing Operator job lifecycle. */
export class GoldOperationEffectError extends Error {
 constructor(code='operation_effect_unknown',jobId=null){super(code);this.name='GoldOperationEffectError';this.status=409;this.jobId=jobId;}
}
function jobSnapshot(job,redact){
 const scrub=value=>redact(String(value||'')).slice(0,1000);
 return {
  jobId:job.id,requestId:job.requestId||null,operationId:job.operationId||null,
  // Persist the Fleet identity alongside the signed terminal record. A crash
  // after PG commit but before JSONL append must not lose replay correlation.
  commandId:/^cmd_[A-Za-z0-9._:-]{20,128}$/.test(String(job.commandId||''))?job.commandId:null,
  operationFingerprint:job.operationFingerprint||null,
  effectState:job.finishedAt?'result_observed':'unknown',
  // Only a result from the authenticated device-result handler provides
  // evidence for a replay ACK; Operator-generated timeout is not proof.
  signedResultVerified:job.signedResultVerified===true,
  // Set ONLY by the authenticated Device result handler after comparing
  // signed ticket, server-owned Guest intent, exact process and command.
  signedGuestDelegationVerified:job.signedGuestDelegationVerified===true,
  ...(job.signedGuestDelegationVerified===true&&job.guestDelegation?
   {guestDelegation:{...job.guestDelegation}}:{}),
  accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,
  agentId:job.agentId,nodeId:job.nodeId,status:job.status,
  route:job.remote?'outbound-leaf':'local',
  startedAt:job.startedAt,finishedAt:job.finishedAt||null,
  // Preserve evidence that a Kill was requested across Operator restarts.
  // This metadata NEVER means the OS effect actually stopped.
  stopRequestedAt:Number.isSafeInteger(job.stopRequestedAt)?job.stopRequestedAt:null,
  exitCode:Number.isInteger(job.exitCode)?job.exitCode:null,
  signal:job.signal||null,requiredCapabilities:[...(job.requiredCapabilities||[])],
  jobRole:job.managedExec?'process_launch':'operation',
  workerClass:String(job.resourceIntent?.family||job.toolMeta?.kind||'general').slice(0,32),
  resultSummary:scrub(job.resultSummary),note:scrub(job.note),
  // Do not persist scripts, stdout/stderr, tokens, process handles or credentials.
  outputStorage:'operator_event_log'
 };
}
export class GoldJobLedger{
 constructor({pool,redact}={}){
  if(!pool||typeof pool.query!=='function'||typeof redact!=='function')throw Error('gold_job_pg_required');
  this.pool=pool;this.redact=redact;this.pending=Promise.resolve();this.error=null;
 }
 static async open({pool,redact,preserveGuestUnknown=false}){
  const instance=new GoldJobLedger({pool,redact});
  // The shared Gold UAT has no PG044 until an approved migration. Keep
  // the classic owner restart behavior unchanged by default. A future
  // Guest-enabled Operator MUST explicitly opt in and have PG044 applied.
  // Guest UNKNOWN must retain its exact signed-launch correlation on
  // restart; no status=interrupted rewrite may discard its M4 evidence.
  const guestFence=preserveGuestUnknown===true?
   ` AND NOT EXISTS(
      SELECT 1 FROM lr_gold_pro_share_guest_jobs g
      JOIN lr_gold_pro_share_guest_slots s
        ON s.job_id=g.job_id AND s.operation_id=g.operation_id
      WHERE g.job_id=lr_gold_job_records.job_id
        AND g.owner_account_id=lr_gold_job_records.account_id
        AND g.device_id=lr_gold_job_records.device_id
        AND ((g.state='unknown' AND s.state IN ('unknown','submitted'))
         OR (g.state='queued' AND s.state='reserved'
             AND EXISTS (
               SELECT 1 FROM lr_gold_personal_agent_work w
               JOIN lr_gold_device_resource_claims c ON c.job_id=w.job_id
                 AND c.account_id=w.account_id AND c.device_id=w.device_id
               WHERE w.job_id=g.job_id
                 AND w.account_id=g.owner_account_id
                 AND w.device_id=g.device_id
                 AND w.state='running'
                 AND c.worker_state='admitting' AND c.process_id IS NULL
             )
             AND NOT EXISTS (
                SELECT 1 FROM lr_gold_pro_share_guest_outbound o
                WHERE o.job_id=g.job_id
             )))
     )`:'';
  await pool.query(`UPDATE lr_gold_job_records
    SET status='interrupted',finished_at=now(),
      public_view=jsonb_set(public_view,'{status}','"interrupted"'::jsonb,true),
      updated_at=now()
    WHERE status IN ('running','queued')${guestFence}`);
  return instance;
 }
 // Reserve the same logical operation in PostgreSQL BEFORE a job can have
 // effects. Transactional advisory lock serializes competing Operator calls.
 async reserve(job){
  if(!job?.operationId||!job?.operationFingerprint)throw new Error('gold_operation_claim_invalid');
  const client=await this.pool.connect();
  let tx=false;
  try{
   await client.query('BEGIN');tx=true;
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    ['light_remote_gold_operation:'+job.accountId+':'+job.deviceId,job.operationId]);
   const {rows}=await client.query(`SELECT job_id,public_view FROM lr_gold_job_records
    WHERE account_id=$1 AND device_id=$2 AND operation_id=$3
    ORDER BY started_at DESC LIMIT 1`,[job.accountId,job.deviceId,job.operationId]);
   if(rows?.length){
    await client.query('COMMIT');tx=false;
    return {jobId:rows[0].job_id,operationFingerprint:rows[0].public_view?.operationFingerprint||null};
   }
   const record=jobSnapshot(job,this.redact);
   await client.query(`INSERT INTO lr_gold_job_records
    (job_id,account_id,device_id,session_id,agent_id,operation_id,status,started_at,finished_at,exit_code,public_view)
    VALUES($1,$2,$3,$4,$5,$6,'running',$7,NULL,NULL,$8::jsonb)`,
    [job.id,job.accountId,job.deviceId,job.sessionId,job.agentId,job.operationId,new Date(job.startedAt),JSON.stringify(record)]);
   await client.query('COMMIT');tx=false;
   return null;
  }catch(error){if(tx)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
 save(job){
  if(this.error)throw this.error;
  const record=jobSnapshot(job,this.redact);
  const json=JSON.stringify(record);
  const values=[job.id,job.accountId,job.deviceId,job.sessionId,job.agentId,job.operationId||null,
    job.status,new Date(job.startedAt),job.finishedAt?new Date(job.finishedAt):null,
    Number.isInteger(job.exitCode)?job.exitCode:null,json];
  this.pending=this.pending.then(()=>this.pool.query(`INSERT INTO lr_gold_job_records
   (job_id,account_id,device_id,session_id,agent_id,operation_id,status,started_at,finished_at,exit_code,public_view)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
   ON CONFLICT(job_id) DO UPDATE SET
    status=EXCLUDED.status,finished_at=EXCLUDED.finished_at,
    exit_code=EXCLUDED.exit_code,public_view=EXCLUDED.public_view,updated_at=now()`,values))
   .catch(error=>{
    this.error=Error('gold_job_pg_write_failed',{cause:error});throw this.error;
   });
  this.pending.catch(()=>{});
 }
 async flush(){await this.pending;if(this.error)throw this.error}
 async get(id){
  if(!/^[a-f0-9-]{36}$/i.test(String(id||'')))return null;
  await this.flush();
  const {rows}=await this.pool.query('SELECT public_view FROM lr_gold_job_records WHERE job_id=$1',[id]);
  return rows?.[0]?.public_view||null;
 }
 // Deliberately fail closed on ambiguous or uncommitted command mappings.
 // No schema migration: this is metadata in the existing JSONB public_view.
 async completedForCommand({commandId,accountId,deviceId,nodeId}={}){
  if(!/^cmd_[A-Za-z0-9._:-]{20,128}$/.test(String(commandId||''))||
     !accountId||!deviceId||!nodeId)throw Error('gold_command_owner_scope_required');
  await this.flush();
  const {rows}=await this.pool.query(`SELECT public_view FROM lr_gold_job_records
    WHERE account_id=$2 AND device_id=$3
      AND public_view->>'commandId'=$1
      AND public_view->>'nodeId'=$4
    LIMIT 2`,[commandId,accountId,deviceId,nodeId]);
  if(!rows?.length)return null;
  if(rows.length!==1)throw Error('gold_command_receipt_ambiguous');
  const row=rows[0].public_view;
  if(!row||row.commandId!==commandId||row.accountId!==accountId||
     row.deviceId!==deviceId||row.nodeId!==nodeId||
     row.signedResultVerified!==true||
     !Number.isSafeInteger(row.finishedAt)||
     !['ok','error','timeout','cancelled'].includes(row.status)||
     !Number.isInteger(row.exitCode))return null;
  return row;
 }
 async listForOwner({accountId,deviceIds,limit=100}={}){
  if(!accountId||!Array.isArray(deviceIds))throw Error('gold_job_owner_scope_required');
  const ids=[...new Set(deviceIds.map(String).filter(Boolean))].slice(0,250);
  if(!ids.length)return [];
  const count=Math.max(1,Math.min(Number(limit)||100,200));
  await this.flush();
  const {rows}=await this.pool.query(`
   SELECT j.job_id AS "jobId",j.device_id AS "deviceId",
     j.agent_id AS "agentId",j.session_id AS "sessionId",
     j.status AS "status",j.started_at AS "startedAt",j.finished_at AS "finishedAt",
     j.exit_code AS "exitCode",j.public_view->>'jobRole' AS "jobRole",
     j.public_view->>'workerClass' AS "workerClass",
     CASE WHEN p.state='queued' THEN p.queue_reason ELSE NULL END AS "queueReason"
   FROM lr_gold_job_records j
   LEFT JOIN lr_gold_personal_agent_work p ON p.job_id=j.job_id
   WHERE j.account_id=$1 AND j.device_id=ANY($2::text[])
   ORDER BY j.started_at DESC LIMIT $3`,[accountId,ids,count]);
  return (rows||[]).map(j=>({
   jobId:String(j.jobId),deviceId:String(j.deviceId),
   agentId:String(j.agentId||''),sessionId:String(j.sessionId||''),
   status:j.queueReason?'queued':String(j.status||'unknown'),
   queueReason:j.queueReason?String(j.queueReason).slice(0,80):null,
   jobRole:['process_launch','operation'].includes(j.jobRole)?j.jobRole:'unclassified',
   workerClass:/^[a-zA-Z0-9_.:-]{1,32}$/.test(String(j.workerClass||''))?j.workerClass:'unknown',
   startedAt:j.startedAt instanceof Date?j.startedAt.getTime():Date.parse(j.startedAt),
   finishedAt:j.finishedAt instanceof Date?j.finishedAt.getTime():j.finishedAt?Date.parse(j.finishedAt):null,
   exitCode:Number.isInteger(j.exitCode)?j.exitCode:null,
   outputBytes:null
  }));
 }
}
