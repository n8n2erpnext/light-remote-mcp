import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-g2-events-'));
const file=path.join(dir,'local.sqlite');
let mod=createGoldWallModules({file,scopeIdentity:{accountId:'acc',deviceId:'arm'}});
try{
 assert.throws(()=>mod.ingestAutoEvent({sourceType:'workspace',sourceId:'/w/gold',eventType:'filesystem_changed',eventRef:'cmd1'}),/gold_module_disabled/);
 assert.equal(fs.existsSync(file),false);
 mod.configure({longMemory:true,codexBridge:false,expectedRevision:0});
 const gold=mod.createMemoryScope({displayName:'Light Remote Gold',captureMode:'auto'});
 const lightbi=mod.createMemoryScope({displayName:'LightBI',captureMode:'auto'});
 const manual=mod.createMemoryScope({displayName:'Firmware',captureMode:'manual'});
 const follow=mod.createMemoryScope({displayName:'Bug bounty',captureMode:'follow_project'});
 for(const [scopeId,sourceId] of [[gold.scopeId,'/w/gold'],[lightbi.scopeId,'/w/bi'],
  [manual.scopeId,'C:\\firmware'],[follow.scopeId,'/w/bounty']])
  mod.bindMemoryScope({scopeId,sourceType:'workspace',sourceId,proofType:'owner_explicit'});
 const input={sourceType:'workspace',sourceId:'/w/gold',eventType:'filesystem_changed',workContextId:'/w/gold'};
 assert.equal(mod.ingestAutoEvent({...input,eventRef:'cmd-1',occurredAt:1000}).accepted,true);
 assert.equal(mod.ingestAutoEvent({...input,eventRef:'cmd-1',occurredAt:1000}).duplicate,true);
 assert.equal(mod.ingestAutoEvent({...input,sourceId:'/w/unbound',eventRef:'cmd-2'}).reason,'unassigned');
 assert.equal(mod.ingestAutoEvent({...input,sourceId:'C:\\firmware',eventRef:'cmd-3'}).reason,'manual_mode');
 assert.equal(mod.ingestAutoEvent({...input,sourceId:'/w/bounty',sourceType:'task',eventRef:'task-1'}).reason,'unassigned');
 assert.equal(mod.flushAuto({now:90999,coalesceMs:90000}).checkpoints.length,0);
 for(let i=2;i<=20;i++)mod.ingestAutoEvent({...input,eventRef:'cmd-'+i,occurredAt:1000+i});
 mod.ingestAutoEvent({...input,sourceId:'/w/bi',eventRef:'bi-1',occurredAt:1000});
 assert.equal(mod.autoPending().reduce((n,r)=>n+r.pending,0),21);
 mod.close();mod=createGoldWallModules({file,scopeIdentity:{accountId:'acc',deviceId:'arm'}});
 const result=mod.flushAuto({now:91050,coalesceMs:90000});
 assert.equal(result.checkpoints.length,2);
 const one=mod.scopedHandoff({scopeId:gold.scopeId});
 assert.equal(one.revision,1);
 assert.equal(one.checkpoints[0].integrity,'home_ed25519_verified');
 assert.match(one.checkpoints[0].body,/filesystem_changed: 20/);
 assert.ok(!one.checkpoints[0].body.includes('LightBI'));
 assert.equal(mod.scopedHandoff({scopeId:lightbi.scopeId}).revision,1);
 assert.equal(mod.scopedHandoff({scopeId:manual.scopeId}).revision,0);
 assert.equal(mod.flushAuto({now:999999}).checkpoints.length,0);
 assert.equal(mod.autoPending().length,0);
 // A second batch is still scoped and has an independently verifiable hash-chain head.
 mod.ingestAutoEvent({...input,eventRef:'cmd-21',occurredAt:92000});
 assert.equal(mod.flushAuto({now:185000}).checkpoints.length,1);
 assert.equal(mod.scopedHandoff({scopeId:gold.scopeId}).revision,2);
 assert.equal(mod.scopedHandoff({scopeId:gold.scopeId}).checkpoints[0].integrity,'home_ed25519_verified');
 const replica=createGoldWallModules({file,scopeIdentity:{accountId:'acc',deviceId:'windows'}});
 try{
   assert.equal(replica.scopedHandoff({scopeId:gold.scopeId}).revision,2);
   assert.equal(replica.ingestAutoEvent({...input,eventRef:'win-1'}).reason,'not_home');
   assert.equal(replica.flushAuto({now:999999}).checkpoints.length,0);
 }finally{replica.close();}
 // Actual filesystem path must match the approved workspace root, never keyword guesses.
 const workspace=path.join(dir,'real-gold-workspace');
 fs.mkdirSync(workspace);
 mod.bindMemoryScope({scopeId:gold.scopeId,sourceType:'workspace',
   sourceId:workspace,proofType:'owner_explicit'});
 const changedFile=path.join(workspace,'actual.txt');
 fs.writeFileSync(changedFile,'An authorized Gold Agent filesystem write');
 assert.equal(mod.ingestFsEffect({operation:'read',filePath:changedFile,eventRef:'read-1'}).accepted,false);
 assert.equal(mod.ingestFsEffect({operation:'write',filePath:changedFile,eventRef:'write-1'}).accepted,true);
 assert.equal(mod.ingestFsEffect({operation:'write',filePath:changedFile,eventRef:'write-1'}).duplicate,true);
 assert.equal(mod.ingestFsEffect({operation:'write',filePath:file,eventRef:'write-other'}).reason,'unassigned');
 assert.equal(mod.flushAuto({now:Date.now()+91000}).checkpoints.length,1);
 assert.equal(mod.scopedHandoff({scopeId:gold.scopeId}).revision,3);
 // Codex OFF is not a dependency for filesystem auto; scoped tasks are also supported.
 mod.configure({longMemory:true,codexBridge:true,expectedRevision:1});
 const task=mod.addTask({title:'Scoped Gold task',scopeId:gold.scopeId});
 assert.equal(task.autoEventQueued,true);
 assert.equal(mod.updateTask({id:task.id,state:'working'}).autoEventQueued,true);
 assert.equal(mod.updateTask({id:task.id,state:'working'}).unchanged,true);
 assert.equal(mod.flushAuto({now:Date.now()+91000}).checkpoints.length,1);
 assert.equal(mod.scopedHandoff({scopeId:gold.scopeId}).revision,4);
 const receipt=mod.scopedHandoff({scopeId:gold.scopeId}).checkpoints[0];
 assert.match(receipt.body,/task_created: 1/);
 assert.match(receipt.body,/task_state_changed: 1/);
 mod.configure({longMemory:false,codexBridge:false,expectedRevision:2});
 assert.throws(()=>mod.ingestAutoEvent({...input,eventRef:'late'}),/gold_module_disabled/);
 assert.throws(()=>mod.flushAuto(),/gold_module_disabled/);
 console.log('GOLD_G2_DURABLE_SCOPE_AUTO_20_EVENTS_ONE_CHECKPOINT_RESTART_DEDUP_PASS');
}finally{mod.close();fs.rmSync(dir,{recursive:true,force:true});}
