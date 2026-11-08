import assert from 'node:assert/strict';
import {createTrustedChannelRateLimiter} from '../../operator-host/trusted-channel-rate-limiter.mjs';
import {createWallStatusCache} from '../../device-agent/wall-status-cache.mjs';

const counts=new Map();
const fakeRedis={
  async eval(_lua,{keys,arguments:args}){
    assert.equal(args[0],'90');
    const key=keys[0],n=(counts.get(key)||0)+1;
    counts.set(key,n);return n;
  }
};
const limits={runtime:2,observer:2,fleet:1,control:1,'rm-live':1};
const create=()=>createTrustedChannelRateLimiter({redis:fakeRedis,prefix:'lr:gold:uat:',limits});
const a=create(),b=create();
const now=180000;
assert.equal((await a.check('g3-test-device-1','status',now)).remaining,1);
assert.equal((await b.check('g3-test-device-1','activity',now)).remaining,0);
await assert.rejects(()=>a.check('g3-test-device-1','status',now),
  e=>e.status===429&&e.scope==='device-channel-observer'&&e.retryAfterSeconds===60);
console.log('G3_REDIS_LIMIT_ATOMIC_SHARED_DEVICE_LANE=PASS');
assert.equal((await a.check('g3-test-device-2','status',now)).remaining,1);
assert.equal((await a.check('g3-test-device-1','poll',now)).remaining,1);
assert.equal((await b.check('g3-test-device-1','status',now+60000)).remaining,1);
console.log('G3_REDIS_LIMIT_DEVICE_LANE_AND_WINDOW_ISOLATION=PASS');
const unavailable=createTrustedChannelRateLimiter({redis:{eval:async()=>{throw Error('transport_failure')}},prefix:'lr:gold:uat:',limits});
await assert.rejects(()=>unavailable.check('g3-test-device-1','status',now),
  e=>e.status===503&&e.message==='trusted_channel_rate_storage_unavailable');
assert.throws(()=>createTrustedChannelRateLimiter({redis:fakeRedis,prefix:'not-gold:',limits}));
console.log('G3_REDIS_LIMIT_FAIL_CLOSED_AND_NAMESPACE=PASS');

let clock=100000,remoteCalls=0,should429=false;
const cache=createWallStatusCache({clock:()=>clock,minIntervalMs:12000,fetchRemote:async()=>{
  remoteCalls++;
  if(should429){const e=Error('rate_limited');e.status=429;e.payload={retryAfterSeconds:35,scope:'device-channel-observer'};throw e;}
  return {ok:true,device:{displayName:'Gold UAT Agent'},connection:{state:'connected'},sessions:[]};
}});
const initial=await Promise.all(Array.from({length:12},()=>cache.get({connected:true,deviceId:'d1'})));
assert.equal(remoteCalls,1);
assert.equal(initial.length,12);
assert.ok(initial.every(x=>x.ok===true));
clock+=11000;
await cache.get({connected:true,deviceId:'d1'});
assert.equal(remoteCalls,1);
console.log('G3_WALL_STATUS_MULTI_TAB_SINGLE_FLIGHT_TTL=PASS');
clock+=1001;should429=true;
const stale=await cache.get({connected:true,deviceId:'d1'});
assert.equal(remoteCalls,2);
assert.equal(stale.status,429);
assert.equal(stale.stale,true);
assert.equal(stale.connection.state,'connected');
assert.equal(stale.retryAfterSeconds,35);
clock+=25000;
await cache.get({connected:true,deviceId:'d1'});
assert.equal(remoteCalls,2,'Retry-After must suppress repeated backend calls');
clock+=10001;should429=false;
const healthy=await cache.get({connected:true,deviceId:'d1'});
assert.equal(remoteCalls,3);
assert.equal(healthy.ok,true);
assert.equal(healthy.stale,undefined);
console.log('G3_WALL_STATUS_RETRY_AFTER_STALE_AND_RECOVERY=PASS');
await cache.get({connected:false,deviceId:'d1'});
await cache.get({connected:true,deviceId:'d2'});
assert.equal(remoteCalls,4,'disconnected/new device cannot reuse old status cache');
console.log('G3_WALL_STATUS_DISCONNECT_INVALIDATES_CACHE=PASS');
let approvalReads=0;
const approvalCache=createWallStatusCache({clock:()=>clock,fetchRemote:async()=>{
  approvalReads++;return {ok:true,access:{pending:approvalReads===1?[]:[{userCode:'SAFE-TEST'}]}};
}});
await approvalCache.get({connected:true,deviceId:'approval-device'});
const approvalFresh=await approvalCache.get({connected:true,deviceId:'approval-device',force:true});
assert.equal(approvalReads,2);
assert.equal(approvalFresh.access.pending.length,1,'new approval must not be hidden by Wall status TTL');
console.log('G3_WALL_APPROVAL_CODE_BYPASSES_CACHE_TTL=PASS');
