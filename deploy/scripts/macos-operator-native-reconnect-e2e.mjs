#!/usr/bin/env node
// Five isolated reconnect cycles using exactly the operator NativeDesktopBridge.
// No mouse, keyboard, user window text or screen pixels are logged.
import assert from 'node:assert/strict';
import {NativeDesktopBridge} from '../../lib/native-desktop.mjs';
const app=process.env.HOME+'/Applications/LightRemoteRobotDev.app';
const env={...process.env,LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_MACOS_GUI_SIDECAR:'1',LIGHT_REMOTE_MACOS_GUI_APP:app};
const ms=()=>Number(process.hrtime.bigint()/1000000n);
const times=[],stages=[];
for(let k=0;k<5;k++){
 const bridge=new NativeDesktopBridge({platform:'darwin',env,command:'',timeoutMs:15000,idleMs:30000});
 let visual;
 try{
  const start=ms();
  const status=await bridge.request('status');
  assert.equal(status.screenRecording,true);assert.equal(status.accessibility,true);
  visual=await bridge.request('visual-attach',{screen:0,leaseMs:12000,maxWidth:480,maxHeight:270,quality:35});
  assert.equal(visual.cursorOverlayActive,true);
  const frame=await bridge.request('visual-frame',{visualSessionId:visual.visualSessionId,leaseToken:visual.leaseToken},{timeoutMs:15000});
  assert.ok(frame.frame?.frameSha256);
  await bridge.request('visual-detach',{visualSessionId:visual.visualSessionId,leaseToken:visual.leaseToken});
  visual=null;
  const end=ms();
  times.push(end-start);
  stages.push({pass:true});
 }catch(e){console.error('native_operator_cycle_'+(k+1)+'=FAIL '+e.message);process.exitCode=1;break;}
 finally{
  if(visual)try{await bridge.request('visual-detach',{visualSessionId:visual.visualSessionId,leaseToken:visual.leaseToken})}catch{}
  bridge.close();
 }
 await new Promise(r=>setTimeout(r,120));
}
if(times.length===5){
 console.log('native_operator_reconnect_cycles=PASS count='+times.length);
 console.log('native_operator_cycle_latency_ms='+JSON.stringify(times));
 console.log('MAC_OPERATOR_RECONNECT_E2E=PASS');
}
