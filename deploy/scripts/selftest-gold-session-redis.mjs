import assert from 'node:assert/strict';
import {GoldSessionRedis} from '../../lib/gold-session-redis.mjs';
import {SessionRegistry} from '../../operator-host/session-manager.mjs';
const kv=new Map();
const client={
 async get(key){return kv.get(key)??null},
 async set(key,value,{EX}={}){assert.equal(EX,604800);kv.set(key,value);return 'OK'}
};
const opts={client,prefix:'lr:gold:synthetic:'};
const first=await GoldSessionRedis.open(opts);
const session=first.mount(new SessionRegistry({accountId:'gold_account',deviceId:'gold_device',nodeId:'gold_node'}));
const opened=session.open({accountId:'gold_account',deviceId:'gold_device',nodeId:'gold_node',agentId:'test_agent_identity_12345',label:'Gold session'});
await first.flush();
assert.equal(JSON.parse(kv.get('lr:gold:synthetic:runtime:sessions')).sessions.length,1);
const second=await GoldSessionRedis.open(opts);
const restored=second.mount(new SessionRegistry({accountId:'gold_account',deviceId:'gold_device',nodeId:'gold_node'}));
assert.equal(restored.get(opened.sessionId,'test_agent_identity_12345').sessionId,opened.sessionId);
await second.flush();
console.log('GOLD_REDIS_SESSION_RESTART_FAKE=PASS');
