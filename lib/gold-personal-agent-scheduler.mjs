/**
 * Gold M3: PostgreSQL-authoritative personal foreground Agent admissions.
 * Free=1 / Pro+VIP=3 distinct Agent IDs per account, one running foreground
 * command per Agent. Queued scripts remain only in Operator memory; no
 * automatic replay after restart. Team scope is NOT enabled.
 */
export class GoldPersonalAgentScheduler {
 constructor({pool,resources=null}={}){
  if(!pool?.connect)throw Error('m3_pg_required');
  this.pool=pool;this.resources=resources;
 }
 static valid(x){
  const id=String(x||'');
  if(!/^[A-Za-z0-9._:-]{1,160}$/.test(id))throw Error('m3_identity_invalid');
  return id;
 }
 async transaction(accountId,callback){
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['lr_gold_personal_agent:'+accountId]);
   const result=await callback(client);
   await client.query('COMMIT');
   return result;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
 }
 async recoverStartup(){
  // Do not re-run unknown external effects or lost queued scripts after restart.
  await this.pool.query("UPDATE lr_gold_personal_agent_work SET state='unknown',finished_at=clock_timestamp(),disposition='operator_restart_reconcile' WHERE state IN ('queued','running')");
 }
 async enqueue({jobId,accountId,agentId,sessionId,operationId,deviceId=null,resource=null}){
  for(const x of [jobId,accountId,agentId,sessionId,operationId])GoldPersonalAgentScheduler.valid(x);
  if(agentId.length<16||operationId.length<16)throw Error('m3_identity_invalid');
  return this.transaction(accountId,async client=>{
   const queued=await client.query("SELECT COUNT(*)::int AS total FROM lr_gold_personal_agent_work WHERE account_id=$1 AND state='queued'",[accountId]);
   if(queued.rows[0].total>=64){
    const error=Error('m3_personal_queue_capacity_reached');error.status=429;throw error;
   }
   if(this.resources&&(!deviceId||!resource?.resourceKey))throw Error('m4_resource_intent_required');
   const r=this.resources?await client.query(
    "INSERT INTO lr_gold_personal_agent_work (job_id,account_id,agent_id,session_id,operation_id,state,device_id,resource_key,resource_mode,worker_weight,queue_reason) VALUES($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9,'QUEUED_AGENT_SLOT') ON CONFLICT DO NOTHING RETURNING job_id",
    [jobId,accountId,agentId,sessionId,operationId,deviceId,resource.resourceKey,resource.mode,resource.workerWeight]):
    await client.query("INSERT INTO lr_gold_personal_agent_work (job_id,account_id,agent_id,session_id,operation_id,state) VALUES($1,$2,$3,$4,$5,'queued') ON CONFLICT DO NOTHING RETURNING job_id",
    [jobId,accountId,agentId,sessionId,operationId]);
   if(r.rowCount===1)return {state:'queued',jobId};
   const q=await client.query('SELECT job_id,agent_id,session_id,state FROM lr_gold_personal_agent_work WHERE account_id=$1 AND operation_id=$2',[accountId,operationId]);
   if(q.rows.length!==1||q.rows[0].job_id!==jobId||q.rows[0].agent_id!==agentId||q.rows[0].session_id!==sessionId)
    throw Error('m3_operation_owner_conflict');
   return {state:q.rows[0].state,jobId};
  });
 }
 async admit(accountId,limit){
  GoldPersonalAgentScheduler.valid(accountId);
  if(!Number.isInteger(limit)||limit<1||limit>3)throw Error('m3_personal_limit_invalid');
  return this.transaction(accountId,async client=>{
   const live=(await client.query("SELECT agent_id FROM lr_gold_personal_agent_work WHERE account_id=$1 AND state='running' FOR UPDATE",[accountId])).rows;
   const active=new Set(live.map(row=>row.agent_id));
   const space=Math.max(0,limit-active.size);
   if(!space)return [];
   const wait=(await client.query("SELECT job_id,account_id,agent_id,device_id,resource_key,resource_mode,worker_weight FROM lr_gold_personal_agent_work WHERE account_id=$1 AND state='queued' ORDER BY device_id,queued_at,job_id FOR UPDATE",[accountId])).rows;
   const accepted=[],deferredAgents=new Set();
   for(const entry of wait){
    if(accepted.length>=space)break;
    if(active.has(entry.agent_id)||deferredAgents.has(entry.agent_id))continue;
    if(this.resources){
     const lock=await this.resources.tryClaim(client,entry);
     if(!lock.granted){
      deferredAgents.add(entry.agent_id);
      await client.query("UPDATE lr_gold_personal_agent_work SET queue_reason=$2 WHERE job_id=$1 AND state='queued'",
       [entry.job_id,lock.reason]);
      continue;
     }
    }
    active.add(entry.agent_id);accepted.push(entry.job_id);
   }
   if(accepted.length)await client.query("UPDATE lr_gold_personal_agent_work SET state='running',started_at=clock_timestamp(),queue_reason=NULL WHERE account_id=$1 AND job_id=ANY($2::text[]) AND state='queued'",[accountId,accepted]);
   return accepted;
  });
 }
 async cancelQueued({jobId,accountId}={}){
  GoldPersonalAgentScheduler.valid(jobId);GoldPersonalAgentScheduler.valid(accountId);
  return this.transaction(accountId,async client=>{
   // Shares the same account advisory lock as admit(), so an already admitted
   // job cannot be relabeled as canceled before its real OS work ends.
   if(this.resources){
    const held=await client.query("SELECT 1 FROM lr_gold_device_resource_claims WHERE job_id=$1 AND account_id=$2 LIMIT 1",[jobId,accountId]);
    if(held.rowCount)throw Error('m6_queued_job_has_resource_claim');
   }
   const row=await client.query("UPDATE lr_gold_personal_agent_work SET state='finished',finished_at=clock_timestamp(),queue_reason=NULL,disposition='cancelled_before_dispatch' WHERE job_id=$1 AND account_id=$2 AND state='queued' RETURNING job_id",[jobId,accountId]);
   return row.rowCount===1;
  });
 }
 async complete(jobId,accountId,disposition='completed',{processId=null,holdUnknown=false}={}){
  GoldPersonalAgentScheduler.valid(jobId);GoldPersonalAgentScheduler.valid(accountId);
  return this.transaction(accountId,async client=>{
   const r=await client.query("UPDATE lr_gold_personal_agent_work SET state='finished',finished_at=clock_timestamp(),disposition=$3 WHERE job_id=$1 AND account_id=$2 AND state IN ('queued','running') RETURNING agent_id",[jobId,accountId,String(disposition).slice(0,80)]);
   if(this.resources&&r.rowCount===1){
    if(processId){
     if(!/^lp_[A-Za-z0-9_-]{20,80}$/.test(processId))throw Error('m4_process_id_invalid');
     const held=await client.query("UPDATE lr_gold_device_resource_claims SET process_id=$3,worker_state='running',launch_observed_at=clock_timestamp() WHERE job_id=$1 AND account_id=$2 RETURNING job_id",
      [jobId,accountId,processId]);
     if(held.rowCount!==1)throw Error('m4_worker_claim_lost_before_launch_ack');
    }else if(holdUnknown){
     await client.query("UPDATE lr_gold_device_resource_claims SET worker_state='terminal_unknown' WHERE job_id=$1 AND account_id=$2",[jobId,accountId]);
    }else{
     await client.query('DELETE FROM lr_gold_device_resource_claims WHERE job_id=$1 AND account_id=$2',[jobId,accountId]);
    }
   }
   return r.rowCount===1;
  });
 }
 async state(jobId){
  GoldPersonalAgentScheduler.valid(jobId);
  const r=await this.pool.query('SELECT state FROM lr_gold_personal_agent_work WHERE job_id=$1',[jobId]);
  return r.rows[0]?.state||null;
 }
 async status(accountId){
  GoldPersonalAgentScheduler.valid(accountId);
  const r=await this.pool.query("SELECT agent_id,state,job_id FROM lr_gold_personal_agent_work WHERE account_id=$1 AND state IN ('queued','running') ORDER BY queued_at,job_id",[accountId]);
  return {activeAgents:new Set(r.rows.filter(v=>v.state==='running').map(v=>v.agent_id)).size,
   queuedJobs:r.rows.filter(v=>v.state==='queued').length,
   queue:r.rows.filter(v=>v.state==='queued').map(v=>v.job_id)};
 }
}
