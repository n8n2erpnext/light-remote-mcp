#!/usr/bin/env node
// macOS owner-only positive Real Remote E2E: observations only, no input.
// Run via the companion shell script from the owner's graphical Terminal.
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const socketPath=process.argv[2];
if(!socketPath?.startsWith('/tmp/lightremote-rmv2-') || !socketPath.endsWith('.sock')){
  console.error('owner-e2e: expected isolated macOS Unix socket');
  process.exit(2);
}
let socket, buffer='', seq=0;
const pending=new Map();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(){
  for(let attempt=0;attempt<60;attempt++){
    try {
      socket=await new Promise((resolve,reject)=>{
        const s=net.createConnection(socketPath);
        s.once('connect',()=>resolve(s));
        s.once('error',reject);
      });
      return;
    }catch(error){
      if(attempt===59)throw error;
      await sleep(100);
    }
  }
}
function handle(line){
  if(!line)return;
  const msg=JSON.parse(line);
  if(msg.type!=='response')return;
  const p=pending.get(msg.id);
  if(!p)return;
  pending.delete(msg.id);clearTimeout(p.timer);
  if(msg.ok===false)p.reject(new Error(String(msg.error||'native_helper_error')));
  else p.resolve(msg.data);
}
function request(op,params={}){
  const id='owner_'+(++seq);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      pending.delete(id);reject(new Error(op+'_timeout'));
    },12000);
    pending.set(id,{resolve,reject,timer});
    socket.write(JSON.stringify({id,op,...params})+'\n');
  });
}
async function main(){
  await connect();
  socket.setEncoding('utf8');
  socket.on('data',chunk=>{
    buffer+=chunk;
    while(buffer.includes('\n')){
      const i=buffer.indexOf('\n');
      const line=buffer.slice(0,i);buffer=buffer.slice(i+1);
      try{handle(line);}catch(e){console.error('owner-e2e: RPC parse error',e.message);}
    }
  });
  const status=await request('desktop.status');
  assert.equal(status.runtime,'real-remote-v2-macos');
  console.log('status: screenRecording='+status.screenRecording+', accessibility='+status.accessibility);
  assert.equal(status.screenRecording,true,'Screen Recording denied in helper process');
  assert.equal(status.accessibility,true,'Accessibility denied in helper process');
  const windows=await request('desktop.windows',{maxWindows:100});
  assert.ok(Array.isArray(windows));
  console.log('windows: PASS count='+windows.length+' (titles omitted)');
  const frame=await request('desktop.frame',{screen:0,maxWidth:960,maxHeight:540,quality:45});
  const img=Buffer.from(frame.data||'','base64');
  assert.ok(img.length>100 && img.length<=700*1024);
  assert.equal(crypto.createHash('sha256').update(img).digest('hex'),frame.frameSha256);
  console.log('frame: PASS bytes='+img.length+' SHA256 verified; pixels not saved or printed');
  let visual;
  try{
    visual=await request('desktop.visual.attach',{screen:0,leaseMs:15000,maxWidth:640,maxHeight:360,quality:40,owner:'local-owner-readonly-test'});
    assert.ok(visual.visualSessionId && visual.leaseToken);
    const f=await request('desktop.visual.frame',{visualSessionId:visual.visualSessionId,leaseToken:visual.leaseToken});
    assert.ok(f.frame?.frameSha256);
    console.log('visual-session: PASS frameSeq='+f.frameSeq);
  }finally{
    if(visual){
      try{await request('desktop.visual.detach',{visualSessionId:visual.visualSessionId,leaseToken:visual.leaseToken});}
      catch(e){console.error('visual detach:',e.message);}
    }
  }
  let sem;
  try{
    sem=await request('desktop.semantic.attach',{scope:'foreground',maxDepth:4,maxNodes:120});
    const initial=sem.snapshot?.nodes||[];
    console.log('AX attach: PASS nodes='+initial.length+' (names omitted)');
    const next=await request('desktop.semantic.snapshot',{semanticSessionId:sem.semanticSessionId});
    assert.ok(Array.isArray(next.snapshot?.nodes));
    const journal=await request('desktop.semantic.events',{semanticSessionId:sem.semanticSessionId,afterSeq:0,limit:20});
    console.log('AX snapshot/events: PASS nodes='+next.snapshot.nodes.length+
      ' resyncRecommended='+journal.resyncRecommended);
  }finally{
    if(sem){
      try{await request('desktop.semantic.detach',{semanticSessionId:sem.semanticSessionId});}
      catch(e){console.error('semantic detach:',e.message);}
    }
  }
  console.log('OWNER_MACOS_READONLY_E2E=PASS');
}
try{await main();}
catch(error){console.error('OWNER_MACOS_READONLY_E2E=FAIL '+error.message);process.exitCode=1;}
finally{
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('closed'));}
  pending.clear();socket?.end();socket?.destroy();
}
