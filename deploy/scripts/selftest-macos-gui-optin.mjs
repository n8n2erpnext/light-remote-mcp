#!/usr/bin/env node
// NativeDesktopBridge feature gate and LaunchServices/socket RPC mock on ARM.
// No real GUI, credentials, screenshots, TCC actions or production client.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {NativeDesktopBridge,realRemoteAvailable,macGuiSidecarAppPath} from '../../lib/native-desktop.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-macos-optin-'));
const app=path.join(root,'Applications','LightRemoteRobotDev.app');
const helper=path.join(app,'Contents','MacOS','LightRemoteRealRemote');
fs.mkdirSync(path.dirname(helper),{recursive:true});fs.writeFileSync(helper,'local synthetic helper fixture');
const env={HOME:root,LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_MACOS_GUI_SIDECAR:'1',LIGHT_REMOTE_MACOS_GUI_APP:app};
assert.equal(macGuiSidecarAppPath(env),app);
assert.equal(realRemoteAvailable({platform:'darwin',env}),true);
assert.equal(realRemoteAvailable({platform:'darwin',env:{...env,LIGHT_REMOTE_MACOS_GUI_APP:'/tmp/unapproved.app'}}),false);
assert.equal(realRemoteAvailable({platform:'darwin',env:{...env,LIGHT_REMOTE_REAL_REMOTE:'0'}}),false);
assert.equal(realRemoteAvailable({platform:'win32',env:{...env,LIGHT_REMOTE_CLIENT_EXE:'/dummy-win.exe'},exists:p=>p==='/dummy-win.exe'}),true);
console.log('macos_optin_gate_and_windows_regression=PASS');
let launches=0,server=null,sidecarSocket=null,accepting=null,bridge=null;
const spawnImpl=(command,args)=>{
 assert.equal(command,'/usr/bin/open');
 assert.deepEqual(args.slice(0,4),['-n','-a',app,'--args']);
 assert.equal(args[4],'--socket');
 const socketPath=args[5];
 assert.ok(socketPath.startsWith('/tmp/lightremote-rmv2-'));
 launches++;
 const proc=new EventEmitter();
 proc.stderr=null;proc.killed=false;proc.exitCode=null;
 server=net.createServer(socket=>{
  sidecarSocket=socket;
  socket.setEncoding('utf8');
  socket.write(JSON.stringify({type:'event',eventName:'robot.ready',data:{}})+'\n');
  let buffer='';
  socket.on('data',text=>{
   buffer+=text;
   while(buffer.includes('\n')){
    const index=buffer.indexOf('\n'),line=buffer.slice(0,index);buffer=buffer.slice(index+1);
    if(!line)continue;
    const request=JSON.parse(line);
    const data=request.op==='desktop.status'?{runtime:'real-remote-v2-macos',accessibility:true,screenRecording:true}:null;
    socket.write(JSON.stringify({type:'response',id:request.id,ok:true,data})+'\n');
   }
  });
 });
 accepting=new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(socketPath,()=>{
   proc.exitCode=0;proc.emit('exit',0,null);resolve();
  });
 });
 return proc;
};
try{
 bridge=new NativeDesktopBridge({platform:'darwin',env,command:'',spawnImpl,timeoutMs:5000,idleMs:30000});
 const s=await bridge.request('status');
 assert.equal(s.runtime,'real-remote-v2-macos');
 assert.equal(s.accessibility,true);
 assert.equal(bridge.running,true);
 assert.equal(launches,1);
 const again=await bridge.request('status');
 assert.equal(again.screenRecording,true);
 assert.equal(launches,1,'second request should reuse native duplex');
 console.log('macos_gui_transport_launch_duplex_reuse=PASS');
}finally{
 bridge?.close();
 await accepting?.catch(()=>{});
 sidecarSocket?.destroy();
 await new Promise(resolve=>server?server.close(resolve):resolve());
 fs.rmSync(root,{recursive:true,force:true});
}
console.log('MACOS_GUI_OPTIN_MOCK_E2E=PASS');
