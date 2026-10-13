import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {makeSyntheticOwnerChannelDbProof}
 from './synthetic-owner-channel-db-proof.mjs';
const ids=(suffix='one')=>({
  requestCreatedAtMs:Date.now()-60000,requestExpiresAtMs:Date.now()+180000,
  requestId:'uat_request_'+suffix,grantId:'uat_grant_'+suffix,
  accountId:'uat_account_primary',deviceId:'uat_device_primary',
  agentId:'uat_agent_primary',connectionId:'uat_connection_primary',
  ownerSessionId:'uat_session_primary',
  deviceKeySha256:'a'.repeat(64)
});
const script=new URL('./synthetic-owner-channel-db-proof.mjs',import.meta.url).pathname;
const cmd=(payload,optIn=true)=>spawnSync(process.execPath,[script,'--synthetic-only'],{
  input:JSON.stringify(payload),encoding:'utf8',timeout:8000,
  env:{...process.env,LR_RC50_UAT_ONLY:optIn?'1':'0'}
});
test('01 two signed fake Wall/channel proofs yield a non-execution PG receipt',()=>{
 const proof=makeSyntheticOwnerChannelDbProof(ids());
 for(const k of ['nonceSha256','wallProofSha256','channelAckSha256',
   'wallVerifierSha256','channelVerifierSha256'])
   assert.match(proof[k],/^[a-f0-9]{64}$/);
 assert.equal(proof.productionIssuerAuthorized,false);
 assert.equal(proof.physicalExecutionAuthorized,false);
 assert.equal(proof.requestId,ids().requestId);
});
test('02 independent proof uses different nonce and signed packet digest',()=>{
 const a=makeSyntheticOwnerChannelDbProof(ids());
 const b=makeSyntheticOwnerChannelDbProof(ids());
 assert.notEqual(a.nonceSha256,b.nonceSha256);
 assert.notEqual(a.wallProofSha256,b.wallProofSha256);
});
test('03 batch shares issuer pins while nonces are unique',()=>{
 const r=cmd({batch:[ids('one'),ids('two'),ids('three')]});
 assert.equal(r.status,0,r.stderr);
 const out=JSON.parse(r.stdout);
 assert.equal(out.length,3);
 assert.equal(new Set(out.map(x=>x.wallVerifierSha256)).size,1);
 assert.equal(new Set(out.map(x=>x.channelVerifierSha256)).size,1);
 assert.equal(new Set(out.map(x=>x.nonceSha256)).size,3);
 assert.equal(new Set(out.map(x=>x.channelAckSha256)).size,3);
});
test('04 malformed actual-looking device name fails closed',()=>{
 assert.throws(()=>makeSyntheticOwnerChannelDbProof({...ids(),deviceId:'production-device'}),
 /invalid_synthetic_owner_db_input/);
});
test('05 owner session ID is compulsory',()=>{
 assert.throws(()=>makeSyntheticOwnerChannelDbProof({...ids(),ownerSessionId:''}),
 /invalid_synthetic_owner_db_input/);
});
test('06 invalid enrolled device fingerprint rejected before signing',()=>{
 assert.throws(()=>makeSyntheticOwnerChannelDbProof({...ids(),deviceKeySha256:'x'}),
 /invalid_synthetic_owner_db_input/);
});
test('07 signer CLI refuses no UAT environment',()=>{
 const r=cmd(ids(),false);
 assert.equal(r.status,3);
 assert.match(r.stderr,/synthetic_owner_channel_db_proof_uat_only/);
});
test('08 empty batch never produces issuer authorization',()=>{
 const r=cmd({batch:[]});
 assert.equal(r.status,4);
 assert.match(r.stderr,/synthetic_owner_channel_db_proof_refused/);
});
test('09 three unsigned public hashes cannot expose Ed25519 private keys',()=>{
 const r=cmd({batch:[ids('one'),ids('two')]});
 assert.equal(r.status,0,r.stderr);
 for(const item of JSON.parse(r.stdout)){
  assert.equal(Object.hasOwn(item,'privateKey'),false);
  assert.equal(Object.hasOwn(item,'signature'),false);
  assert.equal(item.productionIssuerAuthorized,false);
 }
});
test('10 Wall proof approval must be earlier than mock grant expiry',()=>{
 const p=makeSyntheticOwnerChannelDbProof(ids(),Date.now());
 assert.ok(Date.parse(p.approvedAt)<Date.now());
 assert.ok(Date.parse(p.channelApprovedAt)<=Date.parse(p.approvedAt));
});
