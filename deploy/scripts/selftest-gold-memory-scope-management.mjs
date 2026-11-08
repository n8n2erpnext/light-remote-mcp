import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-scope-mgmt-'));
const dbFile=path.join(dir,'gold.sqlite');
const m=createGoldWallModules({file:dbFile,scopeIdentity:{accountId:'account-a',deviceId:'home-a'}});
try{
  m.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  const a=m.createMemoryScope({displayName:'Editable project scope'});
  const b=m.createMemoryScope({displayName:'Independent project'});
  assert.equal(m.fullContextPreference({scopeId:a.scopeId}).fullContextOptIn,false);
  assert.throws(()=>m.saveFullContext({scopeId:a.scopeId,text:'secret project info',confirmed:true}),
    /memory_full_context_scope_opt_in_disabled/);
  m.setFullContextPreference({scopeId:a.scopeId,enabled:true});
  const text='Daily decisions, handoff and workspace context.\n'+'💡'.repeat(7000)+'\nFinal result ✅';
  const saved=m.saveFullContext({scopeId:a.scopeId,text,title:'Owner complete session',
    source:'owner_paste',confirmed:true});
  assert.ok(saved.parts>1);
  const read=m.readFullContext({scopeId:a.scopeId});
  assert.equal(read.available,true);
  assert.equal(read.text,text);
  assert.equal(read.sha256,saved.sha256);
  const usage=m.localMemoryUsage();
  assert.ok(usage.localFileBytes>0);
  assert.ok(usage.scopes.find(s=>s.scopeId===a.scopeId).checkpointBodyBytes>1000);
  assert.equal(usage.lastConfirmedSyncAt,null,'never claim sync based on local save');
  assert.throws(()=>m.archiveMemoryScope({scopeId:a.scopeId}),/memory_scope_owner_confirmation_required/);
  assert.equal(m.archiveMemoryScope({scopeId:a.scopeId,ownerConfirmed:true}).status,'archived');
  assert.throws(()=>m.saveFullContext({scopeId:a.scopeId,text:'should not write',confirmed:true}),
    /memory_scope_not_active/);
  assert.equal(m.restoreMemoryScope({scopeId:a.scopeId,ownerConfirmed:true}).status,'active');
  assert.equal(m.readFullContext({scopeId:a.scopeId}).text,text);
  assert.throws(()=>m.deleteMemoryScopeLocal({scopeId:a.scopeId,confirmName:'wrong',ownerConfirmed:true}),
    /memory_scope_delete_name_mismatch/);
  const gone=m.deleteMemoryScopeLocal({scopeId:a.scopeId,confirmName:'Editable project scope',ownerConfirmed:true});
  assert.equal(gone.status,'deleted_locally');
  assert.ok(gone.checkpointsDeleted>1);
  assert.throws(()=>m.restoreMemoryScope({scopeId:a.scopeId,ownerConfirmed:true}),
    /memory_scope_deleted_cannot_restore/);
  assert.equal(m.listMemoryScopes().some(x=>x.scopeId===a.scopeId),false,'archived/deleted scope excluded from active list');
  assert.equal(m.localMemoryUsage().scopes.find(x=>x.scopeId===a.scopeId).tombstoned,true);
  assert.equal(m.localMemoryUsage().scopes.find(x=>x.scopeId===a.scopeId).checkpoints,0);
  assert.equal(m.localMemoryUsage().scopes.find(x=>x.scopeId===b.scopeId).tombstoned,false);
  assert.throws(()=>m.deleteMemoryScopeAcrossAccount(),/memory_scope_account_delete_requires_signed_tombstone/);
  console.log('GOLD_MEMORY_SCOPED_ARCHIVE_DELETE_LOCAL_TOMBSTONE_OPTIN_FULL_CONTEXT_UNICODE_PASS');
}finally{m.close();fs.rmSync(dir,{recursive:true,force:true});}
