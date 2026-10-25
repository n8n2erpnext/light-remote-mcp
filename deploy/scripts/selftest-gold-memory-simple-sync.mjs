import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-simple-sync-'));
const accountId='owner:gold',deviceId='home-arm',replicaId='replica-win';
const home=createGoldWallModules({file:path.join(root,'home.sqlite'),scopeIdentity:{accountId,deviceId}});
const replica=createGoldWallModules({file:path.join(root,'replica.sqlite'),scopeIdentity:{accountId,deviceId:replicaId}});
let wall;
try{
 home.configure({longMemory:true,codexBridge:false,expectedRevision:0});
 replica.configure({longMemory:true,codexBridge:false,expectedRevision:0});
 const scope=home.createMemoryScope({displayName:'Scope A'});
 assert.equal(scope.syncPolicy,'local_only');
 assert.deepEqual(home.deviceSyncSelection().selectedDeviceIds,[]);
 assert.equal(home.deviceSyncSelection().enabled,false);
 assert.equal(home.deviceSyncSelection().receiveBlocked,false);
 assert.throws(()=>home.setDeviceSyncSelection({enabled:true,selectedDeviceIds:[deviceId]}),
  /gold_sync_selection_invalid/);
 assert.throws(()=>home.setDeviceSyncSelection({enabled:true,selectedDeviceIds:[replicaId,replicaId]}),
  /gold_sync_selection_invalid/);
 const auth={enabled:true,identity:req=>req.headers['x-test-owner']==='yes'?{username:'owner'}:null,
  csrfForRequest:()=> 'ok-csrf',verifyRequestCsrf:(_req,token)=>token==='ok-csrf'};
 wall=startLocalWall({host:'127.0.0.1',port:0,modules:home,auth,
  getMemoryAccountDevices:async()=>({
   currentDeviceId:deviceId,devices:[
    {deviceId,displayName:'ARM',state:'online',memoryIdentity:home.syncIdentity()},
    {deviceId:replicaId,displayName:'Windows',state:'online',memoryIdentity:replica.syncIdentity()}
   ]
  }),
  getLocalStatus:async()=>({cloudState:'disconnected'})});
 await new Promise((resolve,reject)=>wall.server.listening?resolve():
  wall.server.once('listening',resolve).once('error',reject));
 const base='http://127.0.0.1:'+wall.server.address().port,owner={'x-test-owner':'yes'};
 const page=await (await fetch(base+'/',{headers:owner})).text();
 assert.match(page,/id="goldSimpleSyncEnabled"/);
 assert.match(page,/id="goldSimpleSyncDevices"/);
 for(const [,js] of page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))
   if(js.trim())new vm.Script(js);
 assert.equal((await fetch(base+'/api/gold/modules/sync/selection')).status,401);
 const post=(data,headers={'x-test-owner':'yes','x-light-remote-csrf':'ok-csrf'})=>
  fetch(base+'/api/gold/modules/sync/selection',{
   method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
 assert.equal((await post({enabled:true,selectedDeviceIds:[replicaId]},owner)).status,403);
 assert.equal((await post({enabled:true,selectedDeviceIds:['other-account-device']})).status,403);
 const started=await post({enabled:true,selectedDeviceIds:[replicaId]});
 assert.equal(started.status,200);
 assert.deepEqual((await started.json()).selection.selectedDeviceIds,[replicaId]);
 assert.equal(home.listMemoryScopes().find(s=>s.scopeId===scope.scopeId).syncPolicy,'selected_devices');
 const another=home.createMemoryScope({displayName:'Second Home scope'});
 assert.equal(another.syncPolicy,'selected_devices');
 const h=home.syncIdentity(),r=replica.syncIdentity();
 home.grantSyncReplica({scopeId:scope.scopeId,peer:r,expectedFingerprint:r.fingerprint,ownerConfirmed:true});
 assert.equal(home.deviceSyncOverview().devices[replicaId],'pending');
 const stopped=await post({enabled:false,selectedDeviceIds:[replicaId]});
 assert.equal(stopped.status,200);
 assert.equal(home.deviceSyncSelection().receiveBlocked,true);
 assert.equal(home.listMemoryScopes().find(s=>s.scopeId===scope.scopeId).syncPolicy,'local_only');
 assert.equal(home.syncStatus({scopeId:scope.scopeId}).peers.find(x=>x.deviceId===replicaId).revokedAt!==null,true);
 assert.equal(home.deviceSyncOverview().devices[replicaId],'off');
 const reselected=await post({enabled:true,selectedDeviceIds:[]});
 assert.equal(reselected.status,200);
 assert.deepEqual(home.deviceSyncSelection().selectedDeviceIds,[]);
 assert.equal(home.deviceSyncSelection().receiveBlocked,false);
 assert.equal(home.listMemoryScopes().find(s=>s.scopeId===another.scopeId).syncPolicy,'selected_devices');
 assert.equal(home.deviceSyncOverview().homeScopeCount,2);
 console.log('GOLD_ACCOUNT_SYNC_SWITCH_CHECKBOX_SCOPE_REVOKE_OWNER_CSRF_PASS');
}finally{
 try{wall?.server?.close()}catch{}
 home.close();replica.close();fs.rmSync(root,{recursive:true,force:true});
}
