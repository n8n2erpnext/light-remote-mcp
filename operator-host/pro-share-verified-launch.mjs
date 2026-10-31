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
  env.LR_GOLD_PRO_SHARE_GUEST_SLOTS!=='1'||
  env.LR_GOLD_PRO_SHARE_GUEST_QUEUE!=='1'))
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
     j.public_view AS signed_job,c.process_id,c.worker_state,
     g.owner_account_id AS guest_owner,g.guest_account_id AS guest_actor,
     g.grant_id AS guest_grant,g.connection_id AS guest_connection,
     g.operation_id AS guest_operation,g.agent_id AS guest_agent,
     g.permission_revision AS guest_revision,
     s.state AS guest_slot_state
    FROM lr_gold_pro_share_guest_jobs g
    JOIN lr_gold_pro_share_guest_slots s
      ON s.job_id=g.job_id AND s.operation_id=g.operation_id
      AND s.owner_account_id=g.owner_account_id
      AND s.guest_account_id=g.guest_account_id
      AND s.device_id=g.device_id
      AND s.grant_id=g.grant_id AND s.connection_id=g.connection_id
    JOIN lr_gold_job_records j
      ON j.job_id=g.job_id AND j.account_id=g.owner_account_id
      AND j.device_id=g.device_id
    JOIN lr_gold_device_resource_claims c
      ON c.job_id=j.job_id AND c.account_id=j.account_id
      AND c.device_id=j.device_id
    WHERE g.job_id=$1 AND g.owner_account_id=$2 AND g.device_id=$3
      AND s.state='submitted' AND s.process_id=$4 AND c.process_id=$4
      AND c.worker_state='running'
    LIMIT 2`,[jobId,ownerAccountId,deviceId,processId]);
  if(result.rowCount!==1)return false;
  const r=result.rows[0],j=r.signed_job,d=j?.guestDelegation;
  // A classic signed OWNER result cannot authorize a Guest. A future
  // installed Agent must independently verify Guest B/connection/permissions
  // and return a verifiable Guest delegation receipt, which Operator records
  // as signedGuestDelegationVerified. No current Agent sets this field.
  return r.job_id===jobId&&r.account_id===ownerAccountId&&
   r.device_id===deviceId&&r.process_id===processId&&
   r.worker_state==='running'&&r.guest_slot_state==='submitted'&&
   r.guest_owner===ownerAccountId&&r.status==='ok'&&
   j?.jobId===jobId&&j.accountId===ownerAccountId&&
   j.deviceId===deviceId&&j.signedResultVerified===true&&
   j.signedGuestDelegationVerified===true&&
   d?.purpose==='pro-share-guest'&&d.jobId===jobId&&
   d.deviceId===deviceId&&d.processId===processId&&
   d.ownerAccountId===ownerAccountId&&
   d.guestAccountId===r.guest_actor&&d.agentId===r.guest_agent&&
   d.grantId===r.guest_grant&&d.connectionId===r.guest_connection&&
   d.operationId===r.guest_operation&&
   Number(d.permissionRevision)===Number(r.guest_revision)&&
   j.jobRole==='process_launch'&&j.effectState==='result_observed'&&
   j.status==='ok'&&j.exitCode===0&&
   Number.isSafeInteger(j.finishedAt)&&j.finishedAt>0;
 };
}
