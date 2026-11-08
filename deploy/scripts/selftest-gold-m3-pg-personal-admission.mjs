import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldPersonalAgentScheduler} from '../../lib/gold-personal-agent-scheduler.mjs';

// Must run only in independent isolated Gold UAT with an applied schema 032;
// uses randomly-scoped fixture accounts and deletes *only those accounts*.
// Never calls recoverStartup on a shared running Operator.
const db=await connectGoldStorage();
const scheduler=new GoldPersonalAgentScheduler({pool:db.pool});
const salt=crypto.randomBytes(9).toString('hex');
const free='m3_fixture_free_'+salt,pro='m3_fixture_pro_'+salt;
const accounts=[free,pro];
const mk=(account,i)=>({
 jobId:crypto.randomUUID(),accountId:account,agentId:'fixture_stable_agent_'+String(i).padStart(7,'0'),
 sessionId:'fixture_session_'+salt+'_'+i,operationId:'fixture_op_'+salt+'_'+i
});
try{
 const f0=mk(free,1),f1=mk(free,2);
 await scheduler.enqueue(f0);await scheduler.enqueue(f1);
 const a=await Promise.all([scheduler.admit(free,1),scheduler.admit(free,1)]);
 assert.equal(a.flat().length,1,'concurrent PG admission must be atomic');
 assert.deepEqual(await scheduler.status(free),{activeAgents:1,queuedJobs:1,queue:[f1.jobId]});
 assert.equal((await scheduler.admit(free,1)).length,0);
 await scheduler.complete(f0.jobId,free);
 assert.deepEqual(await scheduler.admit(free,1),[f1.jobId]);
 await scheduler.complete(f1.jobId,free);
 console.log('M3_FREE_ONE_AGENT_PG_ACCOUNT_ATOMIC_QUEUE=PASS');

 const jobs=[mk(pro,11),mk(pro,12),mk(pro,13),mk(pro,14)];
 for(const j of jobs)await scheduler.enqueue(j);
 const first=(await Promise.all(Array.from({length:7},()=>scheduler.admit(pro,3)))).flat();
 assert.equal(first.length,3,'PG lock must enforce at most three active Agent identities');
 assert.equal((await scheduler.status(pro)).activeAgents,3);
 assert.equal((await scheduler.status(pro)).queuedJobs,1);
 assert.ok(!first.includes(jobs[3].jobId));
 await scheduler.complete(jobs[1].jobId,pro);
 assert.deepEqual(await scheduler.admit(pro,3),[jobs[3].jobId]);
 for(const j of jobs)await scheduler.complete(j.jobId,pro);
 assert.equal((await scheduler.status(pro)).activeAgents,0);
 assert.equal((await scheduler.status(pro)).queuedJobs,0);
 console.log('M3_PRO_THREE_AGENTS_FOURTH_QUEUED_PG_FAIR=PASS');

 // The same operation cannot be attached to a different owner/session/Agent.
 const reuse=await scheduler.enqueue(f0);
 assert.equal(reuse.state,'finished');
 await assert.rejects(()=>scheduler.enqueue({...f0,jobId:crypto.randomUUID()}),/m3_operation_owner_conflict/);
 console.log('M3_SCHEDULER_VERIFIED_IDENTITY_AND_OPERATION_REPLAY=PASS');
}finally{
 for(const account of accounts){
  await db.pool.query('DELETE FROM lr_gold_personal_agent_work WHERE account_id=$1',[account]);
 }
 await db.close();
}
