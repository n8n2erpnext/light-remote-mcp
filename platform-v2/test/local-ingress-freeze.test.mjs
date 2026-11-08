import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {LocalIngressFreezeGate} from '../../lib/local-ingress-freeze.mjs';

function fakeResponse(){
 const r=new EventEmitter();
 r.statusCode=200;r.headers={};r.body=null;
 r.setHeader=(k,v)=>{r.headers[k]=v;};
 r.end=body=>{r.body=body;r.emit('finish');};
 return r;
}
test('opt-in required before freeze; normal ingress keeps working',async()=>{
 const gate=new LocalIngressFreezeGate();
 assert.equal(gate.snapshot().enabled,false);
 assert.equal(gate.admitHttp({},fakeResponse()),true);
 assert.equal(gate.snapshot().inflight,1);
 assert.throws(()=>gate.freeze(),/LOCAL_FREEZE_NOT_OPTED_IN/);
});
test('freeze rejects NEW HTTP ingress while letting an already admitted request finish',async()=>{
 const gate=new LocalIngressFreezeGate({enabled:true});
 const a=fakeResponse(),b=fakeResponse(),newcomer=fakeResponse();
 assert.equal(gate.admitHttp({},a),true);
 assert.equal(gate.admitHttp({},b),true);
 let resolved=false;
 const promise=gate.freeze().then(x=>{resolved=true;return x;});
 assert.equal(gate.snapshot().phase,'freezing');
 assert.equal(gate.snapshot().inflight,2);
 assert.equal(gate.admitHttp({},newcomer),false);
 assert.equal(newcomer.statusCode,503);
 assert.equal(newcomer.headers['retry-after'],'60');
 assert.match(newcomer.body,/local_ingress_frozen/);
 await Promise.resolve();assert.equal(resolved,false);
 a.emit('finish');a.emit('close'); // completion idempotent
 assert.equal(gate.snapshot().inflight,1);
 b.emit('close');
 const drained=await promise;
 assert.equal(drained.phase,'frozen');
 assert.equal(drained.inflight,0);
 assert.equal(drained.revision,1);
 assert.equal(gate.admitHttp({},fakeResponse()),false);
 assert.equal((await gate.freeze()).revision,1); // no unfreeze
});
test('explicit read-only /healthz is still available after freeze',async()=>{
 const gate=new LocalIngressFreezeGate({enabled:true});
 await gate.freeze();
 assert.equal(gate.admitHttp({},fakeResponse(),{health:true}),true);
 assert.equal(gate.snapshot().inflight,0);
 const nonhealth=fakeResponse();
 assert.equal(gate.admitHttp({},nonhealth),false);
 assert.equal(nonhealth.statusCode,503);
});
test('tracked background outbox work drains; no new background work starts',async()=>{
 const gate=new LocalIngressFreezeGate({enabled:true});
 const one=gate.beginWork();
 assert.equal(typeof one,'function');
 let finished=false;
 const p=gate.freeze().then(()=>{finished=true;});
 assert.equal(gate.beginWork(),null);
 await Promise.resolve();
 assert.equal(finished,false);
 assert.equal(one(),true);
 assert.equal(one(),false);
 await p;
 assert.equal(finished,true);
 assert.equal(gate.snapshot().inflight,0);
});
test('Operator jobs outlive HTTP and block local drain until finishJob notification',async()=>{
 const gate=new LocalIngressFreezeGate({enabled:true});
 let outstandingJobs=1;
 gate.registerPendingSource('operatorJobs',()=>outstandingJobs);
 const accepted=fakeResponse();
 assert.equal(gate.admitHttp({},accepted),true);
 let drained=false;
 const pending=gate.freeze().then(()=>{drained=true;});
 accepted.emit('finish');
 await Promise.resolve();
 assert.equal(drained,false);
 assert.equal(gate.snapshot().phase,'freezing');
 assert.equal(gate.snapshot().inflight,0);
 assert.equal(gate.snapshot().pendingExternal,1);
 outstandingJobs=0;
 gate.notifyPendingChanged();
 await pending;
 assert.equal(drained,true);
 assert.equal(gate.snapshot().pendingExternal,0);
});
test('failed or invalid external job census fails closed, never reports frozen',async()=>{
 const gate=new LocalIngressFreezeGate({enabled:true});
 let bad=true;
 gate.registerPendingSource('operatorJobs',()=>{if(bad)throw Error('job_census_unavailable');return 0;});
 let resolved=false;
 const frozen=gate.freeze().then(()=>{resolved=true;});
 await Promise.resolve();
 assert.equal(gate.snapshot().pendingExternal,null);
 assert.equal(gate.snapshot().phase,'freezing');
 assert.equal(resolved,false);
 bad=false;
 gate.notifyPendingChanged();
 await frozen;
 assert.equal(gate.snapshot().phase,'frozen');
});
test('immediate freeze is terminal for this process',async()=>{
 const gate=new LocalIngressFreezeGate({enabled:true});
 const first=await gate.freeze(),again=await gate.freeze();
 assert.equal(first.phase,'frozen');
 assert.equal(again.revision,1);
 assert.equal(gate.accepting,false);
 assert.equal(gate.beginWork(),null);
});
test('rc50 dev Operator, Plugin and support pump are actually wired',async()=>{
 const fs=await import('node:fs');
 const root=new URL('../../',import.meta.url);
 const operator=fs.readFileSync(new URL('operator-host/executor.mjs',root),'utf8');
 const plugin=fs.readFileSync(new URL('plugin-server/server.mjs',root),'utf8');
 const support=fs.readFileSync(new URL('plugin-server/support-backoffice.mjs',root),'utf8');
 for(const src of [operator,plugin]){
  assert.match(src,/LR_RC50_DEV_LOCAL_FREEZE/);
  assert.match(src,/localFreezeGate\.admitHttp\(req,res,\{health\}\)/);
  assert.match(src,/process\.on\('SIGUSR2'/);
  assert.match(src,/localFreezeGate\.freeze\(\)/);
 }
 assert.match(operator,/if\(!localFreezeGate\.accepting\)return;\s*try \{ devices\.heartbeat/);
 assert.match(operator,/if\(!localFreezeGate\.accepting\)return;\s*try \{\s*const closed=connections\.reap\(\)/);
 assert.match(operator,/localFreezeGate\.registerPendingSource\('operatorJobs'/);
 assert.match(operator,/localFreezeGate\.notifyPendingChanged\(\)/);
 assert.match(plugin,/registerSupportBackoffice\(app,\{beginBackgroundWork:/);
 assert.match(support,/const finish=beginBackgroundWork\(\)/);
 assert.match(support,/\.finally\(finish\)/);
 assert.match(support,/if\(!finish\)return/);
 // Explicitly no shared PostgreSQL writer/Agent fence claim.
 assert.doesNotMatch(operator,/GLOBAL_WRITER_FENCE_READY/);
});
test('actual private-loopback HTTP: in-flight finishes, new POST 503, health reachable',async()=>{
 const http=await import('node:http');
 const gate=new LocalIngressFreezeGate({enabled:true});
 let releaseJob;
 let accepted;
 const acceptedPromise=new Promise(resolve=>accepted=resolve);
 const server=http.createServer((req,res)=>{
  const health=req.method==='GET'&&req.url==='/healthz';
  if(!gate.admitHttp(req,res,{health}))return;
  if(health){res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify(gate.snapshot()));return;}
  accepted();
  releaseJob=()=>res.end(JSON.stringify({ok:true,oldRequestFinished:true}));
 });
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const started=fetch(url+'/mutation',{method:'POST'});
  await acceptedPromise;
  let drained=false;
  const freeze=gate.freeze().then(x=>{drained=true;return x;});
  const rejected=await fetch(url+'/mutation',{method:'POST'});
  assert.equal(rejected.status,503);
  assert.equal((await rejected.json()).error,'local_ingress_frozen');
  const health=await fetch(url+'/healthz');
  assert.equal(health.status,200);
  assert.equal((await health.json()).phase,'freezing');
  assert.equal(drained,false);
  releaseJob();
  assert.equal((await (await started).json()).oldRequestFinished,true);
  const result=await freeze;
  assert.equal(result.phase,'frozen');
  assert.equal(result.inflight,0);
 }finally{
  server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
 }
});
