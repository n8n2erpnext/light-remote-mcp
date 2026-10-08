#!/usr/bin/env node
// Read-only direct macOS GUI Robot E2E; no Terminal TCC inheritance.
// Prints only counts and SHA verification, no window names or pixels.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {MacGuiRobotSidecar} from './GuiSidecarBroker.mjs';
const app=process.argv[2];
const robot=new MacGuiRobotSidecar({appPath:app,timeoutMs:12000});
let visual,semantic;
try {
 await robot.start();
 const st=await robot.request('desktop.status');
 assert.equal(st.runtime,'real-remote-v2-macos');
 assert.equal(st.screenRecording,true,'GUI Robot Screen Recording denied');
 assert.equal(st.accessibility,true,'GUI Robot Accessibility denied');
 console.log('native_gui_tcc=PASS');
 const win=await robot.request('desktop.windows',{maxWindows:100});
 assert.ok(Array.isArray(win));
 console.log('native_gui_windows=PASS count='+win.length);
 const f=await robot.request('desktop.frame',{screen:0,maxWidth:800,maxHeight:450,quality:40});
 const b=Buffer.from(f.data||'','base64');
 assert.ok(b.length>100 && b.length<=700*1024,'frame byte length invalid');
 assert.equal(crypto.createHash('sha256').update(b).digest('hex'),f.frameSha256);
 console.log('native_gui_frame=PASS bytes='+b.length+' sha256-verified');
 visual=await robot.request('desktop.visual.attach',{
   screen:0,leaseMs:12000,maxWidth:640,maxHeight:360,quality:35,owner:'mac-gui-dev-readonly'});
 assert.equal(visual.cursorOverlayActive,true);
 const vf=await robot.request('desktop.visual.frame',{visualSessionId:visual.visualSessionId,leaseToken:visual.leaseToken});
 assert.ok(vf.frame?.frameSha256);
 console.log('native_gui_visual_lease=PASS');
 await robot.request('desktop.visual.detach',{visualSessionId:visual.visualSessionId,leaseToken:visual.leaseToken});
 visual=null;
 semantic=await robot.request('desktop.semantic.attach',{scope:'foreground',maxDepth:4,maxNodes:100});
 const initial=semantic.snapshot?.nodes||[];
 assert.ok(Array.isArray(initial));
 const snap=await robot.request('desktop.semantic.snapshot',{semanticSessionId:semantic.semanticSessionId});
 assert.ok(Array.isArray(snap.snapshot?.nodes));
 console.log('native_gui_accessibility=PASS nodes='+snap.snapshot.nodes.length);
 await robot.request('desktop.semantic.detach',{semanticSessionId:semantic.semanticSessionId});
 semantic=null;
 console.log('MAC_GUI_SIDECAR_READONLY_E2E=PASS');
}catch(e){
 console.error('MAC_GUI_SIDECAR_READONLY_E2E=FAIL '+e.message);
 process.exitCode=1;
}finally{
 if(visual){try{await robot.request('desktop.visual.detach',{visualSessionId:visual.visualSessionId,leaseToken:visual.leaseToken})}catch{}}
 if(semantic){try{await robot.request('desktop.semantic.detach',{semanticSessionId:semantic.semanticSessionId})}catch{}}
 robot.close();
}
