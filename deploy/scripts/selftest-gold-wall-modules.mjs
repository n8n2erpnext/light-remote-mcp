import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-wall-new-modules-'));
const file=path.join(root,'private','gold-wall-modules.sqlite');
let modules=createGoldWallModules({file});
let wall=null;
try {
  assert.deepEqual(modules.flags(),{longMemory:false,codexBridge:false,revision:0});
  assert.equal(fs.existsSync(file),false,'OFF/OFF must not create SQLite');
  assert.deepEqual(modules.configure({longMemory:false,codexBridge:false,expectedRevision:0}),modules.flags());
  assert.equal(fs.existsSync(file),false,'OFF/OFF should not write to disk');
  assert.throws(()=>modules.saveNote({body:'x',source:'y'}),/gold_module_disabled/);
  assert.throws(()=>modules.addTask({title:'x'}),/gold_module_disabled/);

  const auth={
    enabled:true,
    identity:req=>req.headers['x-test-owner']==='yes'?{username:'existing-gold-owner'}:null,
    csrfForRequest:()=> 'test-csrf',
    verifyRequestCsrf:(_req,value)=>value==='test-csrf'
  };
  wall=startLocalWall({host:'127.0.0.1',port:0,auth,modules,
    getLocalStatus:async()=>({deviceName:'Test Gold',cloudState:'disconnected'})});
  await new Promise((resolve,reject)=>wall.server.listening?resolve():wall.server.once('listening',resolve).once('error',reject));
  const base='http://127.0.0.1:'+wall.server.address().port;
  const owner={'x-test-owner':'yes'};
  const post=(url,data,headers={'x-test-owner':'yes','x-light-remote-csrf':'test-csrf'})=>
    fetch(base+url,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(data)});
  const nonOwner=await fetch(base+'/api/gold/modules');
  assert.equal(nonOwner.status,401,'Gold identity gate should reject missing auth');
  const empty=await fetch(base+'/api/gold/modules',{headers:owner});
  assert.equal(empty.status,200);
  assert.deepEqual((await empty.json()).modules,{longMemory:false,codexBridge:false,revision:0});
  const denied=await post('/api/gold/modules/configure',{longMemory:true,codexBridge:false,expectedRevision:0},{'x-test-owner':'yes'});
  assert.equal(denied.status,403,'CSRF is required');
  const invalid=await post('/api/gold/modules/configure',{longMemory:'yes',codexBridge:false,expectedRevision:0});
  assert.equal(invalid.status,400);
  let config=await post('/api/gold/modules/configure',{longMemory:true,codexBridge:false,expectedRevision:0});
  assert.equal(config.status,200,'Memory-only activation');
  assert.equal(fs.statSync(file).mode&0o077,0,'local SQLite must not be world-readable');
  assert.equal(modules.flags().longMemory,true);
  assert.equal(modules.flags().codexBridge,false);
  assert.equal((await post('/api/gold/modules/task',{title:'not allowed'})).status,409,'Codex-only task access denied');
  let saved=await post('/api/gold/modules/memory',{kind:'decision',body:'Keep Gold #486 filesystem scopes',source:'owner-verified-test'});
  assert.equal(saved.status,200);
  let notes=await (await fetch(base+'/api/gold/modules/memory?query=filesystem',{headers:owner})).json();
  assert.equal(notes.notes.length,1);
  assert.match(notes.notes[0].body,/filesystem/);
  assert.equal((await post('/api/gold/modules/configure',{longMemory:false,codexBridge:true,expectedRevision:1})).status,200);
  assert.equal((await fetch(base+'/api/gold/modules/memory',{headers:owner})).status,409,'Memory disabled must not expose saved notes');
  assert.equal((await post('/api/gold/modules/task',{title:'Owner-visible Gold checkpoint'})).status,200);
  let observer=await (await fetch(base+'/api/gold/modules/observer',{headers:owner})).json();
  assert.equal(observer.observer.recommendation,'CONTINUE');
  assert.equal(observer.observer.codexRuntime,'not_connected');
  assert.equal(observer.observer.webTurnContinuation,'unsupported');
  const id=observer.observer.tasks[0].id;
  assert.equal((await post('/api/gold/modules/task/state',{id,state:'waiting'})).status,200);
  observer=await (await fetch(base+'/api/gold/modules/observer',{headers:owner})).json();
  assert.equal(observer.observer.recommendation,'WAIT_OWNER');
  assert.equal((await post('/api/gold/modules/configure',{longMemory:true,codexBridge:true,expectedRevision:2})).status,200);
  assert.equal((await post('/api/gold/modules/configure',{longMemory:true,codexBridge:true,expectedRevision:2})).status,409,'revision rejects stale writes');

  const wallHtml=await (await fetch(base+'/',{headers:owner})).text();
  assert.match(wallHtml,/id="goldModulesPanel"/);
  assert.match(wallHtml,/id="goldLongMemory"/);
  assert.match(wallHtml,/id="goldCodexBridge"/);
  assert.match(wallHtml,/Agent A\/B access/);
  assert.doesNotMatch(wallHtml,/href="\/projects"/);
  const scripts=[...wallHtml.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)];
  for(const script of scripts)if(script[1]?.trim())new vm.Script(script[1],{filename:'GoldWallBrowserUI.js'});
  const permissions=await (await fetch(base+'/permissions',{headers:owner})).text();
  assert.match(permissions,/Filesystem access locations/);
  assert.match(permissions,/fs-read-roots/);
  assert.match(permissions,/fs-write-roots/);
  console.log('GOLD_SINGLE_WALL_UI_AND_PERMISSIONS_PRESERVED_PASS');

  await wall.close();wall=null;modules.close();
  modules=createGoldWallModules({file});
  assert.deepEqual(modules.flags(),{longMemory:true,codexBridge:true,revision:3});
  assert.equal(modules.notes().length,1,'Memory persisted after restart');
  assert.equal(modules.observer().tasks.length,1,'Controller persisted after restart');
  modules.configure({longMemory:false,codexBridge:false,expectedRevision:3});
  assert.throws(()=>modules.notes(),/gold_module_disabled/);
  assert.throws(()=>modules.observer(),/gold_module_disabled/);
  assert.equal(fs.statSync(file).size>0,true);
  console.log('GOLD_LOCAL_SQLITE_MEMORY_OBSERVER_FOUR_MODES_PASS');
}finally{
  if(wall)await wall.close();
  modules.close();
  fs.rmSync(root,{recursive:true,force:true});
}
