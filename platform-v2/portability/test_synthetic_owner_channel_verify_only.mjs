import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {makeSyntheticOwnerChannelDbProof}
 from './synthetic-owner-channel-db-proof.mjs';
import {verifySyntheticOwnerChannelEnvelope}
 from './synthetic-owner-channel-verify-only.mjs';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 const now=Date.now();
 const input={
  requestId:'uat_request_issuer_v',grantId:'uat_grant_issuer_v',
  accountId:'uat_account_issuer_v',deviceId:'uat_device_issuer_v',
  agentId:'uat_agent_issuer_v',connectionId:'uat_connection_issuer_v',
  ownerSessionId:'uat_session_issuer_v',deviceKeySha256:'c'.repeat(64),
  requestCreatedAtMs:now-60000,requestExpiresAtMs:now+180000
 };
 const p=makeSyntheticOwnerChannelDbProof(input,now,null,true);
 const {signedPackets:envelope,...expectedResult}=p;
 const trusted={
  requestId:input.requestId,grantId:input.grantId,
  accountId:input.accountId,deviceId:input.deviceId,
  agentId:input.agentId,connectionId:input.connectionId,
  ownerSessionId:input.ownerSessionId,
  deviceKeySha256:input.deviceKeySha256,
  wallVerifierSha256:p.wallVerifierSha256,
  channelVerifierSha256:p.channelVerifierSha256,
  requestCreatedAtMs:input.requestCreatedAtMs,
  requestExpiresAtMs:input.requestExpiresAtMs,
  requestState:'pending',ownerSessionActive:true,
  enrollmentActive:true,connectionActive:true,pinsActive:true,
  nonceUnused:true
 };
 return {envelope,trusted,expectedResult,now};
}
const denied=(result,reason)=>{
 assert.equal(result.decision,'DENY');
 assert.equal(result.reason,reason);
 assert.equal(result.productionIssuerAuthorized,false);
 assert.equal(result.physicalExecutionAuthorized,false);
};
test('01 independent public verifier reproduces signed fixture proof digests',()=>{
 const f=fixture(),v=verifySyntheticOwnerChannelEnvelope(f.envelope,f.trusted,f.now);
 assert.equal(v.decision,'VERIFIED_FAKE_OWNER_CHANNEL_PRECOMMIT');
 for(const k of ['requestId','grantId','ownerAccountId',
   'deviceId','enrolledKeySha256','channelAckSha256','wallProofSha256',
   'wallVerifierSha256','channelVerifierSha256','nonceSha256'])
    assert.equal(v[k],f.expectedResult[k],k);
 assert.equal(v.productionIssuerAuthorized,false);
});
test('02 forged channel signature denied',()=>{
 const f=fixture();
 const bad=structuredClone(f.envelope);
 bad.channelAck.signature='A'.repeat(86);
 denied(verifySyntheticOwnerChannelEnvelope(bad,f.trusted,f.now),
  'SIGNED_APPROVAL_CHANNEL_SIGNATURE_INVALID');
});
test('03 forged wall signature denied',()=>{
 const f=fixture();const bad=structuredClone(f.envelope);
 bad.wallApproval.signature='A'.repeat(86);
 denied(verifySyntheticOwnerChannelEnvelope(bad,f.trusted,f.now),
  'SIGNED_APPROVAL_WALL_ORIGIN_WALL_RECEIPT_SIGNATURE_INVALID');
});
test('04 unexpected Wall pin not derived from enrolled DB rejected',()=>{
 const f=fixture();
 denied(verifySyntheticOwnerChannelEnvelope(f.envelope,
  {...f.trusted,wallVerifierSha256:'0'.repeat(64)},f.now),
  'PUBLIC_KEY_PIN_MISMATCH');
});
test('05 channel pin substitution denied',()=>{
 const f=fixture();
 denied(verifySyntheticOwnerChannelEnvelope(f.envelope,
  {...f.trusted,channelVerifierSha256:'0'.repeat(64)},f.now),
  'PUBLIC_KEY_PIN_MISMATCH');
});
test('06 changed request creation time in trusted DB denied',()=>{
 const f=fixture();
 denied(verifySyntheticOwnerChannelEnvelope(f.envelope,
  {...f.trusted,requestCreatedAtMs:f.trusted.requestCreatedAtMs+1},f.now),
  'OWNER_SESSION_OR_REQUEST_WINDOW_MISMATCH');
});
test('07 wrong session binding in independent trusted context denied',()=>{
 const f=fixture();
 denied(verifySyntheticOwnerChannelEnvelope(f.envelope,
  {...f.trusted,ownerSessionId:'uat_session_changed'},f.now),
  'OWNER_SESSION_OR_REQUEST_WINDOW_MISMATCH');
});
test('08 wrong persisted grant intent denied despite valid Ed25519',()=>{
 const f=fixture();
 denied(verifySyntheticOwnerChannelEnvelope(f.envelope,
  {...f.trusted,grantId:'uat_grant_altered'},f.now),
  'SIGNED_APPROVAL_CHANNEL_BINDING_MISMATCH');
});
test('09 revoked database owner session denied',()=>{
 const f=fixture();
 denied(verifySyntheticOwnerChannelEnvelope(f.envelope,
  {...f.trusted,ownerSessionActive:false},f.now),
  'OWNER_OR_DEVICE_NOT_CURRENT');
});
test('10 unsigned pending device request or consumed nonce denied',()=>{
 const f=fixture();
 denied(verifySyntheticOwnerChannelEnvelope(f.envelope,
  {...f.trusted,nonceUnused:false},f.now),'OWNER_OR_DEVICE_NOT_CURRENT');
});
test('11 verification fails after grant expiry',()=>{
 const f=fixture();
 denied(verifySyntheticOwnerChannelEnvelope(f.envelope,f.trusted,
  f.envelope.wallApproval.payload.grantExpiresAt),
  'SIGNED_APPROVAL_WALL_ORIGIN_SIGNED_APPROVAL_EXPIRED_OR_CLOCK_INVALID');
});
test('12 CLI refuses if synthetic UAT opt-in missing',()=>{
 const script=new URL('./synthetic-owner-channel-verify-only.mjs',import.meta.url).pathname;
 const r=spawnSync(process.execPath,[script,'--synthetic-only'],{
  encoding:'utf8',input:'{}',timeout:5000,
  env:{...process.env,LR_RC50_UAT_ONLY:'0'}
 });
 assert.equal(r.status,3);
 assert.match(r.stderr,/requires_isolated_uat/);
});
test('13 public verifier process cannot sign or export a private key',()=>{
 const f=fixture();
 const script=new URL('./synthetic-owner-channel-verify-only.mjs',import.meta.url).pathname;
 const r=spawnSync(process.execPath,[script,'--synthetic-only'],{
  encoding:'utf8',input:JSON.stringify({envelope:f.envelope,trusted:f.trusted}),
  timeout:5000,env:{...process.env,LR_RC50_UAT_ONLY:'1'}
 });
 assert.equal(r.status,0,r.stderr);
 const result=JSON.parse(r.stdout);
 assert.equal(result.decision,'VERIFIED_FAKE_OWNER_CHANNEL_PRECOMMIT');
 assert.equal(Object.hasOwn(result,'privateKey'),false);
 assert.equal(Object.hasOwn(result,'wallApproval'),false);
});
