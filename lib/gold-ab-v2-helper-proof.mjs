// P2-I2g: authenticated OAuth Plugin -> private Operator target lookup proof.
// Dedicated domain-separated HMAC; target selection never authorizes access.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const SIG=/^[A-Za-z0-9_-]{43}$/;
const NONCE=/^[a-f0-9]{32}$/;
export class GoldAbV2HelperProofError extends Error{
 constructor(message,status=403){super(message);this.status=status;this.name='GoldAbV2HelperProofError';}
}
function invalid(message,status=403){throw new GoldAbV2HelperProofError(message,status);}
export function goldAbV2HelperKey(env=process.env){
 const root=fs.realpathSync(String(env.LIGHT_REMOTE_GOLD_ROOT||''));
 const filename=fs.realpathSync(String(env.LR_GOLD_AB_V2_HELPER_PROOF_KEY_FILE||''));
 if(!filename.startsWith(root+path.sep)||!fs.statSync(filename).isFile()||
    (fs.statSync(filename).mode&0o077)!==0)
  invalid('abv2_helper_key_permissions_invalid',503);
 const key=fs.readFileSync(filename);
 if(key.length!==32)invalid('abv2_helper_key_length_invalid',503);
 return crypto.createHmac('sha256',key).update('light-remote:gold-abv2:oauth-helper-proof:v1').digest();
}
export function stableGoldV2AgentId({accountId,clientId}={}){
 if(!ID.test(accountId||'')||typeof clientId!=='string'||
   clientId.length<16||clientId.length>8192||
   !/^[A-Za-z0-9._~:-]+$/.test(clientId))
  invalid('abv2_helper_principal_invalid',401);
 return 'plugin-'+crypto.createHash('sha256').update(accountId+'|'+clientId).digest('hex').slice(0,40);
}
function canonical(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  invalid('abv2_helper_proof_invalid',401);
 const {accountId,clientId,agentId,targetQuery,iat,nonce}=payload;
 if(!ID.test(accountId||'')||
    agentId!==stableGoldV2AgentId({accountId,clientId})||
    typeof targetQuery!=='string'||!targetQuery.trim()||targetQuery.length>120||
    /[\u0000-\u001f\u007f]/.test(targetQuery)||targetQuery.trim()!==targetQuery||
    !Number.isSafeInteger(iat)||!NONCE.test(nonce||''))
  invalid('abv2_helper_proof_invalid',401);
 return JSON.stringify(['gold-abv2-helper-target-v1',accountId,clientId,agentId,targetQuery,iat,nonce]);
}
export function signGoldAbV2HelperTarget({identity,targetQuery,key,now=Date.now(),randomBytes=crypto.randomBytes}={}){
 if(!Buffer.isBuffer(key)||key.length!==32)invalid('abv2_helper_sign_key_invalid',503);
 const accountId=identity?.accountId,clientId=identity?.clientId;
 const payload={accountId,clientId,agentId:stableGoldV2AgentId({accountId,clientId}),
  targetQuery:String(targetQuery||'').trim(),iat:now,nonce:randomBytes(16).toString('hex')};
 const sig=crypto.createHmac('sha256',key).update(canonical(payload)).digest('base64url');
 return {...payload,signature:sig};
}
export async function verifyGoldAbV2HelperTarget({proof,key,redis,prefix,now=Date.now()}={}){
 if(!Buffer.isBuffer(key)||key.length!==32||!redis?.set||
   !/^lr:gold:[a-z0-9_-]+:$/.test(prefix||''))
  invalid('abv2_helper_verifier_unavailable',503);
 const signed=canonical(proof);
 if(!SIG.test(String(proof.signature||'')))invalid('abv2_helper_signature_invalid',401);
 const a=Buffer.from(proof.signature),b=Buffer.from(crypto.createHmac('sha256',key)
  .update(signed).digest('base64url'));
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b))
  invalid('abv2_helper_signature_invalid',401);
 if(Math.abs(now-proof.iat)>30000)invalid('abv2_helper_proof_expired',401);
 const replay=prefix+'abv2:helper-proof:'+crypto.createHash('sha256')
  .update(proof.accountId+'|'+proof.clientId+'|'+proof.nonce).digest('hex');
 const first=await redis.set(replay,'1',{NX:true,EX:90});
 if(first!=='OK')invalid('abv2_helper_proof_replayed',409);
 return {accountId:proof.accountId,clientId:proof.clientId,
  agentId:proof.agentId,targetQuery:proof.targetQuery};
}
