// Operator-issued, account-session-authorized ONE-TIME consent for signed Wall.
// Device enrollment signature proves device identity, not owner intent.
// Owner must obtain this consent while authenticated in /account; Wall cannot
// manufacture it. No plaintext consent code is stored in Redis.
import crypto from 'node:crypto';
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const REQUEST=/^av2_[a-f0-9]{32}$/;
const TOKEN=/^[A-Za-z0-9_-]{32}$/;
const LUA=[
 "local body=redis.call('GET',KEYS[1])",
 "if not body then return 0 end",
 "if body~=ARGV[1] then return -1 end",
 "redis.call('DEL',KEYS[1])",
 "return 1"
].join('\n');
export class GoldAbV2WallConsentError extends Error{
 constructor(reason,status=403){super(reason);this.name='GoldAbV2WallConsentError';this.status=status;}
}
const deny=(why,status=403)=>{throw new GoldAbV2WallConsentError(why,status);};
export class GoldAbV2WallOwnerConsent {
 constructor({redis,prefix,sealingKey,now=Date.now,randomBytes=crypto.randomBytes}={}){
  if(!redis||typeof redis.set!=='function'||typeof redis.eval!=='function'||
    !/^lr:gold:[a-z0-9_-]+:$/.test(prefix||'')||
    !Buffer.isBuffer(sealingKey)||sealingKey.length!==32)
    deny('abv2_wall_consent_dependencies_invalid',503);
  Object.assign(this,{redis,prefix,now,randomBytes});
  this.key=crypto.createHmac('sha256',sealingKey)
   .update('light-remote:abv2:wall-owner-consent:v1').digest();
 }
 scope(p={}){
  const owner=p.ownerAccountId,device=p.deviceId,connection=p.connectionId,
   requestId=p.requestId,attempt=p.expectedAttempt;
  if(!ID.test(owner||'')||!ID.test(device||'')||!ID.test(connection||'')||
     !REQUEST.test(requestId||'')||!Number.isSafeInteger(attempt)||attempt<1)
   deny('abv2_wall_consent_scope_invalid',400);
  return JSON.stringify([owner,device,connection,requestId,attempt]);
 }
 storageKey(code){
  if(!TOKEN.test(String(code||'')))deny('abv2_wall_consent_code_invalid',400);
  const digest=crypto.createHmac('sha256',this.key)
   .update('key|'+code).digest('hex');
  return this.prefix+'abv2:wall-owner-consent:'+digest;
 }
 async issue(input={}){
  const scope=this.scope(input),validUntil=Number(input.requestExpiresAt);
  const now=this.now();
  if(!Number.isSafeInteger(validUntil)||validUntil<=now)
   deny('abv2_wall_consent_request_expired',409);
  const ttl=Math.min(90,Math.ceil((validUntil-now)/1000));
  if(ttl<1)deny('abv2_wall_consent_expired',409);
  const code=this.randomBytes(24).toString('base64url');
  if(!TOKEN.test(code))deny('abv2_wall_consent_random_invalid',503);
  const value=crypto.createHmac('sha256',this.key)
   .update('scope|'+scope).digest('hex');
  if(await this.redis.set(this.storageKey(code),value,{NX:true,EX:ttl})!=='OK')
   deny('abv2_wall_consent_collision',503);
  return {consentCode:code,expiresAt:Math.min(validUntil,now+ttl*1000),
   requestId:input.requestId};
 }
 async consume(input={}){
  const code=input.consentCode;
  const scope=this.scope(input);
  const expected=crypto.createHmac('sha256',this.key)
   .update('scope|'+scope).digest('hex');
  const result=Number(await this.redis.eval(LUA,{keys:[this.storageKey(code)],
   arguments:[expected]}));
  if(result!==1)deny(result===0?'abv2_wall_consent_expired_or_used':
   'abv2_wall_consent_scope_mismatch',403);
  return {consumed:true};
 }
}
