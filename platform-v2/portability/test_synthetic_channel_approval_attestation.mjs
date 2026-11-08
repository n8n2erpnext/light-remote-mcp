import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
 signSyntheticChannelApprovalAck,hashSyntheticChannelApprovalPacket,
 verifySyntheticChannelAndWallOrigin
} from './synthetic-channel-approval-attestation.mjs';
import {signSyntheticWallApprovalOrigin}
 from './synthetic-wall-approval-origin.mjs';

function fixture(){
 const now=Date.now();
 const wall=crypto.generateKeyPairSync('ed25519');
 const channel=crypto.generateKeyPairSync('ed25519');
 const rogue=crypto.generateKeyPairSync('ed25519');
 const ids={requestId:'uat_request_linker',grantId:'uat_grant_linker',
  accountId:'uat_account_linker',deviceId:'uat_device_linker',
  agentId:'uat_agent_linker',connectionId:'uat_connection_linker'};
 const packet=signSyntheticChannelApprovalAck(channel.privateKey,{
   kind:'uat_device_channel_grant_ack',...ids,state:'approved',
   approvedAt:now-25000
 });
 const digest=hashSyntheticChannelApprovalPacket(packet);
 const origin={
   kind:'uat_wall_approval_origin',
   ...ids,ownerAccountId:ids.accountId,
   deviceKeySha256:'a'.repeat(64),
   ownerSessionSha256:'b'.repeat(64),
   wallDecisionNonceSha256:'c'.repeat(64),
   channelAckSha256:digest,
   requestCreatedAt:now-90000,requestExpiresAt:now+30000,
   approvedAt:now-20000,grantExpiresAt:now+50000,
   absoluteExpiresAt:now-20000+86400000,
   action:'approve',purpose:'device'
 };
 const signedOrigin=signSyntheticWallApprovalOrigin(wall.privateKey,origin);
 const expected={...ids,ownerAccountId:ids.accountId,purpose:'device',
   ownerSessionSha256:origin.ownerSessionSha256,
   deviceKeySha256:origin.deviceKeySha256,
   channelPublicSha256:crypto.createHash('sha256').update(
      channel.publicKey.export({type:'spki',format:'der'})).digest('hex'),
   approvedRequestState:'approved',ownerSessionActive:true,
   deviceEnrollmentActive:true,connectionActive:true,originNonceUnused:true,
   deviceChannelActive:true};
 const check=(overrides={})=>verifySyntheticChannelAndWallOrigin({
  channelAck:packet,wallApproval:signedOrigin,channelPublicKey:channel.publicKey,
  wallPublicKey:wall.publicKey,expected,nowMs:now,...overrides
 });
 return {wall,channel,rogue,packet,origin,signedOrigin,expected,now,check};
}
const refused=(r,reason)=>{assert.equal(r.decision,'DENY');assert.equal(r.reason,reason);
 assert.equal(r.productionIssuerAuthorized,false);};
test('01 independent fake Wall + channel Ed25519 signatures verify as one evidence chain',()=>{
 const f=fixture(),r=f.check();
 assert.equal(r.decision,'VERIFIED_FAKE_OWNER_AND_CHANNEL');
 assert.equal(r.originVerified,true);
 assert.equal(r.productionIssuerAuthorized,false);
 assert.equal(r.physicalExecutionAuthorized,false);
 assert.match(r.ownerProofDigest,/^[a-f0-9]{64}$/);
 assert.match(r.deviceChannelProofDigest,/^[a-f0-9]{64}$/);
});
test('02 attacker Channel signer rejected',()=>{
 const f=fixture(),ack=signSyntheticChannelApprovalAck(f.rogue.privateKey,f.packet.payload);
 refused(f.check({channelAck:ack}),'CHANNEL_SIGNATURE_INVALID');
});
test('03 forged Channel success state rejected',()=>{
 const f=fixture(),ack={...f.packet,payload:{...f.packet.payload,state:'approved',grantId:'uat_grant_other'}};
 refused(f.check({channelAck:ack}),'CHANNEL_SIGNATURE_INVALID');
});
test('04 forged Channel status denied at schema',()=>{
 const f=fixture(),ack={...f.packet,payload:{...f.packet.payload,state:'denied'}};
 refused(f.check({channelAck:ack}),'CHANNEL_PAYLOAD_INVALID');
});
test('05 unpinned Channel public key rejected',()=>{
 const f=fixture();
 refused(f.check({channelPublicKey:f.rogue.publicKey}),'CHANNEL_SIGNATURE_INVALID');
});
test('06 even matching Channel signature cannot change signed owner proof digest',()=>{
 const f=fixture();
 const replacement=signSyntheticChannelApprovalAck(f.channel.privateKey,{
   ...f.packet.payload,approvedAt:f.now-10000
 });
 refused(f.check({channelAck:replacement}),
  'WALL_ORIGIN_ORIGIN_NOT_BOUND_TO_TRUSTED_STATE');
});
test('07 separate trusted request identity required',()=>{
 const f=fixture();
 refused(f.check({expected:{...f.expected,requestId:'uat_request_other'}}),
  'CHANNEL_BINDING_MISMATCH');
});
test('08 separate trusted grant identity required',()=>{
 const f=fixture();
 refused(f.check({expected:{...f.expected,grantId:'uat_grant_other'}}),
  'CHANNEL_BINDING_MISMATCH');
});
test('09 enrolled Channel key pin mismatch rejected',()=>{
 const f=fixture();
 refused(f.check({expected:{...f.expected,channelPublicSha256:'f'.repeat(64)}}),
  'CHANNEL_ISSUER_PIN_MISMATCH');
});
test('10 revoked device-channel session rejected',()=>{
 const f=fixture();
 refused(f.check({expected:{...f.expected,deviceChannelActive:false}}),
  'TRUSTED_CHANNEL_CONTEXT_REQUIRED');
});
test('11 expired owner approval cannot create a grant',()=>{
 const f=fixture();
 refused(f.check({nowMs:f.origin.grantExpiresAt}),
  'WALL_ORIGIN_SIGNED_APPROVAL_EXPIRED_OR_CLOCK_INVALID');
});
test('12 fake Owner session cannot be revoked',()=>{
 const f=fixture();
 refused(f.check({expected:{...f.expected,ownerSessionActive:false}}),
  'WALL_ORIGIN_APPROVAL_OR_OWNER_SESSION_NOT_CURRENT');
});
test('13 old or consumed decision nonce is rejected',()=>{
 const f=fixture();
 refused(f.check({expected:{...f.expected,originNonceUnused:false}}),
  'WALL_ORIGIN_APPROVAL_OR_OWNER_SESSION_NOT_CURRENT');
});
test('14 channel wall ordering limit fails closed even with valid signatures',()=>{
 const f=fixture();
 const early=signSyntheticChannelApprovalAck(f.channel.privateKey,{
   ...f.packet.payload,approvedAt:f.now-75000
 });
 const matchingOrigin={...f.origin,
   channelAckSha256:hashSyntheticChannelApprovalPacket(early)
 };
 const signed=signSyntheticWallApprovalOrigin(f.wall.privateKey,matchingOrigin);
 refused(f.check({channelAck:early,wallApproval:signed}),
   'CHANNEL_WALL_APPROVAL_ORDER_INVALID');
});
test('15 wrong owner signing key fails after channel verified',()=>{
 const f=fixture();
 refused(f.check({wallPublicKey:f.rogue.publicKey}),
  'WALL_ORIGIN_WALL_RECEIPT_SIGNATURE_INVALID');
});
