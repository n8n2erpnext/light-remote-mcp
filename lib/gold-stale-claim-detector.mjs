// Gold P1-A: read-only owner-scoped detection of stale M4 resource claims.
// Observation is NOT permission to release a process or a GC fence.
// P1-B signed reconnect inventory, P1-C exact signed terminal receipt, or
// owner-attested recovery must make the eventual disposition.
const devicePattern=/^[A-Za-z0-9._:-]{1,160}$/;
const safeInt=(value)=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const isoAt=value=>value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):NaN;

export function classifyStaleClaim(row,{now=Date.now(),minimumAgeMs=3600000}={}){
  if(!row||!devicePattern.test(String(row.device_id||''))||
     !String(row.job_id||'').trim()||!Number.isSafeInteger(now)||
     !Number.isSafeInteger(minimumAgeMs)||minimumAgeMs<60000)
    throw Error('p1_stale_claim_observation_invalid');
  const claimedAt=isoAt(row.claimed_at);
  if(!Number.isFinite(claimedAt)||claimedAt>now+60000)
    throw Error('p1_stale_claim_age_untrusted');
  const ageMs=Math.max(0,now-claimedAt);
  if(ageMs<minimumAgeMs)return null;
  const pid=String(row.process_id||'').trim();
  const ack=row.has_terminal_ack===true;
  let className='needs_signed_reconciliation';
  if(ack)className='inconsistent_claim_after_signed_ack';
  else if(!pid)className='unknown_no_pid';
  else if(row.worker_state==='running')className='running_pid_unresolved';
  return Object.freeze({
    accountId:String(row.account_id||''),deviceId:row.device_id,jobId:String(row.job_id),
    ageMs,claimedAt,processIdentityKnown:Boolean(pid),
    workerState:String(row.worker_state||'unknown'),
    jobStatus:String(row.job_status||'missing'),
    signedTerminalAckPresent:ack,
    classification:className,
    evidence:'diagnostic_only',releaseAllowed:false,
    nextAction:ack?'audit_signed_ack_claim_consistency':
      !pid?'request_signed_zero_dispatch_or_owner_recovery':
      'request_signed_reconnect_inventory_and_terminal_receipt'
  });
}

export async function scanOwnerStaleClaims({
  pool,accountId,deviceIds,now=Date.now(),minimumAgeMs=3600000,maxRows=2000
}={}){
  if(!pool?.query||!devicePattern.test(String(accountId||''))||
     !Array.isArray(deviceIds)||deviceIds.length<1||deviceIds.length>200||
     deviceIds.some(id=>!devicePattern.test(String(id)))||
     !Number.isSafeInteger(now)||now<=0||
     !Number.isSafeInteger(minimumAgeMs)||minimumAgeMs<60000||minimumAgeMs>30*86400000||
     !Number.isInteger(maxRows)||maxRows<1||maxRows>5000)
    throw Error('p1_stale_claim_owner_scope_required');
  const ids=[...new Set(deviceIds)];
  const cutoff=new Date(now-minimumAgeMs);
  // Bounded owner+device scope, age cutoff, no FOR UPDATE and no DB writes.
  // A claim with a durable ACK but still present is an integrity alarm, not
  // permission to delete or fabricate an additional terminal.
  const result=await pool.query(`
    SELECT c.account_id,c.device_id,c.job_id,c.process_id,c.worker_state,c.claimed_at,
      j.status AS job_status,
      EXISTS(SELECT 1 FROM lr_gold_terminal_receipt_acks a
        WHERE a.account_id=c.account_id AND a.device_id=c.device_id
          AND (a.job_id=c.job_id OR (c.process_id IS NOT NULL AND a.process_id=c.process_id))
      ) AS has_terminal_ack
    FROM lr_gold_device_resource_claims c
    LEFT JOIN lr_gold_job_records j
      ON j.job_id=c.job_id AND j.account_id=c.account_id AND j.device_id=c.device_id
    WHERE c.account_id=$1 AND c.device_id=ANY($2::text[]) AND c.claimed_at<=$3::timestamptz
    ORDER BY c.claimed_at,c.job_id LIMIT $4
  `,[accountId,ids,cutoff,maxRows+1]);
  if(result.rows.length>maxRows)
    throw Error('p1_stale_claim_scan_truncated_fail_closed');
  return {
    accountId,deviceCount:ids.length,cutoffAt:cutoff.getTime(),
    totalCandidates:result.rows.length,mode:'owner_scoped_read_only',
    releasePerformed:false,
    items:result.rows.map(row=>classifyStaleClaim(row,{now,minimumAgeMs}))
  };
}
