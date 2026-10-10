import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DurableTeamUatStore} from '../../operator-host/team-durable-dispatch-uat.mjs';

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lr-team-sqlite-'));
let now=Date.UTC(2026,9,10,12,0,0),authorized=true,budget=2;
const dbFile=path.join(folder,'team-uat.db'),nowfn=()=>now;
const authorize=()=>authorized,budgetFor=()=>budget;
const cfg={dbFile,now:nowfn,authorize,budgetFor,leaseMs:2000};
const owner='paid-owner',device='shared-device';
const sample=(actor,op,extra={})=>({ownerAccountId:owner,actorAccountId:actor,
 agentId:'agent-'+actor,deviceId:device,operationId:op,
 fingerprint:'a'.repeat(64),kind:actor===owner?'owner':'member',...extra});
const runChild=(argv)=>{
 const script=fileURLToPath(new URL('./team-durable-dispatch-worker-fixture.mjs',import.meta.url));
 return new Promise((resolve,reject)=>{
  const c=spawn(process.execPath,[script,...argv],{stdio:['ignore','pipe','pipe']});
  let out='',err='';
  c.stdout.on('data',x=>out+=x);c.stderr.on('data',x=>err+=x);
  c.on('error',reject);c.on('close',code=>code===0?resolve(JSON.parse(out.trim())):reject(Error('child('+code+') '+err)));
 });
};
try{
 let store=new DurableTeamUatStore(cfg);
 const own=store.claim(sample(owner,'owner-1'));
 assert.equal(own.job.state,'running');
 assert.equal(store.summary(owner).memberCalls,0,'owner jobs do not debit Team member budget');
 const m1=store.claim(sample('member-A','one'));
 const m2=store.claim(sample('member-B','two'));
 assert.equal(store.summary(owner).runningSlots,3);
 assert.equal(store.summary(owner).memberCalls,2);
 assert.throws(()=>store.claim(sample('member-C','three')),/device_worker_slots_busy/);
 const retry=store.claim(sample('member-A','one'));
 assert.equal(retry.retry,true);
 assert.equal(retry.job.jobId,m1.job.jobId);
 assert.equal(retry.lease.token,m1.lease.token);
 assert.equal(store.summary(owner).memberCalls,2,'idempotent retry must not charge twice');
 assert.throws(()=>store.claim(sample('member-A','one',{fingerprint:'b'.repeat(64)})),/operation_id_conflict/);
 assert.throws(()=>store.claim(sample('member-A','one',{kind:'owner'})),/claim_identity_invalid/);
 store.finish({jobId:m1.job.jobId,token:m1.lease.token,generation:m1.lease.generation});
 assert.throws(()=>store.claim(sample('member-C','three')),/member_budget_exhausted/);
 store.finish({jobId:own.job.jobId,token:own.lease.token,generation:own.lease.generation});
 store.finish({jobId:m2.job.jobId,token:m2.lease.token,generation:m2.lease.generation});
 assert.equal(store.summary(owner).runningSlots,0);
 store.close();
 store=new DurableTeamUatStore(cfg);
 assert.equal(store.summary(owner).memberCalls,2,'durable charge survives reopening');
 assert.equal(store.claim(sample('member-A','one')).job.state,'completed','completed operation must not re-run');
 assert.throws(()=>store.claim(sample('member-C','three')),/member_budget_exhausted/);
 authorized=false;
 assert.throws(()=>store.claim(sample('member-A','one')),/dispatch_authorization_denied/,
  'policy must be checked even on old retry');
 authorized=true;
 now=Date.UTC(2026,10,1,0,0,0);
 const nov=store.claim(sample('member-C','november'));
 assert.equal(store.summary(owner).memberCalls,1,'new UTC month resets budget usage only');
 assert.equal(nov.job.slot,1);
 const stale={...nov.lease};
 now+=2001;
 assert.equal(store.sweep(),1);
 assert.equal(store.job(nov.job.jobId).state,'lease_expired');
 const replacement=store.claim(sample('member-D','slot-reuse'));
 assert.equal(replacement.job.slot,1);
 assert(replacement.lease.generation>stale.generation);
 assert.throws(()=>store.finish({jobId:nov.job.jobId,token:stale.token,generation:stale.generation}),/stale_lease/);
 assert.throws(()=>store.renew({jobId:nov.job.jobId,token:stale.token,generation:stale.generation}),/stale_lease/);
 assert.equal(store.summary(owner).runningSlots,1);
 assert.equal(store.summary(owner).memberCalls,2,'crash/expiry debits conserved: fail-closed');
 assert.throws(()=>store.claim(sample(owner,'other-owner-device',{deviceId:'shared-device',ownerAccountId:'another-owner'})),/claim_identity_invalid/);

 assert.throws(()=>store.claim(sample('member-E','budget-exhausted')),/member_budget_exhausted/);
 store.revoke({ownerAccountId:owner,actorAccountId:'member-D'});
 assert.equal(store.job(replacement.job.jobId).state,'revoked');
 assert.equal(store.summary(owner).runningSlots,0);
 assert.throws(()=>store.finish({jobId:replacement.job.jobId,token:replacement.lease.token,
   generation:replacement.lease.generation}),/stale_lease/);
 assert.throws(()=>store.claim(sample('member-X','owner-switch',{ownerAccountId:'another-owner'})),/device_owner_conflict/);
 store.close();

 // Separate DB, multiple independent processes competing for exactly 3 slots.
 const racing=path.join(folder,'race.db'),stamp=Date.UTC(2026,9,10,12,0);
 const tasks=Array.from({length:14},(_,i)=>runChild([racing,String(stamp),'shared-device',
   'member-'+i,'operation-'+i,'20']));
 const results=await Promise.all(tasks);
 assert.equal(results.filter(r=>r.ok).length,3);
 assert(results.filter(r=>!r.ok).every(r=>r.error==='device_worker_slots_busy'));
 const check=new DurableTeamUatStore({dbFile:racing,now:()=>stamp,authorize:()=>true,budgetFor:()=>20,leaseMs:60000});
 assert.equal(check.summary(owner).runningSlots,3);
 assert.equal(check.summary(owner).memberCalls,3);
 check.close();
 const raceBudget=path.join(folder,'race-budget.db');
 const competing=await Promise.all(Array.from({length:12},(_,i)=>runChild([
   raceBudget,String(stamp),'quota-device','member-'+i,'quota-op-'+i,'2'
 ])));
 assert.equal(competing.filter(x=>x.ok).length,2,'multi-process quota must never exceed 2');
 const budgetCheck=new DurableTeamUatStore({dbFile:raceBudget,now:()=>stamp,
   authorize:()=>true,budgetFor:()=>2});
 assert.equal(budgetCheck.summary(owner).memberCalls,2);
 assert.equal(budgetCheck.summary(owner).runningSlots,2);
 budgetCheck.close();
 const dup=path.join(folder,'duplicate.db');
 const doubles=await Promise.all(Array.from({length:9},()=>runChild([dup,String(stamp),'dup-device',
   'one-member','same-operation','20'])));
 assert(doubles.every(x=>x.ok));
 assert.equal(new Set(doubles.map(x=>x.jobId)).size,1,'cross-process exact retry dedupes');
 const duplicated=new DurableTeamUatStore({dbFile:dup,now:()=>stamp,authorize:()=>true,budgetFor:()=>20});
 assert.equal(duplicated.summary(owner).memberCalls,1);
 duplicated.close();
 console.log('team_sqlite_atomic_owner_member_shared_three_slots=PASS');
 console.log('team_sqlite_owner_billed_monthly_quota_idempotent_restart=PASS');
 console.log('team_sqlite_crash_expiry_generation_fence_and_revoke=PASS');
 console.log('team_sqlite_oauth_policy_revalidated_on_retry=PASS');
 console.log('team_sqlite_multi_process_three_slot_race=PASS');
 console.log('team_sqlite_multi_process_atomic_budget_limit=PASS');
 console.log('team_sqlite_cross_process_exact_retry_one_charge=PASS');
}finally{
 fs.rmSync(folder,{force:true,recursive:true,maxRetries:6,retryDelay:50});
}
