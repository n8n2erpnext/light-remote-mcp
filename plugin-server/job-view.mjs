// Shared shape for live and durable Gold job views.
// A recovered `interrupted` job has an unknown OS effect; do not present it
// as either definitely running or definitely stopped.
export function cleanJob(j={}){
  const state=j.state||j.status||null;
  const effectUnknown=state==='interrupted'||state==='unknown';
  const stopRequestedAt=Number.isSafeInteger(j.stopRequestedAt)&&j.stopRequestedAt>0?j.stopRequestedAt:null;
  return {
    jobId:j.jobId,
    state,
    running:effectUnknown?null:!j.finishedAt,
    ...(effectUnknown?{effectUnknown:true}:{}),
    ...(stopRequestedAt?{stopRequestedAt,
      stopRequestVerified:state==='cancelled'&&j.exitCode===130}:{}),
    exitCode:j.exitCode??null
  };
}
