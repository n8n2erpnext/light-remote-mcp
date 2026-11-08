import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {
 signSyntheticOutboxLease,verifySyntheticOutboxLease,fakeIssuerPublicKeyFingerprint,
 fakeSignedOutboxDigest,syntheticPublisherFixture
} from './synthetic-outbox-lease-publisher.mjs';

const now=Date.now();
const claim=()=>({
 out_request_id:'uat_request_synthetic_one',
 out_grant_id:'uat_grant_synthetic_one',out_generation:51,
 out_grant_revision:8,out_device_id:'uat_device_synthetic_one',
 out_device_key_sha256:'f'.repeat(64),
 out_account_id:'uat_account_synthetic_one',out_agent_id:'uat_agent_synthetic_one',
 out_connection_id:'uat_connection_synthetic_one',out_claim_seq:1
});
const keys=()=>crypto.generateKeyPairSync('ed25519');
test('01 synthetic claim cryptographically signs a strictly bounded lease',()=>{
 const r=syntheticPublisherFixture(claim(),now);
 assert.equal(r.physicalExecutionAuthorized,false);
 assert.equal(r.productionIssuerAuthorized,false);
 assert.equal(r.packet.payload.claimSeq,1);
 assert.equal(r.packet.payload.expiresAtMs-r.packet.payload.notBeforeMs,16000);
 assert.match(r.signatureDigest,/^[0-9a-f]{64}$/);
 assert.match(r.issuerFingerprint,/^[0-9a-f]{64}$/);
 assert.equal(Object.hasOwn(r,'privateKey'),false);
});
test('02 rogue Ed25519 key fails verification',()=>{
 const a=keys(),b=keys(),p=syntheticPublisherFixture(claim(),now).packet.payload;
 const signed=signSyntheticOutboxLease(p,a.privateKey);
 assert.throws(()=>verifySyntheticOutboxLease(signed,b.publicKey),/signature_invalid/);
});
test('03 exact fake signer signature verifies',()=>{
 const a=keys(),p=syntheticPublisherFixture(claim(),now).packet.payload;
 assert.deepEqual(verifySyntheticOutboxLease(signSyntheticOutboxLease(p,a.privateKey),a.publicKey),p);
});
test('04 signed generation tamper rejected',()=>{
 const a=keys(),p=syntheticPublisherFixture(claim(),now).packet.payload;
 const signed=signSyntheticOutboxLease(p,a.privateKey);
 signed.payload={...p,generation:52};
 assert.throws(()=>verifySyntheticOutboxLease(signed,a.publicKey),/signature_invalid/);
});
test('05 signed claim sequence tamper rejected',()=>{
 const a=keys(),p=syntheticPublisherFixture(claim(),now).packet.payload;
 const signed=signSyntheticOutboxLease(p,a.privateKey);
 signed.payload={...p,claimSeq:2};
 assert.throws(()=>verifySyntheticOutboxLease(signed,a.publicKey),/signature_invalid/);
});
test('06 fake payload cannot be real owner request without uat namespace',()=>{
 assert.throws(()=>syntheticPublisherFixture({...claim(),out_device_id:'dev_real'},now),
  /invalid_fake_lease_values/);
});
test('07 lease longer than 30s denied at signer',()=>{
 const p=syntheticPublisherFixture(claim(),now).packet.payload;
 assert.throws(()=>signSyntheticOutboxLease({...p,expiresAtMs:p.notBeforeMs+30001},
  keys().privateKey),/invalid_fake_lease_values/);
});
test('08 invalid device pin denied',()=>{
 assert.throws(()=>syntheticPublisherFixture({...claim(),out_device_key_sha256:'broken'},now),
  /invalid_fake_lease_values/);
});
test('09 canonical packet digest changes with signature and payload',()=>{
 const a=syntheticPublisherFixture(claim(),now);
 const b=syntheticPublisherFixture({...claim(),out_claim_seq:2},now);
 assert.notEqual(fakeSignedOutboxDigest(a.packet),fakeSignedOutboxDigest(b.packet));
});
test('10 CLI fails closed without private synthetic UAT opt-in',()=>{
 const cmd=new URL('./synthetic-outbox-lease-publisher.mjs',import.meta.url).pathname;
 const p=spawnSync(process.execPath,[cmd,'--synthetic-only'],{
  input:JSON.stringify(claim()),encoding:'utf8',timeout:5000,
  env:{...process.env,LR_RC50_UAT_ONLY:'0'}});
 assert.equal(p.status,3);
 assert.match(p.stderr,/requires_isolated_uat/);
});
test('11 isolated CLI signs a fake row and never emits private signer',()=>{
 const cmd=new URL('./synthetic-outbox-lease-publisher.mjs',import.meta.url).pathname;
 const p=spawnSync(process.execPath,[cmd,'--synthetic-only'],{
  input:JSON.stringify(claim()),encoding:'utf8',timeout:5000,
  env:{...process.env,LR_RC50_UAT_ONLY:'1'}});
 assert.equal(p.status,0,p.stderr);
 const row=JSON.parse(p.stdout);
 assert.match(row.packet.signature,/^[A-Za-z0-9_-]{86}$/);
 assert.equal(row.physicalExecutionAuthorized,false);
 assert.equal(Object.hasOwn(row,'privateKey'),false);
});
