#!/usr/bin/env node
// Opt-in NativeDesktopBridge INPUT E2E on a unique synthetic dialog ONLY.
// Uses the same request('semantic-*') API path as the operator agent.
// Requires dev .app; never touches the installed client or production service.
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {NativeDesktopBridge,realRemoteAvailable} from '../../lib/native-desktop.mjs';

const app=process.env.HOME+'/Applications/LightRemoteRobotDev.app';
const env={...process.env,
  LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_MACOS_GUI_SIDECAR:'1',
  LIGHT_REMOTE_MACOS_GUI_APP:app};
const bridge=new NativeDesktopBridge({platform:'darwin',env,command:'',timeoutMs:15000,idleMs:30000});
const uuid=crypto.randomBytes(7).toString('hex');
const title='LR_Operator_GUI_AX_'+uuid;
const value='Robot_Mac_chào_'+uuid;
const script='display dialog "Temporary native bridge test." default answer "" buttons {"Cancel", "OK"} default button "OK" with title "'+title+'" giving up after 25';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child,sem,result='',exitPromise;
function select(tree){
 const nodes=tree?.nodes||[];
 assert.equal(nodes.filter(n=>String(n.name||'').includes(title)).length,1,'synthetic title mismatch');
 const fields=nodes.filter(n=>n.role==='AXTextField'&&n.enabled===true&&n.password!==true);
 const buttons=nodes.filter(n=>n.role==='AXButton'&&n.enabled===true&&String(n.name||'').trim()==='OK');
 assert.equal(fields.length,1,'not a unique synthetic text field');
 assert.equal(buttons.length,1,'not a unique synthetic OK button');
 return {field:fields[0],button:buttons[0]};
}
try{
 assert.equal(realRemoteAvailable({platform:'darwin',env}),true);
 const st=await bridge.request('status');
 assert.equal(st.screenRecording,true);
 assert.equal(st.accessibility,true);
 child=spawn('/usr/bin/osascript',['-e',script],{stdio:['ignore','pipe','pipe']});
 child.stdout.setEncoding('utf8');child.stdout.on('data',v=>result+=v);
 child.stderr.on('data',()=>{});
 exitPromise=new Promise(resolve=>child.once('exit',resolve));
 await pause(900);
 for(let i=0;i<6;i++){
   const attempt=await bridge.request('semantic-attach',{scope:'foreground',maxDepth:8,maxNodes:280});
   try{
      assert.ok(String(attempt.rootTitle||'').toLowerCase().includes('osascript'),'foreign app in foreground');
      select(attempt.snapshot);
      sem=attempt;break;
   }catch(err){
      await bridge.request('semantic-detach',{semanticSessionId:attempt.semanticSessionId}).catch(()=>{});
      if(i===5)throw err;
      await pause(280);
   }
 }
 assert.ok(sem?.semanticSessionId);
 console.log('operator_bridge_synthetic_guard=PASS');
 const snap=await bridge.request('semantic-snapshot',{semanticSessionId:sem.semanticSessionId});
 let nodes=select(snap.snapshot);
 const typed=await bridge.request('semantic-act',{semanticSessionId:sem.semanticSessionId,nodeId:nodes.field.nodeId,action:'value',value});
 assert.equal(typed.applied,true);
 assert.equal(typed.cursorMoved,true);
 console.log('operator_bridge_visible_ax_text=PASS');
 const journal=await bridge.request('semantic-events',{
   semanticSessionId:sem.semanticSessionId,afterSeq:sem.stateSeq,limit:30
 });
 assert.equal(journal.journalMode,'poll-diff','expected bounded native AX journal');
 assert.ok(journal.events.some(e=>e.type==='ax.action'&&e.action==='value'&&e.nodeId===nodes.field.nodeId),
   'missing native action event');
 assert.equal(journal.resyncRecommended,false,'native journal unexpected resync');
 console.log('operator_bridge_native_ax_event_journal=PASS');
 const refresh=await bridge.request('semantic-snapshot',{semanticSessionId:sem.semanticSessionId});
 nodes=select(refresh.snapshot);
 const clicked=await bridge.request('semantic-act',{semanticSessionId:sem.semanticSessionId,nodeId:nodes.button.nodeId,action:'invoke'});
 assert.equal(clicked.applied,true);
 assert.equal(clicked.cursorMoved,true);
 const exit=await Promise.race([exitPromise,pause(6500).then(()=>{throw Error('synthetic_dialog_timeout')})]);
 assert.equal(exit,0);
 assert.ok(result.normalize('NFC').includes(('text returned:'+value).normalize('NFC')));
 console.log('operator_bridge_visible_button_and_unicode_roundtrip=PASS');
 console.log('MAC_OPERATOR_NATIVE_EVENTS_E2E=PASS');
}catch(e){
 console.error('MAC_OPERATOR_NATIVE_EVENTS_E2E=FAIL '+e.message);
 process.exitCode=1;
}finally{
 if(sem)try{await bridge.request('semantic-detach',{semanticSessionId:sem.semanticSessionId})}catch{}
 if(child?.exitCode==null)try{child?.kill('SIGTERM')}catch{}
 bridge.close();
}
