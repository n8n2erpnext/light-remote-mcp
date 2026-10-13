/**
 * rc50 SOURCE-ONLY synthetic owner approval origin contract.
 * This does NOT authenticate a real Local Wall session or produce a
 * production proof. The fixture signer is ephemeral and NOT a trusted key.
 * It models a future owner-authenticated, device-bound approval receipt.
 */
import crypto from 'node:crypto';
const DOMAIN='LIGHT_REMOTE_RC50_FAKE_WALL_APPROVAL_ORIGIN_V1\n';
const FIELDS=['kind','requestId','grantId','ownerAccountId','accountId','deviceId',
  'connectionId','agentId','deviceKeySha256','ownerSessionSha256',
  'wallDecisionNonceSha256','channelAckSha256','requestCreatedAt',
  'requestExpiresAt','approvedAt','grantExpiresAt','absoluteExpiresAt',
  'action','purpose'];
const ID=/^uat_[A-Za-z0-9_-]{4,90}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const goodInt=n=>Number.isSafeInteger(n)&&n>=0;
const exact=(o,keys)=>Boolean(o&&typeof o==='object'&&!Array.isArray(o)
  &&Object.keys(o).sort().join(',')===keys.slice().sort().join(','));
const canonical=o=>Buffer.from(DOMAIN+JSON.stringify(Object.fromEntries(
  FIELDS.map(k=>[k,o[k]]))),'utf8');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=(reason)=>Object.freeze({decision:'DENY',reason,originVerified:false});
const pubKey=k=>k?.type==='public'&&k.asymmetricKeyType==='ed25519';
function shape(p){
  if(!exact(p,FIELDS)||p.kind!=='uat_wall_approval_origin'||p.action!=='approve'
   ||p.purpose!=='device'||!['ownerAccountId','accountId','deviceId',
     'requestId','grantId','connectionId','agentId'].every(k=>ID.test(p[k]||''))
   ||!['deviceKeySha256','ownerSessionSha256','wallDecisionNonceSha256',
      'channelAckSha256'].every(k=>DIGEST.test(p[k]||''))
   ||p.accountId!==p.ownerAccountId
   ||![p.requestCreatedAt,p.requestExpiresAt,p.approvedAt,
     p.grantExpiresAt,p.absoluteExpiresAt].every(goodInt)
   ||p.requestExpiresAt<=p.requestCreatedAt
   ||p.requestExpiresAt-p.requestCreatedAt>600000
   ||p.approvedAt<p.requestCreatedAt||p.approvedAt>=p.requestExpiresAt
   ||p.grantExpiresAt<=p.approvedAt||p.grantExpiresAt>p.absoluteExpiresAt
   ||p.absoluteExpiresAt>p.approvedAt+86400000)
    throw Error('invalid_synthetic_wall_provenance_shape');
  return p;
}
export function syntheticWallOriginFingerprint(key){
  if(!pubKey(key))throw Error('invalid_wall_origin_verifier');
  return sha(key.export({type:'spki',format:'der'}));
}
/** Strictly fake signer used by the test suite; never called by Local Wall. */
export function signSyntheticWallApprovalOrigin(privateKey,record){
  if(privateKey?.type!=='private'||privateKey.asymmetricKeyType!=='ed25519')
    throw Error('invalid_synthetic_wall_signer');
  shape(record);
  return {payload:record,signature:crypto.sign(null,canonical(record),privateKey).toString('base64url')};
}
/**
 * A future trusted receiver MUST authenticate the approval channel and
 * derive expected owner/device/grant/session/key pin from local/DB state.
 * A signed payload alone is not proof of a real B-code owner decision.
 * testNow is used ONLY by synthetic harness (not network request).
 */
export function verifySyntheticWallApprovalOrigin(packet,{
  pinnedWallPublicKey,expected,now=Date.now()
}={}){
  if(!pubKey(pinnedWallPublicKey))return deny('WALL_ISSUER_NOT_PINNED');
  if(!exact(packet,['payload','signature'])||!SIG.test(packet?.signature||''))
    return deny('MALFORMED_SIGNED_WALL_RECEIPT');
  let p;
  try{p=shape(packet.payload);}catch{return deny('WALL_RECEIPT_SHAPE_INVALID');}
  if(!crypto.verify(null,canonical(p),pinnedWallPublicKey,
     Buffer.from(packet.signature,'base64url')))
    return deny('WALL_RECEIPT_SIGNATURE_INVALID');
  if(!expected||typeof expected!=='object')
    return deny('TRUSTED_ORIGIN_EXPECTATIONS_MISSING');
  const mandatory=['requestId','grantId','ownerAccountId','accountId','deviceId',
    'connectionId','agentId','deviceKeySha256','ownerSessionSha256',
    'channelAckSha256','purpose'];
  if(mandatory.some(k=>p[k]!==expected[k]))return deny('ORIGIN_NOT_BOUND_TO_TRUSTED_STATE');
  if(!goodInt(now)||now<p.approvedAt||now>=p.grantExpiresAt||
     now>=p.absoluteExpiresAt)
    return deny('SIGNED_APPROVAL_EXPIRED_OR_CLOCK_INVALID');
  if(expected.approvedRequestState!=='approved'||
    expected.ownerSessionActive!==true||
    expected.deviceEnrollmentActive!==true||
    expected.connectionActive!==true||
    expected.originNonceUnused!==true)
    return deny('APPROVAL_OR_OWNER_SESSION_NOT_CURRENT');
  return Object.freeze({
    decision:'VERIFIED_SYNTHETIC_ORIGIN',originVerified:true,
    requestId:p.requestId,grantId:p.grantId,
    ownerAccountId:p.ownerAccountId,deviceId:p.deviceId,
    provenanceSha256:sha(canonical(p)),
    deviceKeySha256:p.deviceKeySha256,
    wallVerifierFingerprint:syntheticWallOriginFingerprint(pinnedWallPublicKey),
    // Explicitly never an OS/native execution authorization.
    physicalExecutionAuthorized:false,productionIssuerAuthorized:false
  });
}
