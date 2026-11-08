// PostgreSQL 17 only: exact 60-minute offline-GC boundary, idempotence,
// dry-run, known-PID and no-PID fences and strict device allowlist.
// Uses ONLY the disposable database explicitly created by ci-gold-epoch-pg.mjs.
import assert from 'node:assert/strict';
import pg from 'pg';
import {GoldConnectionJobReaper,DEFAULT_OFFLINE_GC_MS} from '../../lib/gold-connection-job-reaper.mjs';
const db=process.env.LR_GOLD_EPOCH_TEST_DB;
assert.equal(process.env.LR_EPOCH_PG_TEST_ALLOW,'1');
assert.match(db||'',/^lr_gold_epoch_fixture_[0-9]{8}$/);
const pool=new pg.Pool({database:db,max:4});
const H=DEFAULT_OFFLINE_GC_MS, baseline=Date.now();
const a='dev-gc-boundary-synthetic', b='dev-gc-boundary-unrelated';
const acct='acct-gc-boundary', otherAcct='acct-gc-unrelated';
const known='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const unknown='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const queued='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const other='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const nativeId='lp_12345678901234567890';
const count=async(sql,values=[])=>Number((await pool.query(sql,values)).rows[0].n);
const seedJob=async(id,accountId,deviceId,status,workState)=>{
 await pool.query('INSERT INTO lr_gold_job_records(job_id,account_id,device_id,status,public_view) VALUES($1,$2,$3,$4,$5::jsonb)',
   [id,accountId,deviceId,status,JSON.stringify({jobId:id,status})]);
 await pool.query('INSERT INTO lr_gold_personal_agent_work(job_id,account_id,device_id,state,resource_key,resource_mode) VALUES($1,$2,$3,$4,$5,$6)',
   [id,accountId,deviceId,workState,'device:unknown','exclusive']);
};
const reaper=(now=baseline,channelFresh=async()=>false)=>new GoldConnectionJobReaper({
 pool,allowedDevices:[a],now:()=>now,offlineMs:H,channelFresh,event:()=>{}});
try{
 await pool.query("INSERT INTO lr_devices(device_id,state,last_seen_at) VALUES($1,'offline',$3),($2,'offline',$3)",[a,b,new Date(baseline-3*H)]);
 await pool.query('INSERT INTO lr_device_connections(connection_id,account_id,device_id,connected_at,closed_at,hard_expires_at) VALUES($1,$2,$3,$4,$5,$6)',
  ['dc_gc_boundary',acct,a,new Date(baseline-4*H),new Date(baseline-H+1),new Date(baseline+H)]);
 await pool.query('INSERT INTO lr_device_connections(connection_id,account_id,device_id,connected_at,closed_at,hard_expires_at) VALUES($1,$2,$3,$4,$5,$6)',
  ['dc_gc_unrelated',otherAcct,b,new Date(baseline-4*H),new Date(baseline-3*H),new Date(baseline+H)]);
 for(const [id,state,work] of [[known,'running','running'],[unknown,'running','running'],[queued,'queued','queued']])
  await seedJob(id,acct,a,state,work);
 await seedJob(other,otherAcct,b,'running','running');
 for(const [id,accountId,deviceId,pid] of [[known,acct,a,nativeId],[unknown,acct,a,null],[other,otherAcct,b,null]]){
  await pool.query('INSERT INTO lr_gold_device_resource_claims(job_id,account_id,device_id,resource_key,resource_mode,worker_state,process_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id,accountId,deviceId,'device:unknown','exclusive','running',pid]);
 }
 const denied=await reaper().sweepDevice(b,{dryRun:false});
 assert.equal(denied.reason,'not_in_gc_allowlist');
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE device_id=$1',[b]),1);

 const aBefore=await reaper(baseline).sweepDevice(a,{dryRun:false});
 assert.equal(aBefore.eligible,false,'GC before exact 60 minute threshold');
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE device_id=$1',[a]),2);
 const dry=await reaper(baseline+1).sweepDevice(a,{dryRun:true});
 assert.equal(dry.eligible,true,'exact threshold must qualify');
 assert.equal(dry.dryRun,true);
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_device_gc_fences WHERE device_id=$1',[a]),0);
 assert.equal(await count("SELECT count(*)::int n FROM lr_gold_job_records WHERE device_id=$1 AND status='running'",[a]),2);

 const channelBlocked=await reaper(baseline+1,async()=>true).sweepDevice(a,{dryRun:false});
 assert.equal(channelBlocked.eligible,false,'fresh signed channel prevents cleanup');
 const after=await reaper(baseline+1).sweepDevice(a,{dryRun:false});
 assert.equal(after.eligible,true);
 assert.equal(after.cleaned,true);
 assert.equal(after.retiredClaims,2,'queued work never creates an OS-effect fence');
 assert.equal(after.retiredJobs,3);
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_device_gc_fences WHERE device_id=$1 AND resolved_at IS NULL',[a]),2);
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_device_gc_fences WHERE device_id=$1 AND process_id IS NULL',[a]),1);
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_device_gc_fences WHERE device_id=$1 AND process_id=$2',[a,nativeId]),1);
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_terminal_receipt_acks WHERE device_id=$1',[a]),0);
 assert.equal(await count("SELECT count(*)::int n FROM lr_gold_job_records WHERE device_id=$1 AND status='interrupted'",[a]),3);
 assert.equal(await count("SELECT count(*)::int n FROM lr_gold_personal_agent_work WHERE device_id=$1 AND state='unknown'",[a]),2);
 assert.equal(await count("SELECT count(*)::int n FROM lr_gold_personal_agent_work WHERE job_id=$1 AND state='finished' AND disposition='offline_gc_before_dispatch'",[queued]),1);
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE device_id=$1',[a]),0);
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE device_id=$1',[b]),1);
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_device_gc_fences WHERE device_id=$1',[b]),0);
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_job_records WHERE job_id=$1 AND status=$2',[other,'running']),1);

 // GC re-sweeps must never create a fabricated terminal or duplicate audit.
 const oldAudits=await count('SELECT count(*)::int n FROM lr_audit_events WHERE resource_id = ANY($1::text[])',[[known,unknown]]);
 assert.equal(oldAudits,2);
 const second=await reaper(baseline+H).sweepDevice(a,{dryRun:false});
 assert.equal(second.cleaned,true,'re-evaluation can be eligible but has no active claims to retire');
 assert.equal(second.retiredClaims,0);
 assert.equal(second.retiredJobs,0);
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_device_gc_fences WHERE device_id=$1',[a]),2);
 assert.equal(await count('SELECT count(*)::int n FROM lr_gold_terminal_receipt_acks WHERE device_id=$1',[a]),0);
 assert.equal(await count('SELECT count(*)::int n FROM lr_audit_events WHERE resource_id=ANY($1::text[])',[[known,unknown]]),oldAudits);

 console.log(JSON.stringify({ok:true,realPostgres:true,offlineBoundaryMs:H,
   beforeThresholdRejected:true,atThresholdEligible:true,dryRunNoMutation:true,
   freshChannelBlocksGC:true,knownPidFence:1,noPidFence:1,
   queuedNoEffectFence:true,unknownJobs:2,syntheticTerminalAcks:0,
   repeatedSweepNoDuplicate:true,unrelatedDeviceUnchanged:true,
   strictAllowlist:true}));
}finally{await pool.end();}
