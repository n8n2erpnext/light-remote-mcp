import assert from 'node:assert/strict';
import {GoldConnectionJobReaper} from '../../lib/gold-connection-job-reaper.mjs';

const now=Date.parse('2026-10-29T17:00:00Z');
const hour=3600000;
const old={connection_id:'dc_old',connected_at:new Date(now-4*hour),closed_at:new Date(now-2*hour),hard_expires_at:new Date(now+hour)};
const fresh={connection_id:'dc_new',connected_at:new Date(now-100),closed_at:null,hard_expires_at:new Date(now+hour)};
const staleDevice={state:'offline',last_seen_at:new Date(now-2*hour)};
const onlineDevice={state:'online',last_seen_at:new Date(now-100)};
async function race(which){
 let connections=0,deviceReads=0,commits=0,rollbacks=0,retire=0,channelChecks=0;
 const sql=[];
 const client={async query(q){
   sql.push(q);
   if(q==='BEGIN'||q.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[],rowCount:0};
   if(q==='COMMIT'){commits++;return {rows:[]};}
   if(q==='ROLLBACK'){rollbacks++;return {rows:[]};}
   if(q.includes('SELECT DISTINCT account_id'))return {rows:[{account_id:'a'}]};
   if(q.includes('FROM lr_device_connections WHERE')){
     connections++;
     return {rows:[connections===2&&which==='new_connection'?fresh:old]};
   }
   if(q.includes('SELECT state,last_seen_at FROM lr_devices')){
     deviceReads++;
     return {rows:[deviceReads===2&&which==='new_heartbeat'?onlineDevice:staleDevice]};
   }
   if(q.includes('FROM lr_gold_device_resource_claims WHERE device_id=$1 FOR UPDATE'))return {rows:[{
     job_id:'j',account_id:'a',resource_key:'project:/tmp',resource_mode:'exclusive',worker_state:'terminal_unknown',process_id:null}]};
   if(q.includes('FROM lr_gold_terminal_receipt_acks'))return {rows:[],rowCount:0};
   return {rows:[],rowCount:1};
 },release(){}};
 const pool={connect:async()=>client,query:async()=>({rows:[]})};
 const gc=new GoldConnectionJobReaper({pool,now:()=>now,channelFresh:async()=>{
   channelChecks++;return which==='late_signed_channel'&&channelChecks>=2;
 },onRetired:()=>{retire++;}});
 const result=await gc.sweepDevice('dev-test',{dryRun:false});
 return {result,connections,deviceReads,commits,rollbacks,retire,sql};
}
for(const which of ['new_connection','new_heartbeat','late_signed_channel']){
 const r=await race(which);
 assert.equal(r.result.cleaned,false,which+' must not retire');
 assert.equal(r.commits,0,which+' must not commit');
 assert.equal(r.rollbacks,1,which+' rollback');
 assert.equal(r.retire,0,which+' must not invalidate Fleet state');
 assert.equal(r.connections,2,which+' requires PG recheck');
}
const steady=await race('steady');
assert.equal(steady.result.cleaned,true);
assert.equal(steady.commits,1);
assert.equal(steady.rollbacks,0);
assert.equal(steady.retire,1);
assert.equal(steady.sql.some(q=>q.includes('INSERT INTO lr_gold_terminal_receipt_acks')),false);
console.log(JSON.stringify({ok:true,unit:'source_mock_only',
 races:['new_connection','new_heartbeat','late_signed_channel'],
 rollbackForAllRaces:true,steadyOfflineGc:true,falseTerminalAck:0}));

// A controlled Gold UAT can opt into a strict device allowlist. This must
// protect another stale claim even when both devices would be GC-eligible.
let scopedSql=0,scopedConnections=0;
const scopedPool={async query(sql,args){
  scopedSql++;
  assert.match(sql,/device_id=ANY\(\$3::text\[\]\)/);
  assert.deepEqual(args[2],['dev-fixture-a']);
  return {rows:sql.includes('device_id>$1')?[{device_id:'dev-fixture-a'}]:[]};
},async connect(){scopedConnections++;throw Error('out_of_scope_device_must_never_connect');}};
assert.throws(()=>new GoldConnectionJobReaper({pool:scopedPool,allowedDevices:[]}),/invalid_device_allowlist/);
assert.throws(()=>new GoldConnectionJobReaper({pool:scopedPool,allowedDevices:['dev other']}),/invalid_device_allowlist/);
const scopedGc=new GoldConnectionJobReaper({pool:scopedPool,allowedDevices:['dev-fixture-a'],now:()=>now});
assert.deepEqual(await scopedGc.candidates(),['dev-fixture-a']);
const excluded=await scopedGc.sweepDevice('dev-historical-unrelated',{dryRun:false});
assert.equal(excluded.reason,'not_in_gc_allowlist');
assert.equal(scopedConnections,0,'no PG mutations or locks for unrelated device');
assert.ok(scopedSql>=1);
console.log('GOLD_GC_UAT_DEVICE_ALLOWLIST_UNRELATED_CLAIMS_PROTECTED=PASS');
