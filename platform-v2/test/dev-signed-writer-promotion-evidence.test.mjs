import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {signDevWriterPromotionClaim,verifyDevWriterPromotionEvidence}
  from '../portability/dev-signed-writer-promotion-evidence.mjs';

const issuer=crypto.generateKeyPairSync('ed25519');
const source=crypto.generateKeyPairSync('ed25519');
const unauthorized=crypto.generateKeyPairSync('ed25519');
const now=Date.now();
const expected={
  sourceNode:'uat_source_arm',targetNode:'uat_target_x64',
  fromGeneration:18,toGeneration:19,
  transactionId:'uat_tx_1234567890',challenge:crypto.randomBytes(24).toString('base64url'),
  snapshotSha256:crypto.randomBytes(32).toString('hex'),
};
const base={version:1,...expected,issuedAt:now-100,expiresAt:now+15000};
const fenceBody={...base,driverFenced:true,unresolvedEffects:0};
const signed=(g=base,f=fenceBody,issuerKey=issuer.privateKey,sourceKey=source.privateKey)=>({
  issuerGrant:signDevWriterPromotionClaim({body:g,kind:'grant',privateKey:issuerKey}),
  sourceFence:signDevWriterPromotionClaim({body:f,kind:'fence',privateKey:sourceKey})
});
const verify=(receipts,opts={})=>verifyDevWriterPromotionEvidence({
  ...receipts,issuerPublicKey:issuer.publicKey,sourcePublicKey:source.publicKey,
  expected,now,seenChallenges:new Set(),...opts});

test('two independent trusted Ed25519 signers bind epoch, snapshot and target; never authorize activation',()=>{
  const data=signed();
  const result=verify(data);
  assert.equal(result.verdict,'TWO_SIGNERS_CHECKED_UNFENCED');
  assert.equal(result.fromGeneration,18);
  assert.equal(result.toGeneration,19);
  assert.equal(result.claimedSourceDrained,true);
  assert.equal(result.targetActivationAuthorized,false);
  assert.equal(result.globalWriterFenceProven,false);
});
test('wrong source signer, wrong issuer signer and tampered signed fields fail closed',()=>{
  assert.throws(()=>verify(signed(base,fenceBody,unauthorized.privateKey)),/SIGNATURE_INVALID/);
  assert.throws(()=>verify(signed(base,fenceBody,issuer.privateKey,unauthorized.privateKey)),/SIGNATURE_INVALID/);
  const data=signed();
  data.sourceFence.body.snapshotSha256='f'.repeat(64);
  assert.throws(()=>verify(data),/SIGNATURE_INVALID/);
});
test('validly signed but mismatched nonce, generation or snapshot never authorizes',()=>{
  const mismatch=signed(base,{...fenceBody,challenge:crypto.randomBytes(24).toString('base64url')});
  assert.throws(()=>verify(mismatch),/CROSS_SIGNER_MISMATCH/);
  assert.throws(()=>verify(signed(),{
    expected:{...expected,toGeneration:20}}),/CROSS_SIGNER_MISMATCH/);
  assert.throws(()=>verify(signed(),{
    expected:{...expected,snapshotSha256:'0'.repeat(64)}}),/CROSS_SIGNER_MISMATCH/);
});
test('valid receipt replay rejected when challenge was consumed',()=>{
  const data=signed(),seenChallenges=new Set();
  assert.equal(verify(data,{seenChallenges}).targetActivationAuthorized,false);
  assert.throws(()=>verify(data,{seenChallenges}),/REPLAY/);
});
test('non-monotonic source→target epoch and not-fully-fenced source are forbidden',()=>{
  assert.throws(()=>signDevWriterPromotionClaim({
    body:{...base,toGeneration:22},kind:'grant',privateKey:issuer.privateKey}),
    /NON_MONOTONIC/);
  assert.throws(()=>signDevWriterPromotionClaim({
    body:{...fenceBody,driverFenced:false},kind:'fence',
    privateKey:source.privateKey}),/SOURCE_NOT_DRAINED/);
  assert.throws(()=>signDevWriterPromotionClaim({
    body:{...fenceBody,unresolvedEffects:1},kind:'fence',
    privateKey:source.privateKey}),/SOURCE_NOT_DRAINED/);
});
test('stale/future receipt, missing trust context and extra forged field deny',()=>{
  const data=signed();
  assert.throws(()=>verify(data,{now:now+16_000}),/STALE/);
  assert.throws(()=>verify(data,{issuerPublicKey:null}),/TRUST_CONTEXT_REQUIRED/);
  assert.throws(()=>verify(data,{seenChallenges:null}),/TRUST_CONTEXT_REQUIRED/);
  assert.throws(()=>verify(data,{expected:{}}),/EXPECTED_BINDINGS_REQUIRED/);
  assert.throws(()=>signDevWriterPromotionClaim({
    kind:'fence',body:{...fenceBody,arbitrary:true},
    privateKey:source.privateKey}),/SCHEMA/);
});
