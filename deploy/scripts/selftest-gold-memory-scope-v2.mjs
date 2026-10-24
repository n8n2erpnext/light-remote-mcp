import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-v2-scopes-'));
const file=path.join(dir,'modules.sqlite');
let m=createGoldWallModules({file,scopeIdentity:{accountId:'account-owner',deviceId:'device-arm'}});
try{
  assert.equal(fs.existsSync(file),false);
  assert.throws(()=>m.createMemoryScope({displayName:'Must fail'}),/gold_module_disabled/);
  assert.equal(fs.existsSync(file),false);
  m.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  const v1=m.saveCheckpoint({title:'V1 restore',kind:'handoff',body:'Original V1 signed',source:'gold-uat'});
  const v1Original=m.readCheckpoint(v1.id);
  const light=m.createMemoryScope({displayName:'Light Remote Gold',captureMode:'manual'});
  const bi=m.createMemoryScope({displayName:'LightBI',captureMode:'auto'});
  const fw=m.createMemoryScope({displayName:'4G pocket firmware',captureMode:'follow_project'});
  assert.equal(m.listMemoryScopes().length,3);
  assert.equal(m.legacyUnassignedCount(),1);
  assert.equal(m.resolveMemoryScope({sourceType:'workspace',sourceId:'/repo/gold'}).scopeId,null);
  m.bindMemoryScope({scopeId:light.scopeId,sourceType:'workspace',sourceId:'/repo/gold',proofType:'owner_explicit'});
  assert.equal(m.resolveMemoryScope({sourceType:'workspace',sourceId:'/repo/gold'}).scopeId,light.scopeId);
  assert.throws(()=>m.bindMemoryScope({scopeId:bi.scopeId,sourceType:'workspace',sourceId:'/repo/gold',proofType:'owner_explicit'}),/gold_scope_binding_conflict/);
  assert.throws(()=>m.bindMemoryScope({scopeId:fw.scopeId,sourceType:'workspace',sourceId:'/repo/gold',proofType:'ai_guessed'}),/gold_scope_binding_proof_untrusted/);
  const a=m.appendScopedCheckpoint({scopeId:light.scopeId,title:'Gold M1',body:'ARM code changed',source:'job-verified-1',evidence:['commit:ab0123'],status:'observed'});
  const b=m.appendScopedCheckpoint({scopeId:bi.scopeId,title:'LightBI DB',body:'Unrelated metric',source:'lightbi-system'});
  const c=m.appendScopedCheckpoint({scopeId:light.scopeId,title:'Gold M2',body:'Test passed on Windows',source:'windows-test',evidence:['job:win-test-1'],status:'test_passed'});
  const d=m.appendScopedCheckpoint({scopeId:fw.scopeId,title:'Firmware note',body:'4G pocket progress',source:'desktop-firmware'});
  assert.equal(a.revision,1);
  assert.equal(c.revision,2);
  assert.equal(m.scopedHandoff({scopeId:light.scopeId}).revision,2);
  assert.deepEqual(m.scopedHandoff({scopeId:light.scopeId}).checkpoints.map(x=>x.title),['Gold M2','Gold M1']);
  assert.equal(m.scopedHandoff({scopeId:bi.scopeId}).checkpoints.length,1);
  assert.equal(m.scopedHandoff({scopeId:fw.scopeId}).checkpoints.length,1);
  assert.equal(m.readScopedCheckpoint({scopeId:light.scopeId,checkpointId:a.checkpointId}).integrity,'home_ed25519_verified');
  assert.equal(m.scopedHandoff({scopeId:light.scopeId}).checkpoints[0].prevHash,a.contentHash);
  assert.throws(()=>m.readScopedCheckpoint({scopeId:light.scopeId,checkpointId:b.checkpointId}),/gold_scope_checkpoint_not_found/);
  assert.throws(()=>m.readScopedCheckpoint({scopeId:bi.scopeId,checkpointId:d.checkpointId}),/gold_scope_checkpoint_not_found/);
  const safe=m.appendScopedCheckpoint({scopeId:light.scopeId,deviceId:'device-foreign',accountId:'other-account',title:'Guarded',body:'Trusted local identity wins',source:'local-runtime',transactionManaged:true});
  assert.equal(safe.revision,3);
  assert.equal(m.scopedHandoff({scopeId:light.scopeId}).checkpoints[0].title,'Guarded');
  const raw=new DatabaseSync(file);
  raw.prepare('UPDATE lm_checkpoint_v2 SET body=? WHERE checkpoint_id=?').run('TAMPER',a.checkpointId);
  raw.close();
  assert.throws(()=>m.readScopedCheckpoint({scopeId:light.scopeId,checkpointId:a.checkpointId}),/gold_scope_checkpoint_hash_invalid/);
  assert.equal(m.readCheckpoint(v1.id).signature,v1Original.signature);
  assert.equal(m.readCheckpoint(v1.id).integrity,'device_hmac_verified');
  m.close();
  m=createGoldWallModules({file,scopeIdentity:{accountId:'account-owner',deviceId:'device-arm'}});
  assert.equal(m.scopedHandoff({scopeId:bi.scopeId}).checkpoints[0].integrity,'home_ed25519_verified');
  const lateV1=m.saveCheckpoint({title:'Late V1 manual checkpoint',kind:'checkpoint',body:'Still legacy/unassigned',source:'old-manual-tool'});
  assert.equal(m.legacyUnassignedCount(),2,'Later V1 writes must remain unassigned');
  assert.equal(m.readCheckpoint(lateV1.id).integrity,'device_hmac_verified');
  assert.throws(()=>m.readScopedCheckpoint({scopeId:light.scopeId,checkpointId:a.checkpointId}),/gold_scope_checkpoint_hash_invalid/);
  m.close();
  const replica=createGoldWallModules({file,scopeIdentity:{accountId:'account-owner',deviceId:'device-windows'}});
  try{
    assert.equal(replica.scopedHandoff({scopeId:bi.scopeId}).checkpoints[0].integrity,'home_ed25519_verified');
    assert.throws(()=>replica.appendScopedCheckpoint({scopeId:bi.scopeId,title:'Illegal replica commit',body:'Should not be committed',source:'replica'}),/gold_scope_home_only/);
  }finally{replica.close();}
  const untrusted=createGoldWallModules({file});
  try{assert.throws(()=>untrusted.listMemoryScopes(),/gold_scope_trusted_identity_required/);}finally{untrusted.close();}
  const other=createGoldWallModules({file,scopeIdentity:{accountId:'different-account',deviceId:'device-arm'}});
  try{assert.equal(other.listMemoryScopes().length,0);assert.throws(()=>other.scopedHandoff({scopeId:light.scopeId}),/gold_scope_not_found/);}finally{other.close();}
  console.log('GOLD_LONG_MEMORY_V2_G1_SCOPE_ISOLATION_V1_HMAC_SIGNATURE_TAMPER_RESTART_PASS');
}finally{m.close();fs.rmSync(dir,{recursive:true,force:true});}
