import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkerUatCoordinator} from '../src/storage/worker-uat.mjs';

const HASH='a'.repeat(64);
function fixture({authorized=true,outboxAuthorized=true,db='light_remote_rc50_uat'}={}){
 const calls=[];
 const repo={
   verifyTarget:async()=>({database:db,role:'lr_rc50_app'}),
   pool:{query:async(sql,args)=>{
      calls.push([sql,args]);
      if(sql.includes('lr_claim_worker_slot'))return {rows:[{slot_number:1,generation:'9'}]};
      if(sql.includes('lr_renew_worker_lease'))return {rows:[{renewed:true}]};
      if(sql.includes('lr_finish_worker_job'))return {rows:[{finished:true}]};
      if(sql.includes('lr_claim_outbox'))return {rows:[{outbox_id:'12',lease_generation:'5'}]};
      if(sql.includes('lr_ack_outbox'))return {rows:[{acknowledged:true}]};
      if(sql.includes('lr_retry_outbox'))return {rows:[{retried:true}]};
      throw Error('unexpected_query');
   }}
 };
 return {calls,instance:new WorkerUatCoordinator({db:repo,allowUat:true,
    authorizeClaim:async()=>authorized,authorizeOutbox:async()=>outboxAuthorized})};
}
test('UAT mode and both trusted authorization callbacks required',()=>{
 const db={verifyTarget:async()=>({database:'light_remote_rc50_uat'}),pool:{query:async()=>({rows:[]})}};
 assert.throws(()=>new WorkerUatCoordinator({db}),/worker_uat_only/);
 assert.throws(()=>new WorkerUatCoordinator({db,allowUat:true}),/trusted_dispatch_proof_required/);
 assert.throws(()=>new WorkerUatCoordinator({db,allowUat:true,authorizeClaim:async()=>true}),/trusted_outbox_consumer_policy_required/);
});
test('fails closed until repository verified and correct database',async()=>{
 const {instance,calls}=fixture();
 await assert.rejects(()=>instance.claim({jobId:'job',deviceId:'device',ownerId:'owner',actorId:'owner',leaseTokenHash:HASH}),/worker_coordinator_not_initialized/);
 assert.equal(calls.length,0);
 const wrong=fixture({db:'production'});
 await assert.rejects(()=>wrong.instance.initialize(),/worker_wrong_database/);
 assert.deepEqual(await instance.initialize(),{database:'light_remote_rc50_uat'});
});
test('trusted claims use placeholders, not interpolated SQL',async()=>{
 const {instance,calls}=fixture();await instance.initialize();
 const job={jobId:'job_1',deviceId:'device_1',ownerId:'owner_1',actorId:'owner_1',leaseTokenHash:HASH};
 assert.deepEqual(await instance.claim(job),{slot_number:1,generation:'9'});
 assert.match(calls[0][0],/\$1,\$2,\$3,\$4/);
 assert.deepEqual(calls[0][1],['device_1','job_1',HASH,120]);
 assert.equal(await instance.renew({jobId:'job_1',leaseTokenHash:HASH,generation:9}),true);
 assert.equal(await instance.finish({jobId:'job_1',leaseTokenHash:HASH,generation:9,succeeded:true}),true);
 assert(calls.every(([sql])=>!sql.includes('device_1')));
});
test('revoked trusted dispatch cannot touch SQL',async()=>{
 const {instance,calls}=fixture({authorized:false});await instance.initialize();
 await assert.rejects(()=>instance.claim({jobId:'job',deviceId:'device',ownerId:'owner',actorId:'owner',leaseTokenHash:HASH}),/worker_dispatch_denied/);
 assert.equal(calls.length,0);
});
test('outbox consumer requires allowlist and generation-bound ack/retry',async()=>{
 const blocked=fixture({outboxAuthorized:false});await blocked.instance.initialize();
 await assert.rejects(()=>blocked.instance.claimOutbox({consumerId:'test'}),/outbox_consumer_denied/);
 assert.equal(blocked.calls.length,0);
 const {instance,calls}=fixture();await instance.initialize();
 assert.equal((await instance.claimOutbox({consumerId:'uat-worker'})).length,1);
 assert.equal(await instance.ackOutbox({id:'12',consumerId:'uat-worker',generation:5}),true);
 assert.equal(await instance.retryOutbox({id:'12',consumerId:'uat-worker',generation:5,delaySeconds:30,error:'transient'}),true);
 assert(calls[2][0].includes('lr_retry_outbox'));
 await assert.rejects(()=>instance.ackOutbox({id:'0',consumerId:'uat-worker',generation:5}),/invalid_outbox_id/);
 await assert.rejects(()=>instance.renew({jobId:'job_1',leaseTokenHash:HASH,generation:0}),/invalid_fence_generation/);
});
