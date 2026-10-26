import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {prepareGoldMemoryV2} from '../../device-agent/gold-memory-scope.mjs';
import {checkAccountDeletionEnvelope} from '../../device-agent/gold-memory-account-delete.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-account-delete-fixture-'));
const acc='delete-fixture-account',homeId='dev_home',repId='dev_replica';
const home=createGoldWallModules({file:path.join(dir,'home.sqlite'),scopeIdentity:{accountId:acc,deviceId:homeId}});
const rep=createGoldWallModules({file:path.join(dir,'replica.sqlite'),scopeIdentity:{accountId:acc,deviceId:repId}});
try{
 home.configure({longMemory:true,codexBridge:false,expectedRevision:0});
 rep.configure({longMemory:true,codexBridge:false,expectedRevision:0});
 const keep=home.createMemoryScope({displayName:'KEEP WORK'});
 const erase=home.createMemoryScope({displayName:'DELETE WORK'});
 const envelope=home.signScopeDeleteAcrossAccount({scopeId:erase.scopeId,confirmName:'DELETE WORK',ownerConfirmed:true});
 assert.equal(checkAccountDeletionEnvelope(envelope).scopeId,erase.scopeId);
 assert.throws(()=>home.signScopeDeleteAcrossAccount({scopeId:erase.scopeId,confirmName:'wrong',ownerConfirmed:true}),/exact_name/);
 assert.throws(()=>rep.signScopeDeleteAcrossAccount({scopeId:erase.scopeId,confirmName:'DELETE WORK',ownerConfirmed:true}));
 // Build realistic independently local Replica metadata fixture, no live device data.
 rep.listMemoryScopes();
 const db=new DatabaseSync(path.join(dir,'replica.sqlite'));
 try{
  prepareGoldMemoryV2(db);
  db.prepare("INSERT INTO lm_scopes(scope_id,account_id,display_name,home_device_id,home_epoch,capture_mode,sync_policy,home_public_key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(erase.scopeId,acc,'DELETE WORK',homeId,1,'manual','selected_devices',envelope.homeSignPublicKey,'active',Date.now(),Date.now());
  db.prepare('INSERT INTO lm_heads(scope_id,home_epoch,revision,head_hash,updated_at) VALUES(?,?,?,?,?)')
    .run(erase.scopeId,1,0,'0'.repeat(64),Date.now());
 }finally{db.close();}
 const altered=structuredClone(envelope);altered.record.issuedAt++;
 assert.throws(()=>rep.applyScopeDeleteAcrossAccount(altered),/home_signature_invalid/);
 assert.equal(rep.listMemoryScopes().length,1);
 const result=rep.applyScopeDeleteAcrossAccount(envelope);
 assert.equal(result.deletedLocally,true);
 assert.equal(rep.listMemoryScopes().length,0);
 assert.equal(rep.applyScopeDeleteAcrossAccount(envelope).alreadyApplied,true);
 const other=structuredClone(envelope);other.signature='AA';
 assert.throws(()=>rep.applyScopeDeleteAcrossAccount(other),/home_signature_invalid/);
 home.applyScopeDeleteAcrossAccount(envelope);
 assert.deepEqual(home.listMemoryScopes().map(s=>s.scopeId),[keep.scopeId]);
 assert.equal(home.applyScopeDeleteAcrossAccount(envelope).alreadyApplied,true);
 const fresh=createGoldWallModules({file:path.join(dir,'fresh.sqlite'),scopeIdentity:{accountId:acc,deviceId:'dev_new'}});
 try{
  fresh.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  assert.equal(fresh.applyScopeDeleteAcrossAccount(envelope).deletedLocally,true);
  assert.equal(fresh.applyScopeDeleteAcrossAccount(envelope).alreadyApplied,true);
  assert.equal(fresh.listMemoryScopes().length,0);
 }finally{fresh.close();}
 const proof=new DatabaseSync(path.join(dir,'replica.sqlite'));
 assert.equal(proof.prepare('SELECT count(*) AS n FROM lm_scope_local_tombstones WHERE scope_id=?').get(erase.scopeId).n,1);
 proof.close();
 const migration=fs.readFileSync(new URL('../../platform-v2/sql/037_gold_memory_account_delete_tombstones.sql',import.meta.url),'utf8');
 assert.ok(migration.includes('acknowledged_at'));
 assert.ok(migration.includes('GRANT SELECT,INSERT'));
 assert.ok(!/checkpoint_body|JSONB|payload_json|snapshot_body/i.test(migration));
 console.log('GOLD_ACCOUNT_SCOPE_DELETE_SIGNED_HOME_REPLICA_TOMBSTONE_IDEMPOTENT_PASS');
}finally{home.close();rep.close();fs.rmSync(dir,{recursive:true,force:true});}
