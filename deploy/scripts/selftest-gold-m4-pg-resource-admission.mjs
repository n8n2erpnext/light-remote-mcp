import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldPersonalAgentScheduler} from '../../lib/gold-personal-agent-scheduler.mjs';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';

// Only independent Gold UAT with schema33 and app-only credential. Does NOT
// invoke global recoverStartup, alter real user work, or change any entitlement.
const db=await connectGoldStorage();
const locks=new GoldDeviceResourceLocks({capacity:2});
const scheduler=new GoldPersonalAgentScheduler({pool:db.pool,resources:locks});
const nonce=crypto.randomBytes(8).toString('hex');
const accounts=[0,1,2,3,4,5,6].map(i=>'m4_fixture_'+nonce+'_'+i);
const dev='m4_device_'+nonce;
const job=(index,key,mode='exclusive',weight=1)=>({
 jobId:crypto.randomUUID(),accountId:accounts[index],agentId:'fixture_agent_'+nonce+'_'+index,
 sessionId:'fixture_session_'+nonce+'_'+index,operationId:'fixture_operation_'+nonce+'_'+index,
 deviceId:dev,resource:{resourceKey:key,mode,workerWeight:weight}
});
const a=job(0,'project:/projects/a'),b=job(1,'project:/projects/a'),
 c=job(2,'project:/projects/b'),d=job(3,'file-dir:/projects/a/src','shared',0),
 e=job(4,'project:/projects/c'),f=job(5,'project:/projects/a/docs','shared',0),
 g=job(6,'project:/projects/a/docs','shared',0);
try{
 for(const item of [a,b,c,d,e,f,g])await scheduler.enqueue(item);
 assert.deepEqual(await scheduler.admit(a.accountId,3),[a.jobId]);
 const raced=await Promise.all([scheduler.admit(b.accountId,3),scheduler.admit(c.accountId,3),scheduler.admit(d.accountId,3),scheduler.admit(e.accountId,3)]);
 assert.deepEqual(raced[0],[],'same project cannot start');
 assert.deepEqual(raced[1],[c.jobId],'independent project allowed');
 assert.deepEqual(raced[2],[],'reader of actively exclusive project waits');
 assert.deepEqual(raced[3],[],'2/2 device worker capacity is exhausted');
 const blocked=await db.pool.query('SELECT account_id,queue_reason FROM lr_gold_personal_agent_work WHERE account_id=ANY($1::text[])',[accounts]);
 const why=new Map(blocked.rows.map(x=>[x.account_id,x.queue_reason]));
 assert.equal(why.get(b.accountId),'RESOURCE_LOCKED');
 assert.equal(why.get(d.accountId),'RESOURCE_LOCKED');
 assert.equal(why.get(e.accountId),'QUEUED_WORKER_CAPACITY');
 console.log('M4_PG_SAME_PROJECT_RESOURCE_LOCKED_AND_SEPARATE_PROJECT_PARALLEL=PASS');
 console.log('M4_PG_DEVICE_CAPACITY_2_HARD_BOUND=PASS');
 await scheduler.complete(a.jobId,a.accountId);
 assert.deepEqual(await scheduler.admit(d.accountId,3),[d.jobId]);
 assert.deepEqual(await scheduler.admit(f.accountId,3),[f.jobId]);
 assert.deepEqual(await scheduler.admit(g.accountId,3),[g.jobId]);
 assert.deepEqual(await scheduler.admit(b.accountId,3),[],'shared readers prevent exclusive writer');
 await scheduler.complete(d.jobId,d.accountId);
 await scheduler.complete(f.jobId,f.accountId);
 await scheduler.complete(g.jobId,g.accountId);
 assert.deepEqual(await scheduler.admit(b.accountId,3),[b.jobId]);
 assert.deepEqual(await scheduler.admit(e.accountId,3),[],'the device has two weighted workers again');
 await scheduler.complete(c.jobId,c.accountId);
 assert.deepEqual(await scheduler.admit(e.accountId,3),[e.jobId]);
 for(const item of [b,e])await scheduler.complete(item.jobId,item.accountId);
 const remaining=await db.pool.query('SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE device_id=$1',[dev]);
 assert.equal(remaining.rows[0].n,0);
 console.log('M4_PG_SHARED_READERS_WAITING_WRITERS_RELEASE_AND_CLEANUP=PASS');
 const record=job(0,'project:/projects/unknown');
 await scheduler.enqueue(record);
 assert.deepEqual(await scheduler.admit(record.accountId,3),[record.jobId]);
 await db.pool.query("UPDATE lr_gold_personal_agent_work SET state='unknown' WHERE job_id=$1",[record.jobId]);
 const lockrows=await db.pool.query('SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE job_id=$1',[record.jobId]);
 assert.equal(lockrows.rows[0].n,1,'unproven work must retain lock');
 console.log('M4_UNKNOWN_AFTER_RESTART_RETAINS_LOCK_FAIL_CLOSED=PASS');
}finally{
 for(const account of accounts)await db.pool.query('DELETE FROM lr_gold_personal_agent_work WHERE account_id=$1',[account]);
 await db.close();
}
