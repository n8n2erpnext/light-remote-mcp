/**
 * rc.50 P0-A development-only: verify cross-role signed promotion EVIDENCE.
 *
 * NO authority to grant leases, STOP writers, clear WAL or enable target.
 * The old writer must genuinely enforce any announced fence in separate code;
 * signatures alone CANNOT prove source OS side effects are quiesced.
 */
import crypto from 'node:crypto';

const GRANT_KEYS=['challenge','expiresAt','fromGeneration','issuedAt',
  'snapshotSha256','sourceNode','targetNode','toGeneration','transactionId','version'];
const FENCE_KEYS=['challenge','driverFenced','expiresAt','fromGeneration',
  'issuedAt','snapshotSha256','sourceNode','targetNode','toGeneration',
  'transactionId','unresolvedEffects','version'];
const ID=/^[A-Za-z0-9._:-]{8,128}$/;
const HEX=/^[a-f0-9]{64}$/;
const CHALLENGE=/^[A-Za-z0-9_-]{32,128}$/;
const time=x=>Number.isSafeInteger(x)&&x>0;
function requireBody(body,kind){
  const keys=kind==='grant'?GRANT_KEYS:FENCE_KEYS;
  if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).sort().join(',')!==[...keys].sort().join(','))
    throw Error('DEV_PROMOTION_SCHEMA_'+kind);
  const b={};
  for(const k of keys)b[k]=body[k];
  if(b.version!==1)throw Error('DEV_PROMOTION_VERSION');
  for(const k of ['sourceNode','targetNode','transactionId'])
    if(typeof b[k]!=='string'||!ID.test(b[k]))
      throw Error('DEV_PROMOTION_ID_INVALID:'+k);
  if(b.sourceNode===b.targetNode)throw Error('DEV_PROMOTION_SAME_NODE');
  if(typeof b.snapshotSha256!=='string'||!HEX.test(b.snapshotSha256)||
     typeof b.challenge!=='string'||!CHALLENGE.test(b.challenge))
    throw Error('DEV_PROMOTION_BINDING_INVALID');
  if(!Number.isSafeInteger(b.fromGeneration)||b.fromGeneration<1||
     b.toGeneration!==b.fromGeneration+1)
    throw Error('DEV_PROMOTION_NON_MONOTONIC');
  if(!time(b.issuedAt)||!time(b.expiresAt)||b.expiresAt<b.issuedAt||
     b.expiresAt-b.issuedAt>30_000)
    throw Error('DEV_PROMOTION_INVALID_TTL');
  if(kind==='fence'){
    if(b.driverFenced!==true||!Number.isSafeInteger(b.unresolvedEffects)||
      b.unresolvedEffects!==0)
      throw Error('DEV_PROMOTION_SOURCE_NOT_DRAINED');
  }
  return b;
}
function digest(body,kind){
  return Buffer.concat([Buffer.from('LR-RC50-DEV-PROMOTION-'+kind+'-V1\0'),
    Buffer.from(JSON.stringify(requireBody(body,kind)),'utf8')]);
}
export function signDevWriterPromotionClaim({body,kind,privateKey}={}){
  if(!['grant','fence'].includes(kind))throw Error('DEV_PROMOTION_KIND_INVALID');
  if(!privateKey)throw Error('DEV_PROMOTION_PRIVATE_KEY_REQUIRED');
  const key=privateKey?.type==='private'?privateKey:crypto.createPrivateKey(privateKey);
  if(key.asymmetricKeyType!=='ed25519')throw Error('DEV_PROMOTION_ED25519_REQUIRED');
  return {body:requireBody(body,kind),
    signature:crypto.sign(null,digest(body,kind),key).toString('base64url')};
}
function verifyClaim(envelope,kind,publicKey,now){
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||
     Object.keys(envelope).sort().join(',')!=='body,signature')
    throw Error('DEV_PROMOTION_ENVELOPE_INVALID');
  const b=requireBody(envelope.body,kind);
  if(now<b.issuedAt-2_000||now>b.expiresAt)
    throw Error('DEV_PROMOTION_STALE:'+kind);
  if(typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{80,100}$/.test(envelope.signature))
    throw Error('DEV_PROMOTION_SIGNATURE_INVALID');
  const key=publicKey?.type==='public'?publicKey:crypto.createPublicKey(publicKey);
  if(key.asymmetricKeyType!=='ed25519')throw Error('DEV_PROMOTION_PINNED_KEY_REQUIRED');
  const sig=Buffer.from(envelope.signature,'base64url');
  if(sig.length!==64||!crypto.verify(null,digest(b,kind),key,sig))
    throw Error('DEV_PROMOTION_SIGNATURE_INVALID');
  return b;
}
export function verifyDevWriterPromotionEvidence({
  issuerGrant,sourceFence,issuerPublicKey,sourcePublicKey,expected,
  seenChallenges,now=Date.now()
}={}){
  if(!time(now)||!issuerPublicKey||!sourcePublicKey||!expected||
     typeof expected!=='object'||!seenChallenges||
     typeof seenChallenges.has!=='function'||typeof seenChallenges.add!=='function')
    throw Error('DEV_PROMOTION_TRUST_CONTEXT_REQUIRED');
  if(!Object.hasOwn(expected,'sourceNode')||
     !Object.hasOwn(expected,'targetNode')||
     !Object.hasOwn(expected,'fromGeneration')||
     !Object.hasOwn(expected,'toGeneration')||
     !Object.hasOwn(expected,'transactionId')||
     !Object.hasOwn(expected,'challenge')||
     !Object.hasOwn(expected,'snapshotSha256'))
    throw Error('DEV_PROMOTION_EXPECTED_BINDINGS_REQUIRED');
  const grant=verifyClaim(issuerGrant,'grant',issuerPublicKey,now);
  const fence=verifyClaim(sourceFence,'fence',sourcePublicKey,now);
  for(const k of ['sourceNode','targetNode','fromGeneration','toGeneration',
    'transactionId','challenge','snapshotSha256']){
    if(grant[k]!==fence[k]||grant[k]!==expected[k])
      throw Error('DEV_PROMOTION_CROSS_SIGNER_MISMATCH:'+k);
  }
  if(seenChallenges.has(grant.challenge))
    throw Error('DEV_PROMOTION_REPLAY');
  seenChallenges.add(grant.challenge);
  // Even with two genuine signatures, neither confirms old processes are
  // killed OR enforces an epoch on every real Operator/Agent write path.
  return {verdict:'TWO_SIGNERS_CHECKED_UNFENCED',
    targetActivationAuthorized:false,globalWriterFenceProven:false,
    transactionId:grant.transactionId,fromGeneration:grant.fromGeneration,
    toGeneration:grant.toGeneration,claimedSourceDrained:true};
}
