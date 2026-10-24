import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ContinuityStore} from '../../device-agent/project-continuity-store.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import vm from 'node:vm';
import {once} from 'node:events';
import {continuityRequest,ipcPath} from '../../device-agent/project-continuity-ipc.mjs';

const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const service=path.join(cwd,'device-agent/project-continuity-service.mjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-continuity-p1-'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){
 const child=spawn(process.execPath,[service,'serve','--root',root],{stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=String(b));
 for(let i=0;i<35;i++){
  if(child.exitCode!==null)throw Error('continuity_child_exited '+stderr);
  try{const h=await continuityRequest('health',{}, {root,timeoutMs:250});if(h.status==='ready')return child;}
  catch{}
  await delay(50);
 }
 child.kill('SIGTERM');throw Error('continuity_socket_not_ready '+stderr);
}
async function stop(child){
 child.kill('SIGTERM');
 for(let i=0;i<35&&child.exitCode===null;i++)await delay(50);
 if(child.exitCode===null){child.kill('SIGKILL');throw Error('continuity_shutdown_timeout');}
}
function expectCode(fn,code){assert.throws(fn,e=>e?.message===code,code);}
try{
 // Database is user-local; optional modules OFF/OFF by default.
 const db=new ContinuityStore({root});
 const p=db.createProject({projectName:'Gold P1',workspace:'/tmp/gold'});
 assert.equal(p.memory_enabled,0);assert.equal(p.codex_enabled,0);
 const offTask=db.createTask(p.id,'Prepare continuity');
 const a=db.addSection(offTask.id,{title:'A needs owner'});
 const b=db.addSection(offTask.id,{title:'B independent'});
 const c=db.addSection(offTask.id,{title:'C after A',dependsOn:[a.id]});
 expectCode(()=>db.memoryPut(p.id,{body:'memory must be off',sourceRef:'test'}),'continuity_memory_disabled');
 assert.equal(c.state,'BLOCKED');
 expectCode(()=>db.transition(c.id,{to:'READY',expectedRevision:1}),'continuity_dependencies_incomplete');
 expectCode(()=>db.transition(a.id,{to:'DONE',expectedRevision:1}),'continuity_illegal_transition');
 const req=db.requestApproval(a.id,'Owner review needed');
 expectCode(()=>db.decideApproval(req.id,{decision:'approved',ownerVerified:false}),'continuity_owner_proof_required');
 expectCode(()=>db.transition(a.id,{to:'READY',expectedRevision:2}),'continuity_owner_approval_required');
 const runningB=db.transition(b.id,{to:'RUNNING',expectedRevision:1});
 assert.equal(runningB.state,'RUNNING');
 db.decideApproval(req.id,{decision:'approved',ownerVerified:true});
 const ra=db.transition(a.id,{to:'RUNNING',expectedRevision:3});
 expectCode(()=>db.transition(a.id,{to:'DONE',expectedRevision:ra.revision}),'continuity_done_requires_evidence');
 db.evidence(a.id,{reference:'owner-verified-commit-abc'});
 const done=db.transition(a.id,{to:'DONE',expectedRevision:ra.revision});
 assert.equal(done.state,'DONE');
 assert.equal(db.section(c.id).state,'READY');
 assert.equal(db.transition(c.id,{to:'RUNNING',expectedRevision:2}).state,'RUNNING');
 expectCode(()=>db.setModules(p.id,{memory:true,expectedRevision:90}),'continuity_stale_revision');
 const m=db.setModules(p.id,{memory:true,expectedRevision:1});
 const fact=db.memoryPut(p.id,{body:'M6 signed ACK and resource lease',kind:'decision',sourceRef:'handoff:gold'});
 assert.ok(fact.id);assert.equal(db.memorySearch(p.id,'signed').length,1);
 const unrelated=db.createProject({projectName:'Other project'});
 db.setModules(unrelated.id,{memory:true,expectedRevision:1});
 assert.equal(db.memorySearch(unrelated.id,'signed').length,0);
 const mOff=db.setModules(p.id,{memory:false,expectedRevision:m.revision});
 expectCode(()=>db.memorySearch(p.id,'signed'),'continuity_memory_disabled');
 // Codex-only must never enable Memory as a side effect.
 const codexOnly=db.setModules(p.id,{codex:true,expectedRevision:mOff.revision});
 assert.equal(codexOnly.memory_enabled,0);assert.equal(codexOnly.codex_enabled,1);
 const summary=db.checkpoint(p.id);
 assert.equal(summary.pendingApprovals.length,0);assert.equal(summary.tasks[0].sections.length,3);
 const exported=db.exportCheckpoint(p.id);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(exported.path)).digest('hex'),exported.sha256);
 assert.ok(summary.sequence>5);
 db.close();console.log('P1_SQLITE_STATES_MODES_FTS_CHECKPOINT_PASS');
 // A local service runs as a distinct OS child; no Cloud service or port opened.
 let child=await start();
 const health=await continuityRequest('health',{}, {root});
 const online=await continuityRequest('onlineBackup',{}, {root});
 assert.equal(fs.existsSync(online.path),true);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(online.path)).digest('hex'),online.sha256);
 assert.equal(health.projects,2);
 const list=await continuityRequest('listProjects',{}, {root});
 assert.equal(list.length,2);
 const extra=await continuityRequest('createProject',{name:'IPC created'}, {root});
 assert.equal(extra.memory_enabled,0);assert.equal(extra.codex_enabled,0);
 const cc=await continuityRequest('setGlobalModules',{memory:true,codex:false,expectedRevision:1},{root});
 assert.equal(cc.memoryEnabled,true);assert.equal(cc.codexEnabled,false);
 await continuityRequest('memoryPut',{projectId:extra.id,body:'SQLite local continuity via IPC',sourceRef:'test'},{root});
 assert.equal((await continuityRequest('memorySearch',{projectId:extra.id,query:'SQLite'},{root})).length,1);
 await assert.rejects(continuityRequest('decideApproval',{approvalId:req.id,decision:'approved',ownerVerified:true},{root}),/continuity_unknown_action/);
 // Tokenless socket caller must fail, not inherit privileges just because local.
 const unauthorized=await new Promise((resolve,reject)=>{
  const s=net.createConnection(ipcPath(root)),parts=[];
  s.on('connect',()=>s.write(JSON.stringify({action:'listProjects'})+'\n'));
  s.on('data',b=>parts.push(b));
  s.on('end',()=>resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))));
  s.on('error',reject);
 });
 assert.equal(unauthorized.error,'continuity_unauthorized');
 // Authenticated Local Wall P1 API: no bypass of account login or CSRF.
 const wallAuth={enabled:true,identity:req=>req.headers['x-fixture-owner']==='yes'?{owner:true}:null,
   csrfForRequest:()=> 'fixture-csrf',
   verifyRequestCsrf:(req,token)=>token==='fixture-csrf'};
 const wall=startLocalWall({host:'127.0.0.1',port:0,brandSvgPath:path.join(cwd,'assets/branding/light-remote-mark.svg'),auth:wallAuth,
   getLocalStatus:async()=>({cloudDesiredConnected:false,cloudState:'dormant'}),
   continuity:{request:(action,data)=>continuityRequest(action,data,{root})}});
 await once(wall.server,'listening');
 const url='http://127.0.0.1:'+wall.server.address().port;
 const hidden=await fetch(url+'/projects',{redirect:'manual'});assert.equal(hidden.status,303);
 const admin={'x-fixture-owner':'yes'};
 const ownerPage=await fetch(url+'/projects',{headers:admin});assert.equal(ownerPage.status,200);
 const markup=await ownerPage.text();
 assert.match(markup,/Project Memory/);assert.match(markup,/Codex Bridge/);
 const scriptMatch=markup.match(/<script>([\s\S]*?)<\/script>/);assert(scriptMatch);
 new vm.Script(scriptMatch[1]);
 const denied=await fetch(url+'/api/project-continuity/createProject',
   {method:'POST',headers:{...admin,'content-type':'application/json'},body:JSON.stringify({name:'denied'})});
 assert.equal(denied.status,403);
 const allowed=await fetch(url+'/api/project-continuity/createProject',
   {method:'POST',headers:{...admin,'content-type':'application/json','x-light-remote-csrf':'fixture-csrf'},body:JSON.stringify({name:'Wall pilot'})});
 assert.equal(allowed.status,200);
 const wallCreated=(await allowed.json()).result;
 const wallList=await fetch(url+'/api/project-continuity/listProjects',{headers:admin});
 assert.equal((await wallList.json()).result.some(item=>item.id===wallCreated.id),true);
 await wall.close();
 console.log('P1_WALL_OWNER_CSRF_PROJECTS_API_PASS');

 if(process.platform!=='win32'){
  assert.equal(fs.statSync(ipcPath(root)).mode&0o077,0);
  assert.equal(fs.statSync(path.join(root,'ipc-token')).mode&0o077,0);
 }
 await stop(child);assert.equal(fs.existsSync(ipcPath(root)),false);
 child=await start();
 assert.equal((await continuityRequest('listProjects',{}, {root})).length,4);
 assert.equal((await continuityRequest('checkpoint',{projectId:p.id},{root})).tasks[0].sections[0].state,'DONE');
 await stop(child);
 console.log('P1_IPC_AUTH_SEPARATE_PROCESS_RESTART_PASS');
 console.log('P1_ALL_FOCUSED_CHECKS_PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
