// Gold P1-E — 1k/10k SIMULATED devices in a disposable PostgreSQL 17 DB.
// Two real GoldExecutionEpochs Operator instances, real Ed25519 inventories,
// real GC admission, 10k durable device connections + mass crash/reconnect.
// NO network devices, no spawned OS process and NO production/UAT mutations.
// Run only via the isolated ci-gold-epoch-pg fixture (never against live DB).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {performance} from 'node:perf_hooks';
import {GoldExecutionEpochs} from '../../lib/gold-execution-epoch.mjs';
import {GoldConnectionJobReaper} from '../../lib/gold-connection-job-reaper.mjs';
import {signReconnectInventory} from '../../lib/gold-reconnect-proof.mjs';
import {scanOwnerStaleClaims} from '../../lib/gold-stale-claim-detector.mjs';

const db=process.env.LR_GOLD_EPOCH_TEST_DB||'';
assert.equal(process.env.LR_EPOCH_PG_TEST_ALLOW,'1','P1E disposable database opt-in required');
assert.match(db,/^lr_gold_epoch_fixture_[0-9]{8}$/,'refuse anything but ephemeral fixture');
assert.equal(process.env.LR_P1E_LOAD_ALLOW,'1','P1E explicit load opt-in required');
const target=Number(process.env.LR_P1E_TARGET||10000);
assert.ok([1000,10000].includes(target),'Only 1000 or 10000 synthetic devices permitted');
const signatureSample=Math.min(1000,target); // genuine code path, NOT 10k Agent processes
const effectSample=50;
const maxConcurrency=24;
const poolA=new pg.Pool({database:db,max:12,connectionTimeoutMillis:15000,statement_timeout:30000});
const poolB=new pg.Pool({database:db,max:12,connectionTimeoutMillis:15000,statement_timeout:30000});
const serverKey=crypto.generateKeyPairSync('ed25519');
const deviceKey=crypto.generateKeyPairSync('ed25519');
const A=new GoldExecutionEpochs({pool:poolA,signer:serverKey});
const B=new GoldExecutionEpochs({pool:poolB,signer:serverKey});
const prefix='dev_p1e_';
const dev=i=>prefix+String(i).padStart(5,'0');
const account=i=>'acct_p1e_'+String(Math.floor((i-1)/100)).padStart(3,'0');
const conn=(i,round)=>'dc_p1e_'+String(i).padStart(5,'0')+'_'+round;
const instance=(i,round)=>'instance_p1e_'+String(i).padStart(5,'0')+'_'+round;
const job=i=>'10000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
const duration=(start)=>Math.round(performance.now()-start);
const percentile=(values,p)=>values.length?
  Math.round([...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(p*(values.length-1)))]):null;
const mem=()=>Math.round(process.memoryUsage().rss/1048576);
let peakRssMiB=mem(),results=[],maxPool=0;
const sample=()=>{peakRssMiB=Math.max(peakRssMiB,mem());maxPool=Math.max(maxPool,
  poolA.totalCount+poolB.totalCount);};
const metric=(name,start,durations=[],extra={})=>{
 sample();const ms=duration(start);
 const result={phase:name,ms,ops:durations.length,p50Ms:percentile(durations,.5),
   p95Ms:percentile(durations,.95),p99Ms:percentile(durations,.99),
   throughputOpsPerSec:durations.length?Math.round(durations.length*1000/Math.max(1,ms)):null,
   ...extra};
 results.push(result);console.log('P1E_PHASE '+JSON.stringify(result));return result;
};
async function bounded(items,limit,task){
 let next=0;const durations=[],errors=[];
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
   for(;;){const i=next++;if(i>=items.length)break;
     const started=performance.now();
     try{await task(items[i],i);durations.push(performance.now()-started)}
     catch(e){errors.push({item:items[i],reason:String(e?.message||e).slice(0,120)});if(errors.length>10)break}
     if(i%100===0)sample();
   }
 }));
 if(errors.length)throw Error('P1E_BOUNDED_ERRORS:'+JSON.stringify(errors.slice(0,5)));
 return durations;
}
const count=async(sql,args=[])=>Number((await poolA.query(sql,args)).rows[0].n);
const totalStart=performance.now();
try{
 // Unique prefix and fixture guard. Never delete or truncate pre-existing data.
 assert.equal(await count("SELECT count(*)::int n FROM lr_devices WHERE device_id LIKE 'dev_p1e_%'"),0);
 const indexStart=performance.now();
 await poolA.query('CREATE INDEX IF NOT EXISTS p1e_conn_current_idx ON lr_device_connections(device_id,connected_at DESC,connection_id DESC)');
 await poolA.query('CREATE INDEX IF NOT EXISTS p1e_claims_device_idx ON lr_gold_device_resource_claims(device_id)');
 await poolA.query('CREATE INDEX IF NOT EXISTS p1e_work_device_idx ON lr_gold_personal_agent_work(device_id)');
 await poolA.query('CREATE INDEX IF NOT EXISTS p1e_jobs_device_idx ON lr_gold_job_records(device_id)');
 metric('fixture_indexes',indexStart);
 // All simulated devices have durable registrations, connections, job ledger
 // and retained M4 claims. This is not a population of real OS child agents.
 for(const [from,to] of [[1,1000],[1001,target]]){
   if(from>to)continue;
   const start=performance.now();
   const args=[from,to];
   await poolA.query(`INSERT INTO lr_devices(device_id,state,last_seen_at)
     SELECT 'dev_p1e_'||lpad(i::text,5,'0'),'online',clock_timestamp()
     FROM generate_series($1::int,$2::int) i`,args);
   await poolA.query(`INSERT INTO lr_device_connections
       (connection_id,account_id,device_id,connected_at,closed_at,hard_expires_at)
     SELECT 'dc_p1e_'||lpad(i::text,5,'0')||'_0',
       'acct_p1e_'||lpad(((i-1)/100)::text,3,'0'),
       'dev_p1e_'||lpad(i::text,5,'0'),
       clock_timestamp()-interval '5 minutes',NULL,clock_timestamp()+interval '12 hours'
     FROM generate_series($1::int,$2::int) i`,args);
   await poolA.query(`INSERT INTO lr_gold_job_records(job_id,account_id,device_id,status,public_view)
     SELECT '10000000-0000-4000-8000-'||lpad(to_hex(i),12,'0'),
       'acct_p1e_'||lpad(((i-1)/100)::text,3,'0'),
       'dev_p1e_'||lpad(i::text,5,'0'),
       CASE WHEN i%2=0 THEN 'running' ELSE 'queued' END,
       jsonb_build_object('status',CASE WHEN i%2=0 THEN 'running' ELSE 'queued' END)
     FROM generate_series($1::int,$2::int) i`,args);
   await poolA.query(`INSERT INTO lr_gold_personal_agent_work
      (job_id,account_id,device_id,state,resource_key,resource_mode)
     SELECT '10000000-0000-4000-8000-'||lpad(to_hex(i),12,'0'),
       'acct_p1e_'||lpad(((i-1)/100)::text,3,'0'),
       'dev_p1e_'||lpad(i::text,5,'0'),
       CASE WHEN i%2=0 THEN 'running' ELSE 'queued' END,
       'device:unknown','exclusive'
     FROM generate_series($1::int,$2::int) i`,args);
   await poolA.query(`INSERT INTO lr_gold_device_resource_claims
      (job_id,account_id,device_id,resource_key,resource_mode,worker_state,process_id,claimed_at)
     SELECT '10000000-0000-4000-8000-'||lpad(to_hex(i),12,'0'),
       'acct_p1e_'||lpad(((i-1)/100)::text,3,'0'),
       'dev_p1e_'||lpad(i::text,5,'0'),'device:unknown','exclusive',
       'running',CASE WHEN i%4=0 THEN 'lp_'||lpad(i::text,20,'0') ELSE NULL END,
       clock_timestamp()-interval '2 hours'
     FROM generate_series($1::int,$2::int) i WHERE i%2=0`,args);
   metric('seed_'+to,start,[],{devices:to-from+1});
 }
 assert.equal(await count("SELECT count(*)::int n FROM lr_devices WHERE device_id LIKE 'dev_p1e_%'"),target);
 assert.equal(await count("SELECT count(*)::int n FROM lr_gold_job_records WHERE device_id LIKE 'dev_p1e_%'"),target);
 assert.equal(await count("SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE device_id LIKE 'dev_p1e_%'"),target/2);
 const samples=Array.from({length:signatureSample},(_,i)=>i+1);
 // Real application-level epoch grants on 1,000 representative devices.
 const initialStart=performance.now();
 const issue0=await bounded(samples,maxConcurrency,i=>
   (i%2?A:B).issue({accountId:account(i),deviceId:dev(i),connectionId:conn(i,0),instanceId:instance(i,0)})
     .then(x=>assert.equal(x.grant.executionEpoch,'1')));
 metric('actual_epoch_grants_initial',initialStart,issue0,{sampledDevices:signatureSample});
 // Simulate abrupt loss of ALL device connections. No real machine touched.
 const crashStart=performance.now();
 await poolA.query(`UPDATE lr_device_connections SET closed_at=clock_timestamp()-interval '2 hours'
     WHERE connection_id LIKE 'dc_p1e_%_0'`);
 await poolA.query(`UPDATE lr_devices SET state='offline',last_seen_at=clock_timestamp()-interval '2 hours'
     WHERE device_id LIKE 'dev_p1e_%'`);
 assert.equal(await count("SELECT count(*)::int n FROM lr_device_connections WHERE connection_id LIKE 'dc_p1e_%_0' AND closed_at IS NOT NULL"),target);
 metric('mass_disconnect',crashStart,[],{disconnectedDevices:target});
 // A GC race with a recent device presence is required to leave UNKNOWN.
 // Test offline eligibility first (dry-run) then bring all devices online.
 const gc=new GoldConnectionJobReaper({pool:poolA,limit:16,
   allowedDevices:Array.from({length:16},(_,i)=>dev(i+1)),
   channelFresh:async()=>false});
 const gcStart=performance.now();
 const dry=await gc.sweep({dryRun:true});
 assert.equal(dry.scanned,16);assert.equal(dry.cleaned,0);
 assert.ok(dry.eligible>0);
 metric('gc_dry_run_offline',gcStart,[],{sampleDevices:dry.scanned,eligible:dry.eligible,mutated:dry.cleaned});
 const reconnectStart=performance.now();
 await poolA.query(`INSERT INTO lr_device_connections(connection_id,account_id,device_id,connected_at,closed_at,hard_expires_at)
   SELECT 'dc_p1e_'||lpad(i::text,5,'0')||'_1',
     'acct_p1e_'||lpad(((i-1)/100)::text,3,'0'),
     'dev_p1e_'||lpad(i::text,5,'0'),
     clock_timestamp(),NULL,clock_timestamp()+interval '12 hours'
   FROM generate_series(1,$1::int) i`,[target]);
 await poolA.query(`UPDATE lr_devices SET state='online',last_seen_at=clock_timestamp()
   WHERE device_id LIKE 'dev_p1e_%'`);
 assert.equal(await count("SELECT count(*)::int n FROM lr_device_connections WHERE connection_id LIKE 'dc_p1e_%_1' AND closed_at IS NULL"),target);
 metric('mass_reconnect',reconnectStart,[],{reconnectedDevices:target});
 const gcAfterStart=performance.now();
 const after=await gc.sweep({dryRun:false});
 assert.equal(after.scanned,16);assert.equal(after.eligible,0);
 assert.equal(after.cleaned,0,'GC cannot retire after reconnect');
 metric('gc_after_reconnect',gcAfterStart,[],{scanned:after.scanned,eligible:after.eligible,mutated:after.cleaned});
 // Real Gold authorization gate across two Operator pools after the storm.
 const grantStart=performance.now();
 const grants=new Map();
 const issues=await bounded(samples,maxConcurrency,async i=>{
   const x=await (i%2?B:A).issue({accountId:account(i),deviceId:dev(i),
     connectionId:conn(i,1),instanceId:instance(i,1)});
   assert.equal(x.grant.executionEpoch,'2');grants.set(i,x.grant);
 });
 metric('actual_epoch_reconnect',grantStart,issues,{sampledDevices:signatureSample});
 // Each selected mock device signs a genuine challenge-bound Ed25519
 // inventory (empty and INCOMPLETE). The server must verify it before ready.
 const inventoryStart=performance.now();
 const inventories=await bounded(samples,maxConcurrency,async i=>{
   const grant=grants.get(i);
   const proof={version:1,accountId:account(i),deviceId:dev(i),
      executionEpoch:grant.executionEpoch,challenge:grant.challenge,
      snapshotId:crypto.randomBytes(16).toString('hex'),pageIndex:0,pageCount:1,totalItems:0,
      capturedAt:Date.now(),complete:false,processes:[]};
   const signed=signReconnectInventory(proof,deviceKey.privateKey);
   const result=await (i%2?A:B).recordInventory({accountId:account(i),deviceId:dev(i),
     connectionId:conn(i,1),statement:signed,devicePublicKey:deviceKey.publicKey});
   assert.equal(result.verified,true);assert.equal(result.ready,true);
   assert.equal(result.unresolvedFencesUntouched,true);
 });
 metric('actual_signed_inventory_reconciliation',inventoryStart,inventories,{signedDevices:signatureSample,complete:false});
 // Two operators race to authorize identical commands. Exactly one durable
 // OS-effect-start permit; no process is actually launched by this test.
 const commandStart=performance.now();
 const commands=await bounded(Array.from({length:effectSample},(_,i)=>i+1),12,async i=>{
   const command={commandId:'cmd_p1e_'+String(i).padStart(20,'0'),
     jobId:job(i),payload:{type:'process',operationId:'op_p1e_'+i,op:'start',synthetic:true}};
   const args={accountId:account(i),deviceId:dev(i),connectionId:conn(i,1),instanceId:instance(i,1),command};
   const [first,second]=await Promise.all([A.authorizeCommand(args),B.authorizeCommand(args)]);
   assert.equal(first.executionAuthorization.ticket.commandId,second.executionAuthorization.ticket.commandId);
   const signedArgs={accountId:account(i),deviceId:dev(i),connectionId:conn(i,1),instanceId:instance(i,1),
      authorization:first.executionAuthorization};
   const pair=await Promise.allSettled([A.validateStart(signedArgs),B.validateStart(signedArgs)]);
   assert.equal(pair.filter(x=>x.status==='fulfilled').length,1);
   assert.equal(pair.filter(x=>x.status==='rejected'&&
     /execution_start_already_authorized/.test(String(x.reason))).length,1);
 });
 metric('two_operator_duplicate_effect_fencing',commandStart,commands,{effectPermits:effectSample,duplicateEffectPermits:0});
 // Owner/tenant-scoped M4 diagnostics at 10k devices. No claim mutations.
 const staleStart=performance.now();
 const owned=[...Array(100)].map((_,i)=>dev(i+1));
 const diagnosis=await scanOwnerStaleClaims({pool:poolA,accountId:account(1),deviceIds:owned,
   minimumAgeMs:3600000,maxRows:1000});
 assert.equal(diagnosis.totalCandidates,50);
 assert.ok(diagnosis.items.every(item=>!item.releaseAllowed));
 assert.ok(diagnosis.items.every(item=>item.accountId===account(1)));
 metric('owner_scoped_stale_diagnostics',staleStart,[],{diagnosedClaims:diagnosis.totalCandidates});
 // A second giant reconnect (10k devices) must be durable and have exactly
 // one current connection, without disturbing previous authenticated start.
 const secondStart=performance.now();
 await poolB.query(`UPDATE lr_device_connections SET closed_at=clock_timestamp()
   WHERE connection_id LIKE 'dc_p1e_%_1'`);
 await poolB.query(`INSERT INTO lr_device_connections(connection_id,account_id,device_id,connected_at,closed_at,hard_expires_at)
   SELECT 'dc_p1e_'||lpad(i::text,5,'0')||'_2',
   'acct_p1e_'||lpad(((i-1)/100)::text,3,'0'),
   'dev_p1e_'||lpad(i::text,5,'0'),clock_timestamp(),NULL,clock_timestamp()+interval '12 hours'
   FROM generate_series(1,$1::int) i`,[target]);
 const active=await count(`SELECT count(*)::int n FROM lr_device_connections
   WHERE connection_id LIKE 'dc_p1e_%_2' AND closed_at IS NULL`);
 assert.equal(active,target);
 metric('second_mass_reconnect',secondStart,[],{reconnectedDevices:target});
 const fenceStart=performance.now();
 const old=await Promise.allSettled(Array.from({length:effectSample},(_,k)=>{
   const i=k+1;
   return A.assertReady({accountId:account(i),deviceId:dev(i),connectionId:conn(i,1),instanceId:instance(i,1)})
     .then(()=>A.authorizeCommand({accountId:account(i),deviceId:dev(i),connectionId:conn(i,1),instanceId:instance(i,1),
       command:{commandId:'cmd_p1e_old_'+String(i).padStart(20,'0'),jobId:job(i),payload:{synthetic:true}}}));
 }));
 // Assert old tickets are NOT startable (via actual PG current connection).
 const stale=await Promise.allSettled(Array.from({length:effectSample},(_,k)=>{
    const i=k+1;
    return A.issue({accountId:account(i),deviceId:dev(i),connectionId:conn(i,1),instanceId:instance(i,1)});
 }));
 assert.equal(stale.filter(r=>r.status==='rejected').length,effectSample);
 metric('old_connection_fencing_after_storm',fenceStart,[],{oldEpochRejections:effectSample});
 assert.equal(await count("SELECT count(*)::int n FROM lr_gold_execution_effect_starts WHERE device_id LIKE 'dev_p1e_%'"),effectSample);
 assert.equal(await count("SELECT count(*)::int n FROM lr_gold_terminal_receipt_acks WHERE device_id LIKE 'dev_p1e_%'"),0);
 assert.equal(await count("SELECT count(*)::int n FROM lr_gold_device_gc_fences WHERE device_id LIKE 'dev_p1e_%'"),0);
 assert.equal(await count("SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE device_id LIKE 'dev_p1e_%'"),target/2);
 sample();
 assert.ok(maxPool<=24,'PostgreSQL client pool exceeded explicit bound');
 const totalMs=duration(totalStart);
 const report={ok:true,kind:'P1E_SIMULATED_DATABASE_AND_PROTOCOL_CHAOS',
   tier:target,syntheticRegisteredDevices:target,syntheticJobRows:target,
   simulatedCrashEvents:target,simulatedReconnectEvents:target*2,
   genuineOperatorEpochHandshakeDevices:signatureSample,
   realSignedInventoryVerified:signatureSample,operatorInstances:2,
   concurrentOperatorLimit:maxConcurrency,peakPgClientConnections:maxPool,peakNodeRssMiB:peakRssMiB,
   noDuplicateEffects:true,verifiedEffectPermits:effectSample,
   noPidClaimsPreserved:true,terminalAcksFabricated:0,offlineGcAfterReconnect:0,
   phases:results,totalMs,
   limits:'No real 10k Agent processes/sockets; SQL population and 1k actual epoch/inventory protocol calls only; CI host not production capacity benchmark'};
 console.log('GOLD_P1E_CHAOS_REPORT '+JSON.stringify(report));
}finally{await Promise.allSettled([poolA.end(),poolB.end()]);}
