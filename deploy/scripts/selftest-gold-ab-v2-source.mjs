// No Redis connections. Check the public 6+5/4+4 contract and secret
// handling at CI, while true Redis CAS races run on the no-NIC LXD clone.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {GoldAbV2PendingRedis,AB_V2_TTL_MS,AB_V2_A_RE,AB_V2_B_RE}
 from '../../lib/gold-ab-v2-pending-redis.mjs';
assert.equal(AB_V2_TTL_MS,300000);
assert.match('ABCD02-GHFDX',AB_V2_A_RE);
assert.match('7KPX-42NM',AB_V2_B_RE);
assert.ok(!AB_V2_A_RE.test('ABCD02-GHFDX7'));
assert.ok(!AB_V2_B_RE.test('7KPX-42N'));
const captured=[];
const client={eval:async(script,{keys,arguments:args})=>{
 captured.push({script,keys,args:JSON.parse(args[1])});
 return JSON.stringify({requestId:captured.at(-1).args.requestId,
  state:'pending',attempt:1,expiresAt:1700000300000});
}};
const store=new GoldAbV2PendingRedis({redis:client,prefix:'lr:gold:sourcefixture:',
 sealingKey:crypto.randomBytes(32)});
const ids=new Set();
for(let i=0;i<40;i++){
 const issued=await store.issue({ownerAccountId:'owner',actorAccountId:'owner',
  agentId:'agent',clientId:'client',deviceId:'device',connectionId:'connection',
  shortId:'ABCD02'});
 assert.match(issued.bCode,AB_V2_B_RE);
 assert.equal(issued.shortId,'ABCD02');
 assert.ok(!Object.hasOwn(issued,'aCode'),'agent response must not contain A');
 ids.add(issued.requestId);
 const row=captured.at(-1).args;
 assert.equal(row.shortId,'ABCD02');
 assert.equal(row.bFingerprint.length,64);
 assert.equal(row.codeHash.length,64);
 assert.ok(!JSON.stringify(row).includes(issued.bCode));
 assert.ok(row.box?.iv&&row.box?.ct&&row.box?.tag);
}
assert.equal(ids.size,40,'CSPRNG request identifiers unique in fixture');
// Owner and Guest pairing are purpose-isolated security domains.
const guest=await store.issue({ownerAccountId:'owner',
 actorAccountId:'guest',agentId:'guest-agent',clientId:'guest-client',
 deviceId:'device',connectionId:'connection',shortId:'ABCD02',
 purpose:'pro-share-guest'});
assert.match(guest.bCode,AB_V2_B_RE);
assert.equal(captured.at(-1).args.purpose,'pro-share-guest');
assert.equal(captured.at(-1).args.actor,'guest');
await assert.rejects(store.issue({ownerAccountId:'owner',
 actorAccountId:'guest',agentId:'guest-agent',clientId:'guest-client',
 deviceId:'device',connectionId:'connection',shortId:'ABCD02',
 purpose:'device'}),/abv2_invalid_actor_purpose/);
await assert.rejects(store.issue({ownerAccountId:'owner',
 actorAccountId:'owner',agentId:'agent',clientId:'client',
 deviceId:'device',connectionId:'connection',shortId:'ABCD02',
 purpose:'pro-share-guest'}),/abv2_invalid_actor_purpose/);

await assert.rejects(store.issue({ownerAccountId:'owner',actorAccountId:'owner',
 agentId:'agent',clientId:'client',deviceId:'device',connectionId:'connection',
 shortId:'BADBAD!'}),/abv2_short_id_invalid/);
assert.throws(()=>new GoldAbV2PendingRedis({redis:client,prefix:'lr:gold:x:',
 sealingKey:crypto.randomBytes(12)}),/abv2_redis_secret_required/);
console.log('GOLD_ABV2_SOURCE_6PLUS5_B4PLUS4_AND_SEALED_B=PASS');

// Check the actual canonical Operator wiring; unit module existence is
// NOT equivalent to the HTTP routes being mounted. These handlers remain
// fail-closed unless their individual source/UAT feature flags are ON.
import fs from 'node:fs';
const runtime=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
for(const [name,handler] of [
 ['OwnerHttp','goldAbV2OwnerHttp'],
 ['HelperTarget','goldAbV2HelperTarget'],
 ['HelperPoll','goldAbV2HelperPoll']
]){
 assert.match(runtime,new RegExp('const '+handler+'=createGoldAbV2'+name+'(?:FromOperator)?\\('));
 assert.match(runtime,new RegExp('await '+handler+'\\(req,res,url\\)'));
}
for(const name of ['SignedPreview','SignedApproval']){
 assert.match(runtime,new RegExp('const goldAbV2'+name+'=createGoldAbV2'+name+'\\('));
 assert.match(runtime,new RegExp('routeDeps=\\(\\)=>\\([\\s\\S]*goldAbV2'+name));
}
for(const [file,flag] of [
 ['gold-ab-v2-owner-http.mjs','LR_GOLD_AB_V2_OWNER_PENDING_HTTP'],
 ['gold-ab-v2-helper-target.mjs','LR_GOLD_AB_V2_HELPER_TARGET_QUERY'],
 ['gold-ab-v2-helper-poll.mjs','LR_GOLD_AB_V2_HELPER_POLL_ATTACH']
]){
 const src=fs.readFileSync(new URL('../../operator-host/'+file,import.meta.url),'utf8');
 assert.ok(src.includes('env.'+flag+"==='1'"),file+' requires explicit ON flag');
}
assert.match(runtime,/await goldAbV2OwnerHttp\(req,res,url\)/);
assert.match(runtime,/if\(await goldAbV2HelperTarget\(req,res,url\)\)return/);
assert.match(runtime,/if\(await goldAbV2HelperPoll\(req,res,url\)\)return/);
console.log('GOLD_ABV2_CANONICAL_OPERATOR_HTTP_MOUNT_FLAG_GATES=PASS');
