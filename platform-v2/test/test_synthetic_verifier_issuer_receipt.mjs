import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {makeSyntheticOwnerChannelDbProof}
 from '../portability/synthetic-owner-channel-db-proof.mjs';
import {signSyntheticVerifiedOriginReceipt,
 verifySyntheticVerifierIssuerReceipt,fakeVerifierKeyPin}
 from '../portability/synthetic-verifier-issuer-receipt.mjs';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const bad=(result)=>{assert.equal(result.decision,'DENY');
 assert.equal(result.grantCommitted,false);assert.equal(result.physicalExecutionAuthorized,false);};
function fixture(){
 const now=Date.now();
 const ids={
  requestId:'uat_request_signer_a',grantId:'uat_grant_signer_a',
  accountId:'uat_account_signer_a',deviceId:'uat_device_signer_a',
  agentId:'uat_agent_signer_a',connectionId:'uat_connection_signer_a',
  ownerSessionId:'uat_session_signer_a',deviceKeySha256:'a'.repeat(64),
  requestCreatedAtMs:now-60000,requestExpiresAtMs:now+180000
 };
 const envelope=makeSyntheticOwnerChannelDbProof(ids,now,null,true);
 const trust={
  requestId:ids.requestId,grantId:ids.grantId,
  accountId:ids.accountId,deviceId:ids.deviceId,
  agentId:ids.agentId,connectionId:ids.connectionId,
  ownerSessionId:ids.ownerSessionId,
  deviceKeySha256:ids.deviceKeySha256,
  wallVerifierSha256:envelope.wallVerifierSha256,
  channelVerifierSha256:envelope.channelVerifierSha256,
  requestCreatedAtMs:ids.requestCreatedAtMs,
  requestExpiresAtMs:ids.requestExpiresAtMs,
  requestState:'pending',ownerSessionActive:true,
  enrollmentActive:true,connectionActive:true,pinsActive:true,nonceUnused:true
 };
 const keys=crypto.generateKeyPairSync('ed25519');
 const spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const packet=signSyntheticVerifiedOriginReceipt({
  envelope:envelope.signedPackets,trusted:trust,
  privateKey:keys.privateKey,verifierId:'uat_verifier_signer_a',
  verifierKeyEpoch:3,writerEpoch:7,grantGeneration:42,nowMs:now
 });
 const expected={
  verifierId:'uat_verifier_signer_a',verifierKeyEpoch:3,
  verifierPublicSpki:spki,verifierKeySha256:fakeVerifierKeyPin(keys.publicKey),
  verifierState:'active',requestState:'pending',ownerSessionActive:true,
  deviceActive:true,writerFenced:false,
  requestId:ids.requestId,grantId:ids.grantId,accountId:ids.accountId,
  deviceId:ids.deviceId,agentId:ids.agentId,connectionId:ids.connectionId,
  ownerSessionSha256:sha(ids.ownerSessionId),
  enrolledKeySha256:ids.deviceKeySha256,
  nonceSha256:packet.payload.nonceSha256,
  wallProofSha256:packet.payload.wallProofSha256,
  channelAckSha256:packet.payload.channelAckSha256,
  writerEpoch:7,nextGrantGeneration:42
 };
 return {now,ids,keys,envelope:envelope.signedPackets,trust,packet,expected};
}
test('01 signed receipt binds synthetic Ed25519 owner and channel proof to trusted issuer state',()=>{
 const f=fixture(),v=verifySyntheticVerifierIssuerReceipt(f.packet,f.expected,f.now);
 assert.equal(v.decision,'VERIFIED_FAKE_RECEIPT_PRECOMMIT');
 assert.equal(v.requestId,f.ids.requestId);
 assert.equal(v.writerEpoch,7);assert.equal(v.grantGeneration,42);
 assert.equal(v.grantCommitted,false);
 assert.equal(v.productionIssuerAuthorized,false);
 assert.equal(v.physicalExecutionAuthorized,false);
 assert.equal('privateKey' in f.packet,false);
});
test('02 signer must verify actual source packets, not a verified:true flag',()=>{
 const f=fixture();
 assert.throws(()=>signSyntheticVerifiedOriginReceipt({
  envelope:{verified:true},trusted:f.trust,privateKey:f.keys.privateKey,
  verifierId:'uat_verifier_signer_a',verifierKeyEpoch:3,
  writerEpoch:7,grantGeneration:42,nowMs:f.now
 }),/RECEIPT_SOURCE_SIGNATURE_NOT_VERIFIED/);
});
test('03 signed wall or channel tampering prevents minting receipt',()=>{
 const f=fixture();
 for(const which of ['wallApproval','channelAck']){
  const badEnvelope=structuredClone(f.envelope);
  badEnvelope[which].signature='A'.repeat(86);
  assert.throws(()=>signSyntheticVerifiedOriginReceipt({
   envelope:badEnvelope,trusted:f.trust,privateKey:f.keys.privateKey,
   verifierId:'uat_verifier_signer_a',verifierKeyEpoch:3,
   writerEpoch:7,grantGeneration:42,nowMs:f.now
  }),/RECEIPT_SOURCE_SIGNATURE_NOT_VERIFIED/);
 }
});
test('04 altered receipt body and forged signature denied',()=>{
 const f=fixture();
 bad(verifySyntheticVerifierIssuerReceipt({
  payload:{...f.packet.payload,grantId:'uat_grant_forged'},
  signature:f.packet.signature},f.expected,f.now));
 bad(verifySyntheticVerifierIssuerReceipt({
  payload:f.packet.payload,signature:'A'.repeat(86)},f.expected,f.now));
});
test('05 compromised/unpinned/revoked/rotated verifier key denied',()=>{
 const f=fixture();
 for(const patch of [
  {verifierState:'revoked'},{verifierKeyEpoch:4},
  {verifierKeySha256:'f'.repeat(64)},
  {verifierPublicSpki:crypto.generateKeyPairSync('ed25519').publicKey
   .export({type:'spki',format:'der'}).toString('base64url')}
 ]){
  bad(verifySyntheticVerifierIssuerReceipt(f.packet,{...f.expected,...patch},f.now));
 }
});
test('06 intended grant, account, device, session, nonce and evidence cannot be rebound',()=>{
 const f=fixture();
 for(const patch of [
  {grantId:'uat_wrong_grant'},{accountId:'uat_wrong_account'},
  {deviceId:'uat_wrong_device'},{ownerSessionSha256:'1'.repeat(64)},
  {nonceSha256:'2'.repeat(64)},{wallProofSha256:'3'.repeat(64)},
  {channelAckSha256:'4'.repeat(64)},
  {connectionId:'uat_wrong_connection'}
 ]){
  bad(verifySyntheticVerifierIssuerReceipt(f.packet,{...f.expected,...patch},f.now));
 }
});
test('07 stale writer epoch, incorrect next generation, or fenced writer denied',()=>{
 const f=fixture();
 for(const patch of [
  {writerEpoch:8},{nextGrantGeneration:43},{writerFenced:true}
 ]){
  bad(verifySyntheticVerifierIssuerReceipt(f.packet,{...f.expected,...patch},f.now));
 }
});
test('08 revoked owner session or consumed request denied',()=>{
 const f=fixture();
 for(const patch of [
  {ownerSessionActive:false},{requestState:'approved'},{deviceActive:false}
 ]){
  bad(verifySyntheticVerifierIssuerReceipt(f.packet,{...f.expected,...patch},f.now));
 }
});
test('09 receipt expires quickly and future-issued receipt denied',()=>{
 const f=fixture();
 bad(verifySyntheticVerifierIssuerReceipt(f.packet,f.expected,
  f.packet.payload.expiresAtMs));
 bad(verifySyntheticVerifierIssuerReceipt(f.packet,f.expected,f.now-1));
});
test('10 strict shape / appended fields / fake key rejected',()=>{
 const f=fixture();
 bad(verifySyntheticVerifierIssuerReceipt({...f.packet,verified:true},f.expected,f.now));
 bad(verifySyntheticVerifierIssuerReceipt({
  payload:{...f.packet.payload,productionIssuerAuthorized:true},
  signature:f.packet.signature},f.expected,f.now));
 assert.throws(()=>signSyntheticVerifiedOriginReceipt({
  envelope:f.envelope,trusted:f.trust,privateKey:f.keys.publicKey,
  verifierId:'uat_verifier_signer_a',verifierKeyEpoch:3,
  writerEpoch:7,grantGeneration:42,nowMs:f.now
 }),/RECEIPT_FAKE_PRIVATE_KEY_REQUIRED/);
});
test('11 valid cryptographic receipt remains valid a second time: PostgreSQL single-use NOT wired',()=>{
 const f=fixture();
 for(let n=0;n<2;n++){
  const r=verifySyntheticVerifierIssuerReceipt(f.packet,f.expected,f.now);
  assert.equal(r.decision,'VERIFIED_FAKE_RECEIPT_PRECOMMIT');
  assert.equal(r.grantCommitted,false);
 }
});
test('12 independently signed same proof has distinct random receipt IDs',()=>{
 const f=fixture();
 const other=signSyntheticVerifiedOriginReceipt({
  envelope:f.envelope,trusted:f.trust,privateKey:f.keys.privateKey,
  verifierId:'uat_verifier_signer_a',verifierKeyEpoch:3,
  writerEpoch:7,grantGeneration:42,nowMs:f.now
 });
 assert.notEqual(other.payload.receiptId,f.packet.payload.receiptId);
 assert.equal(verifySyntheticVerifierIssuerReceipt(other,f.expected,f.now).decision,
  'VERIFIED_FAKE_RECEIPT_PRECOMMIT');
});
