import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {parseSupervisorDecision} from '../../device-agent/gold-codex-supervisor.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-supervisor-uat-fixture-'));
const file=path.join(dir,'modules.sqlite');
let rounds=0,wall=null;
const plus={account:async()=>({connected:true,authMode:'chatgpt',plan:'plus'}),stop(){},
  async runDelegated({workspace,round,maxRounds}){
    assert.equal(maxRounds,2);
    rounds++;
    fs.writeFileSync(path.join(workspace,'actual-code-change-'+round+'.txt'),'fixture-work-'+round);
    return {completed:true,status:'completed',
      summary:'Created one fixture artifact and checked its contents.\nRECOMMENDATION: '+(round===1?'CONTINUE':'DONE')};
  }};
let m;
try{
  m=createGoldWallModules({file,plusImpl:plus});
  assert.equal(m.flags().codexBridge,false);
  assert.throws(()=>m.supervisorWorkspace(),/gold_module_disabled/);
  m.configure({longMemory:false,codexBridge:true,expectedRevision:0});
  const workspace=m.supervisorWorkspace();
  assert.equal(fs.statSync(workspace).isDirectory(),true);
  const task=m.addTask({title:'Implement one bounded test artifact'});
  assert.throws(()=>m.supervisorDelegate({taskId:task.id,workspace,goal:'Create sample file'}),/owner_approval_required/);
  assert.throws(()=>m.supervisorDelegate({taskId:task.id,workspace:'/',goal:'Create sample file',ownerApproved:true}),/workspace_not_authorized/);
  assert.equal(parseSupervisorDecision('no structured result'),'WAIT_OWNER');
  const delegated=m.supervisorDelegate({taskId:task.id,workspace,goal:'Create sample file',ownerApproved:true,maxRounds:2});
  assert.equal(delegated.state,'armed');
  assert.equal((await m.supervisorTick()).round,1);
  assert.equal(m.supervisorList()[0].state,'armed');
  assert.equal((await m.supervisorTick()).decision,'DONE');
  assert.equal(m.supervisorList()[0].state,'review_required');
  assert.equal(rounds,2);
  assert.equal(m.observer().tasks[0].state,'todo','No automatic owner Done');
  assert.equal(m.supervisorReceipts(task.id).length,2);
  assert.equal(fs.existsSync(path.join(workspace,'actual-code-change-1.txt')),true);
  assert.equal((await m.supervisorTick()).ran,false);
  m.close();m=null;
  m=createGoldWallModules({file,plusImpl:plus});
  assert.equal(m.supervisorList()[0].state,'review_required','persisted despite browser/service restart');
  assert.equal(m.supervisorReceipts(task.id).length,2);
  // Simulate crash during workspace mutation and verify fail-closed recovery.
  const raw=new DatabaseSync(file);
  raw.prepare("UPDATE codex_delegations SET state='running',lease_id='crash-unknown' WHERE task_id=?").run(task.id);
  raw.close();
  m.close();m=null;
  m=createGoldWallModules({file,plusImpl:plus});
  assert.equal(m.supervisorList()[0].state,'waiting_owner');
  assert.equal((await m.supervisorTick()).ran,false,'no duplicated workspace writes after crash');
  assert.equal(rounds,2);
  m.supervisorDelegate({taskId:task.id,workspace,goal:'Test WAIT_OWNER path',ownerApproved:true,maxRounds:1});
  m.supervisorPause({taskId:task.id,ownerApproved:true});
  assert.equal(m.supervisorList()[0].state,'paused');
  assert.equal((await m.supervisorTick()).ran,false);

  const auth={enabled:true,identity:req=>req.headers['x-owner']==='yes'?{username:'owner'}:null,
    csrfForRequest:()=> 'verified-csrf',verifyRequestCsrf:(_r,c)=>c==='verified-csrf'};
  wall=startLocalWall({host:'127.0.0.1',port:0,modules:m,auth,
    getLocalStatus:async()=>({deviceName:'fixture'})});
  await new Promise((ok,bad)=>wall.server.listening?ok():wall.server.once('listening',ok).once('error',bad));
  const base='http://127.0.0.1:'+wall.server.address().port;
  const endpoint='/api/gold/modules/supervisor/delegate';
  const body={taskId:task.id,workspace,goal:'Another bounded work round',ownerApproved:true};
  const post=(headers)=>fetch(base+endpoint,{method:'POST',
    headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await post({})).status,401);
  assert.equal((await post({'x-owner':'yes'})).status,403);
  assert.equal((await post({'x-owner':'yes','x-light-remote-csrf':'verified-csrf'})).status,200);
  const info=await fetch(base+'/api/gold/modules/supervisor',{headers:{'x-owner':'yes'}});
  const summary=await info.json();
  assert.equal(summary.delegations.length,1);
  // Both modules ON: durable Codex outcome is an OBSERVED scoped handoff,
  // never owner-approved task completion or an unassigned cross-project write.
  const mem=createGoldWallModules({file:path.join(dir,'combined.sqlite'),plusImpl:plus,
    scopeIdentity:{accountId:'fixture-account',deviceId:'fixture-home'}});
  try{
    mem.configure({longMemory:true,codexBridge:true,expectedRevision:0});
    const scope=mem.createMemoryScope({displayName:'Gold fixture project'});
    const untouched=mem.createMemoryScope({displayName:'Other fixture project'});
    const scopedTask=mem.addTask({title:'Scoped delegated coding fixture',scopeId:scope.scopeId});
    const approved=mem.supervisorWorkspace();
    mem.supervisorDelegate({taskId:scopedTask.id,goal:'Make one mock change',
      workspace:approved,ownerApproved:true,maxRounds:1});
    const completed=await mem.supervisorTick();
    assert.equal(completed.ran,true);
    assert.equal(mem.scopedHandoff({scopeId:scope.scopeId,limit:5}).revision,1);
    assert.match(mem.scopedHandoff({scopeId:scope.scopeId,limit:5}).checkpoints[0].body,/Codex receipt/);
    assert.equal(mem.scopedHandoff({scopeId:untouched.scopeId,limit:5}).revision,0);
    assert.equal(mem.observer().tasks[0].state,'todo');
  }finally{mem.close();}
  console.log('GOLD_CODEX_SUPERVISOR_OWNER_DELEGATION_DEVICE_WORK_ROUNDS_PERSISTENCE_CRASH_CSRF_SCOPED_MEMORY_PASS');
}finally{
  await wall?.close().catch(()=>{});
  m?.close();
  fs.rmSync(dir,{recursive:true,force:true});
}
