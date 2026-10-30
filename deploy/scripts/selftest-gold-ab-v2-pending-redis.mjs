// Gold P2-I2 Redis8 source-only integration regression on NO-NIC LXD.
// Does not use the Gold runtime Redis namespace and creates no access grants.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs/promises';
import {createClient} from 'redis';
import {GoldAbV2PendingRedis,AB_V2_A_RE,AB_V2_B_RE,AB_V2_TTL_MS}
 from '../../lib/gold-ab-v2-pending-redis.mjs';
assert.equal(process.env.LR_P2I2_REDIS_TEST_ALLOW,'1','explicit opt-in');
assert.equal(os.hostname(),'gold-p2a-runtime-rollback-20261030','no-NIC clone required');
assert.deepEqual(await fs.readdir('/sys/class/net'),['lo']);
assert.equal(AB_V2_TTL_MS,300000);
const socket=process.env.LR_P2I2_REDIS_SOCKET;
assert.match(String(socket||''),/^\/tmp\/lr_p2i2_[a-z0-9]+\.sock$/);
const client=createClient({socket:{path:socket,reconnectStrategy:false}});
client.on('error',()=>{});
await client.connect();
const prefix='lr:gold:p2i2fixture:';
const key=crypto.randomBytes(32);
const store=new GoldAbV2PendingRedis({redis:client,prefix,sealingKey:key});
const owner='owner-1',actor='agent-owner',device='device-1',connection='connection-1';
const base={ownerAccountId:owner,actorAccountId:actor,agentId:'agent-1',clientId:'oauth-client',
 deviceId:device,connectionId:connection,shortId:'ABCD02'};
const o={ownerAccountId:owner,deviceId:device,connectionId:connection};
const a={actorAccountId:actor,agentId:'agent-1',clientId:'oauth-client',connectionId:connection};
const errors=async(p,re)=>{await assert.rejects(p,re)};
try{
 const issued=await store.issue(base);
 assert.match(issued.bCode,AB_V2_B_RE);
 assert.equal(issued.shortId,'ABCD02');
 assert.equal(Object.hasOwn(issued,'aCode'),false,'Agent should not get A');
 assert.equal(issued.attempt,1);
 const wall=await store.wallView({...o,requestId:issued.requestId});
 assert.match(wall.aCode,AB_V2_A_RE);
 assert.ok(wall.aCode.startsWith('ABCD02-'));
 assert.equal(wall.attempt,1);
 const pendingOne=await store.listDevicePending({...o});
 assert.equal(pendingOne.length,1,'one pending request listed');
 assert.equal(pendingOne[0].requestId,issued.requestId);
 assert.equal(JSON.stringify(pendingOne).includes(issued.bCode),false,'index must not expose B');
 assert.deepEqual(await store.listDevicePending({...o,ownerAccountId:'foreign-owner'}),[],'other owner sees no pending requests');
 assert.deepEqual(await store.listDevicePending({...o,connectionId:'other-connection'}),[],'other connection sees no pending requests');
 await errors(store.listDevicePending({...o,limit:6}),/abv2_index_limit_invalid/);
 assert.equal(JSON.stringify(wall).includes(issued.bCode),false,'B must not be available on Wall');
 const backing=await client.get(store.key(issued.requestId));
 assert.equal(backing.includes(issued.bCode),false,'B cannot be plaintext in Redis');
 assert.equal(backing.includes('bFingerprint'),true);
 const poll=await store.agentPoll({...a,requestId:issued.requestId});
 assert.equal(poll.bCode,issued.bCode);
 const resumedStore=new GoldAbV2PendingRedis({redis:client,prefix,sealingKey:key});
 assert.equal((await resumedStore.agentPoll({...a,requestId:issued.requestId})).bCode,issued.bCode,'restart must recover B from encrypted Redis record');
 await errors(store.agentPoll({...a,agentId:'other-agent',requestId:issued.requestId}),/abv2_agent_scope_denied/);
 await errors(store.wallView({...o,ownerAccountId:'other-owner',requestId:issued.requestId}),/abv2_owner_scope_denied/);
 assert.throws(()=>store.approve({...o,requestId:issued.requestId,expectedAttempt:1,bCode:'NOTA-CODE'}),/abv2_b_format_invalid/);
 // Simulate elapsed 6 seconds inside this throwaway namespace; never trust
 // wall clocks at runtime. Redis TIME still decides the expiration.
 const stored=JSON.parse(await client.get(store.key(issued.requestId)));
 stored.rotatedAt=stored.rotatedAt-6000;
 await client.set(store.key(issued.requestId),JSON.stringify(stored),{KEEPTTL:true});
 await client.pExpire(store.key(issued.requestId),60000); // simulate short storage lifetime before explicit Refresh
 const other=await store.issue({...base,agentId:'agent-2'});
 assert.equal((await store.listDevicePending({...o})).length,2,'two Agent requests independently visible to owner');
 const r=await Promise.allSettled([store.refresh({...o,requestId:issued.requestId,expectedAttempt:1}),
  store.refresh({...o,requestId:issued.requestId,expectedAttempt:1})]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1,'exactly one atomic refresh accepted');
 assert.equal(r.filter(x=>x.status==='rejected').length,1,'stale CAS must be rejected');
 const newWall=await store.wallView({...o,requestId:issued.requestId});
 assert.ok((await client.pTTL(store.key(issued.requestId)))>800000,'explicit Refresh must extend storage TTL enough for its full 5-minute approval period');
 assert.equal(newWall.attempt,2);
 assert.equal((await store.listDevicePending({...o})).find(x=>x.requestId===issued.requestId).attempt,2,'index tracks refreshed generation');
 assert.notEqual(newWall.aCode,wall.aCode);
 assert.equal((await store.wallView({...o,requestId:other.requestId})).attempt,1,'another Agent unaffected');
 const updated=await store.agentPoll({...a,requestId:issued.requestId});
 assert.equal(updated.attempt,2);
 assert.match(updated.bCode,AB_V2_B_RE);
 assert.notEqual(updated.bCode,issued.bCode);
 await errors(store.approve({...o,requestId:issued.requestId,expectedAttempt:1,bCode:issued.bCode}),/abv2_attempt_changed/);
 await errors(store.approve({...o,requestId:issued.requestId,expectedAttempt:2,bCode:issued.bCode}),/abv2_b_invalid/);
 const right=await store.approve({...o,requestId:issued.requestId,expectedAttempt:2,bCode:updated.bCode});
 assert.equal(right.state,'approved');
 assert.equal((await store.listDevicePending({...o})).length,1,'approved request removed from pending index');
 assert.equal((await store.agentPoll({...a,requestId:issued.requestId})).state,'approved');
 await errors(store.approve({...o,requestId:issued.requestId,expectedAttempt:2,bCode:updated.bCode}),/abv2_request_not_pending/);
 await errors(store.refresh({...o,requestId:issued.requestId,expectedAttempt:2}),/abv2_attempt_changed/);
 await store.deny({...o,requestId:other.requestId});
 assert.deepEqual(await store.listDevicePending({...o}),[],'denied request removed from index');
 assert.equal((await store.agentPoll({...a,agentId:'agent-2',requestId:other.requestId})).state,'denied');
 // Server-clock expiry: mutate only in isolated fixture, don't fake client time.
 const exp=await store.issue({...base,agentId:'agent-3'});
 const expState=JSON.parse(await client.get(store.key(exp.requestId)));
 expState.expiresAt=1;
 await client.set(store.key(exp.requestId),JSON.stringify(expState),{KEEPTTL:true});
 const expired=await store.wallView({...o,requestId:exp.requestId});
 assert.equal(expired.state,'expired');
 assert.deepEqual(await store.listDevicePending({...o}),[],'expired request removed from index');
 await errors(store.approve({...o,requestId:exp.requestId,expectedAttempt:1,bCode:exp.bCode}),/abv2_request_not_pending/);
 const bad=await store.issue({...base,agentId:'agent-4'});
 for(let i=0;i<5;i++)await errors(
  store.approve({...o,requestId:bad.requestId,expectedAttempt:1,bCode:'AAAA-AAAA'}),/abv2_b_invalid/);
 assert.equal((await store.wallView({...o,requestId:bad.requestId})).state,'locked');
 assert.deepEqual(await store.listDevicePending({...o}),[],'locked request removed from index');
 await errors(store.approve({...o,requestId:bad.requestId,expectedAttempt:1,bCode:bad.bCode}),/abv2_request_not_pending/);
 for(let i=0;i<3;i++)await store.issue({...base,agentId:'agent-1'});
 await errors(store.issue({...base,agentId:'agent-1'}),/abv2_issue_rate_limited/);
 console.log('GOLD_ABV2_REDIS_CAS_REFRESH_NO_CROSS_AGENT=PASS');
 console.log('GOLD_ABV2_B_SECRET_8CHAR_OWNER_DENIAL=PASS');
 console.log('GOLD_ABV2_SERVER_TIME_300S_AND_NO_OLD_B=PASS');
 console.log('GOLD_ABV2_RATE_LIMIT_REPLAY_EXPIRED=PASS');
}finally{
 const keys=await client.keys(prefix+'abv2:*');
 if(keys.length)await client.del(keys);
 await client.quit();
}
