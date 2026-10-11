#!/usr/bin/env node
// Two REAL localhost Node HTTP API processes backed by isolated Redis UAT.
// This is a synthetic failed-auth rate-limit contract, not the live OAuth API.
// No listener persists after this script. All generated UAT keys are removed.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRedisCliUatClient} from './helpers/redis-cli-uat.mjs';

const worker=fileURLToPath(new URL('./helpers/http-rate-api-uat.mjs',import.meta.url));
const secret=crypto.randomBytes(32).toString('hex');
const salt=crypto.randomBytes(32);
const actor='uat_actor_'+crypto.randomBytes(10).toString('hex');
const another='uat_actor_'+crypto.randomBytes(10).toString('hex');
const children=[];
const prefix='lr:rc50:uat:auth:rate:oauthhttp-';
const redis=createRedisCliUatClient();
function redisKey(a){
  return prefix+crypto.createHmac('sha256',salt).update(a).digest('hex').slice(0,32);
}
async function start(){
  const child=fork(worker,{stdio:['ignore','ignore','pipe','ipc']});
  children.push(child);
  child.stderr.on('data',data=>process.stderr.write(data));
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('http_uat_start_timeout')),15000);
    const onMessage=msg=>{
      if(msg?.kind==='ready'){
        clearTimeout(timer);child.off('exit',onExit);child.off('message',onMessage);
        resolve({child,port:msg.port,pid:msg.pid,host:msg.host});
      }else if(msg?.kind==='fatal'){
        clearTimeout(timer);reject(Error('http_uat_start_failed'));
      }
    };
    const onExit=code=>{
      clearTimeout(timer);child.off('message',onMessage);
      reject(Error('http_uat_worker_exited_'+code));
    };
    child.on('message',onMessage);child.once('exit',onExit);
  });
  child.send({kind:'start',secret,salt:salt.toString('hex')});
  return ready;
}
async function request(server,{a=actor,path='/uat/synthetic-failure',proof=secret,
  forwarded='203.0.113.18',method='POST',payload}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const url='http://127.0.0.1:'+server.port+path;
    const res=await fetch(url,{
      method,signal:controller.signal,
      headers:{'x-uat-proof':proof,'content-type':'application/json',
        'x-forwarded-for':forwarded},
      ...(method==='POST'?{body:JSON.stringify(payload??{actor:a})}:{})
    });
    const text=await res.text();
    return {status:res.status,body:text?JSON.parse(text):null,
      retryAfter:res.headers.get('retry-after')};
  }finally{clearTimeout(timer);}
}
async function outage(server,enabled){
  const child=server.child;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('outage_ipc_timeout')),3000);
    const onMessage=msg=>{
      if(msg?.kind!=='outage-set')return;
      clearTimeout(timer);child.off('message',onMessage);
      if(msg.enabled!==enabled)reject(Error('outage_ack_wrong_state'));
      else resolve();
    };
    child.on('message',onMessage);
    child.send({kind:'outage',enabled});
  });
}
async function stop(server){
  if(!server||server.child.exitCode!==null||server.child.signalCode!==null)return;
  const child=server.child;
  const exited=new Promise(resolve=>{
    child.once('exit',resolve);
    setTimeout(()=>{try{child.kill('SIGKILL');}catch{}},3000).unref();
  });
  child.kill('SIGTERM');
  await exited;
}
let a,b,replacement;
try{
  a=await start();b=await start();
  assert.equal(a.host,'127.0.0.1');
  assert.equal(b.host,'127.0.0.1');
  assert.notEqual(a.pid,b.pid);
  const health=await Promise.all([a,b].map(s=>request(s,{path:'/uat/healthz',method:'GET'})));
  assert(health.every(x=>x.status===200&&x.body?.uatOnly===true));
  console.log('RC50_TWO_HTTP_REPLICAS_LOOPBACK_ONLY_PASS: 2 actual process PIDs, ephemeral localhost ports');

  const unauthorized=await request(a,{proof:'wrong_proof'});
  assert.equal(unauthorized.status,403);
  const malformed=await request(a,{payload:{actor:'not_a_synthetic_actor'}});
  assert.equal(malformed.status,400);
  const successes=await Promise.all(Array.from({length:4},(_,i)=>
    request(i%2?a:b,{path:'/uat/synthetic-success'})));
  assert(successes.every(x=>x.status===204));
  console.log('RC50_HTTP_GUARDS_PASS: private proof, synthetic actor validation, successful-auth events do not count');

  const all=await Promise.all(Array.from({length:24},(_,i)=>request(i%2?a:b,{
    forwarded:i%2?'127.0.0.1':'198.51.100.123'})));
  const allowed=all.filter(x=>x.status===401),blocked=all.filter(x=>x.status===429);
  assert.equal(allowed.length,12);assert.equal(blocked.length,12);
  assert.deepEqual(all.map(x=>x.body?.count).sort((x,y)=>x-y),
    Array.from({length:24},(_,i)=>i+1));
  assert(blocked.every(x=>Number(x.retryAfter)>0));
  assert(allowed.every(x=>x.body?.remaining>=0&&x.body?.uatOnly));
  console.log('RC50_HTTP_REDIS_GLOBAL_24_PASS: 24 real HTTP failures across replicas -> 12 fail / 12 rate limited, global 1..24');

  await stop(a);
  replacement=await start();
  assert.notEqual(replacement.pid,b.pid);
  const persisted=await request(replacement,{forwarded:'192.0.2.44'});
  assert.equal(persisted.status,429);assert.equal(persisted.body.count,25);
  console.log('RC50_HTTP_RESTART_KEEP_RATE_STATE_PASS: replacement process sees count=25, remains throttled');

  const other=await request(b,{a:another});
  assert.equal(other.status,401);
  assert.equal(other.body.count,1);
  console.log('RC50_HTTP_CLIENT_ISOLATION_PASS: second synthetic actor has independent counter');

  await outage(b,true);
  const backendError=await request(b,{a:another});
  assert.equal(backendError.status,503);
  await outage(b,false);
  const restored=await request(b,{a:another});
  assert.equal(restored.status,401);
  assert.equal(restored.body.count,2);
  console.log('RC50_HTTP_FAIL_CLOSED_REDIS_OUTAGE_PASS: error 503, no accidental quota increment');
}finally{
  await Promise.allSettled([a,b,replacement].filter(Boolean).map(stop));
  await Promise.allSettled(children.map(async child=>{
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  }));
  await Promise.all([actor,another].map(x=>redis.del(redisKey(x))));
  console.log('RC50_HTTP_UAT_GENERATED_REDIS_KEYS_CLEANUP_PASS');
}
