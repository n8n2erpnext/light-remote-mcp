import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ext=path.join(repo,'extensions/light-remote-lm');
const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.background.service_worker,'background.js');
assert.deepEqual(manifest.host_permissions.sort(),[
  'http://127.0.0.1:5491/*','http://localhost:5491/*'
].sort());
assert.ok(!manifest.permissions.includes('cookies'));
assert.ok(!manifest.permissions.includes('webRequest'));
assert.ok(!manifest.host_permissions.some(host=>host.includes('*://')||host.startsWith('https://')));
const cap=fs.readFileSync(path.join(ext,'capture.js'),'utf8');
const fake=(role,text,parent=null)=>({
  parentElement:parent,
  getAttribute:key=>key==='data-message-author-role'?role:null,
  closest:sel=>sel==='main'?{}:null,
  querySelector:()=>null,
  innerText:text,
  textContent:text
});
const good=vm.runInNewContext(cap,{
  URL,Date,
  location:{href:'https://chatgpt.com/c/123e4567-e89b-12d3-a456-426614174000'},
  document:{querySelectorAll:()=>[fake('user','Please inspect the scope'),fake('assistant','Confirmed scope') ]},
  getComputedStyle:()=>({display:'block',visibility:'visible'})
});
assert.equal(good.ok,true);
assert.equal(good.turns,2);
assert.match(good.text,/USER =====\nPlease inspect the scope/);
assert.match(good.text,/ASSISTANT =====\nConfirmed scope/);
assert.match(good.text,/Only loaded messages are captured/);
const wrong=vm.runInNewContext(cap,{
  URL,Date,
  location:{href:'https://example.org/c/123456789'},
  document:{querySelectorAll:()=>[]}
});
assert.equal(wrong.ok,false);
const background=fs.readFileSync(path.join(ext,'background.js'),'utf8');
let registered=0;
const listeners={};
const chromeMock={
  runtime:{id:'test',onMessage:{addListener:f=>{listeners.message=f;registered++;}}},
  tabs:{onUpdated:{addListener:f=>{listeners.updated=f;registered++;}},
    onRemoved:{addListener:f=>{listeners.removed=f;registered++;}}},
  storage:{session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}}
};
const context=vm.createContext({chrome:chromeMock,URL,TextEncoder,Date,console,setTimeout,location:{},
  document:{},Event});
vm.runInContext(background,context);
assert.equal(registered,3);
assert.equal(vm.runInContext("allowedWall('http://127.0.0.1:5491/long-memory')",context),true);
for(const bad of [
  'http://192.168.0.5:5491/long-memory',
  'https://example.org/long-memory',
  'http://127.0.0.1:5492/long-memory',
  'http://localhost:5491/approve'
])assert.equal(vm.runInContext('allowedWall('+JSON.stringify(bad)+')',context),false,bad);
let submitted=0;
let selected='';
let optin=false;
const nodes={
  goldContextText:{value:'',dispatchEvent:()=>{}},
  goldContextTitle:{value:'',dispatchEvent:()=>{}},
  goldReaderScope:{get value(){return selected;},set value(v){selected=v;}},
  goldModulesPanel:{open:false},
  goldContextCapture:{prepend:()=>{},scrollIntoView:()=>{}}
};
const documentMock={
  getElementById:id=>nodes[id]||null,
  createElement:()=>({setAttribute:()=>{},style:{},textContent:'',id:''})
};
context.document=documentMock;
context.location={protocol:'http:',hostname:'127.0.0.1',port:'5491',pathname:'/long-memory'};
const prepared=await vm.runInContext("prepareWallPage({text:'TEST CHAT',turns:2,capturedAt:'2026-10-29T04:00:00.000Z'})",context);
assert.equal(prepared.ok,true);
assert.equal(nodes.goldContextText.value,'TEST CHAT');
assert.equal(selected,'');
assert.equal(optin,false);
assert.equal(submitted,0);
assert.equal(nodes.goldModulesPanel.open,true);
console.log('Gold Light Remote LM Chrome extension: focused checks PASS (not physical E2E).');
