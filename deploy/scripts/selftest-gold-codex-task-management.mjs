import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-codex-task-mgmt-'));
const file=path.join(dir,'gold.sqlite');
const observerPlus={
  account:async()=>({connected:true,authMode:'chatgpt',plan:'plus'}),
  runReadOnly:async({tasks})=>({completed:true,status:'completed',
    summary:'Observed task states only. Review with owner.',tasksObserved:tasks.length}),
  stop:()=>{}
};
const m=createGoldWallModules({file,plusImpl:observerPlus});
let wall=null;
try{
  m.configure({longMemory:false,codexBridge:true,expectedRevision:0});
  const task=m.addTask({title:'Typo todo'});
  assert.equal(m.observer().tasks.length,1);
  const receipt=await m.codexPlusObserve();
  assert.equal(receipt.receipt?.requiresOwnerReview,true);
  const saved=m.observerReceipts()[0];
  assert.equal(saved.tasks[0].id,task.id);
  const changedAt=m.observer().tasks[0].changedAt;
  assert.throws(()=>m.editTask({id:task.id,title:'Fixed title',expectedChangedAt:changedAt-1}),
    /gold_observer_task_changed_since_edit/);
  assert.throws(()=>m.editTask({id:task.id,title:'',expectedChangedAt:changedAt}),
    /gold_observer_task_invalid/);
  const edited=m.editTask({id:task.id,title:'Fixed title',expectedChangedAt:changedAt});
  assert.equal(edited.title,'Fixed title');
  assert.equal(edited.priorReceiptsUnchanged,true);
  assert.ok(edited.changedAt>changedAt);
  assert.equal(m.observer().tasks[0].title,'Fixed title');
  assert.equal(m.observerReceipts()[0].summary,saved.summary);
  assert.throws(()=>m.confirmObserverTask({receiptId:saved.id,taskId:task.id,toState:'done',confirm:true}),
    /gold_observer_task_changed_since_receipt/);
  assert.throws(()=>m.deleteTask({id:task.id,confirm:true,confirmTitle:'Typo todo',expectedChangedAt:edited.changedAt}),
    /gold_observer_task_delete_title_mismatch/);
  assert.throws(()=>m.deleteTask({id:task.id,confirmTitle:'Fixed title',expectedChangedAt:edited.changedAt}),
    /gold_observer_task_delete_owner_confirmation_required/);
  const auth={
    enabled:true,
    identity:req=>req.headers['x-owner']==='yes'?{username:'owner'}:null,
    csrfForRequest:()=> 'owner-csrf',
    verifyRequestCsrf:(_req,x)=>x==='owner-csrf'
  };
  wall=startLocalWall({host:'127.0.0.1',port:0,auth,modules:m,
    getLocalStatus:async()=>({deviceName:'fixture',cloudState:'disconnected'})});
  await new Promise((resolve,reject)=>wall.server.listening?resolve():wall.server.once('listening',resolve).once('error',reject));
  const base='http://127.0.0.1:'+wall.server.address().port;
  const endpoint='/api/gold/modules/task/delete';
  const post=(body,headers={'x-owner':'yes','x-light-remote-csrf':'owner-csrf'})=>
    fetch(base+endpoint,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({id:task.id,confirm:true,confirmTitle:'Fixed title',
    expectedChangedAt:edited.changedAt},{})).status,401);
  assert.equal((await post({id:task.id,confirm:true,confirmTitle:'Fixed title',
    expectedChangedAt:edited.changedAt},{'x-owner':'yes'})).status,403);
  const response=await post({id:task.id,confirm:true,confirmTitle:'Fixed title',expectedChangedAt:edited.changedAt});
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).task.deleted,true);
  assert.equal(m.observer().tasks.length,0);
  assert.equal(m.observerReceipts().length,1);
  assert.throws(()=>m.confirmObserverTask({receiptId:saved.id,taskId:task.id,toState:'done',confirm:true}),
    /gold_observer_task_changed_since_receipt/);
  const raw=new DatabaseSync(file,{readOnly:true});
  assert.ok(raw.prepare('SELECT deleted_ms FROM observer_tasks WHERE id=?').get(task.id).deleted_ms>0);
  assert.deepEqual(raw.prepare('SELECT action FROM observer_task_history ORDER BY created_ms,id').all().map(x=>x.action).sort(),
    ['delete','edit']);
  raw.close();
  const page=await fetch(base+'/codex-cli',{headers:{'x-owner':'yes'}});
  assert.equal(page.status,200);
  const html=await page.text();
  assert.ok(html.includes('/api/gold/modules/task/edit'));
  assert.ok(html.includes('/api/gold/modules/task/delete'));
  assert.ok(html.includes('Save title'));
  for(const [i,v] of [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].entries())
    if(v[1]?.trim())new vm.Script(v[1],{filename:'codex-edit-delete-'+i+'.js'});
  console.log('GOLD_CODEX_TASK_EDIT_SOFT_DELETE_RECEIPT_IMMUTABLE_OWNER_CSRF_PASS');
}finally{
  if(wall)await wall.close();
  m.close();
  fs.rmSync(dir,{recursive:true,force:true});
}
