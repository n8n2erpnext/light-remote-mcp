// Real PostgreSQL concurrency between two distinct Operator pools.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {GoldConnectionJobReaper} from '../../lib/gold-connection-job-reaper.mjs';
import {GoldExecutionEpochs} from '../../lib/gold-execution-epoch.mjs';
const db=process.env.LR_GOLD_EPOCH_TEST_DB||'';
assert.match(db,/^lr_gold_epoch_fixture_[0-9]{8}$/);
const {default:pg}=await import(process.env.LR_GOLD_EPOCH_PG_DRIVER?pathToFileURL(process.env.LR_GOLD_EPOCH_PG_DRIVER).href:'pg');
const pgA=new pg.Pool({host:'/var/run/postgresql',user:'postgres',database:db,max:5}),pgB=new pg.Pool({host:'/var/run/postgresql',user:'postgres',database:db,max:5});
const key=crypto.generateKeyPairSync('ed25519');
const issuer=new GoldExecutionEpochs({pool:pgB,signer:key});
const now=()=>Date.now();
async function seed(tag){
 const deviceId='dev-race-'+tag,accountId='acct-race-'+tag,jobId=tag==='a'?'77777777-7777-4777-8777-777777777777':'88888888-8888-4888-8888-888888888888';
 await pgA.query(`INSERT INTO lr_devices(device_id,state,last_seen_at) VALUES($1,'offline',now()-interval '120 minutes')`,[deviceId]);
 await pgA.query(`INSERT INTO lr_device_connections(connection_id,account_id,device_id,connected_at,closed_at,hard_expires_at)
   VALUES($1,$2,$3,now()-interval '6 hours',now()-interval '65 minutes',now()+interval '12 hours')`,['dc_old_'+tag,accountId,deviceId]);
 await pgA.query(`INSERT INTO lr_gold_job_records(job_id,account_id,device_id,status,public_view)
   VALUES($1,$2,$3,'running','{"status":"running"}'::jsonb)`,[jobId,accountId,deviceId]);
 await pgA.query(`INSERT INTO lr_gold_device_resource_claims(job_id,account_id,device_id,resource_key,resource_mode,worker_state,process_id)
   VALUES($1,$2,$3,'device:unknown','exclusive','terminal_unknown',NULL)`,[jobId,accountId,deviceId]);
 return {deviceId,accountId,jobId};
}
async function reconnect({deviceId,accountId},tag){
 const c=await pgB.connect();let tx=false;
 try{await c.query('BEGIN');tx=true;
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['lr_gold_m4_resource:'+deviceId]);
  await c.query(`INSERT INTO lr_device_connections(connection_id,account_id,device_id,connected_at,closed_at,hard_expires_at)
    VALUES($1,$2,$3,clock_timestamp(),NULL,clock_timestamp()+interval '12 hours')`,['dc_new_'+tag,accountId,deviceId]);
  await c.query("UPDATE lr_devices SET state='online',last_seen_at=clock_timestamp() WHERE device_id=$1",[deviceId]);
  await c.query('COMMIT');tx=false;
 }finally{if(tx)await c.query('ROLLBACK').catch(()=>{});c.release();}
 return issuer.issue({accountId,deviceId,connectionId:'dc_new_'+tag,instanceId:'ei_new_'+tag});
}
const count=async(q,values=[])=>Number((await pgA.query(q,values)).rows[0].n);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 // Reconnect holds the advisory lock FIRST; GC must serialize and notice
 // the brand-new PostgreSQL connection/heartbeat rather than stale Redis.
 const a=await seed('a');
 const client=await pgB.connect();
 await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['lr_gold_m4_resource:'+a.deviceId]);
 const gcA=new GoldConnectionJobReaper({pool:pgA,now,channelFresh:async()=>false});
 const pending=gcA.sweepDevice(a.deviceId,{dryRun:false});
 await sleep(80);
 await client.query(`INSERT INTO lr_device_connections(connection_id,account_id,device_id,connected_at,closed_at,hard_expires_at)
   VALUES($1,$2,$3,clock_timestamp(),NULL,clock_timestamp()+interval '12 hours')`,['dc_new_a',a.accountId,a.deviceId]);
 await client.query("UPDATE lr_devices SET state='online',last_seen_at=clock_timestamp() WHERE device_id=$1",[a.deviceId]);
 await client.query('COMMIT');client.release();
 assert.notEqual((await pending).cleaned,true,'reconnect-first must suppress GC');
 assert.equal(await count('SELECT count(*) n FROM lr_gold_device_resource_claims WHERE device_id=$1',[a.deviceId]),1);
 assert.equal(await count('SELECT count(*) n FROM lr_gold_device_gc_fences WHERE device_id=$1',[a.deviceId]),0);
 const aIssued=await issuer.issue({accountId:a.accountId,deviceId:a.deviceId,connectionId:'dc_new_a',instanceId:'ei_new_a'});
 assert.equal(aIssued.grant.executionEpoch,'1');
 // GC holds lock FIRST; reconnect must wait, GC may retire server row as
 // UNKNOWN but MUST leave durable no-PID fence before connection opens.
 const b=await seed('b');
 let releaseChannel,arrived;
 const waiting=new Promise(r=>{arrived=r});
 const channelLatch=new Promise(r=>{releaseChannel=r});
 let entered=0;
 const gcB=new GoldConnectionJobReaper({pool:pgA,now,channelFresh:async()=>{
  entered++;if(entered===1){arrived();await channelLatch;}return false;
 }});
 const retiring=gcB.sweepDevice(b.deviceId,{dryRun:false});
 await waiting;
 const reconnectPending=reconnect(b,'b');
 await sleep(80);
 assert.equal(await count('SELECT count(*) n FROM lr_device_connections WHERE connection_id=$1',['dc_new_b']),0,'reconnect blocked by GC device lock');
 releaseChannel();
 const old=await retiring;
 assert.equal(old.cleaned,true);
 const newGrant=await reconnectPending;
 assert.equal(newGrant.grant.executionEpoch,'1');
 assert.equal(await count('SELECT count(*) n FROM lr_gold_device_gc_fences WHERE device_id=$1 AND resolved_at IS NULL',[b.deviceId]),1,'unknown OS effect remains fenced');
 assert.equal(await count('SELECT count(*) n FROM lr_gold_device_resource_claims WHERE device_id=$1',[b.deviceId]),0);
 assert.equal(await count('SELECT count(*) n FROM lr_gold_terminal_receipt_acks'),0);
 assert.equal(await count('SELECT count(*) n FROM lr_audit_events WHERE resource_id=$1',[b.jobId]),1);
 console.log(JSON.stringify({ok:true,pg:true,operators:2,
   reconnectWins:{claimPreserved:true,gcSuppressed:true},
   gcWins:{serverClaimRetired:true,unknownFencePreserved:true,lateReconnectAccepted:true},
   staleRedisIndependent:true,falseTerminalAcks:0}));
}finally{await Promise.allSettled([pgA.end(),pgB.end()]);}
