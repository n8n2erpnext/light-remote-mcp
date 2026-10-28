// Explicit, exact claim selection for owner-interactive M6 recovery only.
// The validated UUID is the only value interpolated into SQL.
const ID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export function requireOrphanJobId(argv){
 if(!Array.isArray(argv)||argv.length!==2||argv[0]!=='--job-id')
  throw Error('owner_orphan_explicit_job_id_required');
 const id=String(argv[1]||'').toLowerCase();
 if(!ID.test(id))throw Error('owner_orphan_invalid_job_id');
 return id;
}
export function exactOrphanClaimWhere(jobId){
 if(typeof jobId!=='string'||!ID.test(jobId))
  throw Error('owner_orphan_invalid_job_id');
 return ` WHERE c.job_id='${jobId}'`;
}
