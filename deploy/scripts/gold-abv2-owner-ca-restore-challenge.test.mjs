import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
 issueOwnerCaRecoveryChallenge,verifyOwnerCaRecoveryResponse,
 ownerCaRecoveryChallengePayload
} from './gold-abv2-owner-ca-restore-challenge.mjs';

const cli=fileURLToPath(new URL('./gold-abv2-owner-ca-restore-challenge.mjs',import.meta.url));
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-owner-recovery-challenge-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const key=path.join(dir,'disposable-private.key');
 const caFile=path.join(dir,'public-ca.crt');
 execFileSync('openssl',['req','-x509','-newkey','rsa:4096','-nodes',
  '-days','90','-sha256','-subj','/CN=DISPOSABLE-RESTORE-PROOF-CA',
  '-addext','basicConstraints=critical,CA:TRUE,pathlen:0',
  '-addext','keyUsage=critical,keyCertSign,cRLSign',
  '-keyout',key,'-out',caFile],{stdio:'ignore',timeout:40000});
 fs.chmodSync(key,0o600);
 const ca=new crypto.X509Certificate(fs.readFileSync(caFile));
 const expectedCaSha256=crypto.createHash('sha256').update(ca.raw).digest('hex');
 const secret=crypto.createPrivateKey(fs.readFileSync(key));
 const sign=challenge=>({
  schemaVersion:'light-remote.owner-ca-restore-response.v1',
  challengeId:challenge.challengeId,
  signatureBase64url:crypto.sign('sha256',ownerCaRecoveryChallengePayload(challenge),
   {key:secret,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32})
   .toString('base64url')
 });
 return {dir,key,caFile,expectedCaSha256,sign};
}
test('T04b8 Owner CA signed restore challenge: private key never required by verifier',async t=>{
 const f=fixture(t);
 const now=Date.now();
 const opts={caFile:f.caFile,expectedCaSha256:f.expectedCaSha256,now};
 const issued=issueOwnerCaRecoveryChallenge(opts);
 const challenge=issued.challenge;
 const response=f.sign(challenge);
 const verify=(extras={})=>verifyOwnerCaRecoveryResponse({
  ...opts,issuedChallenge:challenge,response,...extras
 });
 await t.test('random challenge and release HOLD despite valid public cert',()=>{
  assert.equal(issued.releaseApproved,false);
  assert.equal(issued.releaseStatus,'HOLD');
  assert.equal(issued.backupVerified,false);
  assert.match(challenge.challengeId,/^[a-f0-9]{64}$/);
  assert.match(challenge.nonce,/^[a-f0-9]{64}$/);
  const another=issueOwnerCaRecoveryChallenge(opts);
  assert.notEqual(another.challenge.challengeId,challenge.challengeId);
  assert.notEqual(another.challenge.nonce,challenge.nonce);
 });
 await t.test('RSA PSS SHA256 possession PASS but independent recovery NOT proven',()=>{
  const result=verify();
  assert.equal(result.challengeVerified,true);
  assert.equal(result.recoveredSignerPossessionProved,true);
  assert.equal(result.independentMediaRecoveryProved,false);
  assert.equal(result.actualRecoveryDeviceVerified,false);
  assert.equal(result.releaseApproved,false);
  assert.equal(result.releaseStatus,'HOLD');
  assert.equal(result.signerPrivateKeyRead,false);
  assert.equal(result.trustStoreChanged,false);
 });
 await t.test('invalid signature / modified signed nonce rejected',()=>{
  const modified={...challenge,nonce:'0'.repeat(64)};
  assert.throws(()=>verify({issuedChallenge:modified}),
    /ca_possession_signature_invalid/);
 });
 await t.test('expired challenge rejects otherwise valid signature',()=>{
  assert.throws(()=>verify({now:Date.parse(challenge.expiresAt)+1000}),
    /challenge_expired_or_outside_policy/);
 });
 await t.test('challenge clock skew over 5 minutes rejects',()=>{
  assert.throws(()=>verify({now:Date.parse(challenge.issuedAt)-301000}),
    /challenge_expired_or_outside_policy/);
 });
 await t.test('wrong response challenge ID rejected',()=>{
  assert.throws(()=>verify({response:{...response,challengeId:'0'.repeat(64)}}),
    /response_invalid/);
 });
 await t.test('wrong public fingerprint rejected without secret',()=>{
  assert.throws(()=>verify({expectedCaSha256:'f'.repeat(64)}),
    /ca_public_trust_mismatch/);
 });
 await t.test('invalid/short base64 signature rejected',()=>{
  assert.throws(()=>verify({response:{...response,signatureBase64url:'abc'}}),
    /response_invalid/);
 });
 await t.test('old response bound to different challenge rejected',()=>{
  const next=issueOwnerCaRecoveryChallenge(opts).challenge;
  assert.throws(()=>verify({issuedChallenge:next}),/response_invalid/);
 });
 await t.test('issue TTL over 15 minutes rejected',()=>{
  assert.throws(()=>issueOwnerCaRecoveryChallenge({...opts,ttlMinutes:16}),
    /invalid_ttl/);
 });
 await t.test('CLI issue/verify output remains HOLD with no secret material',()=>{
  const issue=spawnSync(process.execPath,[cli,'issue','--ca-file',f.caFile,
   '--pin',f.expectedCaSha256],{encoding:'utf8',timeout:14000});
  assert.equal(issue.status,2,issue.stderr);
  const envelope=JSON.parse(issue.stdout);
  assert.equal(envelope.releaseApproved,false);
  const issuedFile=path.join(f.dir,'challenge.json');
  fs.writeFileSync(issuedFile,issue.stdout);
  const signed=f.sign(envelope.challenge);
  const responseFile=path.join(f.dir,'response.json');
  fs.writeFileSync(responseFile,JSON.stringify(signed));
  const verified=spawnSync(process.execPath,[cli,'verify','--ca-file',f.caFile,
   '--pin',f.expectedCaSha256,'--issued',issuedFile,
   '--response',responseFile],{encoding:'utf8',timeout:14000});
  assert.equal(verified.status,2,verified.stderr);
  assert.equal(JSON.parse(verified.stdout).releaseApproved,false);
  assert.equal(verified.stdout.includes('PRIVATE KEY'),false);
  assert.equal(verified.stdout.includes(f.key),false);
 });
 await t.test('CLI invalid flags exit 3',()=>{
  const run=spawnSync(process.execPath,[cli,'issue','--ca-file',f.caFile],
   {encoding:'utf8',timeout:14000});
  assert.equal(run.status,3);
  assert.equal(run.stdout,'');
 });
});
