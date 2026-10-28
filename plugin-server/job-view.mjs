// Shared shape for live and durable Gold job views.
// A recovered `interrupted` job has an unknown OS effect; do not present it
// as either definitely running or definitely stopped.
export function cleanJob(j={}){
  const state=j.state||j.status||null;
  const effectUnknown=state==='interrupted'||state==='unknown';
  return {
    jobId:j.jobId,
    state,
    running:effectUnknown?null:!j.finishedAt,
    ...(effectUnknown?{effectUnknown:true}:{}),
    exitCode:j.exitCode??null
  };
}
