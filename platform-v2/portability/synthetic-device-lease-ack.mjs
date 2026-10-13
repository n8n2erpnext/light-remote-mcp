/**
 * rc50 P0 — OFFLINE UAT ONLY.
 * Device proof-of-possession ACK: Ed25519 over an issuer-signed fake lease,
 * a trusted server challenge and exact grant/generation/claim bindings.
 * Verifier expectations MUST come from trusted persisted state, not request.
 * No I/O, SQL changes, real Agent imports, or physical action permissions.
 */
import crypto from 'node:crypto';
import {
  verifySyntheticOutboxLease,fakeSignedOutboxDigest,
  fakeIssuerPublicKeyFingerprint
} from './synthetic-outbox-lease-publisher.mjs';

const FIELDS=['kind','requestId','grantId','deviceId','deviceKeySha256',
  'issuerKeySha256','signedLeaseDigest','generation','grantRevision','claimSeq',
  'nonceSha256','challengeExpiresAtMs'];
const DOMAIN='LR_RC50_FAKE_DEVICE_LEASE_ACK_ED25519_V1\n';
const HASH=/^[0-9a-f]{64}$/, SIG=/^[A-Za-z0-9_-]{86}$/;
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const keysEqual=(o,f)=>Boolean(o&&typeof o==='object'&&!Array.isArray(o)
  &&Object.keys(o).sort().join('|')===f.slice().sort().join('|'));
const bytes=p=>Buffer.from(DOMAIN+JSON.stringify(Object.fromEntries(
  FIELDS.map(f=>[f,p[f]]))),'utf8');
const deny=reason=>Object.freeze({decision:'DENY',reason,physicalExecutionAuthorized:false});
const isPub=k=>k?.type==='public'&&k.asymmetricKeyType==='ed25519';
const isPri=k=>k?.type==='private'&&k.asymmetricKeyType==='ed25519';
function shape(p){
 if(!keysEqual(p,FIELDS)||p.kind!=='uat_fake_device_ack'||
    !['requestId','grantId','deviceId'].every(k=>
      typeof p[k]==='string'&&p[k].includes('uat_'))||
    !['deviceKeySha256','issuerKeySha256','signedLeaseDigest','nonceSha256']
      .every(k=>HASH.test(p[k]||''))||
    ![p.generation,p.grantRevision,p.claimSeq,p.challengeExpiresAtMs].every(safe)
    ||p.generation<1||p.grantRevision<1||p.claimSeq<1)
   throw Error('invalid_fake_device_ack_shape');
 return p;
}
export function signSyntheticDeviceLeaseAck(payload,devicePrivateKey){
 if(!isPri(devicePrivateKey))throw Error('fake_device_private_key_required');
 shape(payload);
 return {payload,signature:crypto.sign(null,bytes(payload),devicePrivateKey)
   .toString('base64url')};
}
/** Caller creates a fake ACK from an issuer-signed lease and challenge.
 * This only proves possession of a synthetic device key.
 */
export function makeSyntheticDeviceLeaseAck({
  signedLease,issuerPublicKey,devicePrivateKey,devicePublicKey,challenge
}={}){
 if(!isPri(devicePrivateKey)||!isPub(devicePublicKey)||
   !isPub(issuerPublicKey)||!challenge)throw Error('fake_ack_signer_invalid');
 const lease=verifySyntheticOutboxLease(signedLease,issuerPublicKey);
 const deviceKeySha256=fakeIssuerPublicKeyFingerprint(devicePublicKey);
 if(lease.deviceKeySha256!==deviceKeySha256)throw Error('fake_device_key_not_enrolled');
 if(!HASH.test(challenge.nonceSha256||'')||
    !safe(challenge.expiresAtMs))throw Error('fake_challenge_invalid');
 const payload={
  kind:'uat_fake_device_ack',requestId:lease.requestId,grantId:lease.grantId,
  deviceId:lease.deviceId,deviceKeySha256,
  issuerKeySha256:fakeIssuerPublicKeyFingerprint(issuerPublicKey),
  signedLeaseDigest:fakeSignedOutboxDigest(signedLease),
  generation:lease.generation,grantRevision:lease.grantRevision,
  claimSeq:lease.claimSeq,nonceSha256:challenge.nonceSha256,
  challengeExpiresAtMs:challenge.expiresAtMs
 };
 return signSyntheticDeviceLeaseAck(payload,devicePrivateKey);
}
/** Trusted context must be obtained independently from enrolled-key and
 * signed-outbox DB rows, challenge registry and grant-generation floor.
 * No output grants permission to execute native OS side effects.
 */
export function verifySyntheticDeviceLeaseAck({
 signedAck,signedLease,issuerPublicKey,devicePublicKey,expected,
 nowMs=Date.now()
}={}){
 if(!isPub(issuerPublicKey)||!isPub(devicePublicKey))
  return deny('PINNED_KEY_MISSING');
 if(!expected||typeof expected!=='object'||
    !safe(nowMs)||!safe(expected.challengeExpiresAtMs))
  return deny('TRUSTED_CONTEXT_MISSING');
 if(!keysEqual(signedAck,['payload','signature'])||
    !SIG.test(signedAck.signature||''))return deny('ACK_ENVELOPE_INVALID');
 let ack,lease;
 try{
   ack=shape(signedAck.payload);
   lease=verifySyntheticOutboxLease(signedLease,issuerPublicKey);
 }catch{return deny('SIGNED_LEASE_OR_ACK_INVALID');}
 if(!crypto.verify(null,bytes(ack),devicePublicKey,
   Buffer.from(signedAck.signature,'base64url')))
   return deny('DEVICE_SIGNATURE_INVALID');
 const issuerSha=fakeIssuerPublicKeyFingerprint(issuerPublicKey);
 const deviceSha=fakeIssuerPublicKeyFingerprint(devicePublicKey);
 const leaseDigest=fakeSignedOutboxDigest(signedLease);
 if(issuerSha!==expected.issuerKeySha256||
   deviceSha!==expected.deviceKeySha256||
   leaseDigest!==expected.signedLeaseDigest ||
   ack.issuerKeySha256!==issuerSha||
   ack.deviceKeySha256!==deviceSha||
   ack.signedLeaseDigest!==leaseDigest)
   return deny('KEY_OR_LEASE_DIGEST_NOT_PINNED');
 const fixed=['requestId','grantId','deviceId','generation',
  'grantRevision','claimSeq'];
 if(fixed.some(k=>ack[k]!==lease[k]||ack[k]!==expected[k]))
  return deny('ACK_GRANT_OR_GENERATION_MISMATCH');
 if(ack.nonceSha256!==expected.nonceSha256||
   ack.challengeExpiresAtMs!==expected.challengeExpiresAtMs)
  return deny('ACK_CHALLENGE_MISMATCH');
 if(nowMs<lease.notBeforeMs || nowMs>=lease.expiresAtMs||
   nowMs>=expected.challengeExpiresAtMs)
  return deny('ACK_OR_LEASE_EXPIRED');
 if(expected.enrollmentActive!==true||
    expected.grantActive!==true||
    expected.issuerPinActive!==true||
    expected.nonceUnused!==true||
    lease.generation!==expected.floorGeneration||
    lease.grantRevision!==expected.floorGrantRevision)
  return deny('ACK_REVOKED_OR_STALE');
 return Object.freeze({
   decision:'VERIFIED_FAKE_DEVICE_ACK',ackVerified:true,
   physicalExecutionAuthorized:false,productionAckAuthorized:false,
   requestId:ack.requestId,grantId:ack.grantId,
   deviceKeySha256:deviceSha,issuerKeySha256:issuerSha,
   signedLeaseDigest:leaseDigest,nonceSha256:ack.nonceSha256,
   ackSignature:signedAck.signature,
   ackPacketSha256:crypto.createHash('sha256')
     .update(JSON.stringify(signedAck)).digest('hex'),
   claimSeq:ack.claimSeq,generation:ack.generation,grantRevision:ack.grantRevision
 });
}
