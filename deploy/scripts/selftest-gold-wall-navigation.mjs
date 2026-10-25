import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-gold-route-nav-'));
const m=createGoldWallModules({file:path.join(dir,'modules.sqlite'),
  scopeIdentity:{accountId:'owner-a',deviceId:'device-a'}});
let wall=null;
try{
  m.configure({longMemory:true,codexBridge:true,expectedRevision:0});
  const auth={enabled:true,identity:req=>req.headers['x-test-owner']==='yes'?{username:'owner'}:null,
    csrfForRequest:()=> 'testing-csrf',verifyRequestCsrf:(_r,c)=>c==='testing-csrf'};
  wall=startLocalWall({host:'127.0.0.1',port:0,auth,modules:m,
    getLocalStatus:async()=>({deviceName:'Gold QA',cloudState:'connected'})});
  await new Promise((ok,bad)=>wall.server.listening?ok():wall.server.once('listening',ok).once('error',bad));
  const base='http://127.0.0.1:'+wall.server.address().port;
  for(const [route,tag] of [['/','home'],['/long-memory','memory'],['/codex-cli','codex']]){
    const denied=await fetch(base+route,{redirect:'manual'});
    assert.equal(denied.status,303,route+' requires owner authentication');
    const response=await fetch(base+route,{headers:{'x-test-owner':'yes'}});
    assert.equal(response.status,200);
    const html=await response.text();
    assert.ok(html.includes('class="wall-view-'+tag+'"'));
    assert.ok(html.includes('href="/long-memory"'));
    assert.ok(html.includes('href="/codex-cli"'));
    assert.ok(html.includes('id="navMemoryState"'));
    assert.ok(html.includes('id="navCodexState"'));
    assert.ok(html.includes('href="/permissions"'),route);
    assert.ok(!html.includes('fonts.googleapis.com'),route);
    assert.ok(!html.includes('fonts.gstatic.com'),route);
    if(tag==='home'){
      assert.ok(html.includes('body.wall-view-home #goldModulesPanel{display:none}'));
    }else{
      assert.ok(html.includes('<details open id="goldModulesPanel"'));
      assert.ok(html.includes('body.wall-view-'+tag+' .wall-primary'));
    }
    for(const [index,s] of [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].entries())
      if(s[1]?.trim())new vm.Script(s[1],{filename:tag+'-'+index+'.js'});
  }
  const settings=await fetch(base+'/settings',{headers:{'x-test-owner':'yes'}});
  assert.equal(settings.status,200);
  const html=await settings.text();
  assert.ok(html.includes('name="memoryDeleteScope" value="local" checked'));
  assert.ok(html.includes('name="memoryDeleteScope" value="account" disabled'));
  assert.ok(html.includes('id="memoryDeleteLocal"'));
  for(const script of html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g))
    if(script[1]?.trim())new vm.Script(script[1],{filename:'settings-memory.js'});
  console.log('GOLD_WALL_COMPACT_PROFILE_MODULE_ROUTES_LOCAL_MATERIAL_ICONS_SETTINGS_PASS');
}finally{if(wall)await wall.close();m.close();fs.rmSync(dir,{recursive:true,force:true});}
