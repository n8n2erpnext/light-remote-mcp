// Gold P2-I4C3b2: signed, private OAuth-to-Guest queue identity boundary.
// The Plugin signs only a verified OAuth principal in its guarded handler;
// the Operator never accepts an unverified actor, agent, grant or owner from
// an MCP/user body. This is NOT an execution grant or command payload.
import crypto from 'node:crypto';
import {goldAbV2HelperKey,stableGoldV2AgentId,
 GoldAbV2HelperProofError} from '../lib/gold-ab-v2-helper-proof.mjs';
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const NONCE=/^[a-f0-9]{32}$/;
const KEY=/^[a-f0-9]{32}$/;
const SIG=/^[A-Za-z0-9_-]{43}$/;
const OPERATIONS=new Set(['exec','fs','search','process','terminal','scp','desktop']);
const FIELDS=['purpose','accountId','clientId','agentId','deviceId',
 'requestKey','operation','requiredCapabilities','iat','nonce','signature'];
const fail=(why,status=403)=>{throw new GoldAbV2HelperProofError(why,status)};
const subkey=k=>crypto.createHmac('sha256',k)
 .update('light-remote:gold-pro-share:guest-queue-oauth-proof:v1').digest();
function canonical(p){
 if(!p||typeof p!=='object'||Array.isArray(p)||
    Object.keys(p).sort().join('|')!==[...FIELDS].sort().join('|'))
  fail('guest_queue_proof_fields_invalid',401);
 if(p.purpose!=='guest-queue'||!ID.test(p.accountId||'')||
    p.agentId!==stableGoldV2AgentId(p)||
    !ID.test(p.deviceId||'')||!KEY.test(p.requestKey||'')||
    !OPERATIONS.has(p.operation)||
    !Array.isArray(p.requiredCapabilities)||p.requiredCapabilities.length>32||
    p.requiredCapabilities.some(x=>typeof x!=='string'||!ID.test(x)||
     x.length>80)||
    JSON.stringify([...new Set(p.requiredCapabilities)].sort())!==
     JSON.stringify(p.requiredCapabilities)||
    !Number.isSafeInteger(p.iat)||!NONCE.test(p.nonce||'')||
    !SIG.test(p.signature||''))
  fail('guest_queue_proof_invalid',401);
 return JSON.stringify(['guest-queue-oauth-v1',p.accountId,p.clientId,
  p.agentId,p.deviceId,p.requestKey,p.operation,p.requiredCapabilities,p.iat,p.nonce]);
}
export function signGoldGuestQueueProof({identity,deviceId,requestKey,
 operation,requiredCapabilities=[],env=process.env,
 key=goldAbV2HelperKey(env),now=Date.now(),
 randomBytes=crypto.randomBytes}={}){
 const normalized=[...new Set(requiredCapabilities)].sort();
 const p={purpose:'guest-queue',accountId:identity?.accountId,
  clientId:identity?.clientId,agentId:stableGoldV2AgentId(identity),
  deviceId,requestKey,operation,requiredCapabilities:normalized,
  iat:now,nonce:randomBytes(16).toString('hex'),signature:'A'.repeat(43)};
 const bytes=canonical(p);
 if(!Buffer.isBuffer(key)||key.length!==32)fail('guest_queue_proof_key_invalid',503);
 return {...p,signature:crypto.createHmac('sha256',subkey(key))
  .update(bytes).digest('base64url')};
}
export async function verifyGoldGuestQueueProof({proof,key,redis,prefix,
 now=Date.now()}={}){
 if(!Buffer.isBuffer(key)||key.length!==32||
    !redis?.set||!/^lr:gold:[a-z0-9_-]+:$/.test(prefix||''))
  fail('guest_queue_proof_verifier_unavailable',503);
 const bytes=canonical(proof);
 const expected=crypto.createHmac('sha256',subkey(key)).update(bytes).digest();
 const actual=Buffer.from(proof.signature,'base64url');
 if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))
  fail('guest_queue_signature_invalid',401);
 if(Math.abs(now-proof.iat)>30000)fail('guest_queue_proof_expired',401);
 const replay=prefix+'pro-share:guest-queue:proof:'+crypto.createHash('sha256')
  .update(bytes).digest('hex');
 if(await redis.set(replay,'1',{NX:true,EX:90})!=='OK')
  fail('guest_queue_proof_replayed',409);
 return Object.freeze({accountId:proof.accountId,clientId:proof.clientId,
  agentId:proof.agentId,deviceId:proof.deviceId,
  requestKey:proof.requestKey,operation:proof.operation,
  requiredCapabilities:Object.freeze([...proof.requiredCapabilities]),
  verified:true});
}
