import {resourcePathsOverlap} from '../operator-host/device-resource-intent.mjs';
// Device-scoped PG xact lock serializes conflicting admissions across accounts.
// Uncertain external effects are never silently released after restart.
export class GoldDeviceResourceLocks {
 constructor({capacity=2}={}){
  if(!Number.isInteger(capacity)||capacity<1||capacity>8)throw Error('m4_worker_budget_invalid');
  this.capacity=capacity;
 }
 async tryClaim(client,entry){
  const {job_id:jobId,account_id:accountId,device_id:deviceId,
   resource_key:key,resource_mode:mode,worker_weight:weight}=entry;
  if(!deviceId||!key||!['shared','exclusive'].includes(mode)||![0,1,2].includes(Number(weight)))
   throw Error('m4_resource_intent_invalid');
  // Wait for concurrent short PG admissions on this device to commit;
  // temporary transaction contention must NOT be misreported as CPU/worker
  // exhaustion. Per-account queues take device locks in deterministic order.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
   ['lr_gold_m4_resource:'+deviceId]);
  const existing=(await client.query('SELECT resource_key,resource_mode,worker_weight FROM lr_gold_device_resource_claims WHERE device_id=$1 FOR UPDATE',[deviceId])).rows;
  if(existing.some(row=>resourcePathsOverlap(key,row.resource_key)&&
     (mode==='exclusive'||row.resource_mode==='exclusive')))
    return {granted:false,reason:'RESOURCE_LOCKED'};
  if(existing.reduce((sum,row)=>sum+Number(row.worker_weight),0)+Number(weight)>this.capacity)
    return {granted:false,reason:'QUEUED_WORKER_CAPACITY'};
  await client.query('INSERT INTO lr_gold_device_resource_claims (job_id,account_id,device_id,resource_key,resource_mode,worker_weight) VALUES($1,$2,$3,$4,$5,$6)',
   [jobId,accountId,deviceId,key,mode,weight]);
  return {granted:true,reason:null};
 }
 async releaseVerifiedTerminal(pool,{accountId,deviceId,process}={}){
  if(!accountId||!deviceId||!/^lp_[A-Za-z0-9_-]{20,80}$/.test(String(process?.processId||'')))return false;
  if(!['finished','stopped','timeout','error'].includes(String(process.state||''))||
     !Number.isFinite(Number(process.finishedAt))||Number(process.finishedAt)<=0)return false;
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['lr_gold_m4_resource:'+deviceId]);
   const r=await client.query("DELETE FROM lr_gold_device_resource_claims WHERE account_id=$1 AND device_id=$2 AND process_id=$3 AND worker_state='running' RETURNING job_id",
    [accountId,deviceId,process.processId]);
   await client.query('COMMIT');
   return r.rowCount===1;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 }
 // Transactional ACK ledger. If no matching live claim and no prior durable
 // ACK exists, the device MUST replay the signed receipt. This prevents
 // acknowledging a terminal before its launch lease has been persisted.
 async acknowledgeVerifiedTerminal(pool,{accountId,deviceId,process}={}){
  if(!accountId||!deviceId||!/^lp_[A-Za-z0-9_-]{20,80}$/.test(String(process?.processId||''))||
     !['finished','stopped','timeout','error'].includes(String(process?.state||''))||
     !Number.isSafeInteger(Number(process?.finishedAt))||Number(process.finishedAt)<=0)
   return {acked:false,released:false};
  const at=Number(process.finishedAt);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['lr_gold_m4_resource:'+deviceId]);
   const removed=await client.query(
    "DELETE FROM lr_gold_device_resource_claims WHERE account_id=$1 AND device_id=$2 AND process_id=$3 AND worker_state='running' RETURNING job_id",
    [accountId,deviceId,process.processId]);
   if(removed.rowCount===1){
    await client.query(
     'INSERT INTO lr_gold_terminal_receipt_acks(account_id,device_id,process_id,job_id,terminal_state,finished_at_ms) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
     [accountId,deviceId,process.processId,removed.rows[0].job_id,process.state,at]);
   }
   // Require an exact durable terminal match; never ACK an unknown or
   // temporarily missing lease. Replay duplicates are idempotent.
   const found=await client.query(
    'SELECT process_id FROM lr_gold_terminal_receipt_acks WHERE account_id=$1 AND device_id=$2 AND process_id=$3 AND terminal_state=$4 AND finished_at_ms=$5',
    [accountId,deviceId,process.processId,process.state,at]);
   if(removed.rowCount===1&&found.rowCount!==1)throw Error('m6_terminal_ack_write_mismatch');
   await client.query('COMMIT');
   return {acked:found.rowCount===1,released:removed.rowCount===1};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
 }
 async waitingAccounts(pool,deviceId){
  if(!deviceId)return [];
  const r=await pool.query("SELECT DISTINCT account_id FROM lr_gold_personal_agent_work WHERE device_id=$1 AND state='queued' AND queue_reason IN ('RESOURCE_LOCKED','QUEUED_WORKER_CAPACITY') ORDER BY account_id LIMIT 64",[deviceId]);
  return r.rows.map(x=>x.account_id);
 }
}
