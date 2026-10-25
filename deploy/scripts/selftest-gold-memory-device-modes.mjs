import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {GoldMemoryAccountSyncPolicy,normalizeMemoryAccountSyncInput,memoryModeAllowsScope}
  from '../../operator-host/gold-memory-account-sync-policy.mjs';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';

const accountId='gold-account';
const roster=[
 {deviceId:'arm',accountId,state:'online'},
 {deviceId:'win',accountId,state:'online'},
 {deviceId:'mac',accountId,state:'offline'},
 {deviceId:'foreign',accountId:'different-account',state:'online'}
];
assert.equal(memoryModeAllowsScope('auto'),true);
assert.equal(memoryModeAllowsScope('follow_project'),false);
assert.equal(memoryModeAllowsScope('follow_project',{hasVerifiedBinding:true}),true);
assert.equal(memoryModeAllowsScope('manual'),false);
assert.equal(memoryModeAllowsScope('manual',{manualRequested:true}),true);
assert.throws(()=>normalizeMemoryAccountSyncInput({enabled:true,expectedRevision:0,devices:[
  {deviceId:'foreign',selected:true,mode:'auto'}]},accountId,roster),
  /memory_account_sync_device_invalid/);
assert.throws(()=>normalizeMemoryAccountSyncInput({enabled:true,expectedRevision:0,devices:[
  {deviceId:'win',selected:true,mode:'force'}]},accountId,roster),
  /memory_account_sync_device_invalid/);
assert.throws(()=>normalizeMemoryAccountSyncInput({enabled:true,expectedRevision:0,devices:[
  {deviceId:'win',selected:true,mode:'auto'},{deviceId:'win',selected:false,mode:'manual'}
]},accountId,roster),/memory_account_sync_device_invalid/);

// PG query harness tests normalized metadata/CAS behavior without needing a
// production database or touching any enrolled device.
const accounts=new Map(),devices=new Map();
function response(sql,args){
  const q=sql.replace(/\s+/g,' ').trim();
  if(q.startsWith('CREATE TABLE'))return {rows:[]};
  if(q.startsWith('INSERT INTO lr_gold_memory_sync_accounts')){
    if(!accounts.has(args[0]))accounts.set(args[0],{enabled:false,revision:0});
    return {rows:[]};
  }
  if(q.startsWith('SELECT enabled,revision FROM lr_gold_memory_sync_accounts')){
    const a=accounts.get(args[0]);return {rows:a?[a]:[]};
  }
  if(q.startsWith('SELECT revision FROM lr_gold_memory_sync_accounts')){
    const a=accounts.get(args[0]);return {rows:a?[{revision:a.revision}]:[]};
  }
  if(q.startsWith('SELECT device_id,selected,mode,manual_request_seq')){
    return {rows:[...devices.values()].filter(d=>d.account_id===args[0])};
  }
  if(q.startsWith('INSERT INTO lr_gold_memory_sync_devices')){
    const [id,device_id,selected,mode]=args,key=id+':'+device_id;
    devices.set(key,{account_id:id,device_id,selected,mode,
      manual_request_seq:devices.get(key)?.manual_request_seq||0});
    return {rows:[]};
  }
  if(q.startsWith('UPDATE lr_gold_memory_sync_accounts')){
    const a=accounts.get(args[0]);a.enabled=args[1];a.revision++;
    return {rows:[{revision:a.revision}]};
  }
  if(q.startsWith('UPDATE lr_gold_memory_sync_devices AS d')){
    const [account,device]=args,a=accounts.get(account),row=devices.get(account+':'+device);
    if(!a?.enabled||!row?.selected||row.mode!=='manual')return {rows:[]};
    row.manual_request_seq++;
    return {rows:[{manual_request_seq:row.manual_request_seq}]};
  }
  if(['BEGIN','COMMIT','ROLLBACK'].includes(q))return {rows:[]};
  throw Error('unmocked_postgres_query:'+q.slice(0,90));
}
const pool={query:async(sql,args=[])=>response(sql,args),
  connect:async()=>({query:async(sql,args=[])=>response(sql,args),release(){}})};
const store=new GoldMemoryAccountSyncPolicy(pool);
const expected=[
 {deviceId:'arm',selected:true,mode:'auto'},
 {deviceId:'win',selected:true,mode:'manual'},
 {deviceId:'mac',selected:true,mode:'follow_project'}
];
assert.equal((await store.get(accountId,roster)).revision,0);
const saved=await store.set(accountId,{enabled:true,expectedRevision:0,devices:expected},roster);
assert.equal(saved.revision,1);
assert.equal((await store.get(accountId,roster)).devices.find(d=>d.deviceId==='win').mode,'manual');
assert.equal((await store.requestManual(accountId,'win',roster)).manualRequestSeq,1);
assert.equal((await store.requestManual(accountId,'win',roster)).manualRequestSeq,2);
assert.rejects(()=>store.requestManual(accountId,'arm',roster),/memory_sync_manual_not_enabled/);
await assert.rejects(()=>store.set(accountId,{enabled:false,expectedRevision:0,devices:expected},roster),
 /memory_account_sync_revision_conflict/);
const changed=await store.set(accountId,{enabled:false,expectedRevision:1,devices:expected},roster);
assert.equal(changed.revision,2);
assert.equal((await store.get(accountId,roster)).enabled,false);
await assert.rejects(()=>store.requestManual(accountId,'win',roster),/memory_sync_manual_not_enabled/);

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-device-modes-'));
const mod=createGoldWallModules({file:path.join(dir,'memory.sqlite'),
  scopeIdentity:{accountId,deviceId:'arm'}});
try{
  mod.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  const p=mod.createMemoryScope({displayName:'bound project'});
  assert.equal(mod.scopeSyncGate({scopeId:p.scopeId,replicaDeviceId:'win',
    mode:'follow_project'}).allowed,false);
  const bound=mod.bindMemoryScope({scopeId:p.scopeId,sourceType:'repository',
    sourceId:'repo:gold',proofType:'owner_explicit'});
  assert.equal(bound.scopeId,p.scopeId);
  assert.equal(mod.scopeSyncGate({scopeId:p.scopeId,replicaDeviceId:'mac',
    mode:'follow_project'}).allowed,true);
  const nonProject=mod.createMemoryScope({displayName:'unassigned'});
  assert.equal(mod.scopeSyncGate({scopeId:nonProject.scopeId,replicaDeviceId:'mac',
    mode:'follow_project'}).allowed,false);
  assert.equal(mod.scopeSyncGate({scopeId:p.scopeId,replicaDeviceId:'win',mode:'manual'}).allowed,false);
  mod.appendScopedCheckpoint({scopeId:p.scopeId,title:'Revision 1',body:'test',source:'mode-test'});
  const manual=mod.scopeSyncGate({scopeId:p.scopeId,replicaDeviceId:'win',
    mode:'manual',manualRequestSeq:1});
  assert.deepEqual(manual,{allowed:true,uptoRevision:1});
  mod.appendScopedCheckpoint({scopeId:p.scopeId,title:'Revision 2',body:'test',source:'mode-test'});
  assert.equal(mod.scopeSyncGate({scopeId:p.scopeId,replicaDeviceId:'win',
    mode:'manual',manualRequestSeq:1}).uptoRevision,1);
  assert.equal(mod.scopeSyncGate({scopeId:p.scopeId,replicaDeviceId:'win',
    mode:'manual',manualRequestSeq:2}).uptoRevision,2);
  assert.equal(mod.scopeSyncGate({scopeId:p.scopeId,replicaDeviceId:'mac',
    mode:'auto'}).allowed,true);
  assert.equal(mod.scopeSyncGate({scopeId:nonProject.scopeId,replicaDeviceId:'win',
    mode:'auto'}).allowed,true);
  console.log('GOLD_ACCOUNT_MODES_PG_CAS_AUTO_FOLLOW_PROJECT_MANUAL_SCOPE_CEILING_PASS');
}finally{mod.close();fs.rmSync(dir,{recursive:true,force:true});}
