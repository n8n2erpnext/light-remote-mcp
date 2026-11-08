#!/usr/bin/env node
// Short lease renew/cleanup canary. No capture or input.
import net from 'node:net';
import assert from 'node:assert/strict';
const sock=process.argv[2];assert.ok(sock?.startsWith('/tmp/lightremote-rmv2-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let client,buf='',seq=0;
const pending=new Map();
for(let i=0;i<50;i++){
  try{client=await new Promise((res,rej)=>{const s=net.createConnection(sock);s.once('connect',()=>res(s));s.once('error',rej);});break;}
  catch(e){if(i===49)throw e;await sleep(100)}
}
client.setEncoding('utf8');
client.on('data',chunk=>{
 buf+=chunk;
 while(buf.includes('\n')){
  const i=buf.indexOf('\n');const raw=buf.slice(0,i);buf=buf.slice(i+1);if(!raw)continue;
  const m=JSON.parse(raw);if(m.type!=='response')continue;
  const p=pending.get(m.id);if(!p)continue;
  clearTimeout(p.timer);pending.delete(m.id);
  if(m.ok)p.resolve(m.data);else p.reject(new Error(String(m.error||'RPC_error')));
 }
});
function call(op,args={}){
 const id='renew_'+(++seq);
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error(op+'_timeout'))},7000);
  pending.set(id,{resolve,reject,timer});
  client.write(JSON.stringify({id,op,...args})+'\n');
 });
}
let vis;
try{
 const st=await call('desktop.status');
 assert.equal(st.screenRecording,true);
 vis=await call('desktop.visual.attach',{screen:0,leaseMs:2600,owner:'owner-macos-overlay-lease-smoke'});
 assert.equal(vis.cursorOverlayActive,true);
 await sleep(1750);
 await call('desktop.visual.keepalive',{visualSessionId:vis.visualSessionId,leaseToken:vis.leaseToken});
 await sleep(1300);
 const refreshed=await call('desktop.status');
 assert.equal(refreshed.cursorOverlayActive,true,'Robot marker did not survive lease extension');
 console.log('robot_overlay_lease_renewal=PASS');
 await call('desktop.visual.detach',{visualSessionId:vis.visualSessionId,leaseToken:vis.leaseToken});
 vis=null;
 await sleep(200);
 const done=await call('desktop.status');
 assert.equal(done.cursorOverlayActive,false,'Robot marker did not stop on detach');
 console.log('robot_overlay_detach_cleanup=PASS');
 console.log('MACOS_OVERLAY_LEASE_E2E=PASS');
}catch(e){console.error('MACOS_OVERLAY_LEASE_E2E=FAIL '+e.message);process.exitCode=1}
finally{
 if(vis)try{await call('desktop.visual.detach',{visualSessionId:vis.visualSessionId,leaseToken:vis.leaseToken})}catch{}
 client.destroy();
 for(const p of pending.values())clearTimeout(p.timer);
}
