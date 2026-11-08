#!/usr/bin/env node
// macOS GUI input canary probe: dedicated dialog + AX inspection ONLY.
// This stage does not inject input or read user document contents.
import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const socketPath=process.argv[2];
assert.ok(socketPath?.startsWith('/tmp/lightremote-rmv2-'));
const tag='LR_Mac_Input_Canary_'+crypto.randomBytes(5).toString('hex');
const dialogScript='display dialog "Light Remote native accessibility input test (temporary)." default answer "" buttons {"Cancel", "OK"} default button "OK" with title "'+tag+'" giving up after 18';
let child, client, lines='', serial=0;
let quitTimer;
const pending=new Map();
function req(op,opts={}){
  const id='probe_'+(++serial);
  return new Promise((res,rej)=>{
    const timer=setTimeout(()=>{pending.delete(id);rej(new Error(op+'_timeout'));},6500);
    pending.set(id,{res,rej,timer});
    client.write(JSON.stringify({id,op,...opts})+'\n');
  });
}
function consume(chunk){
  lines+=chunk;
  while(lines.includes('\n')){
    const i=lines.indexOf('\n'), line=lines.slice(0,i);lines=lines.slice(i+1);
    if(!line)continue;
    const m=JSON.parse(line),p=pending.get(m.id);if(!p)continue;
    pending.delete(m.id);clearTimeout(p.timer);
    if(!m.ok)p.rej(new Error(String(m.error||'RPC_error')));
    else p.res(m.data);
  }
}
async function main(){
  for(let n=0;n<60;n++){
    try {client=await new Promise((res,rej)=>{let s=net.createConnection(socketPath);s.once('connect',()=>res(s));s.once('error',rej);});break;}
    catch(e){if(n===59)throw e;await new Promise(r=>setTimeout(r,100));}
  }
  client.setEncoding('utf8');client.on('data',consume);
  const st=await req('desktop.status');
  assert.equal(st.accessibility,true);assert.equal(st.screenRecording,true);
  child=spawn('/usr/bin/osascript',['-e',dialogScript],{stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
  // Let macOS activate the dedicated dialog; do not change any other UI.
  await new Promise(r=>setTimeout(r,1800));
  let found=false, dialogCount=0, fieldCount=0, appName='';
  for(let k=0;k<4;k++){
    const attach=await req('desktop.semantic.attach',{scope:'foreground',maxDepth:8,maxNodes:250});
    const nodes=attach.snapshot?.nodes||[];
    appName=String(attach.rootTitle||'');
    dialogCount=nodes.filter(n=>String(n.name||'').includes(tag)).length;
    fieldCount=nodes.filter(n=>String(n.role||'').toLowerCase().includes('textfield')).length;
    found=dialogCount>0;
    await req('desktop.semantic.detach',{semanticSessionId:attach.semanticSessionId});
    if(found)break;
    await new Promise(r=>setTimeout(r,400));
  }
  console.log('CANARY_DIALOG_PROBE='+ (found?'FOUND':'NOT_FOUND'));
  console.log('canary_window_matches='+dialogCount+' text_fields='+fieldCount);
  console.log('foreground_process_category='+ (appName.toLowerCase().includes('osascript')?'osascript':(appName.toLowerCase().includes('script')?'script':'other')));
  console.log('NO_DESKTOP_INPUT_PERFORMED=1');
  if(!found)process.exitCode=2;
}
try{await main();}
catch(e){console.error('CANARY_DIALOG_PROBE_ERROR='+e.message);process.exitCode=1;}
finally{
  if(child && child.exitCode===null){try{child.kill('SIGTERM');}catch{}}
  for(const p of pending.values()){clearTimeout(p.timer);p.rej(new Error('shutdown'));}
  pending.clear();client?.destroy();
  if(quitTimer)clearTimeout(quitTimer);
}
