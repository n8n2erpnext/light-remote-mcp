import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  signSyntheticWallApprovalOrigin,
  verifySyntheticWallApprovalOrigin,
  syntheticWallOriginFingerprint,
} from './synthetic-wall-approval-origin.mjs';
function fixture(){
 const owner=crypto.generateKeyPairSync('ed25519');
 const rogue=crypto.generateKeyPairSync('ed25519');
 const now=Date.now();
 const p={
  kind:'uat_wall_approval_origin',
  requestId:'uat_request_primary',grantId:'uat_grant_primary',
  ownerAccountId:'uat_owner_primary',accountId:'uat_owner_primary',
  deviceId:'uat_device_primary',connectionId:'uat_connection_primary',
  agentId:'uat_agent_primary',
  deviceKeySha256:'a'.repeat(64),
  ownerSessionSha256:'b'.repeat(64),
  wallDecisionNonceSha256:'c'.repeat(64),
  channelAckSha256:'d'.repeat(64),
  requestCreatedAt:now-90000,requestExpiresAt:now+40000,
  approvedAt:now-20000,grantExpiresAt:now+30000,
  absoluteExpiresAt:now+86400000-20000,
  action:'approve',purpose:'device',
 };
 const packet=signSyntheticWallApprovalOrigin(owner.privateKey,p);
 const expected={
  requestId:p.requestId,grantId:p.grantId,ownerAccountId:p.ownerAccountId,
  accountId:p.accountId,deviceId:p.deviceId,connectionId:p.connectionId,
  agentId:p.agentId,deviceKeySha256:p.deviceKeySha256,
  ownerSessionSha256:p.ownerSessionSha256,channelAckSha256:p.channelAckSha256,
  purpose:p.purpose,approvedRequestState:'approved',
  ownerSessionActive:true,deviceEnrollmentActive:true,
  connectionActive:true,originNonceUnused:true,
 };
 const check=(changedPacket=packet,override={},clock=now,key=owner.publicKey)=>
  verifySyntheticWallApprovalOrigin(changedPacket,{
    pinnedWallPublicKey:key,expected:{...expected,...override},now:clock
  });
 return {owner,rogue,p,packet,expected,now,check};
}
const denied=(r,reason)=>{
 assert.equal(r.decision,'DENY');
 assert.equal(r.reason,reason);
 assert.equal(r.originVerified,false);
};
test('01 ephemeral Ed25519 Wall signer creates verified fake origin',()=>{
 const f=fixture(),r=f.check();
 assert.equal(r.decision,'VERIFIED_SYNTHETIC_ORIGIN');
 assert.equal(r.originVerified,true);
 assert.equal(r.physicalExecutionAuthorized,false);
 assert.equal(r.productionIssuerAuthorized,false);
 assert.match(r.provenanceSha256,/^[a-f0-9]{64}$/);
});
test('02 unsigned approved=true never acts as proof',()=>{
 const f=fixture();
 denied(f.check({approved:true}),'MALFORMED_SIGNED_WALL_RECEIPT');
});
test('03 fake arbitrary Wall key is not accepted',()=>{
 const f=fixture();
 denied(f.check(f.packet,{},f.now,f.rogue.publicKey),'WALL_RECEIPT_SIGNATURE_INVALID');
});
test('04 tampering target after signature fails',()=>{
 const f=fixture();
 const pkt={...f.packet,payload:{...f.packet.payload,deviceId:'uat_device_attacker'}};
 denied(f.check(pkt),'WALL_RECEIPT_SIGNATURE_INVALID');
});
test('05 tampering approved timestamp fails',()=>{
 const f=fixture();
 const pkt={...f.packet,payload:{...f.packet.payload,approvedAt:f.now-1000}};
 denied(f.check(pkt),'WALL_RECEIPT_SIGNATURE_INVALID');
});
test('06 changing owner session context fails',()=>{
 const f=fixture();
 denied(f.check(f.packet,{ownerSessionSha256:'e'.repeat(64)}),
  'ORIGIN_NOT_BOUND_TO_TRUSTED_STATE');
});
test('07 grant ID cannot be replaced',()=>{
 const f=fixture();
 denied(f.check(f.packet,{grantId:'uat_grant_attacker'}),
  'ORIGIN_NOT_BOUND_TO_TRUSTED_STATE');
});
test('08 request ID cannot be replaced',()=>{
 const f=fixture();
 denied(f.check(f.packet,{requestId:'uat_request_attacker'}),
  'ORIGIN_NOT_BOUND_TO_TRUSTED_STATE');
});
test('09 device enrollment key mismatch fails',()=>{
 const f=fixture();
 denied(f.check(f.packet,{deviceKeySha256:'f'.repeat(64)}),
  'ORIGIN_NOT_BOUND_TO_TRUSTED_STATE');
});
test('10 channel acknowledgement mismatch fails',()=>{
 const f=fixture();
 denied(f.check(f.packet,{channelAckSha256:'f'.repeat(64)}),
  'ORIGIN_NOT_BOUND_TO_TRUSTED_STATE');
});
test('11 wrong connection fails',()=>{
 const f=fixture();
 denied(f.check(f.packet,{connectionId:'uat_connection_changed'}),
  'ORIGIN_NOT_BOUND_TO_TRUSTED_STATE');
});
test('12 member-purpose approval rejected as direct-owner',()=>{
 const f=fixture();
 assert.throws(()=>signSyntheticWallApprovalOrigin(f.owner.privateKey,{
  ...f.p,purpose:'team-member'}),/invalid_synthetic_wall_provenance_shape/);
});
test('13 request approval must precede request expiry',()=>{
 const f=fixture();
 assert.throws(()=>signSyntheticWallApprovalOrigin(f.owner.privateKey,{
  ...f.p,approvedAt:f.p.requestExpiresAt}),/invalid_synthetic_wall_provenance_shape/);
});
test('14 request may not exceed 10-minute window',()=>{
 const f=fixture();
 assert.throws(()=>signSyntheticWallApprovalOrigin(f.owner.privateKey,{
  ...f.p,requestExpiresAt:f.p.requestCreatedAt+600001}),/invalid_synthetic_wall_provenance_shape/);
});
test('15 absolute lifetime may not exceed 24 hours',()=>{
 const f=fixture();
 assert.throws(()=>signSyntheticWallApprovalOrigin(f.owner.privateKey,{
  ...f.p,absoluteExpiresAt:f.p.approvedAt+86400001}),/invalid_synthetic_wall_provenance_shape/);
});
test('16 expired fake grant denies even with valid signature',()=>{
 const f=fixture();
 denied(f.check(f.packet,{},f.p.grantExpiresAt),
  'SIGNED_APPROVAL_EXPIRED_OR_CLOCK_INVALID');
});
test('17 clock before approved timestamp denies',()=>{
 const f=fixture();
 denied(f.check(f.packet,{},f.p.approvedAt-1),
  'SIGNED_APPROVAL_EXPIRED_OR_CLOCK_INVALID');
});
test('18 revoked owner session denies',()=>{
 const f=fixture();
 denied(f.check(f.packet,{ownerSessionActive:false}),
  'APPROVAL_OR_OWNER_SESSION_NOT_CURRENT');
});
test('19 revoked device enrollment denies',()=>{
 const f=fixture();
 denied(f.check(f.packet,{deviceEnrollmentActive:false}),
  'APPROVAL_OR_OWNER_SESSION_NOT_CURRENT');
});
test('20 closed connection denies',()=>{
 const f=fixture();
 denied(f.check(f.packet,{connectionActive:false}),
  'APPROVAL_OR_OWNER_SESSION_NOT_CURRENT');
});
test('21 already consumed nonce denies replay',()=>{
 const f=fixture();
 denied(f.check(f.packet,{originNonceUnused:false}),
  'APPROVAL_OR_OWNER_SESSION_NOT_CURRENT');
});
test('22 pending request cannot be represented as approved',()=>{
 const f=fixture();
 denied(f.check(f.packet,{approvedRequestState:'pending'}),
  'APPROVAL_OR_OWNER_SESSION_NOT_CURRENT');
});
test('23 missing trusted local/DB expectations denies',()=>{
 const f=fixture();
 denied(verifySyntheticWallApprovalOrigin(f.packet,{
  pinnedWallPublicKey:f.owner.publicKey,now:f.now
 }),'TRUSTED_ORIGIN_EXPECTATIONS_MISSING');
});
test('24 malformed signer type and payload are rejected',()=>{
 const f=fixture();
 assert.throws(()=>signSyntheticWallApprovalOrigin(f.owner.publicKey,f.p),/invalid_synthetic_wall_signer/);
 const bad={...f.packet,payload:{...f.p,unexpected:'user'}};
 denied(f.check(bad),'WALL_RECEIPT_SHAPE_INVALID');
});
test('25 signature domain is deterministic and fingerprint stable',()=>{
 const f=fixture();
 const twice=signSyntheticWallApprovalOrigin(f.owner.privateKey,f.p);
 assert.equal(twice.signature,f.packet.signature);
 assert.equal(f.check().provenanceSha256,
   f.check(twice).provenanceSha256);
 assert.match(syntheticWallOriginFingerprint(f.owner.publicKey),/^[a-f0-9]{64}$/);
});
