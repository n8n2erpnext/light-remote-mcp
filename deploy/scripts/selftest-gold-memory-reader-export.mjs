import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-owner-memory-export-'));
const file=path.join(dir,'gold-wall-modules.sqlite');
const m=createGoldWallModules({file,scopeIdentity:{accountId:'gold-owner-account',deviceId:'home-owner'}});
let wall=null;
try{
  m.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  const gold=m.createMemoryScope({displayName:'Light Remote Gold',captureMode:'manual'});
  const bi=m.createMemoryScope({displayName:'LightBI',captureMode:'manual'});
  const a=m.appendScopedCheckpoint({scopeId:gold.scopeId,title:'Gold checkpoint 1',body:'Scoped content 1',source:'test:a'});
  const b=m.appendScopedCheckpoint({scopeId:gold.scopeId,title:'Gold checkpoint 2',body:'Scoped content 2',source:'test:b'});
  m.appendScopedCheckpoint({scopeId:bi.scopeId,title:'BI separate',body:'Other project private',source:'test:bi'});
  let last=b;
  for(let i=3;i<=8;i++)last=m.appendScopedCheckpoint({scopeId:gold.scopeId,title:'Gold checkpoint '+i,body:'Scoped content '+i,source:'test:more'});
  const full=m.scopedExport({scopeId:gold.scopeId});
  assert.equal(full.checkpointCount,8,'export must include older history beyond short handoff');
  assert.equal(full.revision,8);
  assert.deepEqual(full.checkpoints.map(x=>x.revision),[1,2,3,4,5,6,7,8]);
  assert.ok(full.checkpoints.every(x=>x.integrity==='home_ed25519_verified'));
  assert.ok(!JSON.stringify(full).includes('Other project private'));
  assert.equal(full.coverage,'authoritative_current_epoch_only');
  assert.equal(full.headHash,last.contentHash);
  assert.equal(m.scopedHandoff({scopeId:gold.scopeId,limit:1}).checkpoints.length,1);
  const auth={
    enabled:true,
    identity:req=>req.headers['x-test-owner']==='yes'?{username:'owner'}:null,
    csrfForRequest:()=> 'test-csrf',
    verifyRequestCsrf:(_req,s)=>s==='test-csrf'
  };
  wall=startLocalWall({host:'127.0.0.1',port:0,auth,modules:m,
    getLocalStatus:async()=>({deviceName:'test-owner',cloudState:'disconnected'})});
  await new Promise((resolve,reject)=>wall.server.listening?resolve():wall.server.once('listening',resolve).once('error',reject));
  const base='http://127.0.0.1:'+wall.server.address().port;
  const route='/api/gold/modules/scope/export?scopeId='+encodeURIComponent(gold.scopeId);
  assert.equal((await fetch(base+route)).status,401,'unauthenticated export must fail');
  const resp=await fetch(base+route,{headers:{'x-test-owner':'yes'}});
  assert.equal(resp.status,200);
  const out=await resp.json();
  assert.equal(out.export.checkpointCount,8);
  assert.equal(out.export.integrity,'all_current_epoch_revisions_verified');
  assert.equal((await fetch(base+'/api/gold/modules/scope/export?scopeId=missing',
    {headers:{'x-test-owner':'yes'}})).status,400);
  const html=await (await fetch(base+'/',{headers:{'x-test-owner':'yes'}})).text();
  for(const id of ['goldReaderScope','goldReaderRead','goldReaderExportJson','goldReaderExportMd',
    'goldReaderPreview','goldReaderStatus'])assert.ok(html.includes('id="'+id+'"'),id);
  const scripts=[...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)];
  for(const [i,s] of scripts.entries())if(s[1]?.trim())new vm.Script(s[1],{filename:'GoldMemoryReader-'+i+'.js'});
  console.log('GOLD_MEMORY_OWNER_SCOPED_READ_EXPORT_UI_AUTH_PASS');
  await wall.close();wall=null;
  const other=createGoldWallModules({file,scopeIdentity:{accountId:'unrelated-account',deviceId:'foreign-device'}});
  try{assert.throws(()=>other.scopedExport({scopeId:gold.scopeId}),/gold_scope_not_found/);}
  finally{other.close();}
  const raw=new DatabaseSync(file);
  raw.prepare('UPDATE lm_checkpoint_v2 SET body=? WHERE checkpoint_id=?').run('TAMPERED',a.checkpointId);
  raw.close();
  assert.throws(()=>m.scopedExport({scopeId:gold.scopeId}),/gold_scope_checkpoint_hash_invalid/);
  console.log('GOLD_MEMORY_FULL_CHAIN_TAMPER_CROSS_SCOPE_FAIL_CLOSED_PASS');
}finally{if(wall)await wall.close();m.close();fs.rmSync(dir,{recursive:true,force:true});}
