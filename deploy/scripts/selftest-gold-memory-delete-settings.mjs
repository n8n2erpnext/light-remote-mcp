import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'gold-memory-delete-'));
const file=path.join(home,'modules.sqlite');
const modules=createGoldWallModules({file,scopeIdentity:{accountId:'acct-a',deviceId:'device-owner'}});
let wall=null;
try{
  modules.configure({longMemory:true,codexBridge:true,expectedRevision:0});
  const scope=modules.createMemoryScope({displayName:'Gold Scope'});
  modules.appendScopedCheckpoint({scopeId:scope.scopeId,title:'Test private checkpoint',body:'Checkpoint sensitive text',source:'owner'});
  modules.saveNote({kind:'note',body:'Local owner memory',source:'owner'});
  modules.saveCheckpoint({title:'Legacy secret',body:'old record',kind:'checkpoint',source:'owner'});
  modules.addTask({title:'Codex task must survive'});
  const before=modules.localMemoryDeletePreview();
  assert.ok(before.totalRows>3);
  const auth={enabled:true,identity:req=>req.headers['x-test-owner']==='yes'?{username:'owner'}:null,
    csrfForRequest:()=> 'test-csrf',verifyRequestCsrf:(_req,c)=>c==='test-csrf'};
  let selected=true;
  wall=startLocalWall({host:'127.0.0.1',port:0,auth,modules,
    getLocalStatus:async()=>({deviceName:'Test',cloudState:'disconnected'}),
    getMemoryAccountDevices:async()=>({currentDeviceId:'device-owner',devices:[{deviceId:'device-owner',state:'online'}]}),
    getMemoryAccountSyncPolicy:async()=>({policy:{enabled:true,devices:[{deviceId:'device-owner',selected}]}})});
  await new Promise((ok,err)=>wall.server.listening?ok():wall.server.once('listening',ok).once('error',err));
  const base='http://127.0.0.1:'+wall.server.address().port,url='/api/gold/modules/memory/delete/';
  const post=(route,body,headers={'x-test-owner':'yes','x-light-remote-csrf':'test-csrf'})=>
    fetch(base+url+route,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await fetch(base+url+'preview')).status,401);
  assert.equal((await fetch(base+url+'preview',{headers:{'x-test-owner':'yes'}})).status,200);
  assert.equal((await post('local',{confirmText:'DELETE LOCAL MEMORY'},{'x-test-owner':'yes'})).status,403);
  assert.equal((await post('local',{confirmText:'wrong'})).status,400);
  assert.equal((await post('local',{confirmText:'DELETE LOCAL MEMORY'})).status,409,'sync active: delete must fail');
  assert.equal(modules.localMemoryDeletePreview().totalRows,before.totalRows);
  assert.equal((await post('account',{confirmText:'DELETE ALL ACCOUNT MEMORY'})).status,501,'no fake cloud-wide deletion');
  selected=false;
  const r=await post('local',{confirmText:'DELETE LOCAL MEMORY'});
  assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
  const result=(await r.json()).result;
  assert.equal(result.deleted,true);
  assert.equal(result.localFence,true);
  assert.equal(modules.localMemoryDeletePreview().totalRows,0,'all local memory content purged');
  assert.equal(modules.notes().length,0);
  assert.equal(modules.listMemoryScopes().length,0);
  assert.equal(modules.observer().tasks.length,1,'Codex Task Controller preserved');
  assert.equal(modules.flags().longMemory,true);
  console.log('GOLD_MEMORY_LOCAL_DELETE_OWNER_CSRF_SYNC_FENCE_AND_ACCOUNT_FAIL_CLOSED_PASS');
}finally{if(wall)await wall.close();modules.close();fs.rmSync(home,{recursive:true,force:true});}
