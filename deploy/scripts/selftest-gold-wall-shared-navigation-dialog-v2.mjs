import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {WALL_NATIVE_DIALOG_SCRIPT,WALL_NATIVE_DIALOG_MARKUP} from '../../device-agent/wall-ui-refinement.mjs';

const preview=readFileSync(new URL('../../device-agent/wall-ab-v2-preview.mjs',import.meta.url),'utf8');
assert.doesNotMatch(preview,/window\.confirm\(/);
assert.match(preview,/await window\.lrWebConfirm/);
assert.match(preview,/row\.aCode/);
assert.match(preview,/expiresNode\.dataset\.phase/);
assert.match(WALL_NATIVE_DIALOG_MARKUP,/<dialog /);
new vm.Script(WALL_NATIVE_DIALOG_SCRIPT);
let wall;
try{
 wall=startLocalWall({host:'127.0.0.1',port:0,modules:null,auth:{
   enabled:true,identity:()=>({username:'owner@example.invalid'}),csrfForRequest:()=> 'sample-csrf',
   verifyRequestCsrf:()=>true
 },getLocalStatus:async()=>({ok:true,cloudDesiredConnected:false,cloudState:'dormant',deviceName:'test'}),
 getRemoteStatus:async()=>({ok:false,error:'offline'})});
 if(!wall.server.listening)await new Promise((resolve,reject)=>wall.server.once('listening',resolve).once('error',reject));
 const root='http://127.0.0.1:'+wall.server.address().port;
 for(const path of ['/','/long-memory','/codex-cli','/approve','/permissions','/settings']){
  const res=await fetch(root+path,{headers:{'x-test-owner':'owner'}});
  assert.equal(res.status,200,path);
  const html=await res.text();
  assert.match(html,/id="wallSidebar"/,path);
  assert.match(html,/id="sidebarToggle"/,path);
  assert.match(html,/href="\/"[^>]*title="Wall"|title="Wall"[^>]*href="\//,path);
  assert.match(html,/href="\/permissions"/,path);
  assert.match(html,/href="\/approve"/,path);
  assert.match(html,/href="\/settings"/,path);
  assert.doesNotMatch(html,/window\.confirm\(/,path);
  assert.match(html,/wall-sidebar-collapsed/,path);
  if(['/','/long-memory','/codex-cli'].includes(path)){
   assert.match(html,/id="abV2AValue"/);
   assert.match(html,/Short ID \(Device ID\)/);
   assert.match(html,/class="wall-brand-status"/);
   assert.match(html,/className='ab-grant-grid'/);
   assert.match(html,/abV2PendingAValue=/);
   assert.match(html,/Pending approval/);
   assert.match(html,/data-wall-current="true"/);
  }else{
   assert.match(html,/id="wallNativeConfirm"/);
   assert.match(html,/window\.lrWebConfirm=/);
   assert.match(html,/class="wall-subpage/);
   assert.doesNotMatch(html,/href="\/">Back to Wall<\/a>/);
  }
  for(const script of html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)){
   if(script[1].trim())new vm.Script(script[1],{filename:path+'-html-script.js'});
  }
  console.log(path+' NAVIGATION_RENDER_PASS');
 }
 console.log('GOLD_ABV2_ALL_PAGES_SIDEBAR_SIGNED_A_WEB_CONFIRM_AND_TIMERS=PASS');
}finally{if(wall)await wall.close();}
