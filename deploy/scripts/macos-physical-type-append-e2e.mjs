#!/usr/bin/env node
// Mac Intel owner-Terminal canary. Only types into its own uniquely named
// transient osascript dialog. Never interacts with user documents or Chrome.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const base=process.env.HOME+'/Library/Caches/LightRemote-RMV2-Experimental';
const {NativeDesktopBridge}=await import(pathToFileURL(base+'/OperatorCanary-fe90890/lib/native-desktop.mjs').href);
const helper=base+'/CI-4920273/LightRemoteRobotDev.app/Contents/MacOS/LightRemoteRealRemote';
const b=new NativeDesktopBridge({command:helper,platform:'darwin',timeoutMs:20000,idleMs:35000});
const mark=crypto.randomBytes(5).toString('hex');
const title='LR_PHYTYPE_'+mark;
const first='Robot verified ';
const second='typing '+mark;
const value=first+second;
const script='display dialog "Light Remote physical keyboard canary" default answer "" buttons {"Cancel", "OK"} default button "OK" with title "'+title+'" giving up after 30';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let child,sem,stdout='',exitPromise;
try {
 const st=await b.request('status');
 assert.equal(st.accessibility,true,'owner Terminal AX consent missing');
 child=spawn('/usr/bin/osascript',['-e',script],{stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{stdout+=chunk.toString('utf8')});
 child.stderr.on('data',()=>{});
 exitPromise=new Promise(resolve=>child.once('exit',resolve));
 await delay(850);
 for(let i=0;i<7;i++){
  const s=await b.request('semantic-attach',{scope:'foreground',maxDepth:8,maxNodes:300});
  const nodes=s.snapshot?.nodes||[];
  if(String(s.rootTitle||'').toLowerCase().includes('osascript')&&nodes.filter(n=>String(n.name||'').includes(title)).length===1){
   sem=s;break;
  }
  await b.request('semantic-detach',{semanticSessionId:s.semanticSessionId});
  await delay(250);
 }
 assert.ok(sem,'unique osascript dialog not foreground');
 let nodes=sem.snapshot.nodes;
 const field=nodes.filter(n=>n.role==='AXTextField'&&n.enabled&&!n.password);
 assert.equal(field.length,1);
 const focused=await b.request('semantic-act',{semanticSessionId:sem.semanticSessionId,nodeId:field[0].nodeId,action:'focus'});
 assert.equal(focused.applied,true);
 const one=await b.request('input',{events:[{type:'type',text:first,intervalMs:36}]},{timeoutMs:13000});
 assert.equal(one.results?.[0]?.textMethod,'hid-key-by-key-verified');
 assert.equal(one.results?.[0]?.verified,true);
 console.log('MAC_PHYSICAL_FIRST_VERIFIED=PASS');
 const two=await b.request('input',{events:[{type:'type',text:second,intervalMs:36}]},{timeoutMs:13000});
 assert.equal(two.results?.[0]?.textMethod,'hid-key-by-key-verified');
 assert.equal(two.results?.[0]?.verified,true);
 console.log('MAC_PHYSICAL_APPEND_VERIFIED=PASS');
 const snap=await b.request('semantic-snapshot',{semanticSessionId:sem.semanticSessionId});
 nodes=snap.snapshot.nodes;
 const okay=nodes.filter(n=>n.role==='AXButton'&&n.enabled&&String(n.name||'').trim()==='OK');
 assert.equal(okay.length,1);
 await b.request('semantic-act',{semanticSessionId:sem.semanticSessionId,nodeId:okay[0].nodeId,action:'invoke'});
 const exit=await Promise.race([exitPromise,delay(6000).then(()=>{throw Error('dialog_confirmation_timeout')})]);
 assert.equal(exit,0);
 assert.ok(stdout.includes('text returned:'+value),'synthetic dialog text mismatch');
 console.log('MAC_PHYSICAL_TYPE_APPEND_E2E=PASS');
}catch(e){
 console.error('MAC_PHYSICAL_TYPE_APPEND_E2E=FAIL '+String(e.message||e));
 process.exitCode=1;
}finally{
 if(sem)try{await b.request('semantic-detach',{semanticSessionId:sem.semanticSessionId})}catch{}
 if(child?.exitCode==null)try{child.kill('SIGTERM')}catch{}
 b.close();
}
