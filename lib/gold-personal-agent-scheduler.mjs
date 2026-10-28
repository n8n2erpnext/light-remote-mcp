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
  // Never replay effects whose Operator state was lost. Background launch
  // admission may have reached the device before its process ID was recorded.
  // Keep its lease, but mark it terminal_unknown in the SAME PG statement as
  // the job transition. In particular this must never DELETE a resource claim.
  if(!this.resources){
   await this.pool.query("UPDATE lr_gold_personal_agent_work SET state='unknown',finished_at=clock_timestamp(),disposition='operator_restart_reconcile' WHERE state IN ('queued','running')");
   return;
  }
  await this.pool.query(`WITH lost AS (
    UPDATE lr_gold_personal_agent_work
       SET state='unknown',finished_at=clock_timestamp(),disposition='operator_restart_reconcile'
     WHERE state IN ('queued','running')
     RETURNING job_id
   )
   UPDATE lr_gold_device_resource_claims AS c
      SET worker_state='terminal_unknown'
     FROM lost
    WHERE c.worker_state='admitting' AND c.process_id IS NULL
      AND (c.job_id IN (SELECT job_id FROM lost)
        OR EXISTS (SELECT 1 FROM lr_gold_personal_agent_work AS j
             WHERE j.job_id=c.job_id AND j.state='unknown'
               AND j.disposition='operator_restart_reconcile'))`);
 }
 async enqueue({jobId,accountId,agentId,sessionId,operationId,deviceId=null,resource=null}){
  for(const x of [jobId,accountId,agentId,sessionId,operationId])GoldPersonalAgentScheduler.valid(x);
  if(agentId.length<16||operationId.length<16)throw Error('m3_identity_invalid');
  return this.transaction(accountId,async client=>{
   // Device-wide advisory lock also protects queue caps across Team accounts.
   if(deviceId)await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['lr_gold_m4_resource:'+deviceId]);
   const prior=await client.query('SELECT job_id,agent_id,session_id,state FROM lr_gold_personal_agent_work WHERE account_id=$1 AND operation_id=$2',[accountId,operationId]);
   if(prior.rowCount){
    const saved=prior.rows[0];
    if(saved.job_id!==jobId||saved.agent_id!==agentId||saved.session_id!==sessionId)
     throw Error('m3_operation_owner_conflict');
    return {state:saved.state,jobId};
   }
   if(deviceId){
    const waiting=await client.query("SELECT COUNT(*)::int AS total FROM lr_gold_personal_agent_work WHERE device_id=$1 AND state='queued'",[deviceId]);
    if(waiting.rows[0].total>=16){
     const error=Error('m3_device_queue_capacity_reached');error.status=429;throw error;
    }
   }
   const queued=await client.query("SELECT COUNT(*)::int AS total FROM lr_gold_personal_agent_work WHERE account_id=$1 AND state='queued'",[accountId]);
   if(queued.rows[0].total>=48){
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
  if(!Number.isInteger(limit)||limit<1||limit>5)throw Error('m3_execution_limit_invalid'); // Only a verified Team scope may supply 5.
  return this.transaction(accountId,async client=>{
   const live=(await client.query("SELECT agent_id FROM lr_gold_personal_agent_work WHERE account_id=$1 AND state='running' FOR UPDATE",[accountId])).rows;
   const active=new Set(live.map(row=>row.agent_id));
   const space=Math.max(0,limit-live.length);
   if(!space)return [];
   const wait=(await client.query("SELECT job_id,account_id,agent_id,device_id,resource_key,resource_mode,worker_weight FROM lr_gold_personal_agent_work WHERE account_id=$1 AND state='queued' ORDER BY device_id,queued_at,job_id FOR UPDATE",[accountId])).rows;
   const accepted=[],deferredAgents=new Set(),deferredDevices=new Set(),admittedDevices=new Set();
   for(const entry of wait){
    if(accepted.length>=space)break;
    if(entry.device_id){
     if(deferredDevices.has(entry.device_id)||admittedDevices.has(entry.device_id))continue;
     // A single foreground OS slot per device, across all OAuth Agents,
     // accounts and Pro Team actors. Device lock serializes cross-account admits.
     await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['lr_gold_m4_resource:'+entry.device_id]);
     const busy=await client.query("SELECT 1 FROM lr_gold_personal_agent_work WHERE device_id=$1 AND state='running' LIMIT 1",[entry.device_id]);
     if(busy.rowCount){
      deferredDevices.add(entry.device_id);
      // Schema 037 permits QUEUED_AGENT_SLOT, RESOURCE_LOCKED or QUEUED_WORKER_CAPACITY only.
      // The first reason covers the owner's shared foreground device slot.
      await client.query("UPDATE lr_gold_personal_agent_work SET queue_reason='QUEUED_AGENT_SLOT' WHERE job_id=$1 AND state='queued'",[entry.job_id]);
      continue;
     }
    }else if(active.has(entry.agent_id)||deferredAgents.has(entry.agent_id))continue;
    if(this.resources){
     const lock=await this.resources.tryClaim(client,entry);
     if(!lock.granted){
      // A background resource conflict must not block unrelated foreground
      // operations on this same device; only a busy foreground slot does.
      if(!entry.device_id)deferredAgents.add(entry.agent_id);
      await client.query("UPDATE lr_gold_personal_agent_work SET queue_reason=$2 WHERE job_id=$1 AND state='queued'",
       [entry.job_id,lock.reason]);
      continue;
     }
    }
    active.add(entry.agent_id);if(entry.device_id)admittedDevices.add(entry.device_id);accepted.push(entry.job_id);
   }
   if(accepted.length)await client.query("UPDATE lr_gold_personal_agent_work SET state='running',started_at=clock_timestamp(),queue_reason=NULL WHERE account_id=$1 AND job_id=ANY($2::text[]) AND state='queued'",[accountId,accepted]);
   return accepted;
  });
 }
 async expireQueued(accountId,maxWaitMs=600000){
  GoldPersonalAgentScheduler.valid(accountId);
  if(!Number.isSafeInteger(maxWaitMs)||maxWaitMs<60000)throw Error('m3_queue_timeout_invalid');
  return this.transaction(accountId,async client=>{
   // Never mark a job timed out when it owns a resource claim or was admitted.
   const expired=await client.query(
    "UPDATE lr_gold_personal_agent_work q SET state='finished',finished_at=clock_timestamp(),queue_reason=NULL,disposition='queue_wait_timeout' WHERE q.account_id=$1 AND q.state='queued' AND q.queued_at<clock_timestamp()-($2::bigint * interval '1 millisecond') AND NOT EXISTS (SELECT 1 FROM lr_gold_device_resource_claims c WHERE c.job_id=q.job_id) RETURNING q.job_id",
    [accountId,maxWaitMs]);
   return expired.rows.map(row=>row.job_id);
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
  return {activeAgents:r.rows.filter(v=>v.state==='running').length,
   queuedJobs:r.rows.filter(v=>v.state==='queued').length,
   queue:r.rows.filter(v=>v.state==='queued').map(v=>v.job_id)};
 }
}
