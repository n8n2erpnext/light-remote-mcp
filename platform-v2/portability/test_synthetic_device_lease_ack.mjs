import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {
 signSyntheticOutboxLease,fakeSignedOutboxDigest,fakeIssuerPublicKeyFingerprint
} from './synthetic-outbox-lease-publisher.mjs';
import {
 makeSyntheticDeviceLeaseAck,verifySyntheticDeviceLeaseAck,
 signSyntheticDeviceLeaseAck
} from './synthetic-device-lease-ack.mjs';

function fixture(){
 const issuer=crypto.generateKeyPairSync('ed25519');
 const device=crypto.generateKeyPairSync('ed25519');
 const rogue=crypto.generateKeyPairSync('ed25519');
 const now=Date.now();
 const payload={
  kind:'uat_issuer_lease',requestId:'uat_request_device_ack',
  grantId:'uat_grant_device_ack',generation:52,grantRevision:7,
  deviceId:'uat_device_receipt',
  deviceKeySha256:fakeIssuerPublicKeyFingerprint(device.publicKey),
  accountId:'uat_account_owner',agentId:'uat_agent_owner',
  connectionId:'uat_connection_owner',
  claimSeq:2,notBeforeMs:now-5000,expiresAtMs:now+15000
 };
 const signedLease=signSyntheticOutboxLease(payload,issuer.privateKey);
 const challenge={nonceSha256:crypto.randomBytes(32).toString('hex'),
   expiresAtMs:now+12000};
 const signedAck=makeSyntheticDeviceLeaseAck({
   signedLease,issuerPublicKey:issuer.publicKey,
   devicePrivateKey:device.privateKey,devicePublicKey:device.publicKey,
   challenge
 });
 const expected={
  requestId:payload.requestId,grantId:payload.grantId,
  deviceId:payload.deviceId,deviceKeySha256:payload.deviceKeySha256,
  issuerKeySha256:fakeIssuerPublicKeyFingerprint(issuer.publicKey),
  signedLeaseDigest:fakeSignedOutboxDigest(signedLease),
  generation:52,grantRevision:7,claimSeq:2,
  nonceSha256:challenge.nonceSha256,
  challengeExpiresAtMs:challenge.expiresAtMs,
  enrollmentActive:true,grantActive:true,issuerPinActive:true,
  nonceUnused:true,floorGeneration:52,floorGrantRevision:7
 };
 const check=(args={})=>verifySyntheticDeviceLeaseAck({
   signedAck,signedLease,issuerPublicKey:issuer.publicKey,
   devicePublicKey:device.publicKey,expected,nowMs:now,...args
 });
 return {issuer,device,rogue,now,payload,signedLease,signedAck,challenge,expected,check};
}
const denies=(r,why)=>{
 assert.equal(r.decision,'DENY');
 assert.equal(r.reason,why);
 assert.equal(r.physicalExecutionAuthorized,false);
};
test('01 real Ed25519 device key proves possession for exact signed fake lease',()=>{
 const f=fixture(),r=f.check();
 assert.equal(r.decision,'VERIFIED_FAKE_DEVICE_ACK');
 assert.equal(r.ackVerified,true);
 assert.equal(r.productionAckAuthorized,false);
 assert.equal(r.physicalExecutionAuthorized,false);
 assert.equal(r.signedLeaseDigest,f.expected.signedLeaseDigest);
});
test('02 ACK signature forgery by rogue device is rejected',()=>{
 const f=fixture();
 const signedAck=signSyntheticDeviceLeaseAck(f.signedAck.payload,f.rogue.privateKey);
 denies(f.check({signedAck}),'DEVICE_SIGNATURE_INVALID');
});
test('03 wrong enrolled device public key is rejected',()=>{
 const f=fixture();
 denies(f.check({devicePublicKey:f.rogue.publicKey}),
   'DEVICE_SIGNATURE_INVALID');
});
test('04 tampered grant in ACK invalidates device signature',()=>{
 const f=fixture();
 const signedAck={...f.signedAck,payload:{...f.signedAck.payload,
   grantId:'uat_grant_attacker'}};
 denies(f.check({signedAck}),'DEVICE_SIGNATURE_INVALID');
});
test('05 tampered signed issuer lease rejected',()=>{
 const f=fixture();
 const signedLease={...f.signedLease,payload:{...f.payload,generation:61}};
 denies(f.check({signedLease}),'SIGNED_LEASE_OR_ACK_INVALID');
});
test('06 wrong issuer public key rejects signed lease',()=>{
 const f=fixture();
 denies(f.check({issuerPublicKey:f.rogue.publicKey}),
   'SIGNED_LEASE_OR_ACK_INVALID');
});
test('07 forged public fingerprint in trusted DB context denied',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,issuerKeySha256:'0'.repeat(64)}}),
   'KEY_OR_LEASE_DIGEST_NOT_PINNED');
});
test('08 changed persisted signed outbox digest denied',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,signedLeaseDigest:'e'.repeat(64)}}),
   'KEY_OR_LEASE_DIGEST_NOT_PINNED');
});
test('09 wrong grant ID against trusted DB row refused',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,grantId:'uat_grant_wrong'}}),
   'ACK_GRANT_OR_GENERATION_MISMATCH');
});
test('10 stale persisted writer generation refused',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,generation:53}}),
   'ACK_GRANT_OR_GENERATION_MISMATCH');
});
test('11 current device floor generation revoked refuses old lease',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,floorGeneration:53}}),
   'ACK_REVOKED_OR_STALE');
});
test('12 current grant revision bumped refuses stale lease',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,floorGrantRevision:8}}),
   'ACK_REVOKED_OR_STALE');
});
test('13 wrong claim sequence against signed outbox denied',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,claimSeq:3}}),
   'ACK_GRANT_OR_GENERATION_MISMATCH');
});
test('14 different one-time ACK challenge cannot be reused',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,nonceSha256:'1'.repeat(64)}}),
   'ACK_CHALLENGE_MISMATCH');
});
test('15 expired challenge denied even while lease live',()=>{
 const f=fixture();
 denies(f.check({nowMs:f.challenge.expiresAtMs}),
   'ACK_OR_LEASE_EXPIRED');
});
test('16 expired signed lease denied',()=>{
 const f=fixture();
 denies(f.check({nowMs:f.payload.expiresAtMs}),'ACK_OR_LEASE_EXPIRED');
});
test('17 inactive device enrollment denied',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,enrollmentActive:false}}),
   'ACK_REVOKED_OR_STALE');
});
test('18 closed grant denied',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,grantActive:false}}),
   'ACK_REVOKED_OR_STALE');
});
test('19 revoked issuer pin denied',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,issuerPinActive:false}}),
   'ACK_REVOKED_OR_STALE');
});
test('20 consumed nonce denied on replay',()=>{
 const f=fixture();
 denies(f.check({expected:{...f.expected,nonceUnused:false}}),
   'ACK_REVOKED_OR_STALE');
});
test('21 malformed fake ACK input fails closed',()=>{
 const f=fixture();
 denies(f.check({signedAck:{payload:{},signature:'fake'}}),
   'ACK_ENVELOPE_INVALID');
});
test('22 missing trusted context denies even signed packet',()=>{
 const f=fixture();
 denies(f.check({expected:undefined}),'TRUSTED_CONTEXT_MISSING');
});
test('23 fake ACK constructor requires matching device private identity',()=>{
 const f=fixture();
 assert.throws(()=>makeSyntheticDeviceLeaseAck({
  signedLease:f.signedLease,issuerPublicKey:f.issuer.publicKey,
  devicePrivateKey:f.rogue.privateKey,devicePublicKey:f.rogue.publicKey,
  challenge:f.challenge
 }),/fake_device_key_not_enrolled/);
});
test('24 future notBefore lease denied',()=>{
 const f=fixture();
 denies(f.check({nowMs:f.payload.notBeforeMs-1}),'ACK_OR_LEASE_EXPIRED');
});
test('25 receipt signature is deterministic and exact device-bound',()=>{
 const f=fixture();
 assert.equal(signSyntheticDeviceLeaseAck(f.signedAck.payload,
   f.device.privateKey).signature,f.signedAck.signature);
 assert.match(f.signedAck.signature,/^[A-Za-z0-9_-]{86}$/);
});
test('26 public verifier subprocess has no fake device signing capability',()=>{
 const script=new URL('./synthetic-device-ack-fixture-cli.mjs',import.meta.url).pathname;
 const result=spawnSync(process.execPath,[script,'--verify-only'],{
   input:JSON.stringify({action:'sign'})+'\n',encoding:'utf8',timeout:5000,
   env:{...process.env,LR_RC50_UAT_ONLY:'1'}
 });
 assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(result.stdout).reason,'UNSUPPORTED_FAKE_ACTION');
});
test('27 fake device CLI requires explicit private UAT flag',()=>{
 const script=new URL('./synthetic-device-ack-fixture-cli.mjs',import.meta.url).pathname;
 const result=spawnSync(process.execPath,[script,'--synthetic-only'],{
   input:JSON.stringify({action:'public'})+'\n',encoding:'utf8',timeout:5000,
   env:{...process.env,LR_RC50_UAT_ONLY:'0'}
 });
 assert.equal(result.status,3);
 assert.match(result.stderr,/requires_isolated_uat/);
});
