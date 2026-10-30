// Gold P2-I2h2e-B. Distinct HMAC proof only for OAuth Helper V2 poll.
// Never accept client/Agent identity from a user-facing body: the Plugin
// signs the verified OAuth principal server-side with an isolated key.
import crypto from 'node:crypto';
import {goldAbV2HelperKey,stableGoldV2AgentId,GoldAbV2HelperProofError}
 from './gold-ab-v2-helper-proof.mjs';
const REQUEST=/^av2_[a-f0-9]{32}$/;
const SHORT=/^[0-9A-HJKMNP-TV-Z]{6}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const NONCE=/^[a-f0-9]{32}$/;
const SIG=/^[A-Za-z0-9_-]{43}$/;
const fail=(reason,status=403)=>{throw new GoldAbV2HelperProofError(reason,status)};
function canonical(p){
 if(!p||typeof p!=='object'||Array.isArray(p))fail('abv2_poll_proof_invalid',401);
 const {accountId,clientId,agentId,deviceId,shortId,requestId,iat,nonce,purpose}=p;
 if(purpose!=='poll'||!ID.test(accountId||'')||
    agentId!==stableGoldV2AgentId({accountId,clientId})||
    !ID.test(deviceId||'')||!SHORT.test(shortId||'')||
    !REQUEST.test(requestId||'')||
    !Number.isSafeInteger(iat)||!NONCE.test(nonce||''))
  fail('abv2_poll_proof_invalid',401);
 return JSON.stringify(['lr-abv2-poll-v1',accountId,clientId,agentId,deviceId,shortId,requestId,iat,nonce]);
}
const pollKey=key=>crypto.createHmac('sha256',key)
 .update('light-remote:gold-abv2:poll-proof:v1').digest();
export function signGoldAbV2HelperPoll({identity,deviceId,shortId,requestId,
 env=process.env,key=goldAbV2HelperKey(env),now=Date.now(),randomBytes=crypto.randomBytes}={}){
 if(!Buffer.isBuffer(key)||key.length!==32)fail('abv2_poll_key_invalid',503);
 const p={purpose:'poll',accountId:identity?.accountId,clientId:identity?.clientId,
  agentId:stableGoldV2AgentId(identity),deviceId,shortId,requestId,
  iat:now,nonce:randomBytes(16).toString('hex')};
 const signature=crypto.createHmac('sha256',pollKey(key))
  .update(canonical(p)).digest('base64url');
 return {...p,signature};
}
export async function verifyGoldAbV2HelperPoll({proof,key,redis,prefix,
 now=Date.now()}={}){
 if(!Buffer.isBuffer(key)||key.length!==32||typeof redis?.set!=='function'||
    !/^lr:gold:[a-z0-9_-]+:$/.test(prefix||''))
  fail('abv2_poll_verifier_unavailable',503);
 const signed=canonical(proof);
 if(!SIG.test(proof.signature||''))fail('abv2_poll_signature_invalid',401);
 const got=Buffer.from(proof.signature,'base64url');
 const expected=crypto.createHmac('sha256',pollKey(key)).update(signed).digest();
 if(got.length!==expected.length||!crypto.timingSafeEqual(got,expected))
  fail('abv2_poll_signature_invalid',401);
 if(Math.abs(now-proof.iat)>30000)fail('abv2_poll_proof_expired',401);
 const replay=prefix+'abv2:poll-proof:'+crypto.createHash('sha256')
  .update(proof.accountId+'|'+proof.clientId+'|'+proof.nonce).digest('hex');
 if(await redis.set(replay,'1',{NX:true,EX:90})!=='OK')
  fail('abv2_poll_proof_replayed',409);
 return {accountId:proof.accountId,clientId:proof.clientId,
  agentId:proof.agentId,deviceId:proof.deviceId,shortId:proof.shortId,
  requestId:proof.requestId};
}
