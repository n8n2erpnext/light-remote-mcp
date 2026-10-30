// Gold P2-I2h2e-C: one-use, server-session issued owner consent,
// exact request/attempt/connection binding and atomic Redis consumption.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {GoldAbV2WallOwnerConsent} from '../../lib/gold-ab-v2-wall-owner-consent.mjs';
const secret=crypto.randomBytes(32),rows=new Map();
let now=1800000000000;
const redis={
 set:async(k,v,opts)=>{
  assert.equal(opts.NX,true);assert.ok(opts.EX>0&&opts.EX<=90);
  if(rows.has(k))return null;
  rows.set(k,{value:v,expiresAt:now+opts.EX*1000});return 'OK';
 },
 eval:async(lua,{keys,arguments:args})=>{
  assert.match(lua,/redis.call\('DEL'/);
  const r=rows.get(keys[0]);
  if(!r||r.expiresAt<=now)return 0;
  if(r.value!==args[0])return -1;
  rows.delete(keys[0]);return 1;
 }
};
const consent=new GoldAbV2WallOwnerConsent({
 redis,prefix:'lr:gold:fixture:',sealingKey:secret,now:()=>now
});
const input={ownerAccountId:'acct1',deviceId:'dev1',connectionId:'conn1',
 requestId:'av2_'+'a'.repeat(32),expectedAttempt:1,requestExpiresAt:now+300000};
const issue=async()=>consent.issue(input);
const first=await issue();
assert.match(first.consentCode,/^[A-Za-z0-9_-]{32}$/);
assert.equal(first.expiresAt,now+90000);
assert.equal(rows.size,1);
assert.ok(!JSON.stringify([...rows.values()]).includes(first.consentCode),
 'Redis contains only HMAC hash, no plaintext token');
for(const changed of [
 {ownerAccountId:'other'},{deviceId:'dev2'},{connectionId:'changed'},
 {requestId:'av2_'+'b'.repeat(32)},{expectedAttempt:2}
]){
 await assert.rejects(consent.consume({...input,...changed,consentCode:first.consentCode}),
  /abv2_wall_consent_scope_mismatch/);
}
assert.equal(rows.size,1,'wrong scope cannot consume another owner consent');
assert.deepEqual(await consent.consume({...input,consentCode:first.consentCode}),
 {consumed:true});
await assert.rejects(consent.consume({...input,consentCode:first.consentCode}),
 /abv2_wall_consent_expired_or_used/);
const second=await issue();
now+=90001;
await assert.rejects(consent.consume({...input,consentCode:second.consentCode}),
 /abv2_wall_consent_expired_or_used/);
const third=await issue();
assert.notEqual(third.consentCode,second.consentCode);
await assert.rejects(consent.consume({...input,consentCode:'bad'}),
 /abv2_wall_consent_code_invalid/);
assert.equal((await consent.consume({...input,consentCode:third.consentCode})).consumed,true);
assert.throws(()=>new GoldAbV2WallOwnerConsent({redis,prefix:'wrong:',sealingKey:secret}),
 /abv2_wall_consent_dependencies_invalid/);
console.log('GOLD_ABV2_OWNER_SESSION_CONSENT_ONE_TIME_SCOPE_EXPIRY_REPLAY=PASS');
