// Bootstrap-admin-only Job Recovery adapter. Reuses the existing M4/GC worker;
// never performs direct claim DELETE or writes terminal ACK outside that worker.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const safeDate=value=>value instanceof Date?value.toISOString():value?new Date(value).toISOString():null;
export class GoldAdminJobRecovery {
 constructor({pool,reaper=null}={}){
  if(!pool?.query)throw Error('gold_admin_recovery_pool_required');
  this.pool=pool;this.reaper=reaper;
 }
 async readiness(){
  const x=(await this.pool.query(`SELECT
    (SELECT count(*)::int FROM lr_schema_migrations) AS migrations,
    (SELECT max(version)::int FROM lr_schema_migrations) AS version,
    to_regclass('public.lr_gold_device_gc_fences') IS NOT NULL AS fences,
    to_regclass('public.lr_gold_device_execution_epochs') IS NOT NULL AS epochs`)).rows?.[0];
  const ready=x?.fences===true&&x?.epochs===true&&Number(x.version)>=41&&
    Number(x.migrations)===Number(x.version)&&!!this.reaper;
  return {canRetire:ready,workerEnabled:!!this.reaper,
    schemaVersion:Number(x?.version)||0,
    reason:ready?null:!this.reaper?'gc_worker_not_enabled':'gc_fence_or_epoch_schema_missing'};
 }
 async list({jobId='',limit=50}={}){
  const job=String(jobId||'').trim();
  if(job&&!uuid.test(job))throw Error('gold_admin_recovery_job_id_invalid');
  const max=Number(limit);
  if(!Number.isInteger(max)||max<1||max>100)throw Error('gold_admin_recovery_limit_invalid');
  const ready=await this.readiness();
  const {rows}=await this.pool.query(`SELECT c.job_id,c.account_id,c.device_id,
    d.display_name,d.state AS device_state,c.worker_state,c.claimed_at,
    j.status AS job_status,
    c.process_id IS NOT NULL AS process_identity_known,
    EXISTS(SELECT 1 FROM lr_gold_terminal_receipt_acks a
      WHERE a.account_id=c.account_id AND a.device_id=c.device_id
        AND (a.job_id=c.job_id OR (c.process_id IS NOT NULL AND a.process_id=c.process_id))
    ) AS terminal_ack_present,
    (SELECT x.closed_at IS NULL AND x.hard_expires_at>clock_timestamp()
      FROM lr_device_connections x WHERE x.device_id=c.device_id
      ORDER BY x.connected_at DESC LIMIT 1) AS active_connection
   FROM lr_gold_device_resource_claims c
   LEFT JOIN lr_devices d ON d.device_id=c.device_id
   LEFT JOIN lr_gold_job_records j
     ON j.job_id=c.job_id AND j.account_id=c.account_id AND j.device_id=c.device_id
   WHERE ($1::text IS NULL OR c.job_id=$1)
   ORDER BY c.claimed_at,c.job_id LIMIT $2`,[job||null,max]);
  // Bounded page plus aggregate status; do not expose job command or PID text.
  const counts=(await this.pool.query(`SELECT
    (SELECT count(*)::int FROM lr_gold_device_resource_claims) AS resource_claims,
    (SELECT count(*)::int FROM lr_gold_personal_agent_work WHERE state='unknown') AS unknown_work,
    (SELECT count(*)::int FROM lr_gold_personal_agent_work WHERE state='running') AS running_work,
    (SELECT count(*)::int FROM lr_gold_personal_agent_work WHERE state='queued') AS queued_work`)).rows?.[0]||{};
  const unresolvedFences=ready.schemaVersion>=40?
    Number((await this.pool.query('SELECT count(*)::int AS n FROM lr_gold_device_gc_fences WHERE resolved_at IS NULL')).rows?.[0]?.n||0):null;
  return {ok:true,...ready,limit:max,summary:{
    claims:Number(counts.resource_claims)||0,unknown:Number(counts.unknown_work)||0,
    running:Number(counts.running_work)||0,queued:Number(counts.queued_work)||0,
    unresolvedFences},items:rows.map(r=>({
    jobId:r.job_id,accountId:r.account_id,deviceId:r.device_id,
    deviceName:r.display_name||r.device_id,deviceState:r.device_state||'unknown',
    workerState:r.worker_state,jobStatus:r.job_status||'unknown',
    claimedAt:safeDate(r.claimed_at),processIdentityKnown:r.process_identity_known===true,
    terminalAckPresent:r.terminal_ack_present===true,
    connectionLeaseActive:r.active_connection===true
  }))};
 }
 async retire({jobId,confirm,reason,actorAccountId}={}){
  if(!uuid.test(String(jobId||''))||confirm!=='RETIRE_UNKNOWN_WITH_FENCE'||
    !/^[A-Za-z0-9._:-]{1,160}$/.test(String(actorAccountId||''))||
    typeof reason!=='string'||reason.trim().length<8||reason.length>300)
    throw Error('gold_admin_recovery_confirmation_invalid');
  const ready=await this.readiness();
  if(!ready.canRetire)throw Error('gold_admin_recovery_unavailable_'+ready.reason);
  const {rows}=await this.pool.query(
    'SELECT device_id FROM lr_gold_device_resource_claims WHERE job_id=$1 LIMIT 1',[jobId]);
  if(rows.length!==1)throw Error('gold_admin_recovery_claim_not_found');
  // Authoritative recheck + exact-job guard happens AGAIN under the GC M4 lock.
  const outcome=await this.reaper.sweepDevice(rows[0].device_id,{
    dryRun:false,expectedOnlyJobId:jobId,actorAccountId,adminReason:reason
  });
  if(!outcome.cleaned||outcome.retiredClaims!==1||outcome.retiredJobs!==1)
    return {ok:false,retired:false,reason:outcome.reason||'gc_not_eligible'};
  return {ok:true,retired:true,jobId,deviceId:rows[0].device_id,
    processOutcome:'unknown',fenced:true,terminalAckCreated:false,audited:true};
 }
}
