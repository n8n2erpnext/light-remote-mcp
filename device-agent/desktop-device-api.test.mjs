import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {createGoldWallModules} from './gold-wall-modules.mjs';
import {createDesktopDeviceApi} from './desktop-device-api.mjs';

const setup=(t,options={})=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lr-desktop-device-'));
 const file=path.join(folder,'modules.sqlite');
 const modules=createGoldWallModules({file,scopeIdentity:{accountId:'owner',deviceId:'local'},
  plusImpl:{stop(){},warmup(){},snapshot:()=>null},...options});
 t.after(()=>{modules.close();fs.rmSync(folder,{recursive:true,force:true});});
 const api=createDesktopDeviceApi({modules,localStatus:()=>({deviceName:'Actual device',cloudState:'connected',
  cloudDesiredConnected:true,version:'test',platformAdapter:process.platform,privateKey:'NEVER_RETURN',
  effectiveCapabilities:['filesystem:read']}),
  getSyncDevices:async()=>{throw Error('offline');},getSyncPolicy:async()=>{throw Error('offline');}});
 return {file,modules,api,call:(action,payload={})=>api.dispatch(action,payload)};
};
test('optional modules stay OFF without creating SQLite; snapshots omit secrets',async t=>{
 const {file,call}=setup(t);
 const device=await call('device.read');
 assert.equal(device.device.deviceName,'Actual device');
 assert.equal(JSON.stringify(device).includes('NEVER_RETURN'),false);
 assert.equal((await call('memory.read')).memory,null);
 assert.equal((await call('codex.read')).codex,null);
 assert.equal(fs.existsSync(file),false);
 await assert.rejects(call('shell.run',{command:'anything'}),/desktop_action_denied/);
 await assert.rejects(call('device.read',{url:'http://elsewhere'}),/desktop_payload_invalid/);
});
test('native provider opt-in is local and connection check sends no inference',async t=>{
 const env={LIGHT_REMOTE_API_WORKER_PILOT:'1',LIGHT_REMOTE_API_WORKER_GEMINI_KEY:'private_fixture_key_not_real',
  LIGHT_REMOTE_API_WORKER_GEMINI_MODEL:'gemini-fixture'};
 const prior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
 Object.assign(process.env,env);
 t.after(()=>{for(const [k,v] of Object.entries(prior)){
  if(v===undefined)delete process.env[k];else process.env[k]=v;
 }});
 let calls=0;
 const {call}=setup(t,{
  plusImpl:{stop(){},warmup(){},snapshot:()=>({account:{connected:false},catalog:{state:'not_checked'}}),
   runWorkerReview:()=>assert.fail('metadata sent inference')},
  fetchImpl:async(url,opts)=>{
   calls++;
   assert.match(url,/\/models\/gemini-fixture$/);
   assert.equal(opts.method,'GET');
   return Response.json({name:'models/gemini-fixture'});
  }
 });
 await call('module.configure',{module:'codexBridge',enabled:true,expectedRevision:0});
 const providers=async()=> (await call('codex.read')).codex.providers;
 assert.equal((await providers()).find(x=>x.provider==='gemini').enabled,false);
 assert.equal(calls,0);
 await assert.rejects(call('worker.provider-select',{provider:'gemini',enabled:true,apiKey:'never'}),/desktop_payload_invalid/);
 await call('worker.provider-select',{provider:'gemini',enabled:true});
 await call('worker.provider-check',{provider:'gemini'});
 const rows=await providers();
 assert.equal(calls,1);
 assert.equal(rows.find(x=>x.provider==='gemini').authState,'authenticated');
 assert.equal(rows.find(x=>x.provider==='gemini').enabled,true);
 assert.doesNotMatch(JSON.stringify(rows),/private_fixture_key/);
 await call('worker.provider-select',{provider:'gemini',enabled:false});
 assert.equal((await providers()).find(x=>x.provider==='gemini').enabled,false);
});
test('review resolves a signed Memory checkpoint locally and refuses it when the scope is archived',async t=>{
 const key='LIGHT_REMOTE_API_WORKER_PILOT',before=process.env[key];
 process.env[key]='1';
 t.after(()=>{if(before===undefined)delete process.env[key];else process.env[key]=before;});
 let work=0;
 const {modules}=setup(t,{plusImpl:{
  stop(){},warmup(){},snapshot:()=>({account:{connected:true},catalog:{state:'ready',models:[]}}),
  runWorkerReview:async({context,verify})=>{
   await verify();
   work++;
   assert.equal(JSON.parse(context).body,'LOCAL_SIGNED_MEMORY_SENTINEL');
   return {text:'Review complete',model:'fixture'};
  }
 }});
 modules.configure({longMemory:true,codexBridge:true,expectedRevision:0});
 const {scopeId}=modules.createMemoryScope({displayName:'Test workspace'});
 const receipt=modules.appendScopedCheckpoint({scopeId,title:'Checkpoint',body:'LOCAL_SIGNED_MEMORY_SENTINEL',
  source:'synthetic Memory fixture',kind:'checkpoint'});
 const checkpointId=receipt.checkpointId;
 assert.ok(checkpointId);
 const actor={accountId:'owner',deviceId:'local',agentId:'agent',sessionId:'session',
  grantId:'grant',connectionId:'connection'};
 const request=()=>({action:'start',workerId:randomUUID(),provider:'codex',model:'fixture',prompt:'Review summary',
  memoryCheckpoint:{scopeId,checkpointId},timeoutMs:10000});
 const approved=modules.remoteWorkerRequest(actor,request(),async()=>true);
 const revoked=modules.remoteWorkerRequest(actor,request(),async()=>true);
 assert.doesNotMatch(JSON.stringify(approved),/LOCAL_SIGNED_MEMORY_SENTINEL/);
 assert.equal(JSON.parse(modules.ownerWorkerJobs()[0].context).body,'LOCAL_SIGNED_MEMORY_SENTINEL');
 modules.ownerWorkerDecision({...approved,approve:true});
 await setImmediate();
 assert.equal(work,1);
 modules.archiveMemoryScope({scopeId,ownerConfirmed:true});
 modules.ownerWorkerDecision({...revoked,approve:true});
 await setImmediate();
 assert.equal(work,1);
 assert.equal(modules.remoteWorkerRequest(actor,{action:'status',workerId:revoked.workerId}).error,
  'api_worker_checkpoint_unavailable');
});
test('real SQLite module CAS, fresh Memory usage, scopes and archive/restore persist',async t=>{
 const {call,modules}=setup(t);
 await call('module.configure',{module:'longMemory',enabled:true,expectedRevision:0});
 const fresh=await call('memory.read');
 assert.equal(fresh.modules.revision,1);
 assert.equal(fresh.memory.scopes.length,0);
 assert.equal(fresh.memory.sync.state,'unavailable'); // offline cloud does not hide local data
 assert.ok(fresh.memory.localFileBytes>0);
 await assert.rejects(call('module.configure',{module:'codexBridge',enabled:true,expectedRevision:0}),e=>e.status===409);
 assert.equal(modules.flags().codexBridge,false);
 const {scope}=await call('memory.create',{displayName:'Real scope',captureMode:'manual'});
 let current=await call('memory.read');assert.equal(current.memory.scopes[0].scopeId,scope.scopeId);
 await assert.rejects(call('memory.archive',{scopeId:scope.scopeId,confirmed:false}),e=>e.status===403);
 await call('memory.archive',{scopeId:scope.scopeId,confirmed:true});
 current=await call('memory.read');assert.equal(current.memory.scopes[0].status,'archived');
 await call('memory.restore',{scopeId:scope.scopeId,confirmed:true});
 assert.equal((await call('memory.read')).memory.scopes[0].status,'active');
 await call('module.configure',{module:'codexBridge',enabled:true,expectedRevision:1});
 assert.equal(modules.flags().longMemory,true); // a toggle cannot overwrite the other module
 await call('module.configure',{module:'longMemory',enabled:false,expectedRevision:2});
 assert.equal((await call('memory.read')).memory,null);
 await call('module.configure',{module:'longMemory',enabled:true,expectedRevision:3});
 assert.equal((await call('memory.read')).memory.scopes[0].scopeId,scope.scopeId); // disabling retains data
});
test('real Codex task edit/delete use current version and exact confirmation',async t=>{
 const {call}=setup(t);
 await call('module.configure',{module:'codexBridge',enabled:true,expectedRevision:0});
 const {task}=await call('codex.task-create',{title:'Owner task'});
 const current=(await call('codex.read')).codex.tasks.find(r=>r.id===task.id);
 assert.ok(current.changedAt>0);
 await assert.rejects(call('codex.task-edit',{id:task.id,title:'Changed',expectedChangedAt:current.changedAt+1}),e=>e.status===409);
 await call('codex.task-edit',{id:task.id,title:'Changed',expectedChangedAt:current.changedAt});
 const edited=(await call('codex.read')).codex.tasks[0];
 assert.equal(edited.title,'Changed');assert.ok(edited.changedAt>current.changedAt);
 await assert.rejects(call('codex.task-delete',{id:task.id,expectedChangedAt:edited.changedAt,confirmed:true,confirmTitle:'Wrong'}));
 await call('codex.task-delete',{id:task.id,expectedChangedAt:edited.changedAt,confirmed:true,confirmTitle:'Changed'});
 assert.equal((await call('codex.read')).codex.tasks.length,0);
});
test('sync write rechecks binding after async roster and never forwards foreign devices',async()=>{
 let changed=false,writes=0;
 const api=createDesktopDeviceApi({modules:{flags:()=>({})},localStatus:()=>({}),
  getSyncDevices:async()=>{changed=true;return {devices:[{deviceId:'owned'}]};},
  getSyncPolicy:async()=>{writes++;return {};}});
 const payload={enabled:true,expectedRevision:0,devices:[{deviceId:'owned',selected:true,mode:'auto'}]};
 await assert.rejects(api.dispatch('memory.sync-policy',payload,()=>{if(changed)throw Error('identity_changed');}),/identity_changed/);
 assert.equal(writes,0);
 await assert.rejects(api.dispatch('memory.sync-policy',{...payload,devices:[{deviceId:'foreign',selected:true,mode:'manual'}]}),e=>e.status===403);
 assert.equal(writes,0);
});
test('only enabled and installed provider snapshots warm metadata, manual account refresh is forced',async t=>{
 const {modules,call}=setup(t);let warms=0,force=null;
 modules.codexPlusWarmup=()=>{warms++;};modules.managedCodexStatus=()=>({state:'missing',installed:false,externalAvailable:false});
 await call('codex.read');assert.equal(warms,0);
 await call('module.configure',{module:'codexBridge',enabled:true,expectedRevision:0});
 await call('codex.read');assert.equal(warms,0);
 modules.managedCodexStatus=()=>({state:'installed',installed:true,externalAvailable:false});
 await call('codex.read');assert.equal(warms,1);
 modules.codexPlusStatus=async options=>{force=options.force;return {connected:true};};
 await call('codex.account');assert.equal(force,true);
});
