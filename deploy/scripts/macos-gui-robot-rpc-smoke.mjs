#!/usr/bin/env node
// Feature-only, READ-ONLY: agent -> LaunchServices -> signed GUI macOS Robot -> 0600 Unix RPC.
// Never requests TCC privileges, captures a screen, or sends desktop input.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

const appPath=process.argv[2];
const expectedHome=process.env.HOME+'/Library/Caches/LightRemote-RMV2-Experimental/';
assert.ok(appPath?.startsWith(expectedHome),'GUI helper must be experimental');
assert.ok(appPath.endsWith('/LightRemoteRmv2Canary.app'),'GUI helper app name mismatch');
assert.ok(fs.existsSync(appPath+'/Contents/MacOS/LightRemoteRealRemote'));
const sock='/tmp/lightremote-rmv2-gui-'+crypto.randomBytes(7).toString('hex')+'.sock';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let peer=null;
async function openGui(){
 const child=spawn('/usr/bin/open',['-n','-a',appPath,'--args','--socket',sock],{stdio:'ignore'});
 const result=await Promise.race([
   new Promise((res,rej)=>{child.once('error',rej);child.once('exit',code=>code===0?res(code):rej(new Error('launchservices_exit_'+code)))}),
   sleep(9000).then(()=>{throw new Error('launchservices_timeout')})
 ]);
 return result;
}
async function connect(){
 for(let i=0;i<75;i++){
  try{
   return await new Promise((res,rej)=>{
    const s=net.createConnection(sock);
    s.once('connect',()=>res(s));s.once('error',rej);
   });
  }catch(e){if(i===74)throw e;await sleep(100);}
 }
}
async function statusRpc(socket){
 return await new Promise((resolve,reject)=>{
  let buffer='';
  const timeout=setTimeout(()=>reject(new Error('native_status_timeout')),10000);
  socket.setEncoding('utf8');
  socket.on('error',err=>{clearTimeout(timeout);reject(err)});
  socket.on('data',chunk=>{
   buffer+=chunk;
   while(buffer.includes('\n')){
    const end=buffer.indexOf('\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    if(!line)continue;
    let event;
    try{event=JSON.parse(line)}catch(e){clearTimeout(timeout);reject(e);return;}
    if(event.type==='event'&&event.eventName==='robot.ready'){
      socket.write(JSON.stringify({id:'read_only',op:'desktop.status'})+'\n');
    }
    if(event.type==='response'&&event.id==='read_only'){
      clearTimeout(timeout);
      if(event.ok)resolve(event.data);
      else reject(new Error(String(event.error||'RPC_denied')));
      return;
    }
   }
  });
 });
}
try{
 await openGui();
 peer=await connect();
 const status=await statusRpc(peer);
 assert.equal(status.runtime,'real-remote-v2-macos');
 console.log(JSON.stringify({guiRobotRpc:'PASS',runtime:status.runtime,
   screenRecording:status.screenRecording,accessibility:status.accessibility,
   visualSessions:status.visualSessions,cursorOverlayActive:status.cursorOverlayActive}));
}catch(e){console.error('GUI_ROBOT_RPC=FAIL '+e.message);process.exitCode=1;}
finally{
 peer?.end();peer?.destroy();
 // The native server exits after EOF; never kill installed client processes.
 await sleep(100);
 try{fs.unlinkSync(sock)}catch{}
}
