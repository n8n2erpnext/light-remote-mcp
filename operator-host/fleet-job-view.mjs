// Fleet Wall read-only job projection. Never return raw scripts, output,
// environment, resultData, credentials or another account's jobs.
export function ownerFleetJobRows(jobs, {accountId,deviceIds,limit=100}={}){
 if(typeof accountId!=='string'||!accountId||!(deviceIds instanceof Set))throw Error('fleet_job_owner_scope_required');
 const cap=Math.min(200,Math.max(1,Number.isInteger(limit)?limit:100));
 return [...jobs.values()].filter(j=>
  j?.accountId===accountId && deviceIds.has(String(j.deviceId||'')))
  .sort((a,b)=>(Number(b.startedAt)||0)-(Number(a.startedAt)||0))
  .slice(0,cap).map(j=>({
   jobId:String(j.id||''),
   deviceId:String(j.deviceId||''),
   agentId:String(j.agentId||''),
   sessionId:String(j.sessionId||''),
   status:j.finishedAt?String(j.status||'finished'):
     j.queueReason?'queued':String(j.status||'unknown'),
   queueReason:j.finishedAt?null:String(j.queueReason||'')||null,
   workerClass:String(j.resourceIntent?.family||j.toolMeta?.kind||(j.managedExec?'managed':'general')),
   startedAt:Number.isFinite(j.startedAt)?j.startedAt:null,
   finishedAt:Number.isFinite(j.finishedAt)?j.finishedAt:null,
   exitCode:j.finishedAt&&Number.isInteger(j.exitCode)?j.exitCode:null,
   // A launch ACK is not process termination; show the job's actual role.
   jobRole:j.managedExec?'process_launch':'operation',
   outputBytes:(Number(j.stdout?.totalBytes)||0)+(Number(j.stderr?.totalBytes)||0)
  }));
}
