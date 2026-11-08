import test from 'node:test';
import assert from 'node:assert/strict';
import {GoldSessionRedis} from './gold-session-redis.mjs';
import {SessionRegistry} from '../operator-host/session-manager.mjs';
import {createDesktopV4OwnerActivityPage} from '../operator-host/desktop-v4-owner-activity-page.mjs';
const DAY=86400000,TTL_SECONDS=604800,SESSION='acctsess_123e4567-e89b-42d3-a456-426614174000';
const agent='agent_id_long_enough_for_gold';
function world(){
 let now=1794000000000,flushed=0;
 const kv=new Map();
 const client={
  async get(k){const item=kv.get(k);if(!item)return null;
   if(item.until<=now){kv.delete(k);return null;}return item.data;},
  async set(k,v,{EX}={}){
   assert.equal(EX,TTL_SECONDS);
   kv.set(k,{data:v,until:now+EX*1000});flushed++;return 'OK';
  }
 };
 const opts={client,prefix:'lr:gold:h3_test:'},clock=()=>now;
 const create=async(historyMs=DAY)=>{
  const store=await GoldSessionRedis.open(opts);
  const registry=store.mount(new SessionRegistry({
   accountId:'owner',deviceId:'d-1',nodeId:'node-1',
   idleMs:30*60*1000,historyMs,now:clock
  }));
  await store.flush();
  return {store,registry};
 };
 const activity=({store,registry})=>{
  let approved=true;
  const devices=[{accountId:'owner',deviceId:'d-1',state:'online'}];
  const accounts={
   desktopOwnerSessionActive:(a,s)=>approved&&a==='owner'&&s===SESSION,
   account:()=>({accountId:'owner',isOwner:true,emailVerified:true,status:'active'})
  };
  const read=createDesktopV4OwnerActivityPage({
   accounts,allDeviceViews:({accountId})=>devices.filter(d=>d.accountId===accountId),
   usage:{summary:()=>({currentMonth:'2026-11',devices:[]})},
   jobs:new Map(),sessions:registry,sessionBacking:store,now:clock
  });
  return {devices,setApproved:v=>{approved=v;},
   read:()=>read({accountId:'owner',accountSessionId:SESSION,page:{kind:'sessions',limit:100}})};
 };
 return {kv,opts,clock,create,activity,advance:ms=>{now+=ms;},writes:()=>flushed};
}
test('H3 retention provenance is explicit, frozen, and excludes Redis key and session secrets',async()=>{
 const w=world(),{store,registry}=await w.create();
 const p=store.retentionPolicy(registry);
 assert.deepEqual(p,{snapshotTtlSeconds:604800,terminalPruneAfterMs:DAY,immutableAudit:false});
 assert.equal(Object.isFrozen(p),true);
 assert.ok(!JSON.stringify(p).includes('runtime:sessions'));
 assert.ok(!JSON.stringify(p).includes('workspace'));
 assert.throws(()=>store.retentionPolicy(new SessionRegistry()),/retention_policy_invalid/);
 const opened=registry.open({accountId:'owner',deviceId:'d-1',nodeId:'node-1',
  agentId:agent,label:'Test 1',workspace:'/private/never-log'});
 await store.flush();
 const a=w.activity({store,registry}),page=await a.read();
 assert.equal(page.coverage.source,'redis_retained_session_window');
 assert.deepEqual(page.coverage.retention,p);
 assert.equal(page.rows.length,1);
 assert.equal(page.rows[0].sessionId,opened.sessionId);
 assert.ok(!JSON.stringify(page).includes('never-log'));
});
test('H3 close/prune is durably flushed before Owner reports session unavailable',async()=>{
 const w=world(),first=await w.create(DAY);
 const opened=first.registry.open({accountId:'owner',deviceId:'d-1',
   nodeId:'node-1',agentId:agent,label:'session'});
 await first.store.flush();
 first.registry.close(opened.sessionId,agent);
 await first.store.flush();
 // Retained terminal record survives a normal Operator restart.
 const second=await w.create(DAY);
 const before=await w.activity(second).read();
 assert.equal(before.rows.length,1);
 assert.equal(before.rows[0].state,'closed');
 w.advance(DAY+1);
 const missing=await w.activity(second).read();
 assert.equal(missing.rows.length,0);
 const raw=w.kv.get('lr:gold:h3_test:runtime:sessions');
 assert.ok(raw,'snapshot exists only because pruning re-persisted it');
 assert.deepEqual(JSON.parse(raw.data).sessions,[],
  'pruned session tombstone committed before returning Owner result');
 const third=await w.create(DAY);
 assert.equal(third.registry.list().length,0,'pruned row never resurrects on restart');
});
test('H3 Redis TTL expiry without writes clears recoverable snapshot; no hidden audit',async()=>{
 const w=world(),{store,registry}=await w.create(DAY);
 registry.open({accountId:'owner',deviceId:'d-1',nodeId:'node-1',
  agentId:agent,label:'TTL'});
 await store.flush();
 w.advance(TTL_SECONDS*1000+1);
 const restored=await w.create(DAY);
 assert.equal(restored.registry.list().length,0);
 const page=await w.activity(restored).read();
 assert.equal(page.coverage.retention.immutableAudit,false);
 assert.equal(page.coverage.total,0);
});
test('H3 Owner or device transfer during Redis persistence denies read',async()=>{
 const w=world(),s=await w.create(DAY);
 s.registry.open({accountId:'owner',deviceId:'d-1',nodeId:'node-1',agentId:agent});
 const a=w.activity(s);
 const baseFlush=s.store.flush.bind(s.store);
 s.store.flush=async()=>{await baseFlush();a.devices[0].accountId='other';};
 await assert.rejects(a.read(),/changed_during_read/);
 const w2=world(),s2=await w2.create(DAY),a2=w2.activity(s2);
 const origin=s2.store.flush.bind(s2.store);
 s2.store.flush=async()=>{await origin();a2.setApproved(false);};
 await assert.rejects(a2.read(),/owner_required/);
});
test('H3 Redis persistence failures are fail-closed, never reported as retained history',async()=>{
 const w=world(),s=await w.create(DAY),a=w.activity(s);
 s.store.flush=async()=>{throw Error('redis_store_unavailable');};
 await assert.rejects(a.read(),/redis_store_unavailable/);
});
