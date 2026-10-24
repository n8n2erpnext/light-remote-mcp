import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ContinuityStore} from '../../device-agent/project-continuity-store.mjs';
import {safeGoldToolReceipt,observeGoldToolReceipt} from '../../device-agent/project-continuity-tool-observer.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'continuity-passive-memory-'));
try{
 const db=new ContinuityStore({root});
 try{
  assert.equal(db.db.prepare('PRAGMA user_version').get().user_version,10);
  assert.deepEqual([db.moduleSettings().memoryEnabled,db.moduleSettings().codexEnabled],[false,false]);
  const receipt=safeGoldToolReceipt({
   commandId:'command:fixed-0123456789',
   payload:{type:'terminal',script:'SENSITIVE_PRIVATE_COMMAND_TOKEN',password:'SENSITIVE_OWNER_PASSWORD'}
  },{status:'ok',exitCode:0,stdout:'SECRET_OUTPUT_STRING'});
  assert.deepEqual(receipt,{operationId:'command:fixed-0123456789',category:'terminal',outcome:'ok'});
  assert.equal(db.observeGoldTool(receipt).recorded,false);
  assert.equal(db.db.prepare('SELECT count(*) n FROM observed_tool_receipts').get().n,0);
  let settings=db.moduleSettings();
  settings=db.setGlobalModules({memory:true,codex:false,expectedRevision:settings.revision});
  assert.equal(db.projects().length,0,'no user Project required');
  assert.equal(db.observeGoldTool(receipt).recorded,true);
  assert.equal(db.observeGoldTool(receipt).recorded,false,'at least once device delivery deduplicated');
  const result=db.observeGoldTool({operationId:crypto.randomUUID(),category:'filesystem',outcome:'error'});
  assert.equal(result.recorded,true);
  assert.deepEqual(db.recentGoldActivity({limit:2}).map(x=>x.category).sort(),['filesystem','terminal']);
  const brief=db.contextBrief(settings.defaultScopeId,{maxChars:6000});
  assert.match(brief.content,/Recent Light Remote tool activity/);
  assert.match(brief.content,/terminal ok/);
  assert.match(brief.content,/filesystem error/);
  const serialized=JSON.stringify(db.db.prepare('SELECT * FROM observed_tool_receipts').all())+brief.content;
  for(const phrase of ['SENSITIVE_PRIVATE_COMMAND_TOKEN','SENSITIVE_OWNER_PASSWORD','SECRET_OUTPUT_STRING'])
   assert.ok(!serialized.includes(phrase),'private tool payload must not be retained');
  settings=db.setGlobalModules({memory:false,codex:false,expectedRevision:settings.revision});
  assert.equal(db.observeGoldTool({operationId:crypto.randomUUID(),category:'scp',outcome:'ok'}).recorded,false);
  assert.throws(()=>db.recentGoldActivity(),/continuity_memory_disabled/);
  console.log('PASSIVE_GOLD_RECEIPT_AUTO_LOCAL_OPT_IN_ONLY_PASS');
  console.log('PASSIVE_GOLD_RECEIPT_DEDUP_NO_SECRET_PAYLOAD_PASS');
  console.log('PASSIVE_GOLD_HISTORY_IN_CROSS_SESSION_BRIEF_PASS');
 }finally{db.close();}
}finally{fs.rmSync(root,{recursive:true,force:true});}
const old=process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL;
let called=0;
try{
 delete process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL;
 const status=await observeGoldToolReceipt({commandId:'command:off-123456789',payload:{type:'terminal'}},{status:'ok',exitCode:0},{request:()=>{called++;}});
 assert.equal(status.recorded,false);
 assert.equal(called,0);
 process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL='1';
 const status2=await observeGoldToolReceipt({commandId:'command:on-123456789',payload:{type:'terminal'}},{status:'ok',exitCode:0},{request:async(action,data)=>{
  called++;assert.equal(action,'observeGoldTool');assert.equal(data.category,'terminal');return {recorded:true};
 }});
 assert.equal(status2.recorded,true);assert.equal(called,1);
 const failure=await observeGoldToolReceipt({commandId:'command:fail-123456789',payload:{type:'terminal'}},{status:'error',exitCode:1},{request:async()=>{throw Error('unavailable');}});
 assert.equal(failure.recorded,false);
 console.log('PASSIVE_OBSERVER_OFF_OFF_NO_CALL_AND_GOLD_FAILURE_ISOLATION_PASS');
}finally{
 if(old===undefined)delete process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL;
 else process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL=old;
}
