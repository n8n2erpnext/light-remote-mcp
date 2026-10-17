import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateGoldVerifierPath,bootGoldCoreFromEnvironment}
 from '../src/http/gold-core-entry.mjs';

const verifierNames=['verifyIdentityProof','verifyDeviceProof','verifyAgentPrincipal',
 'verifyWallApproval','verifyPaddleSignature','verifyOwnerProof',
 'verifyUsageEvidence','approveWallRequest','verifyAgentIngress',
 'verifyOAuthClient','verifyBillingIngress','verifyUsageIngress'];
const fixture=()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-core-private-'));
 const dir=path.join(root,'config');fs.mkdirSync(dir,{mode:0o700});
 const file=path.join(dir,'verifiers.mjs');fs.writeFileSync(file,'export const goldCoreVerifiers = {};\n',{mode:0o600});
 fs.chmodSync(root,0o700);fs.chmodSync(file,0o600);
 return {root,dir,file,env:{LIGHT_REMOTE_GOLD_INDEPENDENT:'1',
  LIGHT_REMOTE_GOLD_ROOT:root,LR_GOLD_VERIFIERS_MODULE:file},
  dispose:()=>fs.rmSync(root,{recursive:true,force:true})};
};
const bundle=()=>({...Object.fromEntries(verifierNames.map(x=>[x,async()=>false])),
 pairingEncryptionKey:Buffer.alloc(32)});
test('Gold Core launcher refuses untrusted or world/group readable verifier module',()=>{
 const f=fixture();
 try{
  assert.equal(validateGoldVerifierPath(f.env),f.file);
  assert.throws(()=>validateGoldVerifierPath({...f.env,LIGHT_REMOTE_GOLD_INDEPENDENT:'0'}),
   /gold_core_requires_independent_runtime/);
  fs.chmodSync(f.file,0o644);
  assert.throws(()=>validateGoldVerifierPath(f.env),/gold_core_verifier_file_not_private_owner/);
  fs.chmodSync(f.file,0o600);fs.chmodSync(f.dir,0o755);
  assert.throws(()=>validateGoldVerifierPath(f.env),/gold_core_verifier_file_not_private_owner/);
 }finally{f.dispose()}
});
test('Gold Core refuses missing callback even if owner supplies a private module',async()=>{
 const f=fixture(),calls=[];
 try{
  await assert.rejects(()=>bootGoldCoreFromEnvironment({...{
   env:f.env,importer:async()=>({goldCoreVerifiers:{}}),
   start:async()=>{calls.push('started')}
  }}),/gold_core_verifier_required_/);
  assert.deepEqual(calls,[]);
 }finally{f.dispose()}
});
test('Gold Core refuses absent encryption key before opening PostgreSQL',async()=>{
 const f=fixture();
 try{
  const incomplete=bundle();delete incomplete.pairingEncryptionKey;
  await assert.rejects(()=>bootGoldCoreFromEnvironment({
   env:f.env,importer:async()=>({goldCoreVerifiers:incomplete}),
   start:async()=>{throw Error('must not start')}
  }),/gold_core_pairing_encryption_key_missing/);
 }finally{f.dispose()}
});
test('Gold Core launches with explicitly provisioned trusted verifiers and never modifies production',async()=>{
 const f=fixture();let called=0;
 try{
  const result=await bootGoldCoreFromEnvironment({
   env:f.env,importer:async()=>({goldCoreVerifiers:bundle()}),
   start:async options=>{
    called++;
    assert.equal(options.env.LIGHT_REMOTE_GOLD_ROOT,f.root);
    assert.equal(options.verifiers.pairingEncryptionKey.length,32);
    return {socketPath:path.join(f.root,'run','core.sock')};
   }
  });
  assert.equal(called,1);
  assert.equal(result.socketPath,path.join(f.root,'run','core.sock'));
 }finally{f.dispose()}
});
