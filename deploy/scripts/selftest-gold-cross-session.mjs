import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-cross-session-')),file=path.join(dir,'gold-wall-modules.sqlite');
let m=createGoldWallModules({file,scopeIdentity:{accountId:'owner-test',deviceId:'arm-test'}}),wall;
try{
  assert.equal(fs.existsSync(file),false);
  assert.throws(()=>m.handoff(),/gold_module_disabled/);
  m.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  const a=m.saveCheckpoint({kind:'handoff',title:'Restore Gold #486',body:'Gold source pinned to ba579f8. No second Wall.',source:'owner-approved-handoff-session-A'});
  assert.equal(fs.statSync(file+'.checkpoint-key').mode&0o077,0);
  assert.equal(a.version,1);
  assert.equal(m.listCheckpoints().length,1);
  assert.equal(m.readCheckpoint(a.id).integrity,'device_hmac_verified');
  assert.equal(m.handoff().checkpoints[0].body,'Gold source pinned to ba579f8. No second Wall.');
  m.close();
  m=createGoldWallModules({file,scopeIdentity:{accountId:'owner-test',deviceId:'arm-test'}}); // new ChatGPT Web session instance
  const b=m.handoff();
  assert.equal(b.checkpoints[0].id,a.id);
  assert.equal(b.checkpoints[0].signature,a.signature);
  assert.match(b.trust,/not transcript access/);
  const db=m; // check disabled read and owner mode independence
  m.configure({longMemory:false,codexBridge:true,expectedRevision:1});
  assert.throws(()=>m.readCheckpoint(a.id),/gold_module_disabled/);
  assert.throws(()=>m.saveCheckpoint({title:'Unauthorized',body:'X',source:'Y'}),/gold_module_disabled/);
  const t=m.addTask({title:'Verify Codex Bridge'});
  assert.equal(t.state,'todo');
  // Simulate successful Codex receipt from the trusted local invocation boundary.
  // A failed/unverified model completion cannot create this receipt.
  const {createRequire}=await import('node:module');
  const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
  const sqlite=new DatabaseSync(file);
  const {saveGoldObserverReceipt}=await import('../../device-agent/gold-memory-ledger.mjs');
  const row=sqlite.prepare('SELECT id,state,changed_ms AS changedAt FROM observer_tasks WHERE id=?').get(t.id);
  assert.throws(()=>saveGoldObserverReceipt(sqlite,{status:'failed',summary:'No completed response',tasks:[row]}),/gold_observer_receipt_not_completed/);
  const receipt=saveGoldObserverReceipt(sqlite,{status:'completed',summary:'Codex recommends checking status',tasks:[row]});
  sqlite.close();
  assert.equal(m.observer().tasks[0].state,'todo','Codex completion MUST NOT auto-complete');
  assert.equal(m.observerReceipts().length,1);
  assert.throws(()=>m.confirmObserverTask({receiptId:receipt.id,taskId:t.id,toState:'done'}),/gold_observer_owner_confirmation_required/);
  assert.equal(m.confirmObserverTask({receiptId:receipt.id,taskId:t.id,toState:'done',confirm:true}).state,'done');
  assert.equal(m.observer().tasks[0].state,'done');
  assert.throws(()=>m.confirmObserverTask({receiptId:receipt.id,taskId:t.id,toState:'waiting',confirm:true}),/gold_observer_task_changed_since_receipt/);
  m.configure({longMemory:true,codexBridge:true,expectedRevision:2});
  assert.equal(m.handoff().checkpoints[0].id,a.id);
  const auth={enabled:true,identity:r=>r.headers['x-owner']==='yes'?{username:'owner'}:null,csrfForRequest:()=> 'gold-csrf',verifyRequestCsrf:(_r,x)=>x==='gold-csrf'};
  wall=startLocalWall({host:'127.0.0.1',port:0,auth,modules:m,getMemoryAccountDevices:async()=>({currentDeviceId:'arm-test',devices:[{deviceId:'arm-test',displayName:'ARM Home',state:'online',platform:'linux'},{deviceId:'windows-peer',displayName:'Windows Replica',state:'offline',platform:'win32'}]}),getLocalStatus:async()=>({cloudState:'disconnected'})});
  await new Promise((ok,bad)=>wall.server.listening?ok():wall.server.once('listening',ok).once('error',bad));
  const base='http://127.0.0.1:'+wall.server.address().port,owner={'x-owner':'yes'};
  const page=await (await fetch(base+'/',{headers:owner})).text();
  assert.match(page,/goldModulesLiveSummary/);
  assert.match(page,/Signed handoff checkpoints/);
  assert.match(page,/goldPeerAccountDevicesRefresh/);
  assert.match(page,/goldSyncRevoke/);
  assert.doesNotMatch(page,/Home NetBird URL e.g./);
  for(const id of ['goldPeerExportIdentity','goldPeerCopyIdentity','goldPeerCandidate',
    'goldPeerExpectedFingerprint','goldPeerGrant','goldPeerInviteOutput',
    'goldPeerCopyInvite','goldPeerInviteInput','goldPeerHomeFingerprint',
    'goldPeerAccept','goldPeerRevoke','goldPeerOwnerApproval'])
    assert.ok(page.includes('id="'+id+'"'),'Owner pairing control missing: '+id);
  assert.match(page,/I own these devices, checked their fingerprints separately/);
  assert.match(page,/Observer does not change task states/);
  for(const [,js] of page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))if(js.trim())new vm.Script(js);
  assert.equal((await fetch(base+'/api/gold/modules/sync/account-devices')).status,401);
  const directory=await fetch(base+'/api/gold/modules/sync/account-devices',{headers:owner});
  assert.equal(directory.status,200);
  const directoryData=await directory.json();
  assert.deepEqual(directoryData.devices.map(device=>device.deviceId),['arm-test','windows-peer']);
  assert.equal(directoryData.currentDeviceId,'arm-test');
  assert.equal((await fetch(base+'/api/gold/modules/handoff')).status,401);
  const result=await (await fetch(base+'/api/gold/modules/handoff',{headers:owner})).json();
  assert.equal(result.handoff.checkpoints[0].id,a.id);
  const notes=await (await fetch(base+'/api/gold/modules/checkpoints',{headers:owner})).json();
  assert.equal(notes.checkpoints[0].integrity,'device_hmac_verified');
  assert.equal((await fetch(base+'/api/gold/modules/receipts',{headers:owner})).status,200);
  const post=(url,data,headers={'x-owner':'yes','x-light-remote-csrf':'gold-csrf'})=>fetch(base+url,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await post('/api/gold/modules/checkpoint',{title:'Deny',body:'X',source:'Y'},owner)).status,403);
  assert.equal((await post('/api/gold/modules/checkpoint',{title:'Session B',body:'Recovered prior context',source:'owner-confirmed-session-B'})).status,200);
  const scopeCreate=await post('/api/gold/modules/scope',{displayName:'Gold UAT scoped',captureMode:'manual',syncPolicy:'local_only'});
  assert.equal(scopeCreate.status,200);
  const scope=(await scopeCreate.json()).scope;
  const scopes=await (await fetch(base+'/api/gold/modules/scopes',{headers:owner})).json();
  assert.equal(scopes.scopes.some(x=>x.scopeId===scope.scopeId),true);
  assert.equal(scopes.legacyUnassigned,2);
  const badCsrf=await post('/api/gold/modules/scope',{displayName:'Denied'},owner);
  assert.equal(badCsrf.status,403);
  assert.equal((await post('/api/gold/modules/scope/bind',{
    scopeId:scope.scopeId,sourceType:'workspace',sourceId:'/gold/dev',proofType:'owner_explicit'})).status,200);
  const signed=await post('/api/gold/modules/scope/checkpoint',{
    scopeId:scope.scopeId,title:'G1 scoped UI',body:'Isolated project checkpoint',source:'owner-wall',status:'owner_approved'});
  assert.equal(signed.status,200);
  const v2=await (await fetch(base+'/api/gold/modules/scope/handoff?scopeId='+scope.scopeId,{headers:owner})).json();
  assert.equal(v2.handoff.checkpoints[0].integrity,'home_ed25519_verified');
  assert.equal(v2.handoff.checkpoints[0].title,'G1 scoped UI');
  assert.equal(v2.handoff.revision,1);
  const policy=await post('/api/gold/modules/scope/capture',{
    scopeId:scope.scopeId,captureMode:'auto'});
  assert.equal(policy.status,200);
  assert.equal((await policy.json()).policy.captureMode,'auto');
  const pending=await fetch(base+'/api/gold/modules/auto/pending',{headers:owner});
  assert.equal(pending.status,200);
  assert.deepEqual((await pending.json()).pending,[]);
  assert.equal((await post('/api/gold/modules/scope/capture',{
    scopeId:scope.scopeId,captureMode:'invalid'},owner)).status,403);
  const idResponse=await fetch(base+'/api/gold/modules/sync/identity',{headers:owner});
  assert.equal(idResponse.status,200);
  const identity=(await idResponse.json()).identity;
  assert.ok(identity.fingerprint.length>=16);
  assert.ok(identity.signPublicKey.length>32&&identity.encPublicKey.length>32);
  const statusResponse=await fetch(base+'/api/gold/modules/scope/sync/status?scopeId='+scope.scopeId,{headers:owner});
  assert.equal(statusResponse.status,200);
  assert.equal((await statusResponse.json()).sync.syncPolicy,'local_only');
  const noCsrf=await post('/api/gold/modules/scope/sync/policy',{
    scopeId:scope.scopeId,syncPolicy:'selected_devices'},owner);
  assert.equal(noCsrf.status,403);
  assert.equal((await post('/api/gold/modules/scope/sync/policy',{
    scopeId:scope.scopeId,syncPolicy:'selected_devices'})).status,200);
  const peer={...identity,deviceId:'other-approved-device'};
  const denied=await post('/api/gold/modules/scope/sync/grant',{
    scopeId:scope.scopeId,peer,expectedFingerprint:identity.fingerprint});
  assert.equal(denied.status,403,'sync grant requires owner confirmation, not just CSRF');
  const routeWithoutCsrf=await post('/api/gold/modules/scope/sync/route',{
    scopeId:scope.scopeId,homeUrl:'http://100.94.184.141:5591',enabled:true},owner);
  assert.equal(routeWithoutCsrf.status,403);
  const anonymousPeer=await fetch(base+'/api/gold/peer/v1',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({malformed:true})});
  assert.equal(anonymousPeer.status,403);
  console.log('GOLD_G3_PEER_ROUTE_OWNER_CSRF_AND_ANONYMOUS_SIGNED_GATE_PASS');
  console.log('GOLD_G3_SCOPED_OWNER_SYNC_IDENTITY_POLICY_AND_GRANT_CONFIRM_PASS');
  console.log('GOLD_G2_SCOPED_OWNER_CAPTURE_MODE_CSRF_PASS');
  console.log('GOLD_G1_OWNER_SCOPED_WALL_CSRF_HANDOFF_PASS');
  console.log('GOLD_MEMORY_SESSION_A_TO_B_SIGNED_LOCAL_CHECKPOINT_PASS');
  const e2eFile=path.join(dir,'codex-linked.sqlite');
  let calls=0;
  const linked=createGoldWallModules({file:e2eFile,plusImpl:{
    runReadOnly:async({tasks})=>{calls++;assert.equal(tasks.length,1);return {status:'completed',completed:true,summary:'Owner should review then mark task done.'};},
    account:async()=>({connected:true,authMode:'chatgpt',plan:'plus'}),
    stop(){}
  }});
  try{
    linked.configure({longMemory:false,codexBridge:true,expectedRevision:0});
    const task=linked.addTask({title:'Owner review needed'});
    const result=await linked.codexPlusObserve();
    assert.equal(calls,1);
    assert.equal(result.completed,true);
    assert.equal(result.receipt.requiresOwnerReview,true);
    assert.equal(result.taskStateChanged,false);
    assert.equal(linked.observer().tasks[0].state,'todo');
    const reviewed=linked.confirmObserverTask({receiptId:result.receipt.id,taskId:task.id,toState:'done',confirm:true});
    assert.equal(reviewed.approvedBy,'owner_explicit');
    assert.equal(linked.observer().tasks[0].state,'done');
  }finally{linked.close();}
  console.log('GOLD_CODEX_REAL_METHOD_TO_RECEIPT_NO_AUTO_STATE_CHANGE_PASS');
  console.log('GOLD_CODEX_OBSERVER_RECEIPT_MANUAL_APPROVAL_CAS_PASS');
  console.log('GOLD_WALL_OWNER_AUTH_CSRF_AND_NO_AUTO_TASK_UPDATE_PASS');
}finally{
 if(wall)await wall.close();
 m.close();
 fs.rmSync(dir,{recursive:true,force:true});
}
