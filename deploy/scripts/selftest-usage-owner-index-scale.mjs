import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {UsageRegistry} from '../../operator-host/usage-registry.mjs';

const AUG31=Date.UTC(2026,7,31,23,40);
let now=Date.UTC(2026,8,1,0,20);
const registry=new UsageRegistry({stateFile:null,now:()=>now});
const owners=5000;
const entries=Array.from({length:owners},(_,n)=>({
 state:'connected',connectionId:'uat_connection_'+n,accountId:'uat_account_'+n,
 deviceId:'uat_device_'+n,connectedAt:AUG31,hardExpiresAt:Date.UTC(2026,8,1,1,0)
}));
assert.equal(registry.reconcileConnections(entries),true);
assert.equal(registry.openConnections.size,owners);
assert.equal(registry.accountConnectionIds.size,owners);
assert.equal(registry.deviceConnectionIds.size,owners);

let accrued=0;
const originalAccrue=registry._accrue.bind(registry);
registry._accrue=(...args)=>{accrued++;return originalAccrue(...args);};
const selected='uat_account_37';
const priorOther=registry.openConnections.get('uat_connection_4000').lastAccruedAt;
const summary=registry.summary(selected,{months:2});
assert.equal(summary.onlineMsThisMonth,20*60_000);
assert.equal(summary.series.find(row=>row.month==='2026-08').onlineMs,20*60_000);
assert.equal(summary.toolCallsThisMonth,0);
assert.equal(accrued,1,'one account read must not iterate/accrue 5,000 foreign connections');
assert.equal(registry.openConnections.get('uat_connection_4000').lastAccruedAt,priorOther);
assert.equal(registry.summary(selected,{months:2}).onlineMsThisMonth,summary.onlineMsThisMonth);
assert.equal(accrued,2,'second owner summary still uses only one owner connection');

now=Date.UTC(2026,8,1,1,10);
assert.equal(registry.summary(selected,{months:1}).onlineMsThisMonth,60*60_000);
assert.equal(registry.openConnections.has('uat_connection_37'),false);
assert.equal(registry.accountConnectionIds.has(selected),false);
assert.equal(registry.deviceConnectionIds.has('uat_device_37'),false);
assert.equal(registry.openConnections.size,owners-1);
assert.equal(registry.summary('uat_account_4000',{months:1}).onlineMsThisMonth,60*60_000);
assert.equal(registry.openConnections.has('uat_connection_4000'),false);
assert.equal(registry.accountConnectionIds.has('uat_account_4000'),false);
assert.equal(accrued,4,'expiry cleanup of one account must not sweep the others');

const replacementAt=Date.UTC(2026,8,1,0,30);
const replaced=registry.ingest({
 type:'device_connection_opened',accountId:'uat_account_new',
 deviceId:'uat_device_1',connectionId:'uat_connection_new',
 hardExpiresAt:Date.UTC(2026,8,1,2),at:new Date(replacementAt).toISOString()
},{persist:false});
assert.equal(replaced,true);
assert.equal(registry.openConnections.has('uat_connection_1'),false);
assert.equal(registry.accountConnectionIds.has('uat_account_1'),false);
assert.deepEqual([...registry.accountConnectionIds.get('uat_account_new')],['uat_connection_new']);
assert.equal(registry.deviceConnectionIds.has('uat_device_1'),true);

// Reopen the same connection ID under another owner: old index must not leak.
registry.ingest({
 type:'device_connection_opened',accountId:'uat_account_other',
 deviceId:'uat_device_reopen',connectionId:'uat_connection_new',
 at:new Date(replacementAt+1000).toISOString()
},{persist:false});
assert.equal(registry.accountConnectionIds.has('uat_account_new'),false);
assert.equal(registry.deviceConnectionIds.has('uat_device_1'),false);
assert.deepEqual([...registry.accountConnectionIds.get('uat_account_other')],['uat_connection_new']);
registry.ingest({
 type:'device_connection_closed',connectionId:'uat_connection_new',
 at:new Date(replacementAt+2000).toISOString()
},{persist:false});
assert.equal(registry.accountConnectionIds.has('uat_account_other'),false);
assert.equal(registry.deviceConnectionIds.has('uat_device_reopen'),false);

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-usage-owner-index-'));
try{
 const file=path.join(tmp,'synthetic-usage.json');
 let tick=Date.UTC(2026,8,2,1);
 const u=new UsageRegistry({stateFile:file,now:()=>tick});
 u.reconcileConnections([{state:'connected',accountId:'owner_uat',connectionId:'con_uat',
  deviceId:'device_uat',connectedAt:tick-2*3600000,hardExpiresAt:tick+2*3600000}]);
 let saved=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(saved.schemaVersion,1);
 assert.equal(saved.openConnections.length,1);
 const restored=new UsageRegistry({stateFile:file,now:()=>tick});
 assert.equal(restored.accountConnectionIds.get('owner_uat').has('con_uat'),true);
 assert.equal(restored.deviceConnectionIds.get('device_uat').has('con_uat'),true);
 assert.equal(restored.summary('owner_uat',{months:1}).onlineHoursThisMonth,2);
 saved=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(saved.schemaVersion,1,'schema v1 must remain backward compatible');
 assert.equal(saved.openConnections[0].connectionId,'con_uat');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('USAGE_OWNER_INDEX_5000_SYNTHETIC_PASS: O(owner-connections) accrual; 5000 unrelated connections untouched');
console.log('USAGE_OWNER_INDEX_EXPIRY_RENEWAL_PERSISTENCE_PASS: schema v1 retained');
