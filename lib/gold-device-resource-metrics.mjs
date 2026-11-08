// M6 owner-scoped read-only worker lease diagnostics.
// A missing or old claim is NEVER permission to release it.
export async function ownerDeviceResourceMetrics({pool,accountId,deviceIds,workerBudget=null,now=Date.now(),ageWarningMs=3600000}={}){
 if(!pool?.query||typeof accountId!=='string'||!accountId||
    !Array.isArray(deviceIds)||deviceIds.length>200||!Number.isSafeInteger(now)||now<=0)
   throw Error('m6_resource_metrics_owner_scope_required');
 const ids=[...new Set(deviceIds.filter(id=>typeof id==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(id)))];
 if(ids.length!==new Set(deviceIds).size)throw Error('m6_resource_metrics_invalid_device');
 if(!ids.length)return [];
 const cutoff=new Date(now-Math.max(60000,Math.min(ageWarningMs,30*24*3600000)));
 const {rows:claims}=await pool.query(
  `SELECT c.device_id AS "deviceId", COUNT(*)::int AS "claimCount",
    COALESCE(SUM(c.worker_weight),0)::int AS "ownerWorkerWeight",
    COUNT(*) FILTER (WHERE c.worker_state='running' AND c.process_id IS NOT NULL)::int AS "processLeaseCount",
    COUNT(*) FILTER (WHERE c.process_id IS NULL)::int AS "noProcessIdCount",
    COUNT(*) FILTER (WHERE c.claimed_at < $3::timestamptz)::int AS "ageWarningCount",
    COUNT(*) FILTER (WHERE c.worker_state='running'
      AND j.status IN ('interrupted','unknown','timeout','error'))::int AS "reviewRequiredCount",
    MIN(c.claimed_at) AS "oldestClaimAt"
   FROM lr_gold_device_resource_claims c
   LEFT JOIN lr_gold_job_records j ON j.job_id=c.job_id AND j.account_id=c.account_id
   WHERE c.account_id=$1 AND c.device_id=ANY($2::text[])
   GROUP BY c.device_id`,
  [accountId,ids,cutoff]);
 const {rows:queued}=await pool.query(
  `SELECT device_id AS "deviceId",COUNT(*)::int AS "queuedCount",
    COUNT(*) FILTER (WHERE queue_reason IN ('RESOURCE_LOCKED','QUEUED_WORKER_CAPACITY'))::int AS "resourceQueuedCount",
    COUNT(*) FILTER (WHERE queue_reason='QUEUED_AGENT_SLOT')::int AS "agentSlotQueuedCount"
   FROM lr_gold_personal_agent_work
   WHERE account_id=$1 AND device_id=ANY($2::text[]) AND state='queued'
   GROUP BY device_id`,
  [accountId,ids]);
 const byClaim=new Map((claims||[]).map(r=>[r.deviceId,r]));
 const byQueue=new Map((queued||[]).map(r=>[r.deviceId,r]));
 const safe=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:0};
 return ids.map(deviceId=>{
  const c=byClaim.get(deviceId)||{},q=byQueue.get(deviceId)||{};
  const at=c.oldestClaimAt instanceof Date?c.oldestClaimAt.getTime():c.oldestClaimAt?Date.parse(c.oldestClaimAt):NaN;
  return {deviceId,workerBudget:Number.isInteger(workerBudget)&&workerBudget>=1&&workerBudget<=8?workerBudget:null,
   ownerWorkerWeight:safe(c.ownerWorkerWeight),claimCount:safe(c.claimCount),
   processLeaseCount:safe(c.processLeaseCount),noProcessIdCount:safe(c.noProcessIdCount),
   ageWarningCount:safe(c.ageWarningCount),reviewRequiredCount:safe(c.reviewRequiredCount),
   oldestClaimAt:Number.isFinite(at)?at:null,queuedCount:safe(q.queuedCount),
   resourceQueuedCount:safe(q.resourceQueuedCount),agentSlotQueuedCount:safe(q.agentSlotQueuedCount),
   scope:'owner_claims_only',releasePolicy:'signed_terminal_receipt_only'};
 });
}
