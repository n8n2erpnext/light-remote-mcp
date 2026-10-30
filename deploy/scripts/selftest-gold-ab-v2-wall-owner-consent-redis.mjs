// Gold P2-I2h2e-C: REAL Redis8 Lua atomic consent on no-NIC rollback clone.
// Strict opt-in, Unix socket only; never connect to Gold live Redis namespace.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import {createClient} from 'redis';
import {GoldAbV2WallOwnerConsent} from '../../lib/gold-ab-v2-wall-owner-consent.mjs';
assert.equal(process.env.LR_P2I2_WALL_CONSENT_REAL_REDIS_ALLOW,'1');
assert.equal(os.hostname(),'gold-p2a-runtime-rollback-20261030');
assert.deepEqual(await fs.readdir('/sys/class/net'),['lo']);
const socket=process.env.LR_P2I2_REDIS_SOCKET;
assert.match(String(socket||''),/^\/tmp\/lr_p2i2_[a-z0-9]+\.sock$/);
const redis=createClient({socket:{path:socket,reconnectStrategy:false}});
redis.on('error',()=>{});
await redis.connect();
const prefix='lr:gold:p2i2consent:';
const key=crypto.randomBytes(32);
const store=new GoldAbV2WallOwnerConsent({redis,prefix,sealingKey:key});
const scope={ownerAccountId:'fixture-owner',deviceId:'fixture-device',
 connectionId:'fixture-connection',requestId:'av2_'+'a'.repeat(32),
 expectedAttempt:2,requestExpiresAt:Date.now()+300000};
try{
 const issued=await store.issue(scope);
 assert.match(issued.consentCode,/^[A-Za-z0-9_-]{32}$/);
 const redisKeys=await redis.keys(prefix+'abv2:wall-owner-consent:*');
 assert.equal(redisKeys.length,1);
 const raw=await redis.get(redisKeys[0]);
 assert.ok(!raw.includes(issued.consentCode));
 const ttl=await redis.ttl(redisKeys[0]);
 assert.ok(ttl>=1&&ttl<=90);
 for(const alter of [{deviceId:'wrong-device'},{connectionId:'wrong-connection'},
  {ownerAccountId:'wrong-owner'},{expectedAttempt:1},
  {requestId:'av2_'+'b'.repeat(32)}]){
  await assert.rejects(store.consume({...scope,...alter,consentCode:issued.consentCode}),
   /abv2_wall_consent_scope_mismatch/);
 }
 await store.consume({...scope,consentCode:issued.consentCode});
 await assert.rejects(store.consume({...scope,consentCode:issued.consentCode}),
  /abv2_wall_consent_expired_or_used/);
 assert.equal(await redis.exists(redisKeys[0]),0);
 const renewed=await store.issue(scope);
 assert.notEqual(renewed.consentCode,issued.consentCode);
 await assert.rejects(store.consume({...scope,requestId:'av2_'+'c'.repeat(32),
  consentCode:renewed.consentCode}),/abv2_wall_consent_scope_mismatch/);
 await store.consume({...scope,consentCode:renewed.consentCode});
 console.log('GOLD_ABV2_REAL_REDIS8_OWNER_CONSENT_ATOMIC_ONE_USE_SCOPE=PASS');
}finally{
 const keys=await redis.keys(prefix+'abv2:wall-owner-consent:*');
 if(keys.length)await redis.del(keys);
 await redis.quit();
}
