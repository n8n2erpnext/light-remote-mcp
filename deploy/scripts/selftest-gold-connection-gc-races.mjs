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
