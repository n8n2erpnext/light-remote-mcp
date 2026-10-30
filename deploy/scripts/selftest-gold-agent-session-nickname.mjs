import assert from 'node:assert/strict';
import {SessionRegistry,SessionError} from '../../operator-host/session-manager.mjs';
import {GoldSessionRedis} from '../../lib/gold-session-redis.mjs';
const kv=new Map();
const client={
 get:async key=>kv.get(key)??null,
 set:async(key,value)=>{kv.set(key,value);return 'OK'}
};
const prefix='lr:gold:nickname-fixture:';
let now=1800000000000;
const mk=()=>new SessionRegistry({now:()=>now,accountId:'owner',deviceId:'dev',nodeId:'node',
 maxActive:10});
const persist=await GoldSessionRedis.open({client,prefix});
const reg=persist.mount(mk());
const actorA='agent-client-a-abcdefgh',actorB='agent-client-b-abcdefgh';
function open(agentId,deviceId='dev'){
 return reg.open({accountId:'owner',agentId,nodeId:'node',deviceId,label:'ChatGPT Light Remote'});
}
const a=open(actorA),b=open(actorB);
assert.equal(a.displayName,null);
const nameA=reg.setDisplayName(a.sessionId,{accountId:'owner',agentId:actorA,
 source:'agent',displayName:'ChatGPT Silver Fern'});
assert.equal(nameA.displayName,'ChatGPT Silver Fern');
assert.equal(reg.setDisplayName(a.sessionId,{accountId:'owner',agentId:actorA,
 source:'agent',displayName:'ChatGPT Blue Orchid'}).displayName,'ChatGPT Silver Fern');
assert.equal(reg.setDisplayName(b.sessionId,{accountId:'owner',agentId:actorB,
 source:'agent',displayName:'ChatGPT Silver Fern'}).displayName,'ChatGPT Silver Fern 2');
assert.throws(()=>reg.setDisplayName(a.sessionId,{accountId:'other',agentId:actorA,
 displayName:'Owner Override'}),/session_account_mismatch/);
assert.throws(()=>reg.setDisplayName(a.sessionId,{accountId:'owner',agentId:actorB,
 displayName:'Other Agent'}),/session_owner_mismatch/);
for(const bad of ['<script>alert(1)</script>','A\u202eB','AB\nCD','  ','x'.repeat(97)]){
 assert.throws(()=>reg.setDisplayName(b.sessionId,{accountId:'owner',agentId:actorB,
 displayName:bad}),/session_display_name_invalid/);
}
const owner=reg.setDisplayName(a.sessionId,{accountId:'owner',source:'owner',
 displayName:'Personal Workstation'});
assert.equal(owner.displayName,'Personal Workstation');
assert.equal(owner.nameSource,'owner');
assert.equal(reg.setDisplayName(a.sessionId,{accountId:'owner',agentId:actorA,
 source:'agent',displayName:'ChatGPT Golden Mango'}).displayName,'Personal Workstation');
assert.equal(reg.resume(a.sessionId,actorA).sessionId,a.sessionId);
reg.hold(b.sessionId,actorB);
await persist.flush();
const nextStore=await GoldSessionRedis.open({client,prefix});
const restored=nextStore.mount(mk());
assert.equal(restored.get(a.sessionId,actorA).displayName,'Personal Workstation');
assert.equal(restored.get(a.sessionId,actorA).nameSource,'owner');
assert.equal(restored.get(b.sessionId,actorB).displayName,'ChatGPT Silver Fern 2');
assert.equal(restored.get(a.sessionId,actorA).sessionId,a.sessionId);
assert.equal(restored.get(b.sessionId,actorB).sessionId,b.sessionId);
assert.equal(restored.open({accountId:'owner',agentId:actorA,deviceId:'dev',nodeId:'node'}).displayName,'Personal Workstation');
await nextStore.flush();
console.log('GOLD_P2_I3_AGENT_NICKNAME_OWNER_PRIORITY_REDISSNAP_RESTART=PASS');
console.log('GOLD_P2_I3_AGENT_NICKNAME_XSS_COLLISION_SESSIONID_IMMUTABLE=PASS');
