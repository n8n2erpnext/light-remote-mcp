/** Durable PostgreSQL job metadata for the existing Operator job lifecycle. */
function jobSnapshot(job,redact){
 const scrub=value=>redact(String(value||'')).slice(0,1000);
 return {
  jobId:job.id,requestId:job.requestId||null,operationId:job.operationId||null,
  accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,
  agentId:job.agentId,nodeId:job.nodeId,status:job.status,
  route:job.remote?'outbound-leaf':'local',
  startedAt:job.startedAt,finishedAt:job.finishedAt||null,
  exitCode:Number.isInteger(job.exitCode)?job.exitCode:null,
  signal:job.signal||null,requiredCapabilities:[...(job.requiredCapabilities||[])],
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
 static async open({pool,redact}){
  const instance=new GoldJobLedger({pool,redact});
  await pool.query(`UPDATE lr_gold_job_records
    SET status='interrupted',finished_at=now(),
      public_view=jsonb_set(public_view,'{status}','"interrupted"'::jsonb,true),
      updated_at=now()
    WHERE status='running'`);
  return instance;
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
}
