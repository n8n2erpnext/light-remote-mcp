import assert from 'node:assert/strict';
import {GoldConnectionJobReaper,offlineGcEligibility,DEFAULT_OFFLINE_GC_MS} from '../../lib/gold-connection-job-reaper.mjs';
import {DEFAULT_PLAN_CONNECTION_CAPS} from '../../operator-host/device-connection-registry.mjs';

const H=60*60*1000, now=Date.parse('2026-10-29T17:00:00Z');
assert.deepEqual(Object.fromEntries(Object.entries(DEFAULT_PLAN_CONNECTION_CAPS).map(([k,v])=>[k,v/H])),
  {free:12,pro:48,vip:72});
assert.equal(DEFAULT_OFFLINE_GC_MS,H);
const eligible=x=>offlineGcEligibility({now,delayMs:H,...x});
const expired=now-H-1000;
assert.equal(eligible({connection:{closedAt:now-H+1,hardExpiresAt:now+H},channelFresh:false}).eligible,false,'not yet one hour');
assert.equal(eligible({connection:{closedAt:expired,hardExpiresAt:now+H}}).reason,'connection_disconnected');
assert.equal(eligible({connection:{closedAt:expired,hardExpiresAt:now+H}}).eligible,true);
assert.equal(eligible({connection:{closedAt:null,hardExpiresAt:expired}}).reason,'plan_lease_expired');
assert.equal(eligible({connection:{closedAt:null,hardExpiresAt:now+H},device:{state:'online',lastSeenAt:expired}}).reason,'network_lost');
assert.equal(eligible({connection:{closedAt:null,hardExpiresAt:now+H},device:{state:'offline',lastSeenAt:now-H+100}}).eligible,false);
assert.equal(eligible({connection:{closedAt:null,hardExpiresAt:now+48*H},device:{state:'online',lastSeenAt:now}}).eligible,false);
assert.equal(eligible({connection:{closedAt:expired,hardExpiresAt:expired},channelFresh:true}).eligible,false);
assert.equal(eligible({connection:{closedAt:null,hardExpiresAt:now+H},device:{lastSeenAt:expired},channelFresh:true}).eligible,false);

const job1='11111111-1111-4111-8111-111111111111',job2='22222222-2222-4222-8222-222222222222';
const processId='lp_12345678901234567890';
let queries=[],recovered=false,retired=null,shouldBeFresh=false;
const fakePool={
  async query(sql,args){assert.match(sql,/SELECT DISTINCT device_id/);return {rows:args[0]===''?[{device_id:'dev-test'}]:[]}},
  async connect(){
    return {
      async query(sql,args=[]){
        queries.push({sql,args});
        if(sql.includes('SELECT DISTINCT account_id'))return {rows:[{account_id:'acct-1'}]};
        if(sql.includes('FROM lr_device_connections WHERE'))return {rows:[{closed_at:new Date(expired),hard_expires_at:new Date(now+H)}]};
        if(sql.includes('SELECT state,last_seen_at FROM lr_devices'))return {rows:[{state:'offline',last_seen_at:new Date(expired)}]};
        if(sql.includes('SELECT job_id FROM lr_gold_job_records'))return {rows:[{job_id:job1},{job_id:job2}]};
        if(sql.includes('FROM lr_gold_device_resource_claims WHERE device_id=$1 FOR UPDATE'))return {rows:[
          {job_id:job1,account_id:'acct-1',resource_key:'project:/tmp/a',resource_mode:'exclusive',worker_state:'running',process_id:processId},
          {job_id:job2,account_id:'acct-1',resource_key:'project:/tmp/b',resource_mode:'exclusive',worker_state:'terminal_unknown',process_id:null}
        ]};
        if(sql.includes('FROM lr_gold_terminal_receipt_acks'))return {rowCount:0,rows:[]};
        return {rowCount:1,rows:[]};
      },
      release(){recovered=true;}
    };
  }
};
const gc=new GoldConnectionJobReaper({pool:fakePool,channelFresh:async()=>shouldBeFresh,now:()=>now,onRetired:x=>{retired=x;}});
const preview=await gc.sweepDevice('dev-test',{dryRun:true});
assert.equal(preview.eligible,true);assert.equal(preview.dryRun,true);
assert.equal(queries.some(x=>x.sql.startsWith('DELETE FROM lr_gold_device_resource_claims')),false);
queries=[];retired=null;
const result=await gc.sweepDevice('dev-test',{dryRun:false});
assert.equal(result.retiredClaims,2);
assert.equal(result.retiredJobs,2);
assert.deepEqual(new Set(retired.jobIds),new Set([job1,job2]));
assert.equal(queries.filter(x=>x.sql.includes('INSERT INTO lr_gold_device_gc_fences')).length,2,'fence even unknown process with null PID');
assert.equal(queries.filter(x=>x.sql.includes('INSERT INTO lr_audit_events')).length,2,'audit each unknown result');
assert.equal(queries.filter(x=>x.sql.includes('INSERT INTO lr_gold_terminal_receipt_acks')).length,0,'never synthesize terminal ACK');
assert.equal(queries.some(x=>x.sql.includes("UPDATE lr_gold_personal_agent_work SET")),true);
assert.equal(queries.some(x=>x.sql.includes("UPDATE lr_gold_job_records SET")),true);
assert.equal(queries.some(x=>x.sql.startsWith('DELETE FROM lr_gold_device_resource_claims')),true);
assert.equal(queries.at(-1).sql,'COMMIT');
assert.equal(recovered,true);
queries=[];retired=null;shouldBeFresh=true;
const blocked=await gc.sweepDevice('dev-test',{dryRun:false});
assert.equal(blocked.eligible,false);
assert.equal(retired,null);
assert.equal(queries.some(x=>x.sql.startsWith('DELETE FROM lr_gold_device_resource_claims')),false);
assert.equal(queries.at(-1).sql,'ROLLBACK');
console.log(JSON.stringify({ok:true,connectionLeaseHours:{free:12,pro:48,vip:72},
  offlineGcMinutes:60,triggers:['connection_disconnected','plan_lease_expired','network_lost'],
  dryRun:true,transactionalUnknown:true,unresolvedFences:2,syntheticTerminalAcks:0,reconnectGuard:true},null,2));

// M4 must refuse conflicting work while a GC fence still protects an unknown OS effect.
const {GoldDeviceResourceLocks}=await import('../../lib/gold-device-resource-locks.mjs');
const m4=new GoldDeviceResourceLocks({capacity:2});
const conflictSql=[];
const conflictClient={async query(sql,args=[]){conflictSql.push(sql);
  if(sql.includes('lr_gold_device_gc_fences'))return {rows:[{resource_key:'project:/tmp/a'}]};
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
  throw Error('fence_conflict_must_reject_before_live_claim_query');
}};
const rejected=await m4.tryClaim(conflictClient,{
 job_id:'33333333-3333-4333-8333-333333333333',
 account_id:'acct-2',device_id:'dev-test',
 resource_key:'project:/tmp/a',resource_mode:'exclusive',worker_weight:1
});
assert.deepEqual(rejected,{granted:false,reason:'RESOURCE_LOCKED'});
assert.equal(conflictSql.some(q=>q.includes('INSERT INTO lr_gold_device_resource_claims')),false);

const receiptQueries=[];
const signedClient={async query(sql,args=[]){receiptQueries.push(sql);
 if(sql==='BEGIN'||sql==='COMMIT')return {rowCount:0,rows:[]};
 if(sql.includes('pg_advisory_xact_lock'))return {rowCount:1,rows:[]};
 if(sql.startsWith('DELETE FROM lr_gold_device_resource_claims'))return {rowCount:0,rows:[]};
 if(sql.includes('UPDATE lr_gold_device_gc_fences'))return {rowCount:1,rows:[{job_id:job1}]};
 if(sql.includes('INSERT INTO lr_gold_terminal_receipt_acks'))return {rowCount:1,rows:[]};
 if(sql.includes('SELECT process_id FROM lr_gold_terminal_receipt_acks'))return {rowCount:1,rows:[{process_id:processId}]};
 throw Error('unexpected_signed_terminal_query');
 },release(){}};
const verified=await m4.acknowledgeVerifiedTerminal({connect:async()=>signedClient},{
 accountId:'acct-1',deviceId:'dev-test',
 process:{processId,state:'stopped',finishedAt:now}
});
assert.deepEqual(verified,{acked:true,released:true},'only authenticated signed terminal receipt retires fence');
assert.ok(receiptQueries.some(q=>q.includes("resolution='signed_terminal_receipt'")));
console.log('GOLD_GC_M4_FENCING_AND_SIGNED_RECEIPT_RESOLUTION=PASS');
