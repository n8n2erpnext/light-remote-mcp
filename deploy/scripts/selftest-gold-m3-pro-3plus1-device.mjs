import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldPersonalAgentScheduler} from '../../lib/gold-personal-agent-scheduler.mjs';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';

// Isolated PostgreSQL UAT fixture; synthetic Agent IDs are NOT actual MCP
// identities. Four separate owner-approved OAuth/A-B clients are a later gate.
const db=await connectGoldStorage();
const scheduler=new GoldPersonalAgentScheduler({
 pool:db.pool,resources:new GoldDeviceResourceLocks({capacity:2})
});
const nonce=crypto.randomBytes(8).toString('hex');
const accountId='m3_pro3plus1_fixture_'+nonce;
const deviceId='m3_3plus1_device_'+nonce;
const jobs=Array.from({length:4},(_,i)=>({
 jobId:crypto.randomUUID(),accountId,deviceId,
 agentId:'fixture_distinct_agent_'+nonce+'_'+i,
 sessionId:'fixture_distinct_session_'+nonce+'_'+i,
 operationId:'fixture_distinct_operation_'+nonce+'_'+i,
 resource:{resourceKey:'project:/tmp/m3-agent-'+i,mode:'shared',workerWeight:0}
}));
try{
 for(const job of jobs)await scheduler.enqueue(job);
 // Concurrent same-account admission races must commit serially.
 const admitted=(await Promise.all(Array.from({length:5},()=>scheduler.admit(accountId,3)))).flat();
 assert.equal(admitted.length,3);
 assert.deepEqual(new Set(admitted),new Set(jobs.slice(0,3).map(j=>j.jobId)));
 const state=await scheduler.status(accountId);
 assert.equal(state.activeAgents,3);
 assert.equal(state.queuedJobs,1);
 assert.deepEqual(state.queue,[jobs[3].jobId]);
 const fourth=await db.pool.query('SELECT state,queue_reason FROM lr_gold_personal_agent_work WHERE job_id=$1',[jobs[3].jobId]);
 assert.equal(fourth.rows[0]?.state,'queued');
 assert.equal(fourth.rows[0]?.queue_reason,'QUEUED_AGENT_SLOT');
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE device_id=$1',[deviceId])).rows[0].n,3);
 console.log('M3_PRO_THREE_DISTINCT_FIXTURE_AGENTS_ACTIVE_FOURTH_QUEUED=PASS');
 // Fourth is genuinely queued due to Agent entitlement, not worker capacity
 // or maintenance drain; all four jobs have workerWeight zero.
 await scheduler.complete(jobs[1].jobId,accountId,'ok');
 const next=await scheduler.admit(accountId,3);
 assert.deepEqual(next,[jobs[3].jobId]);
 assert.equal((await scheduler.status(accountId)).activeAgents,3);
 console.log('M3_PRO_FOURTH_PROMOTED_AFTER_AGENT_RELEASE_NO_DRAIN=PASS');
 for(const j of [jobs[0],jobs[2],jobs[3]])await scheduler.complete(j.jobId,accountId,'ok');
 const final=await scheduler.status(accountId);
 assert.equal(final.activeAgents,0);assert.equal(final.queuedJobs,0);
 console.log('M3_PRO_3PLUS1_RESOURCE_CLAIMS_CLEAN=PASS');
}finally{
 await db.pool.query('DELETE FROM lr_gold_personal_agent_work WHERE account_id=$1',[accountId]);
 await db.close();
}
