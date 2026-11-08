import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SyntheticAgentGeneration} from '../portability/synthetic-agent-generation.mjs';
import {SyntheticSignedAgentGate,signSyntheticEpoch,signSyntheticCommand,syntheticKeyFingerprint} from '../portability/synthetic-signed-agent-gate.mjs';

let passed=0;
function test(name,fn){fn();console.log('PASS '+name);passed++;}
function fixture(run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-agent-fixture-'));
 const keys=crypto.generateKeyPairSync('ed25519');
 const rogue=crypto.generateKeyPairSync('ed25519');
 const accountId='uat_account_fake_owner';
 const deviceId='uat_device_fake_target';
 const agentId='uat_agent_fake_target';
 let now=100_000;
 const reader=()=>now;
 const newGate=(key=keys.publicKey)=>new SyntheticSignedAgentGate({
   agent:new SyntheticAgentGeneration({root,agentId}),publicKey:key,
   accountId,deviceId,agentId,now:reader
 });
 const makeEpoch=(overrides={})=>({
   kind:'fake_epoch',accountId,deviceId,agentId,generation:50,
   grantRevision:7,notBefore:90_000,expiresAt:160_000,...overrides
 });
 const open=(gate,epoch=makeEpoch())=>{
   const signed=signSyntheticEpoch(keys.privateKey,epoch);
   const applied=gate.applyEpoch(signed);
   return {signed,applied};
 };
 const makeCommand=(digest,overrides={})=>({
   kind:'fake_command',accountId,deviceId,agentId,
   generation:50,grantRevision:7,epochDigest:digest,
   commandId:'uat_cmd_fake_signed_001',
   notBefore:95_000,expiresAt:120_000,
   payload:{kind:'fake_noop',message:'fake local test only'},...overrides
 });
 const signCommand=(digest,overrides={},privateKey=keys.privateKey)=>
   signSyntheticCommand(privateKey,makeCommand(digest,overrides));
 try{return run({root,keys,rogue,newGate,makeEpoch,open,makeCommand,signCommand,
   setNow:value=>now=value});}
 finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('valid_ed25519_epoch_and_fake_command_receipts',()=>fixture(({newGate,open,signCommand})=>{
 const gate=newGate(),{applied}=open(gate);
 assert.match(applied.epochDigest,/^[a-f0-9]{64}$/);
 const result=gate.accept(signCommand(applied.epochDigest));
 assert.equal(result.status,'accepted_receipt_persisted');
 assert.equal(gate.startFake('uat_cmd_fake_signed_001').executed,false);
 assert.equal(gate.state.realExecutionAllowed,false);
}));
test('fingerprint_pins_verifier_not_production_key',()=>fixture(({keys,rogue})=>{
 const a=syntheticKeyFingerprint(keys.publicKey);
 const b=syntheticKeyFingerprint(rogue.publicKey);
 assert.match(a,/^[a-f0-9]{64}$/);
 assert.notEqual(a,b);
}));
test('rogue_signed_epoch_rejected',()=>fixture(({newGate,makeEpoch,rogue})=>{
 const gate=newGate();
 assert.throws(()=>gate.applyEpoch(signSyntheticEpoch(rogue.privateKey,makeEpoch())),/signature_not_verified/);
}));
test('tampered_signed_epoch_generation_denied',()=>fixture(({newGate,makeEpoch,keys})=>{
 const gate=newGate(),packet=signSyntheticEpoch(keys.privateKey,makeEpoch());
 packet.payload={...packet.payload,generation:51};
 assert.throws(()=>gate.applyEpoch(packet),/signature_not_verified/);
}));
test('wrong_account_device_agent_bound_in_epoch',()=>fixture(({newGate,makeEpoch,keys})=>{
 const gate=newGate();
 for(const patch of [
  {accountId:'uat_account_other_account'},
  {deviceId:'uat_device_other_device'},
  {agentId:'uat_agent_other_agent'}
 ]){
  assert.throws(()=>gate.applyEpoch(signSyntheticEpoch(keys.privateKey,makeEpoch(patch))),/signed_envelope_wrong_target/);
 }
}));
test('expired_and_future_epoch_rejected',()=>fixture(({newGate,makeEpoch,keys,setNow})=>{
 const gate=newGate();
 setNow(80_000);
 assert.throws(()=>gate.applyEpoch(signSyntheticEpoch(keys.privateKey,makeEpoch())),/signed_envelope_expired_or_not_yet_valid/);
 setNow(160_000);
 assert.throws(()=>gate.applyEpoch(signSyntheticEpoch(keys.privateKey,makeEpoch())),/signed_envelope_expired_or_not_yet_valid/);
}));
test('signed_command_requires_authenticated_epoch_after_restart',()=>fixture(({newGate,open,signCommand})=>{
 const first=newGate(),{applied}=open(first);
 const signed=signCommand(applied.epochDigest);
 const restarted=newGate();
 assert.throws(()=>restarted.accept(signed),/signed_epoch_required_after_restart/);
 open(restarted);
 assert.equal(restarted.accept(signed).status,'accepted_receipt_persisted');
}));
test('command_tamper_or_rogue_signature_rejected',()=>fixture(({newGate,open,signCommand,rogue})=>{
 const gate=newGate(),{applied}=open(gate);
 const valid=signCommand(applied.epochDigest);
 valid.payload.payload.message='modified';
 assert.throws(()=>gate.accept(valid),/signature_not_verified/);
 assert.throws(()=>gate.accept(signCommand(applied.epochDigest,{},rogue.privateKey)),/signature_not_verified/);
}));
test('command_wrong_target_rejected_even_with_valid_signature',()=>fixture(({newGate,open,signCommand})=>{
 const gate=newGate(),{applied}=open(gate);
 assert.throws(()=>gate.accept(signCommand(applied.epochDigest,{
   deviceId:'uat_device_other_device'
 })),/signed_envelope_wrong_target/);
}));
test('command_generation_and_grant_revision_must_match_epoch',()=>fixture(({newGate,open,signCommand})=>{
 const gate=newGate(),{applied}=open(gate);
 assert.throws(()=>gate.accept(signCommand(applied.epochDigest,{generation:51})),/signed_command_epoch_or_grant_mismatch/);
 assert.throws(()=>gate.accept(signCommand(applied.epochDigest,{grantRevision:8})),/signed_command_epoch_or_grant_mismatch/);
 assert.throws(()=>gate.accept(signCommand('a'.repeat(64))),/signed_command_epoch_or_grant_mismatch/);
}));
test('invalid_noop_payload_and_extra_fields_denied_before_signing',()=>fixture(({keys,makeEpoch,makeCommand})=>{
 assert.throws(()=>signSyntheticEpoch(keys.privateKey,{...makeEpoch(),evil:true}),/invalid_fake_signed_epoch/);
 assert.throws(()=>signSyntheticCommand(keys.privateKey,makeCommand('f'.repeat(64),{
   payload:{kind:'pty',message:'no'}
 })),/invalid_fake_signed_command/);
}));
test('expired_signed_command_denied_at_accept',()=>fixture(({newGate,open,signCommand,setNow})=>{
 const gate=newGate(),{applied}=open(gate);
 setNow(120_000);
 assert.throws(()=>gate.accept(signCommand(applied.epochDigest)),/signed_envelope_expired_or_not_yet_valid/);
}));
test('expired_command_denied_just_before_start',()=>fixture(({newGate,open,signCommand,setNow})=>{
 const gate=newGate(),{applied}=open(gate);
 gate.accept(signCommand(applied.epochDigest));
 setNow(120_000);
 assert.throws(()=>gate.startFake('uat_cmd_fake_signed_001'),/signed_command_not_fresh_for_start/);
}));
test('expired_epoch_denied_just_before_start',()=>fixture(({newGate,open,signCommand,setNow})=>{
 const gate=newGate(),{applied}=open(gate);
 gate.accept(signCommand(applied.epochDigest));
 setNow(160_000);
 assert.throws(()=>gate.startFake('uat_cmd_fake_signed_001'),/signed_envelope_expired_or_not_yet_valid/);
}));
test('same_command_duplicate_is_noop_after_receipt',()=>fixture(({newGate,open,signCommand})=>{
 const gate=newGate(),{applied}=open(gate),packet=signCommand(applied.epochDigest);
 assert.equal(gate.accept(packet).status,'accepted_receipt_persisted');
 assert.equal(gate.accept(packet).status,'duplicate_no_execution');
 gate.startFake('uat_cmd_fake_signed_001');
 assert.throws(()=>gate.startFake('uat_cmd_fake_signed_001'),/signed_command_not_fresh_for_start/);
}));
test('restart_marks_started_receipt_uncertain_not_replay',()=>fixture(({newGate,open,signCommand})=>{
 const gate=newGate(),{applied}=open(gate),packet=signCommand(applied.epochDigest);
 gate.accept(packet);gate.startFake('uat_cmd_fake_signed_001');
 const restart=newGate();open(restart);
 assert.equal(restart.accept(packet).status,'duplicate_no_execution');
 assert.throws(()=>restart.startFake('uat_cmd_fake_signed_001'),/signed_command_not_fresh_for_start/);
}));
test('higher_signed_epoch_rejects_old_command',()=>fixture(({newGate,open,makeEpoch,signCommand})=>{
 const gate=newGate(),{applied}=open(gate),packet=signCommand(applied.epochDigest);
 gate.accept(packet);
 open(gate,makeEpoch({generation:51,grantRevision:8}));
 assert.throws(()=>gate.accept(packet),/signed_command_epoch_or_grant_mismatch/);
 assert.throws(()=>gate.startFake('uat_cmd_fake_signed_001'),/signed_command_not_fresh_for_start/);
}));
test('same_generation_conflicting_signed_grant_refused',()=>fixture(({newGate,open,makeEpoch})=>{
 const gate=newGate();open(gate);
 assert.throws(()=>open(gate,makeEpoch({grantRevision:8})),/conflicting_epoch_control/);
}));
test('signature_domain_separation_prevents_command_as_epoch',()=>fixture(({newGate,open,signCommand})=>{
 const gate=newGate(),{applied}=open(gate);
 assert.throws(()=>gate.applyEpoch(signCommand(applied.epochDigest)),/invalid_fake_signed_epoch/);
}));
test('bad_signer_or_verifier_type_rejected',()=>fixture(({keys,newGate,makeEpoch})=>{
 assert.throws(()=>signSyntheticEpoch(keys.publicKey,makeEpoch()),/invalid_fake_signer/);
 assert.throws(()=>newGate(keys.privateKey),/invalid_fake_gate_dependencies/);
}));
console.log('RC50_SIGNED_SYNTHETIC_AGENT_TESTS_PASS '+passed+'/'+passed);
