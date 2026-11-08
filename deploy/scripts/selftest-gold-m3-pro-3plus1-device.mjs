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
 assert.equal(admitted.length,1);
 assert.deepEqual(admitted,[jobs[0].jobId]);
 const state=await scheduler.status(accountId);
 assert.equal(state.activeAgents,1);
 assert.equal(state.queuedJobs,3);
 assert.deepEqual(state.queue,jobs.slice(1).map(j=>j.jobId));
 const fourth=await db.pool.query('SELECT state,queue_reason FROM lr_gold_personal_agent_work WHERE job_id=$1',[jobs[3].jobId]);
 assert.equal(fourth.rows[0]?.state,'queued');
 assert.equal(fourth.rows[0]?.queue_reason,'QUEUED_AGENT_SLOT');
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE device_id=$1',[deviceId])).rows[0].n,1);
 console.log('M3_PRO_MULTIAGENT_SAME_DEVICE_ONE_ACTIVE_REST_QUEUED=PASS');
 for(let i=0;i<4;i++){
  await scheduler.complete(jobs[i].jobId,accountId,'ok');
  if(i<3)assert.deepEqual(await scheduler.admit(accountId,3),[jobs[i+1].jobId]);
 }
 console.log('M3_PRO_SAME_DEVICE_FIFO_PROMOTION_NO_OVERLAP=PASS');
 const final=await scheduler.status(accountId);
 assert.equal(final.activeAgents,0);assert.equal(final.queuedJobs,0);
 console.log('M3_PRO_3PLUS1_RESOURCE_CLAIMS_CLEAN=PASS');
}finally{
 await db.pool.query('DELETE FROM lr_gold_personal_agent_work WHERE account_id=$1',[accountId]);
 await db.close();
}
