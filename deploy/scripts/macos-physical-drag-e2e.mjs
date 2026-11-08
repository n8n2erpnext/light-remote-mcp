#!/usr/bin/env node
// Mac owner GUI-only drag E2E against a dedicated, temporary native window.
// Never sends input unless the canary is the verified foreground app.
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

const sock=process.argv[2],dragCanary=process.argv[3];
assert.ok(sock?.startsWith('/tmp/lightremote-rmv2-')&&sock.endsWith('.sock'));
assert.ok(dragCanary?.endsWith('/LightRemoteDragCanary'));
const runId=crypto.randomBytes(6).toString('hex');
const statePath='/tmp/lightremote-drag-'+runId+'.json';
let child,client,buffer='',idCounter=0;
const pending=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(){
 for(let i=0;i<60;i++){
  try {client=await new Promise((res,rej)=>{const s=net.createConnection(sock);
   s.once('connect',()=>res(s));s.once('error',rej);});return;}
  catch(e){if(i===59)throw e;await sleep(100);}
 }
}
function onData(chunk){
 buffer+=chunk;
 while(buffer.includes('\n')){
  const pos=buffer.indexOf('\n'),line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);
  if(!line)continue;let msg=JSON.parse(line);if(msg.type!=='response')continue;
  const p=pending.get(msg.id);if(!p)continue;clearTimeout(p.timer);pending.delete(msg.id);
  if(msg.ok===false)p.reject(new Error(String(msg.error||'helper_error')));else p.resolve(msg.data);
 }
}
function req(op,args={}){
 return new Promise((resolve,reject)=>{
  const id='drag_'+(++idCounter);
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error(op+'_timeout'));},9500);
  pending.set(id,{resolve,reject,timer});
  client.write(JSON.stringify({id,op,...args})+'\n');
 });
}
function getState(){try{return JSON.parse(fs.readFileSync(statePath,'utf8'));}catch{return null;}}
async function main(){
 await connect();client.setEncoding('utf8');client.on('data',onData);
 const status=await req('desktop.status');
 assert.equal(status.accessibility,true);assert.equal(status.screenRecording,true);
 child=spawn(dragCanary,[statePath],{stdio:'ignore'});
 let ready=null;
 for(let i=0;i<60;i++){
  ready=getState();
  if(ready?.state==='READY')break;
  await sleep(125);
 }
 assert.equal(ready?.state,'READY','native drag test window failed to open');
 const win=(await req('desktop.windows',{maxWindows:100})).find(w=>w.title==='LightRemoteDragCanary');
 assert.equal(win?.processId,ready.pid,'unexpected drag test window owner');
 const sem=await req('desktop.semantic.attach',{scope:'foreground',maxDepth:3,maxNodes:80});
 try {assert.ok(String(sem.rootTitle).includes('LightRemoteDragCanary'),'test is not the foreground app')}
 finally{await req('desktop.semantic.detach',{semanticSessionId:sem.semanticSessionId});}
 console.log('isolated_native_drag_window=PASS');
 const vis=await req('desktop.visual.attach',{screen:0,leaseMs:20000,maxWidth:640,maxHeight:360,quality:40});
 assert.equal(vis.cursorOverlayActive,true);
 try{
  const topo=(await req('desktop.status')).topology;
  const locate=p=>{
   const sc=topo.screens.find(s=>p.x>=s.bounds.x&&p.x<s.bounds.x+s.bounds.width&&p.y>=s.bounds.y&&p.y<s.bounds.y+s.bounds.height);
   assert.ok(sc,'drag coordinate not on connected display');
   return {screen:sc.index,x:p.x-sc.bounds.x,y:p.y-sc.bounds.y};
  };
  const from=locate(ready.start),to=locate(ready.end);
  // Each operation rechecks that the owner’s dedicated test app still has focus.
  const guardTitleContains='LightRemoteDragCanary';
  const r=await req('desktop.input',{displayTopologyId:topo.displayTopologyId,actions:[
    {op:'cursor.drag',screen:from.screen,fromX:from.x,fromY:from.y,
     toScreen:to.screen,toX:to.x,toY:to.y,steps:24,durationMs:600,guardTitleContains}
  ]});
  assert.equal(r.applied,true);
  assert.equal(r.results?.[0]?.dragTimed,true,'timed gesture contract mismatch');
  console.log('native_timed_cgevent_drag=PASS steps='+r.results[0].dragSteps);
  let end=null;
  for(let i=0;i<25;i++){
    end=getState();
    if(end?.state!=='READY')break;
    await sleep(100);
  }
  assert.equal(end?.state,'PASS','synthetic native view did not observe successful drag');
  console.log('synthetic_drag_target_hit=PASS');
 }finally{
  await req('desktop.visual.detach',{visualSessionId:vis.visualSessionId,leaseToken:vis.leaseToken}).catch(()=>{});
 }
 console.log('OWNER_MACOS_PHYSICAL_DRAG_E2E=PASS');
}
try{await main();}
catch(e){console.error('OWNER_MACOS_PHYSICAL_DRAG_E2E=FAIL '+e.message);process.exitCode=1;}
finally{
 try{child?.kill('SIGTERM')}catch{}
 client?.destroy();
 try{fs.unlinkSync(statePath)}catch{}
 for(const p of pending.values())clearTimeout(p.timer);
 pending.clear();
}
