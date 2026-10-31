import assert from 'node:assert/strict';
import {GoldConnectionJobReaper,offlineGcEligibility} from '../../lib/gold-connection-job-reaper.mjs';

// Regression for the actual UAT failure shape: a removed/revoked Gold Agent
// still has an M4 running lease while its *launch* job already says "ok".
// GC must require NO user password, never forge a terminal ACK, and leave
// a durable resource fence to prevent duplicate OS effects.
const H=3600000,now=Date.parse('2026-10-31T12:00:00Z');
const deviceId='dev_revoked_ownerless_fixture';
const accountId='acct_revoked_ownerless_fixture';
const jobId='db964413-f80f-4869-96aa-fa9b56dded09';
const processId='lp_12345678901234567890';
const expired=new Date(now-8*H);
const fake={
 calls:[],claims:1,audit:0,fences:0,acks:0,rolledBack:0,
 async query(sql,args=[]){
  this.calls.push({sql,args});
  if(!sql.includes('SELECT DISTINCT device_id'))throw Error('unexpected_reaper_candidate_query');
  return {rows:args[0]===''?[{device_id:deviceId}]:[]};
 },
 async connect(){
  const s=this;
  return {async query(sql,args=[]){
   s.calls.push({sql,args});
   if(sql==='ROLLBACK'){s.rolledBack++;return {rows:[],rowCount:0};}
   if(sql.includes('SELECT DISTINCT account_id'))return {rows:[{account_id:accountId}]};
   if(sql.includes('FROM lr_device_connections WHERE'))return {rows:[{
     connection_id:'closed_v1',connected_at:new Date(now-10*H),
     closed_at:expired,hard_expires_at:new Date(now+H)}]};
   if(sql.includes('SELECT state,last_seen_at FROM lr_devices'))return {rows:[{
     state:'revoked',last_seen_at:new Date(now-7*H)}]};
   if(sql.includes('SELECT job_id,account_id,status')&&sql.includes('lr_gold_job_records'))return {rows:[]}; // launch was OK
   if(sql.includes('SELECT job_id,account_id,resource_key')&&sql.includes('lr_gold_personal_agent_work'))return {rows:[]};
   if(sql.includes('FROM lr_gold_device_resource_claims WHERE device_id=$1 FOR UPDATE'))
    return {rows:s.claims?[{job_id:jobId,account_id:accountId,
      resource_key:'device:unknown',resource_mode:'exclusive',
      worker_state:'running',process_id:processId}]:[]};
   if(sql.includes('FROM lr_gold_terminal_receipt_acks'))return {rows:[],rowCount:0};
   if(sql.includes('INSERT INTO lr_gold_device_gc_fences')){s.fences++;return {rows:[],rowCount:1};}
   if(sql.includes('INSERT INTO lr_audit_events')){
    s.audit++;
    const audit=JSON.parse(args[4]);
    assert.equal(audit.processOutcome,'unknown');
    assert.equal(audit.terminalReceiptCreated,false);
    assert.equal(audit.fenced,true);
    return {rows:[],rowCount:1};
   }
   if(sql.startsWith('DELETE FROM lr_gold_device_resource_claims')){
    s.claims=0;return {rows:[],rowCount:1};
   }
   if(sql.includes('INSERT INTO lr_gold_terminal_receipt_acks')){s.acks++;throw Error('forbidden_fake_terminal_ack');}
   return {rows:[],rowCount:1};
  },release(){}};
 }
};
const allowed=[deviceId],events=[];
const gc=(fresh=false)=>new GoldConnectionJobReaper({
 pool:fake,now:()=>now,offlineMs:H,allowedDevices:allowed,
 channelFresh:async()=>fresh,event:x=>events.push(x)
});
assert.equal(offlineGcEligibility({
 connection:{closedAt:expired.getTime(),hardExpiresAt:now+H},
 device:{state:'revoked',lastSeenAt:now-7*H},channelFresh:false,now,delayMs:H
}).eligible,true);
assert.equal((await gc(false).sweepDevice(deviceId,{dryRun:true})).eligible,true);
assert.equal(fake.claims,1);
assert.equal(fake.fences,0);
assert.equal(fake.audit,0);
const blocked=await gc(true).sweepDevice(deviceId,{dryRun:false});
assert.equal(blocked.eligible,false,'fresh signed channel must block auto-GC');
assert.equal(fake.claims,1);
const notAllowed=await gc(false).sweepDevice('dev_other_account',{dryRun:false});
assert.equal(notAllowed.reason,'not_in_gc_allowlist');
const outcome=await gc(false).sweepDevice(deviceId,{dryRun:false});
assert.equal(outcome.cleaned,true);
assert.equal(outcome.retiredClaims,1,'orphaned launch-OK claim must be reclaimed');
assert.equal(outcome.retiredJobs,1);
assert.equal(fake.claims,0);
assert.equal(fake.fences,1,'still-running local OS effect must remain fenced');
assert.equal(fake.acks,0,'never invent terminal receipt');
assert.equal(fake.audit,1);
assert.equal(fake.calls.some(x=>x.sql.includes("UPDATE lr_gold_job_records SET")),true,
 'preserve source behavior; running/queued status updates never fake completion');
const again=await gc(false).sweepDevice(deviceId,{dryRun:false});
assert.equal(again.retiredClaims,0);
assert.equal(again.retiredJobs,0);
assert.equal(fake.audit,1,'idempotent repeated scans');
assert.equal(fake.acks,0);
assert.equal(fake.fences,1);
console.log('GOLD_OWNERLESS_REVOKED_CLAIM_GC_PASS no_password,no_owner_session,launch_ok_orphan,fresh_channel_hold,device_scope,transactional_claim_retirement,unknown_audit,durable_fence,no_fake_terminal_ack,idempotent');
