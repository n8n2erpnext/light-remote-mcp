#!/usr/bin/env node
// Two independent Node OS processes, one REAL isolated Redis UAT instance.
// Docker exec is ONLY a test transport: the numbers are NOT API p95/RPS.
// Namespace is randomly chosen and deleted; never FLUSHDB, never production.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {RedisUatAuxiliary} from '../src/storage/redis.mjs';
import {createRedisCliUatClient} from './helpers/redis-cli-uat.mjs';

const path=fileURLToPath(new URL('./helpers/redis-rate-worker-uat.mjs',import.meta.url));
const tag=crypto.randomBytes(10).toString('hex');
const key='oauthsynthetic-'+tag;
const other='oauthother-'+tag;
const broken='oauthunavailable-'+tag;
const namespace='lr:rc50:uat:auth:';
const client=createRedisCliUatClient();
const children=[];
let sequence=0;
const requests=new Map();

function launch(){
  const child=fork(path,[],{stdio:['ignore','ignore','pipe','ipc']});
  child.stderr.on('data',chunk=>process.stderr.write(chunk));
  child.on('message',message=>{
    const ref=requests.get(message.id);
    if(!ref)return;
    clearTimeout(ref.timer);
    requests.delete(message.id);
    if(message.ok)ref.resolve(message);
    else ref.reject(new Error(message.error));
  });
  child.on('exit',(code)=>{
    for(const [id,ref] of requests)
      if(ref.child===child){
        clearTimeout(ref.timer);requests.delete(id);
        ref.reject(new Error('uat_redis_worker_exited_'+code));
      }
  });
  children.push(child);
  return child;
}
function invoke(child,name,limit,windowSeconds){
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      requests.delete(id);reject(new Error('uat_redis_worker_timeout'));
    },30000);
    requests.set(id,{resolve,reject,timer,child});
    child.send({id,action:'hit',key:name,limit,windowSeconds});
  });
}
async function run(){
  const a=launch(),b=launch();
  assert.notEqual(a.pid,b.pid);
  const hits=await Promise.all(Array.from({length:24},
    (_,i)=>invoke(i%2?a:b,key,12,60)));
  assert.deepEqual([...new Set(hits.map(h=>h.result.count))].sort((x,y)=>x-y),
    Array.from({length:24},(_,i)=>i+1),'Redis increments must be global across independent processes');
  assert.deepEqual([...new Set(hits.map(h=>h.pid))].sort(),
    [a.pid,b.pid].sort(),'two actual operating-system processes must contribute');
  assert.equal(hits.filter(h=>h.result.allowed).length,12);
  assert.equal(hits.filter(h=>!h.result.allowed).length,12);
  assert(hits.every(h=>h.result.remaining>=0&&
    (h.result.allowed?h.result.retryAfterSeconds===0:h.result.retryAfterSeconds>0)));
  console.log('RC50_REDIS_TWO_NODE_PROCESS_RATE_PASS: 24 requests, 12 allowed / 12 denied, unique global counts 1..24');

  a.kill();
  await new Promise(resolve=>a.once('exit',resolve));
  const replacement=launch();
  const retained=await invoke(replacement,key,12,60);
  assert.equal(retained.result.count,25);
  assert.equal(retained.result.allowed,false);
  console.log('RC50_REDIS_NODE_RESTART_RETENTION_PASS: replacement process inherits existing Redis counter');

  const isolated=await invoke(b,other,1,2);
  assert.equal(isolated.result.count,1);
  assert.equal(isolated.result.remaining,0);
  const double=await invoke(replacement,other,1,2);
  assert.equal(double.result.count,2);
  assert.equal(double.result.allowed,false);
  await new Promise(resolve=>setTimeout(resolve,2400));
  const reset=await invoke(b,other,1,2);
  assert.equal(reset.result.count,1);
  assert.equal(reset.result.allowed,true);
  console.log('RC50_REDIS_NAMESPACE_TTL_PASS: independent identity, blocked when full, restored only after TTL');

  const failed=new RedisUatAuxiliary({
    client:createRedisCliUatClient({simulateOutage:true}),
    prefix:namespace,allowUat:true
  });
  await assert.rejects(()=>failed.rateHit(broken,{limit:2,windowSeconds:30}),
    /rate_limit_backend_unavailable/);
  console.log('RC50_REDIS_FAILURE_FAIL_CLOSED_PASS: backend transport failure rejects instead of allowing');
}
try{
  await run();
}finally{
  for(const child of children)child.kill();
  await Promise.allSettled(children.map(child=>new Promise(resolve=>{
    if(child.exitCode!==null||child.signalCode!==null)return resolve();
    child.once('exit',resolve);
    setTimeout(resolve,1000).unref();
  })));
  for(const id of [key,other,broken]){
    const redisKey=namespace+'rate:'+id;
    await client.del(redisKey);
  }
  console.log('RC50_REDIS_SYNTHETIC_KEY_CLEANUP_PASS');
}
