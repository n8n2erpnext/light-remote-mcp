import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldPersonalAgentScheduler} from '../../lib/gold-personal-agent-scheduler.mjs';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';

// Isolated Gold UAT only: synthetic account/device IDs, no OS process.
const db=await connectGoldStorage(),locks=new GoldDeviceResourceLocks({capacity:2});
const sched=new GoldPersonalAgentScheduler({pool:db.pool,resources:locks});
const salt=crypto.randomBytes(8).toString('hex');
const accounts=[0,1,2,3].map(i=>'m4_lease_fixture_'+salt+'_'+i);
const deviceId='m4_lease_device_'+salt;
const processId='lp_'+crypto.randomBytes(18).toString('base64url');
const mk=(i,key)=>({
 jobId:crypto.randomUUID(),accountId:accounts[i],deviceId,
 agentId:'fixture_agent_'+salt+'_'+i,sessionId:'fixture_session_'+salt+'_'+i,
 operationId:'fixture_operation_'+salt+'_'+i,
 resource:{resourceKey:key,mode:'exclusive',workerWeight:1}
});
const a=mk(0,'project:/work/a'),b=mk(1,'project:/work/a');
const c=mk(2,'project:/work/c'),d=mk(3,'project:/work/d');
try{
 for(const v of [a,b,c,d])await sched.enqueue(v);
 assert.deepEqual(await sched.admit(a.accountId,3),[a.jobId]);
 await sched.complete(a.jobId,a.accountId,'ok',{processId});
 const held=await db.pool.query('SELECT process_id,worker_state FROM lr_gold_device_resource_claims WHERE job_id=$1',[a.jobId]);
 assert.equal(held.rows[0]?.process_id,processId);
 assert.equal(held.rows[0]?.worker_state,'running');
 assert.equal((await sched.status(a.accountId)).activeAgents,0);
 assert.deepEqual(await sched.admit(b.accountId,3),[]);
 assert.deepEqual(await sched.admit(c.accountId,3),[c.jobId]);
 assert.deepEqual(await sched.admit(d.accountId,3),[]);
 console.log('M4_BACKGROUND_LAUNCH_LOCK_PERSISTS_AGENT_SLOT_RELEASED=PASS');
 const unproven=await locks.releaseVerifiedTerminal(db.pool,{accountId:a.accountId,deviceId,process:{processId,state:'running'}});
 const foreign=await locks.releaseVerifiedTerminal(db.pool,{accountId:b.accountId,deviceId,process:{processId,state:'finished',finishedAt:Date.now()}});
 assert.equal(unproven,false);assert.equal(foreign,false);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE job_id=$1',[a.jobId])).rows[0].n,1);
 console.log('M4_BACKGROUND_UNKNOWN_AND_FOREIGN_OWNER_NO_RELEASE=PASS');
 const released=await locks.releaseVerifiedTerminal(db.pool,{accountId:a.accountId,deviceId,process:{processId,state:'finished',finishedAt:Date.now(),exitCode:0}});
 assert.equal(released,true);
 assert.deepEqual(await sched.admit(b.accountId,3),[b.jobId]);
 await sched.complete(c.jobId,c.accountId,'ok');
 assert.deepEqual(await sched.admit(d.accountId,3),[d.jobId]);
 await sched.complete(b.jobId,b.accountId,'ok');
 await sched.complete(d.jobId,d.accountId,'ok');
 console.log('M4_BACKGROUND_VERIFIED_EXIT_RECLAIMS_WORKER_AND_PROJECT=PASS');
 const unknown=mk(0,'project:/work/unknown');unknown.operationId+='_other';
 await sched.enqueue(unknown);
 assert.deepEqual(await sched.admit(unknown.accountId,3),[unknown.jobId]);
 await sched.complete(unknown.jobId,unknown.accountId,'timeout',{holdUnknown:true});
 const u=await db.pool.query('SELECT worker_state,process_id FROM lr_gold_device_resource_claims WHERE job_id=$1',[unknown.jobId]);
 assert.equal(u.rows[0]?.worker_state,'terminal_unknown');assert.equal(u.rows[0]?.process_id,null);
 console.log('M4_BACKGROUND_LOST_LAUNCH_ACK_FAIL_CLOSED=PASS');
}finally{
 for(const id of accounts)await db.pool.query('DELETE FROM lr_gold_personal_agent_work WHERE account_id=$1',[id]);
 await db.close();
}
