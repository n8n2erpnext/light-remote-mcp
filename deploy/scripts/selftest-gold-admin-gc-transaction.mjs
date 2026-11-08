import assert from 'node:assert/strict';
import {GoldConnectionJobReaper} from '../../lib/gold-connection-job-reaper.mjs';
const ADMIN='acct_bootstrap_admin';
const OWNER='acct_customer_1';
const DEVICE='dev_revoked_1';
const JOB='db964413-f80f-4869-96aa-fa9b56dded09';
const OTHER='4a444444-1111-4111-8111-444444444444';
const NOW=Date.parse('2026-10-31T12:00:00Z');
const H=3600000;
function fixture({extraJob=false,hasAck=false,fresh=false}={}){
 const state={audit:[],fence:0,claims:1,updates:0,committed:0,rolledBack:0,acksInserted:0};
 const pool={
  async query(){return {rows:[]}},
  async connect(){return {async query(sql,args=[]){
   if(sql==='ROLLBACK'){state.rolledBack++;return {rows:[],rowCount:0}}
   if(sql==='COMMIT'){state.committed++;return {rows:[],rowCount:0}}
   if(sql.includes('SELECT DISTINCT account_id'))return {rows:[{account_id:OWNER}]};
   if(sql.includes('FROM lr_device_connections WHERE'))return {rows:[{
    connection_id:'old_connection',connected_at:new Date(NOW-10*H),
    closed_at:new Date(NOW-8*H),hard_expires_at:new Date(NOW+H)}]};
   if(sql.includes('SELECT state,last_seen_at FROM lr_devices'))return {rows:[{state:'revoked',last_seen_at:new Date(NOW-7*H)}]};
   if(sql.includes('FROM lr_gold_job_records WHERE device_id=$1 AND status IN'))return {
    rows:extraJob?[{job_id:OTHER,account_id:OWNER,status:'running'}]:[]};
   if(sql.includes('FROM lr_gold_personal_agent_work WHERE device_id=$1 AND state IN'))return {rows:[]};
   if(sql.includes('FROM lr_gold_device_resource_claims WHERE device_id=$1 FOR UPDATE'))return {
    rows:state.claims?[{job_id:JOB,account_id:OWNER,resource_key:'device:unknown',resource_mode:'exclusive',
      worker_state:'running',process_id:'lp_12345678901234567890'}]:[]};
   if(sql.includes('FROM lr_gold_terminal_receipt_acks'))return {rows:hasAck?[{}]:[],rowCount:hasAck?1:0};
   if(sql.includes('INSERT INTO lr_gold_device_gc_fences')){state.fence++;return {rowCount:1,rows:[]}}
   if(sql.includes('INSERT INTO lr_gold_terminal_receipt_acks')){state.acksInserted++;throw Error('fake_ack_denied')}
   if(sql.includes('INSERT INTO lr_audit_events')){
    state.audit.push({actor:args[1],owner:args[2],kind:args[3],job:args[4],metadata:JSON.parse(args[5])});
    return {rowCount:1,rows:[]};
   }
   if(sql.startsWith('DELETE FROM lr_gold_device_resource_claims')){state.claims=0;return {rowCount:1,rows:[]}}
   if(sql.startsWith('UPDATE')){state.updates++;return {rowCount:1,rows:[]}}
   return {rowCount:0,rows:[]};
  },release(){}}}
 };
 const gc=new GoldConnectionJobReaper({
  pool,now:()=>NOW,offlineMs:H,allowedDevices:[DEVICE],
  channelFresh:async()=>fresh
 });
 const opts={dryRun:false,expectedOnlyJobId:JOB,actorAccountId:ADMIN,adminReason:'Stale offline support cleanup'};
 return {state,gc,opts};
}
{
 const f=fixture();
 const result=await f.gc.sweepDevice(DEVICE,f.opts);
 assert.equal(result.cleaned,true);
 assert.equal(result.retiredClaims,1);
 assert.equal(f.state.claims,0);
 assert.equal(f.state.fence,1);
 assert.equal(f.state.committed,1);
 assert.equal(f.state.acksInserted,0);
 assert.equal(f.state.audit.length,1);
 assert.equal(f.state.audit[0].actor,ADMIN);
 assert.equal(f.state.audit[0].owner,OWNER);
 assert.equal(f.state.audit[0].kind,'gold_admin_connection_gc_unknown');
 assert.equal(f.state.audit[0].job,JOB);
 assert.equal(f.state.audit[0].metadata.manualRecovery,true);
 assert.equal(f.state.audit[0].metadata.processOutcome,'unknown');
 assert.equal(f.state.audit[0].metadata.terminalReceiptCreated,false);
 assert.equal((await f.gc.sweepDevice(DEVICE,f.opts)).cleaned,false);
 assert.equal(f.state.audit.length,1);
}
for(const variant of [{extraJob:true},{hasAck:true},{fresh:true}]){
 const f=fixture(variant);
 const outcome=await f.gc.sweepDevice(DEVICE,f.opts);
 assert.notEqual(outcome.cleaned,true);
 assert.equal(f.state.committed,0);
 assert.equal(f.state.rolledBack,1);
 assert.equal(f.state.fence,0);
 assert.equal(f.state.audit.length,0);
 assert.equal(f.state.claims,1);
 assert.equal(f.state.acksInserted,0);
}
{
 const f=fixture();
 await assert.rejects(()=>f.gc.sweepDevice(DEVICE,{...f.opts,adminReason:'x'}),/selection_invalid/);
 await assert.rejects(()=>f.gc.sweepDevice(DEVICE,{...f.opts,actorAccountId:''}),/selection_invalid/);
 const denied=await f.gc.sweepDevice('dev_other',f.opts);
 assert.equal(denied.reason,'not_in_gc_allowlist');
}
console.log('GOLD_ADMIN_M4_GC_TRANSACTION_PASS admin_vs_customer_audit,exact_job_single_device,known_pid_fence,unknown_not_fake_ack,scope_race_rollback,signed_ack_replay_hold,fresh_channel_hold,idempotence');
