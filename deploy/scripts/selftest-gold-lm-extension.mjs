import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash, webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ext=path.join(repo,'extensions/light-remote-lm');
const read=name=>fs.readFileSync(path.join(ext,name),'utf8');
const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.version,'0.2.0');
assert.equal(manifest.background.service_worker,'background.js');
assert.deepEqual(manifest.host_permissions.slice().sort(),[
  'http://127.0.0.1:5491/*','http://localhost:5491/*'
].sort());
assert.ok(!manifest.permissions.includes('cookies'));
assert.ok(!manifest.permissions.includes('webRequest'));
assert.ok(!manifest.host_permissions.some(host=>host.includes('*://')||host.startsWith('https://')));
const html=read('popup.html');
assert.ok(html.indexOf('src="capture.js"') < html.indexOf('src="popup.js"'));

const captureJs=read('capture.js');
let firstMessage='Please inspect the scope';
let assistantMessage='Unicode: ' + 'ạ😀'.repeat(3500);
function fake(role,readText) {
  return {
    parentElement:null,
    getAttribute:key=>key==='data-message-author-role'?role:null,
    closest:selector=>selector==='main'?{}:null,
    querySelector:()=>null,
    get innerText(){return readText();},
    get textContent(){return readText();}
  };
}
const nodes=[fake('user',()=>firstMessage),fake('assistant',()=>assistantMessage)];
const captureContext=vm.createContext({
  URL,Date,TextEncoder,TextDecoder,crypto:webcrypto,
  location:{href:'https://chatgpt.com/c/123e4567-e89b-12d3-a456-426614174000'},
  document:{querySelectorAll:()=>nodes},
  getComputedStyle:()=>({display:'block',visibility:'visible'})
});
vm.runInContext(captureJs,captureContext);
const call=async args=>await vm.runInContext(
  'lightRemoteLmCaptureSegment('+JSON.stringify(args)+')',captureContext);
const first=await call({offset:0,maxBytes:4096});
assert.equal(first.ok,true);
assert.equal(first.turns,2);
assert.equal(first.complete,false);
assert.equal(first.coverage,'loaded_dom_only');
assert.match(first.chunk,/USER =====\nPlease inspect the scope/);
let bytes=Buffer.from(first.chunk,'utf8');
let cursor=first.nextOffset;
while(cursor!==null) {
  const page=await call({offset:cursor,expectedSha256:first.sha256,maxBytes:4096});
  assert.equal(page.ok,true);
  assert.equal(page.offset,cursor);
  bytes=Buffer.concat([bytes,Buffer.from(page.chunk,'utf8')]);
  cursor=page.nextOffset;
}
assert.equal(bytes.byteLength,first.totalBytes);
assert.equal(createHash('sha256').update(bytes).digest('hex'),first.sha256);
assert.match(bytes.toString('utf8'),/ASSISTANT =====\nUnicode: /);
assistantMessage+=' updated';
const stale=await call({offset:first.nextOffset,expectedSha256:first.sha256,maxBytes:4096});
assert.equal(stale.ok,false);
assert.equal(stale.stale,true);
assert.equal(stale.chunk,undefined);
captureContext.location.href='https://not-chatgpt.example/c/123456789';
const wrong=await call({offset:0,maxBytes:4096});
assert.equal(wrong.ok,false);

const popupJs=read('popup.js');
assert.match(popupJs,/lightRemoteLmCaptureSegment/);
assert.match(popupJs,/SHA-256 verification failed/);
assert.match(popupJs,/same visible transcript|Same visible transcript/);
assert.match(popupJs,/Loaded turns|loaded messages/);
const background=read('background.js');
let registered=0;
const listeners={};
const chromeMock={
  runtime:{id:'test',onMessage:{addListener:fn=>{listeners.message=fn;registered++;}}},
  tabs:{onUpdated:{addListener:fn=>{listeners.updated=fn;registered++;}},
    onRemoved:{addListener:fn=>{listeners.removed=fn;registered++;}}},
  storage:{session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}}
};
const context=vm.createContext({chrome:chromeMock,URL,TextEncoder,Date,console,setTimeout,
  location:{},document:{},Event});
vm.runInContext(background,context);
assert.equal(registered,3);
assert.equal(vm.runInContext("allowedWall('http://127.0.0.1:5491/long-memory')",context),true);
for(const bad of [
  'http://192.168.0.5:5491/long-memory',
  'https://example.org/long-memory',
  'http://127.0.0.1:5492/long-memory',
  'http://localhost:5491/approve'
])assert.equal(vm.runInContext('allowedWall('+JSON.stringify(bad)+')',context),false,bad);

let selected='', saved=0, optedIn=false;
const nodesWall={
  goldContextText:{value:'',dispatchEvent:()=>{}},
  goldContextTitle:{value:'',dispatchEvent:()=>{}},
  goldReaderScope:{get value(){return selected;},set value(v){selected=v;}},
  goldModulesPanel:{open:false},
  goldContextCapture:{prepend:()=>{},scrollIntoView:()=>{}}
};
context.document={
  getElementById:id=>nodesWall[id]||null,
  createElement:()=>({setAttribute:()=>{},style:{},textContent:'',id:''})
};
context.location={protocol:'http:',hostname:'127.0.0.1',port:'5491',pathname:'/long-memory'};
const prepared=await vm.runInContext(
  "prepareWallPage({text:'TEST CHAT',turns:2,capturedAt:'2026-10-29T04:00:00.000Z'})",context);
assert.equal(prepared.ok,true);
assert.equal(nodesWall.goldContextText.value,'TEST CHAT');
assert.equal(selected,'');
assert.equal(optedIn,false);
assert.equal(saved,0);
assert.equal(nodesWall.goldModulesPanel.open,true);
console.log('Light Remote LM v0.2: chunk cursor, SHA-256 stale detection, manual Wall staging PASS (not physical Chrome E2E).');
