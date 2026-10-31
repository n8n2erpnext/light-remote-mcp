// Gold P2-I4C3b private signed-launch verification source.
// A process ID from a request or an Operator "accepted" response is not proof.
// Read only the existing M4 resource claim + Gold signed Fleet job ledger
// both created from authenticated Device results and committed in PostgreSQL.
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const PROCESS=/^lp_[A-Za-z0-9_-]{20,80}$/;
export function createGoldProShareVerifiedLaunch({pool,env=process.env}={}){
 const enabled=env.LR_GOLD_PRO_SHARE_GUEST_SIGNED_LAUNCH==='1';
 if(enabled&&(
  env.LR_GOLD_PRO_SHARE_CORE!=='1'||
  env.LR_GOLD_PRO_SHARE_GUEST_SLOTS!=='1'))
  throw Error('guest_signed_launch_prerequisite_off');
 if(enabled&&typeof pool?.query!=='function')
  throw Error('guest_signed_launch_pg_required');
 return async ({ownerAccountId,deviceId,jobId,processId}={})=>{
  if(!enabled)return false;
  if(!ID.test(String(ownerAccountId||''))||
     !ID.test(String(deviceId||''))||
     !ID.test(String(jobId||''))||
     !PROCESS.test(String(processId||'')))return false;
  const result=await pool.query(`SELECT j.job_id,j.account_id,j.device_id,j.status,
     j.public_view AS signed_job,
     c.process_id,c.worker_state
    FROM lr_gold_job_records j
    JOIN lr_gold_device_resource_claims c
     ON c.job_id=j.job_id AND c.account_id=j.account_id
       AND c.device_id=j.device_id
    WHERE j.job_id=$1 AND j.account_id=$2 AND j.device_id=$3
      AND c.process_id=$4 AND c.worker_state='running'
    LIMIT 2`,[jobId,ownerAccountId,deviceId,processId]);
  if(result.rowCount!==1)return false;
  const r=result.rows[0],j=r.signed_job;
  // Only a signed device response persisted by GoldJobLedger counts.
  // A regular timeout, stale Operator replay or unsigned launch cannot pass.
  return r.job_id===jobId&&r.account_id===ownerAccountId&&
   r.device_id===deviceId&&r.process_id===processId&&
   r.worker_state==='running'&&r.status==='ok'&&
   j?.jobId===jobId&&j.accountId===ownerAccountId&&
   j.deviceId===deviceId&&j.signedResultVerified===true&&
   j.jobRole==='process_launch'&&j.effectState==='result_observed'&&
   j.status==='ok'&&j.exitCode===0&&
   Number.isSafeInteger(j.finishedAt)&&j.finishedAt>0;
 };
}
