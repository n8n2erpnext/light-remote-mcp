/* Light Remote device-level feature switches, no Project prerequisite.
 * Source test ONLY, not physical Codex worker or ChatGPT MCP acceptance.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ContinuityStore} from '../../device-agent/project-continuity-store.mjs';
import {execFileSync} from 'node:child_process';
const baseline='30766940ac18e55cb735354b40a3af9ba37eddb8';
const oldManifest=JSON.parse(execFileSync('git',['show',baseline+':client/core-files.json'],{encoding:'utf8'}));
const newManifest=JSON.parse(fs.readFileSync(new URL('../../client/core-files.json',import.meta.url),'utf8'));
const paths=new Map(newManifest.files.map(f=>[f.source,f.destination]));
assert.deepEqual(oldManifest.files.filter(f=>paths.get(f.source)!==f.destination),[],
 'Continuity must retain the entire tested Gold Client packaging contract');
assert.ok(paths.has('device-agent/operator-agent.mjs'));
assert.ok(paths.has('device-agent/local-wall.mjs'));
assert.ok(!paths.has('device-agent/project-continuity-uat-wall.mjs'));
assert.ok(!paths.has('device-agent/project-continuity-uat-web.mjs'));
console.log('GOLD_486_BASELINE_PACKAGED_SOURCES_ALL_INHERITED_PASS');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-cont-device-modules-'));
let db;
const denied=(fn,code)=>assert.throws(fn,e=>e?.message===code);
try{
 db=new ContinuityStore({root});
 let state=db.moduleSettings();
 assert.deepEqual([state.memoryEnabled,state.codexEnabled,state.revision],[false,false,1]);
 assert.equal(db.projects().length,0);
 console.log('MODULES_OFF_OFF_WITH_ZERO_PROJECTS_PASS');
 state=db.setGlobalModules({memory:true,codex:false,expectedRevision:state.revision});
 assert.equal(db.projects().length,0);
 assert.equal(state.memoryEnabled,true);assert.equal(state.codexEnabled,false);
 const internal=state.defaultScopeId;
 assert.equal(db.project(internal).memory_enabled,1);
 db.memoryPut(internal,{body:'No-project Memory can be used independently',sourceRef:'owner:device-memory'});
 assert.equal(db.memorySearch(internal,'No-project').length,1);
 assert.equal(db.projects().length,0,'implicit default scope must not appear as a user Project');
 const memoryProject=db.createProject({projectName:'Optional memory scope'});
 assert.equal(memoryProject.memory_enabled,1);assert.equal(memoryProject.codex_enabled,0);
 assert.equal(db.memoryPut(memoryProject.id,{body:'one independent memory fact',sourceRef:'fixture:owner'}).kind,'observation');
 denied(()=>db.codexThread(memoryProject.id),'continuity_codex_disabled');
 console.log('MEMORY_ONLY_ACTIVATES_WITHOUT_PROJECT_CREATION_PASS');
 state=db.setGlobalModules({memory:false,codex:true,expectedRevision:state.revision});
 assert.equal(state.memoryEnabled,false);assert.equal(state.codexEnabled,true);
 denied(()=>db.memorySearch(memoryProject.id,'one'),'continuity_memory_disabled');
 denied(()=>db.memorySearch(internal,'No-project'),'continuity_memory_disabled');
 assert.equal(db.project(internal).codex_enabled,1);
 assert.equal(db.project(memoryProject.id).codex_enabled,1);
 assert.equal(db.recordCodexThread(memoryProject.id,{threadId:'codex-without-memory'}).thread_id,'codex-without-memory');
 const codexProject=db.createProject({projectName:'Optional Codex scope'});
 assert.equal(codexProject.memory_enabled,0);assert.equal(codexProject.codex_enabled,1);
 console.log('CODEX_ONLY_ACTIVATES_WITHOUT_MEMORY_PASS');
 state=db.setGlobalModules({memory:true,codex:true,expectedRevision:state.revision});
 assert.equal(db.memorySearch(memoryProject.id,'one').length,1);
 assert.equal(db.memorySearch(internal,'No-project').length,1);
 assert.equal(db.codexThread(memoryProject.id).thread_id,'codex-without-memory');
 console.log('BOTH_ON_PRESERVES_EXISTING_MEMORY_AND_CODEX_PASS');
 state=db.setGlobalModules({memory:false,codex:false,expectedRevision:state.revision});
 denied(()=>db.memorySearch(memoryProject.id,'one'),'continuity_memory_disabled');
 denied(()=>db.codexThread(memoryProject.id),'continuity_codex_disabled');
 const other=db.createProject({projectName:'Inherit global defaults'});
 assert.equal(other.memory_enabled,0);assert.equal(other.codex_enabled,0);
 assert.equal(db.moduleSettings().revision,5);
 denied(()=>db.setGlobalModules({memory:true,expectedRevision:1}),'continuity_stale_revision');
 console.log('BOTH_OFF_REVOKES_EXECUTION_AND_NEW_PROJECTS_DEFAULT_OFF_PASS');
 db.close();db=null;
 db=new ContinuityStore({root});
 assert.deepEqual([db.moduleSettings().memoryEnabled,db.moduleSettings().codexEnabled],[false,false]);
 assert.equal(db.memorySearch.bind(db,memoryProject.id,'one') instanceof Function,true);
 console.log('GLOBAL_SWITCHES_SQLITE_RESTART_PERSIST_PASS');
 const view=fs.readFileSync(new URL('../../device-agent/project-continuity-page.mjs',import.meta.url),'utf8');
 assert.ok(view.indexOf('id="continuityModules"')<view.indexOf('class="layout"'),'global controls above Projects');
 assert.ok(!view.includes("api('setModules'"),'Project must never be a module on/off prerequisite');
 const wall=fs.readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8');
 assert.ok(wall.includes("'getGlobalModules'")&&wall.includes("'setGlobalModules'"));
 assert.ok(!wall.includes("'setModules','createTask'"));
 console.log('WALL_MODULE_SWITCHES_OUTSIDE_PROJECT_AND_NO_LEGACY_TOGGLE_PASS');
}finally{
 try{db?.close();}catch{}
 fs.rmSync(root,{recursive:true,force:true});
}
