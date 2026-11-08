/* Gold owner-delegated Codex supervisor; persists state independently of ChatGPT Web. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const fail=(s,c=400)=>Object.assign(new Error(s),{status:c});
export function parseSupervisorDecision(text){
 const match=String(text||'').match(/(?:^|\n)RECOMMENDATION:\s*(CONTINUE_SECTION_B|CONTINUE|WAIT_OWNER|DONE)(?:\s|$)/i);
 return match?match[1].toUpperCase():'WAIT_OWNER';
}
export function createGoldCodexSupervisor({db,plus,root,flags,onReceipt=()=>{}}){
 if(!path.isAbsolute(root))throw fail('codex_supervisor_root_invalid');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 if(process.platform!=='win32'&&(fs.statSync(root).mode&0o077))
   throw fail('codex_supervisor_root_permissions',503);
 db.exec("CREATE TABLE IF NOT EXISTS codex_delegations (task_id TEXT PRIMARY KEY REFERENCES observer_tasks(id),workspace TEXT NOT NULL,goal TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('armed','running','waiting_owner','paused','budget_exhausted','review_required')),decision TEXT NOT NULL DEFAULT 'WAIT_OWNER',max_rounds INTEGER NOT NULL CHECK(max_rounds BETWEEN 1 AND 5),rounds INTEGER NOT NULL DEFAULT 0,updated_ms INTEGER NOT NULL,lease_id TEXT,last_receipt_id TEXT)");
 db.exec("CREATE TABLE IF NOT EXISTS codex_supervisor_receipts (id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES observer_tasks(id),lease_id TEXT NOT NULL UNIQUE,round INTEGER NOT NULL,decision TEXT NOT NULL,summary TEXT NOT NULL,result_status TEXT NOT NULL,created_ms INTEGER NOT NULL)");
 // Crash recovery deliberately requires owner review before any retry.
 db.prepare("UPDATE codex_delegations SET state='waiting_owner',decision='WAIT_OWNER',lease_id=NULL,updated_ms=? WHERE state='running'").run(Date.now());
 let running=false,closed=false;
 let cancelRequested=null;
 function authorizedFolder(value){
  if(typeof value!=='string'||!path.isAbsolute(value))throw fail('codex_supervisor_workspace_absolute_required');
  let real;try{real=fs.realpathSync(value);}catch{throw fail('codex_supervisor_workspace_missing');}
  const roots=[root,...String(process.env.LIGHT_REMOTE_GOLD_CODEX_WORKSPACE_ROOTS||'').split(path.delimiter).filter(Boolean)];
  if(!fs.statSync(real).isDirectory()||!roots.some(r=>{
   let base;try{base=fs.realpathSync(r);}catch{return false;}
   const rel=path.relative(base,real);
   return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);
  }))throw fail('codex_supervisor_workspace_not_authorized',403);
  return real;
 }
 function list(){
  return db.prepare("SELECT d.task_id AS taskId,t.title,d.workspace,d.goal,d.state,d.decision,d.max_rounds AS maxRounds,d.rounds,d.updated_ms AS updatedAt,d.last_receipt_id AS lastReceiptId FROM codex_delegations d JOIN observer_tasks t ON t.id=d.task_id WHERE t.deleted_ms IS NULL ORDER BY d.updated_ms DESC LIMIT 100").all();
 }
 function receipts(taskId){
  return db.prepare("SELECT id,task_id AS taskId,round,decision,summary,result_status AS resultStatus,created_ms AS createdAt FROM codex_supervisor_receipts WHERE task_id=? ORDER BY created_ms DESC LIMIT 20").all(taskId);
 }
 function delegate({taskId,workspace,goal,maxRounds=2,ownerApproved=false}={}){
  if(!flags().codexBridge)throw fail('gold_module_disabled',409);
  if(ownerApproved!==true)throw fail('codex_supervisor_owner_approval_required',403);
  const task=db.prepare('SELECT id,state FROM observer_tasks WHERE id=? AND deleted_ms IS NULL').get(taskId);
  if(!task)throw fail('codex_supervisor_task_not_found',404);
  if(!['todo','working'].includes(task.state))throw fail('codex_supervisor_task_not_actionable',409);
  if(typeof goal!=='string'||!goal.trim()||goal.length>2000)throw fail('codex_supervisor_goal_invalid');
  if(!Number.isInteger(maxRounds)||maxRounds<1||maxRounds>5)throw fail('codex_supervisor_budget_invalid');
  const selected=workspace||path.join(root,taskId);
  if(!workspace)fs.mkdirSync(selected,{recursive:true,mode:0o700});
  const cwd=authorizedFolder(selected);
  if(db.prepare("SELECT 1 FROM codex_delegations WHERE task_id=? AND state='running'").get(taskId))
   throw fail('codex_supervisor_running',409);
  db.prepare("INSERT INTO codex_delegations(task_id,workspace,goal,state,decision,max_rounds,rounds,updated_ms) VALUES(?,?,?,'armed','CONTINUE',?,0,?) ON CONFLICT(task_id) DO UPDATE SET workspace=excluded.workspace,goal=excluded.goal,state='armed',decision='CONTINUE',max_rounds=excluded.max_rounds,rounds=0,updated_ms=excluded.updated_ms,lease_id=NULL").run(taskId,cwd,goal.trim(),maxRounds,Date.now());
  return list().find(x=>x.taskId===taskId);
 }
 function pause({taskId,ownerApproved=false}={}){
  if(ownerApproved!==true)throw fail('codex_supervisor_owner_approval_required',403);
  const d=db.prepare('SELECT state FROM codex_delegations WHERE task_id=?').get(taskId);
  if(!d)throw fail('codex_supervisor_not_found',404);
  if(d.state==='running'){
   cancelRequested=taskId;
   plus.stop?.();
   return {taskId,state:'stopping',decision:'WAIT_OWNER'};
  }
  db.prepare("UPDATE codex_delegations SET state='paused',decision='WAIT_OWNER',updated_ms=? WHERE task_id=?").run(Date.now(),taskId);
  return list().find(x=>x.taskId===taskId);
 }
 async function tick(){
  if(running||closed||!flags().codexBridge)return {ran:false,reason:'disabled_or_busy'};
  const candidate=db.prepare("SELECT d.*,t.title FROM codex_delegations d JOIN observer_tasks t ON t.id=d.task_id WHERE d.state='armed' AND d.rounds<d.max_rounds AND t.deleted_ms IS NULL AND t.state IN ('todo','working') ORDER BY d.updated_ms ASC LIMIT 1").get();
  if(!candidate)return {ran:false,reason:'no_authorized_work'};
  running=true;
  const lease=crypto.randomUUID(),now=Date.now();
  try{
   const workspace=authorizedFolder(candidate.workspace);
   if(db.prepare("UPDATE codex_delegations SET state='running',lease_id=?,updated_ms=? WHERE task_id=? AND state='armed'").run(lease,now,candidate.task_id).changes!==1)
    return {ran:false,reason:'cas_lost'};
   const round=candidate.rounds+1;
   let outcome;
   try{
    if(typeof plus.runDelegated!=='function')throw fail('codex_supervisor_runtime_missing',503);
    outcome=await plus.runDelegated({taskTitle:candidate.title,goal:candidate.goal,
      workspace,round,maxRounds:candidate.max_rounds,previous:receipts(candidate.task_id).slice(0,2)});
   }catch(e){outcome={completed:false,status:'failed',summary:'Delegated worker stopped: '+String(e.message||e).slice(0,150)};}
   const summary=String(outcome?.summary||'').slice(0,12000);
   const decision=outcome?.completed===true?parseSupervisorDecision(summary):'WAIT_OWNER';
   const requestedStop=cancelRequested===candidate.task_id;
   if(requestedStop)cancelRequested=null;
   const state=requestedStop?'paused':decision==='WAIT_OWNER'?'waiting_owner':
     decision==='DONE'?'review_required':
     round>=candidate.max_rounds?'budget_exhausted':'armed';
   const receiptId=crypto.randomUUID(),end=Date.now();
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('INSERT INTO codex_supervisor_receipts(id,task_id,lease_id,round,decision,summary,result_status,created_ms) VALUES(?,?,?,?,?,?,?,?)')
      .run(receiptId,candidate.task_id,lease,round,decision,summary,String(outcome?.status||'unknown').slice(0,40),end);
    const n=db.prepare("UPDATE codex_delegations SET state=?,decision=?,rounds=?,lease_id=NULL,updated_ms=?,last_receipt_id=? WHERE task_id=? AND lease_id=? AND state='running'")
      .run(state,decision,round,end,receiptId,candidate.task_id,lease).changes;
    if(n!==1)throw fail('codex_supervisor_lease_conflict',409);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   try{await onReceipt({taskId:candidate.task_id,receiptId,decision,summary,state});}
   catch(e){console.error(JSON.stringify({event:'gold_codex_supervisor_memory_pending',code:String(e.message).slice(0,90)}));}
   return {ran:true,taskId:candidate.task_id,receiptId,round,decision,state};
  }finally{running=false;}
 }
 return {delegate,pause,list,receipts,tick,isRunning:taskId=>db.prepare("SELECT 1 FROM codex_delegations WHERE task_id=? AND state='running'").get(taskId)!=null,workspaceRoot:()=>root,close(){closed=true;}};
}
