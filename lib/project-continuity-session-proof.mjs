/* Authenticated, one-shot remote Project Memory delegation.
 * Issued ONLY by Gold Operator after checking a real account-owned active
 * A/B session and registered device. Owner-pinned broker trust is required.
 */
import crypto from 'node:crypto';

export const PROJECT_REMOTE_READ_PURPOSE='light-remote:continuity:operator-session-read:v1';
export const PROJECT_REMOTE_READ_VALID_MS=6000;
const requireIt=(ok,reason)=>{if(!ok)throw Error(reason);};
const validText=(s,max)=>typeof s==='string'&&s.length>0&&s.length<=max&&/^[A-Za-z0-9._:-]+$/.test(s);
const validProject=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s);
const hashQuery=query=>crypto.createHash('sha256').update(query,'utf8').digest('hex');

export function createProjectReadDelegation({privateKey,accountId,deviceId,agentId,sessionId,
 projectId,requestId,query='',maxChars=8000,now=Date.now()}={}){
 requireIt(validText(accountId,128)&&validText(deviceId,128)&&validText(agentId,128)&&
  validText(sessionId,160),'continuity_operator_identity_invalid');
 requireIt(validProject(projectId)&&validProject(requestId),'continuity_operator_scope_invalid');
 requireIt(typeof query==='string'&&query.length<=300,'continuity_operator_query_invalid');
 requireIt(Number.isInteger(maxChars)&&maxChars>=512&&maxChars<=8000,'continuity_operator_limit_invalid');
 requireIt(Number.isSafeInteger(now)&&now>0,'continuity_operator_clock_invalid');
 const grant={purpose:PROJECT_REMOTE_READ_PURPOSE,accountId,deviceId,agentId,sessionId,
  projectId,requestId,querySha256:hashQuery(query),maxChars,
  issuedAt:now,expiresAt:now+PROJECT_REMOTE_READ_VALID_MS};
 const key=privateKey?.type==='private'?privateKey:crypto.createPrivateKey(privateKey);
 requireIt(key.asymmetricKeyType==='ed25519','continuity_operator_key_invalid');
 const signature=crypto.sign(null,Buffer.from(JSON.stringify(grant)),key).toString('base64url');
 return {grant,signature};
}

export function verifyProjectReadDelegation({proof,publicKey,accountId,deviceId,
 projectId,requestId,query='',maxChars=8000,now=Date.now()}={}){
 requireIt(publicKey,'continuity_operator_trust_missing');
 const grant=proof?.grant,signature=proof?.signature;
 requireIt(grant&&typeof grant==='object'&&!Array.isArray(grant)&&
  typeof signature==='string'&&signature.length<=160,'continuity_operator_proof_invalid');
 requireIt(grant.purpose===PROJECT_REMOTE_READ_PURPOSE,'continuity_operator_purpose_invalid');
 requireIt(grant.accountId===accountId&&grant.deviceId===deviceId&&
  validText(grant.agentId,128)&&validText(grant.sessionId,160),
 'continuity_operator_identity_mismatch');
 requireIt(grant.projectId===projectId&&grant.requestId===requestId&&
  validProject(projectId)&&validProject(requestId),'continuity_operator_scope_invalid');
 requireIt(typeof query==='string'&&query.length<=300&&grant.querySha256===hashQuery(query) &&
  Number.isInteger(maxChars)&&maxChars>=512&&maxChars<=8000&&grant.maxChars===maxChars,
 'continuity_operator_request_mismatch');
 requireIt(Number.isSafeInteger(grant.issuedAt)&&Number.isSafeInteger(grant.expiresAt)
  &&grant.expiresAt-grant.issuedAt===PROJECT_REMOTE_READ_VALID_MS&&
  grant.issuedAt<=now+1000&&grant.expiresAt>now,'continuity_operator_proof_expired');
 let sig;
 try{sig=Buffer.from(signature,'base64url');}catch{throw Error('continuity_operator_proof_invalid');}
 const key=publicKey?.type==='public'?publicKey:crypto.createPublicKey(publicKey);
 requireIt(key.asymmetricKeyType==='ed25519'&&sig.length===64&&
  crypto.verify(null,Buffer.from(JSON.stringify(grant)),key,sig),
 'continuity_operator_signature_invalid');
 return grant;
}
