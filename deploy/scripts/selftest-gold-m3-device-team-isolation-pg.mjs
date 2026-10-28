import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldPersonalAgentScheduler} from '../../lib/gold-personal-agent-scheduler.mjs';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';
// Synthetic Gold UAT fixture only; no live jobs or OS effects.
const db=await connectGoldStorage();
const sched=new GoldPersonalAgentScheduler({pool:db.pool,resources:new GoldDeviceResourceLocks({capacity:2})});
const seed=crypto.randomBytes(8).toString('hex'),a='fixture_owner_'+seed,b='fixture_team_'+seed;
let seq=0;
const mk=(owner,device,agent)=>{const id=++seq;return {jobId:crypto.randomUUID(),accountId:owner,deviceId:device,
 agentId:agent,sessionId:'fixture_session_'+seed+'_'+id,operationId:'fixture_operation_'+seed+'_'+id,
 resource:{resourceKey:'project:/test/'+device,mode:'shared',workerWeight:0}}};
try{
 const agent='same_plugin_agent_'+seed;
 const jobs=Array.from({length:4},(_,i)=>mk(a,'multi_'+seed+'_'+i,agent));
 for(const job of jobs)await sched.enqueue(job);
 const admitted=await sched.admit(a,3);
 assert.deepEqual(new Set(admitted),new Set(jobs.slice(0,3).map(x=>x.jobId)));
 assert.equal((await sched.status(a)).activeAgents,3);
 await sched.complete(jobs[0].jobId,a);
 assert.deepEqual(await sched.admit(a,3),[jobs[3].jobId]);
 for(const job of jobs.slice(1))await sched.complete(job.jobId,a);
 console.log('M3_SAME_AGENT_THREE_DEVICES_NO_CROSS_DEVICE_BLOCK_PASS');
 const sharedDevice='team_device_'+seed;
 const owner=mk(a,sharedDevice,'agent_owner_'+seed),member=mk(b,sharedDevice,'agent_member_'+seed);
 await sched.enqueue(owner);await sched.enqueue(member);
 const concurrent=(await Promise.all([sched.admit(a,5),sched.admit(b,5)])).flat();
 assert.equal(concurrent.length,1,'Team actors share a single foreground device slot');
 const winner=concurrent[0]===owner.jobId?owner:member,loser=winner===owner?member:owner;
 await sched.complete(winner.jobId,winner.accountId);
 assert.deepEqual(await sched.admit(loser.accountId,5),[loser.jobId]);
 await sched.complete(loser.jobId,loser.accountId);
 console.log('M3_TEAM_CROSS_ACCOUNT_SINGLE_DEVICE_SLOT_PASS');
 const capped='queue_cap_'+seed;
 const queued=Array.from({length:16},()=>mk(a,capped,'agent_'+seed));
 for(const job of queued)await sched.enqueue(job);
 await assert.rejects(()=>sched.enqueue(mk(a,capped,'overflow_'+seed)),/m3_device_queue_capacity_reached/);
 assert.equal((await sched.enqueue(queued[0])).jobId,queued[0].jobId);
 await db.pool.query("UPDATE lr_gold_personal_agent_work SET queued_at=clock_timestamp()-interval '11 minutes' WHERE job_id=$1",[queued[0].jobId]);
 assert.deepEqual(await sched.expireQueued(a,600000),[queued[0].jobId]);
 for(const job of queued.slice(1))await sched.cancelQueued({jobId:job.jobId,accountId:a});
 console.log('M3_DEVICE_QUEUE_16_EXPIRE_10M_IDEMPOTENCY_PASS');
}finally{
 for(const id of [a,b])await db.pool.query('DELETE FROM lr_gold_personal_agent_work WHERE account_id=$1',[id]);
 await db.close();
}
