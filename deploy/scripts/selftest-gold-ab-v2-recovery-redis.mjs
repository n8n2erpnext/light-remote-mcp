import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createClient} from 'redis';
import {GoldAbV2PendingRedis} from '../../lib/gold-ab-v2-pending-redis.mjs';
// Explicit opt-in and throwaway Unix socket only. NEVER target Gold Redis.
assert.equal(process.env.LR_ABV2_RECOVERY_ISOLATED,'1');
const socket=process.env.LR_ABV2_RECOVERY_REDIS_SOCKET;
const url=process.env.LR_ABV2_RECOVERY_REDIS_URL;
if(socket){
 assert.match(socket,/^\/tmp\/lr-abv2-recovery-[a-z0-9_-]+\/redis\.sock$/);
}else{
 // Only a loopback-bound, throwaway container. Never allow remote Redis here.
 assert.match(String(url||''),/^redis:\/\/127\.0\.0\.1:[0-9]{4,5}$/);
}
const client=createClient(socket?{socket:{path:socket,reconnectStrategy:false}}:
 {url,socket:{reconnectStrategy:false}});
client.on('error',()=>{});await client.connect();
const prefix='lr:gold:recoveryfixture:';
const secret=crypto.randomBytes(32);
const store=new GoldAbV2PendingRedis({redis:client,prefix,sealingKey:secret});
const base={ownerAccountId:'owner1',actorAccountId:'owner1',
 agentId:'agent1',clientId:'oauth-client1',deviceId:'dev1',
 connectionId:'conn1',shortId:'ABCD02'};
const agent={actorAccountId:'owner1',agentId:'agent1',clientId:'oauth-client1'};
try{
 const one=await store.issue({...base,requestKey:'a'.repeat(32)});
 assert.equal(one.state,'pending');
 assert.equal((await store.recoverAgent(agent)).requestId,one.requestId);
 assert.equal((await store.recoverAgent(agent)).bCode,one.bCode);
 const resumed=new GoldAbV2PendingRedis({redis:client,prefix,sealingKey:secret});
 assert.equal((await resumed.recoverAgent(agent)).bCode,one.bCode,
  'server restart with durable Redis+seal key recovers exact pending B');
 assert.equal((await store.recoverAgent({...agent,agentId:'agent2'})).state,'none');
 // Owner explicit Refresh only: rotate B under the exact same request.
 const firstRaw=JSON.parse(await client.get(store.key(one.requestId)));
 firstRaw.rotatedAt-=6000;
 await client.set(store.key(one.requestId),JSON.stringify(firstRaw),{KEEPTTL:true});
 const refresh=await store.refresh({ownerAccountId:'owner1',deviceId:'dev1',
  connectionId:'conn1',requestId:one.requestId,expectedAttempt:1});
 assert.equal(refresh.attempt,2);
 const newer=await resumed.recoverAgent(agent);
 assert.notEqual(newer.bCode,one.bCode);
 assert.equal(newer.attempt,2);
 await assert.rejects(store.approve({ownerAccountId:'owner1',deviceId:'dev1',
  connectionId:'conn1',requestId:one.requestId,expectedAttempt:2,
  bCode:one.bCode}),/abv2_b_invalid/,'obsolete B denied after explicit refresh');
 const duplicate=await store.issue({...base,requestKey:'a'.repeat(32)});
 assert.equal(duplicate.reused,true);assert.equal(duplicate.requestId,one.requestId);
 const other=await store.issue({...base,agentId:'agent2',clientId:'oauth-client2'});
 assert.equal((await store.recoverAgent({...agent,agentId:'agent2',clientId:'oauth-client2'})).requestId,other.requestId);
 const second=await store.issue({...base,requestKey:'b'.repeat(32)});
 assert.notEqual(second.requestId,one.requestId);
 assert.equal((await store.recoverAgent(agent)).state,'ambiguous');
 await store.deny({ownerAccountId:'owner1',deviceId:'dev1',connectionId:'conn1',requestId:one.requestId});
 assert.equal((await store.recoverAgent(agent)).requestId,second.requestId);
 assert.equal((await store.recoverAgent(agent)).bCode,second.bCode);
 const pending=await client.get(store.key(second.requestId));
 assert.ok(!pending.includes(second.bCode),'Redis never stores plaintext B');
 // Simulate server clock expiry without sleeping; both indexes still exist.
 const r=JSON.parse(pending);r.expiresAt=1;
 await client.set(store.key(second.requestId),JSON.stringify(r),{KEEPTTL:true});
 assert.equal((await store.recoverAgent(agent)).state,'none');
 assert.equal((await store.recoverAgent(agent)).state,'none');
 console.log('GOLD_ABV2_NATIVE_REDIS8_OAUTH_INDEX_EXACT_RECOVERY=PASS');
 console.log('GOLD_ABV2_NATIVE_REDIS8_2AGENT_AMBIGUOUS_DENY_EXPIRY=PASS');
}finally{
 await client.quit();
}
