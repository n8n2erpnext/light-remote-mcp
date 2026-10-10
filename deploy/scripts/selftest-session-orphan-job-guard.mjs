import fs from 'node:fs';
const src=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
const guarded=(src.match(/const command=enqueueForJob\(job,\{/g)||[]).length;
const unguarded=(src.match(/const command=fleet\.enqueue\(/g)||[]).length;
if(guarded!==8||unguarded!==0)throw new Error(`enqueue_not_guarded:${guarded}:${unguarded}`);
const helper=src.slice(src.indexOf('function enqueueForJob('),src.indexOf('function emitStream('));
if(!helper.includes('finishJob(job,1,null)')||!helper.includes('throw error'))throw new Error('enqueue_rejection_cleanup_must_finish_and_rethrow');
console.log('session_orphan_job_enqueue_guard_all_routes=PASS');
