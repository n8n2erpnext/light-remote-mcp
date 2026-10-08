#!/usr/bin/env node
// Safe background Agent -> unsigned GUI Robot -> synthetic AX input E2E.
// Only interacts with a uniquely named temporary osascript dialog.
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {MacGuiRobotSidecar} from './GuiSidecarBroker.mjs';

const app=process.argv[2];
if(!app){console.error('dev app path required');process.exit(2);}
const uuid=crypto.randomBytes(6).toString('hex');
const title='LR_Dev_Gui_AX_'+uuid;
const value='Chào_Robot_Dev_'+uuid;
const script='display dialog "Temporary Light Remote Robot test." default answer "" buttons {"Cancel", "OK"} default button "OK" with title "'+title+'" giving up after 22';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const robot=new MacGuiRobotSidecar({appPath:app,timeoutMs:12000});
let osascript=null,sem=null,result='',exitPromise;
function safeNodes(tree) {
 const nodes=tree?.nodes||[];
 assert.equal(nodes.filter(n=>String(n.name||'').includes(title)).length,1,'test dialog identity mismatch');
 const fields=nodes.filter(n=>n.role==='AXTextField'&&n.enabled===true&&n.password!==true);
 const buttons=nodes.filter(n=>n.role==='AXButton'&&n.enabled===true&&String(n.name||'').trim()==='OK');
 assert.equal(fields.length,1,'expected one safe textfield');
 assert.equal(buttons.length,1,'expected one OK button');
 return {field:fields[0],button:buttons[0]};
}
try {
 await robot.start();
 const st=await robot.request('desktop.status');
 assert.equal(st.accessibility,true,'GUI Robot AX permission not granted');
 assert.equal(st.screenRecording,true,'GUI Robot screen permission not granted');
 osascript=spawn('/usr/bin/osascript',['-e',script],{stdio:['ignore','pipe','pipe']});
 osascript.stdout.setEncoding('utf8');
 osascript.stdout.on('data',c=>result+=c);
 osascript.stderr.on('data',()=>{}); // never emit external content
 exitPromise=new Promise(res=>osascript.once('exit',res));
 await wait(1000);
 for(let i=0;i<5;i++){
  const candidate=await robot.request('desktop.semantic.attach',{scope:'foreground',maxDepth:8,maxNodes:280});
  try {
   assert.ok(String(candidate.rootTitle||'').toLowerCase().includes('osascript'),'foreign foreground app');
   safeNodes(candidate.snapshot);
   sem=candidate;
   break;
  }catch(e){
   await robot.request('desktop.semantic.detach',{semanticSessionId:candidate.semanticSessionId}).catch(()=>{});
   if(i===4)throw e;
   await wait(350);
  }
 }
 assert.ok(sem?.semanticSessionId);
 console.log('native_gui_synthetic_target_guard=PASS');
 const before=await robot.request('desktop.semantic.snapshot',{semanticSessionId:sem.semanticSessionId});
 let target=safeNodes(before.snapshot);
 const write=await robot.request('desktop.semantic.act',{semanticSessionId:sem.semanticSessionId,nodeId:target.field.nodeId,action:'value',value});
 assert.equal(write.applied,true);
 assert.equal(write.cursorMoved,true);
 console.log('native_gui_ax_text_and_cursor=PASS');
 const next=await robot.request('desktop.semantic.snapshot',{semanticSessionId:sem.semanticSessionId});
 target=safeNodes(next.snapshot);
 const press=await robot.request('desktop.semantic.act',{semanticSessionId:sem.semanticSessionId,nodeId:target.button.nodeId,action:'invoke'});
 assert.equal(press.applied,true);
 assert.equal(press.cursorMoved,true);
 const code=await Promise.race([exitPromise,wait(6000).then(()=>{throw new Error('synthetic_dialog_timeout')})]);
 assert.equal(code,0);
 assert.ok(result.normalize('NFC').includes(('text returned:'+value).normalize('NFC')),'synthetic Unicode mismatch');
 console.log('native_gui_ax_button_and_roundtrip=PASS');
 console.log('MAC_GUI_SIDECAR_INPUT_E2E=PASS');
}catch(e){
 console.error('MAC_GUI_SIDECAR_INPUT_E2E=FAIL '+e.message);
 process.exitCode=1;
}finally{
 if(sem){try{await robot.request('desktop.semantic.detach',{semanticSessionId:sem.semanticSessionId})}catch{}}
 if(osascript?.exitCode==null){try{osascript.kill('SIGTERM')}catch{}}
 robot.close();
}
