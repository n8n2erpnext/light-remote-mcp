import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
const source=readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8');
assert.match(source,/new Terminal\(\{disableStdin:true/);
assert.match(source,/term\?\.write\(String\(out\.text\)\)/);
assert.doesNotMatch(source,/function ptyPlain\(/);
assert.match(source,/const candidate=sorted\.find\(t=>t\.state==='running'\)\|\|sorted\[0\]/);
assert.match(source,/ptyPull\(\);},500/);
assert.match(source,/ptyRevision/);
assert.match(source,/ptyListTimer/);
const vendor=readFileSync(new URL('../../assets/vendor/xterm/xterm.js',import.meta.url),'utf8');
const fit=readFileSync(new URL('../../assets/vendor/xterm/addon-fit.js',import.meta.url),'utf8');
assert.ok(vendor.length>100000 && fit.length>300);
assert.ok(readFileSync(new URL('../../assets/vendor/xterm/LICENSE',import.meta.url),'utf8').includes('Permission is hereby granted'));
new vm.Script(vendor);new vm.Script(fit);
let wall;
try{
 wall=startLocalWall({host:'127.0.0.1',port:0,modules:null,auth:{enabled:true,identity:()=>({username:'owner@example.invalid'}),csrfForRequest:()=> 'test-csrf'},getLocalStatus:async()=>({deviceName:'fixture',cloudDesiredConnected:false,cloudState:'dormant'}),getRemoteStatus:async()=>({ok:false,error:'offline'})});
 if(!wall.server.listening)await new Promise((resolve,reject)=>wall.server.once('listening',resolve).once('error',reject));
 const base='http://127.0.0.1:'+wall.server.address().port;
 for(const [asset,type] of [['xterm.js','javascript'],['addon-fit.js','javascript'],['xterm.css','css']]){
  const response=await fetch(base+'/assets/vendor/xterm/'+asset);
  assert.equal(response.status,200,asset);
  assert.match(response.headers.get('content-type'),new RegExp(type),asset);
  assert.ok((await response.text()).length>100,asset);
 }
 const paths=['/','/long-memory','/codex-cli','/settings','/permissions','/approve'];
 for(const path of paths){
  const r=await fetch(base+path);
  assert.equal(r.status,200,path);
  const csp=r.headers.get('content-security-policy');
  assert.ok(csp?.includes("script-src 'self' 'unsafe-inline'"),path+' self-hosted scripts allowed');
  assert.ok(csp?.includes("style-src 'self' 'unsafe-inline'"),path+' self-hosted style allowed');
  assert.ok(csp?.includes("frame-ancestors 'none'"),path+' anti-framing policy kept');
  const html=await r.text();
  assert.doesNotMatch(html,/id="backToWall"/,path);
  assert.match(html,/title="Wall"/,path+' sidebar available');
  if(path==='/'){
   assert.match(html,/assets\/vendor\/xterm\/xterm\.js/);
   assert.match(html,/id="ptyOutput" class="pty-screen"/);
   assert.doesNotMatch(html,/Output hidden until a terminal is selected/);
   assert.match(html,/ptyRenderer\(\)/);
  }else if(['/settings','/permissions','/approve'].includes(path)){
   assert.match(html,/body\.wall-subpage \.wrap\{width:auto;max-width:none!important/);
   assert.doesNotMatch(html,/>Back to Wall</);
  }
  for(const match of html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
 }
 console.log('GOLD_ABV2_PTY_XTERM_SELF_HOSTED_AUTO_SELECT_500MS_READ_ONLY_AND_WIDE_PAGES_PASS');
}finally{if(wall)await wall.close()}
