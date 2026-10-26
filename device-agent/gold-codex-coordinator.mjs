import crypto from 'node:crypto';
const fail=(code,status=400)=>Object.assign(new Error(code),{status});
const text=(value,max,code)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw fail(code);return value.trim();};
export function parseGoldCodexGate(raw,{last=false}={}){
 const s=String(raw||'');
 const matches=[...s.matchAll(/(?:^|\n)DECISION:\s*(CONTINUE|WAIT_OWNER|DONE)[ \t]*(?=\r?\n|$)/g)];
 if(matches.length!==1)return {decision:'WAIT_OWNER',reason:'missing_or_ambiguous_decision'};
 const decision=matches[0][1];
 if(decision==='DONE'&&!last)return {decision:'WAIT_OWNER',reason:'premature_done'};
 if(decision==='CONTINUE'&&last)return {decision:'WAIT_OWNER',reason:'no_remaining_step'};
 return {decision,reason:String(s.match(/(?:^|\n)REASON:\s*([^\r\n]{1,400})/)?.[1]||'No reason supplied').trim()};
}
export function createGoldCodexCoordinator({db,plus,enabled=()=>true}){
 db.exec("CREATE TABLE IF NOT EXISTS codex_review_plans (id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','reviewing','waiting_owner','completed','cancelled')),current_index INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS codex_review_steps (plan_id TEXT NOT NULL REFERENCES codex_review_plans(id),step_index INTEGER NOT NULL,title TEXT NOT NULL,acceptance TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('locked','ready','reviewing','accepted','waiting_owner')),report TEXT,evidence TEXT,report_sha256 TEXT,receipt_id TEXT,PRIMARY KEY(plan_id,step_index))");
 db.exec("CREATE TABLE IF NOT EXISTS codex_review_receipts (id TEXT PRIMARY KEY,plan_id TEXT NOT NULL,step_index INTEGER NOT NULL,report_sha256 TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,summary TEXT NOT NULL,status TEXT NOT NULL,created_ms INTEGER NOT NULL,UNIQUE(plan_id,step_index,report_sha256))");
 db.prepare("UPDATE codex_review_plans SET status='waiting_owner',revision=revision+1,updated_ms=? WHERE status='reviewing'").run(Date.now());
 db.prepare("UPDATE codex_review_steps SET state='waiting_owner' WHERE state='reviewing'").run();
 let busy=false;
 const planRow=id=>db.prepare('SELECT * FROM codex_review_plans WHERE id=?').get(id);
 const steps=id=>db.prepare('SELECT step_index AS stepIndex,title,acceptance,state,report_sha256 AS reportHash,receipt_id AS receiptId FROM codex_review_steps WHERE plan_id=? ORDER BY step_index').all(id);
 function get(id){
  const p=planRow(id);if(!p)throw fail('codex_review_plan_not_found',404);
  const list=steps(id);
  return {id,title:p.title,status:p.status,revision:p.revision,currentIndex:p.current_index,
    currentStep:list[p.current_index]||null,steps:list,nextAction:p.status==='active'?'REPORT_STEP':p.status==='completed'?'PLAN_COMPLETE':'WAIT_OWNER'};
 }
 function list(){return db.prepare('SELECT id,title,status,current_index AS currentIndex,revision FROM codex_review_plans ORDER BY updated_ms DESC LIMIT 50').all();}
 function receipts(id){if(!planRow(id))throw fail('codex_review_plan_not_found',404);
   return db.prepare('SELECT id,step_index AS stepIndex,decision,reason,summary,status,created_ms AS createdAt FROM codex_review_receipts WHERE plan_id=? ORDER BY created_ms').all(id);}
 function create({title,steps:items,ownerApproved=false}={}){
  if(!enabled())throw fail('gold_module_disabled',409);
  if(ownerApproved!==true)throw fail('codex_review_owner_required',403);
  const name=text(title,160,'codex_review_plan_title_invalid');
  if(!Array.isArray(items)||items.length<2||items.length>8)throw fail('codex_review_steps_invalid');
  const checked=items.map(x=>({title:text(x?.title,160,'codex_review_step_title_invalid'),acceptance:text(x?.acceptance,500,'codex_review_acceptance_invalid')}));
  const id=crypto.randomUUID(),now=Date.now();
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare("INSERT INTO codex_review_plans(id,title,status,created_ms,updated_ms) VALUES(?,?,'active',?,?)").run(id,name,now,now);
   const insert=db.prepare('INSERT INTO codex_review_steps(plan_id,step_index,title,acceptance,state) VALUES(?,?,?,?,?)');
   checked.forEach((x,i)=>insert.run(id,i,x.title,x.acceptance,i===0?'ready':'locked'));
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return get(id);
 }
 async function report({planId,stepIndex,expectedRevision,summary,evidence}={}){
  if(!enabled())throw fail('gold_module_disabled',409);
  if(busy)throw fail('codex_review_busy',409);
  const p=planRow(planId);
  if(!p)throw fail('codex_review_plan_not_found',404);
  if(p.status!=='active')throw fail('codex_review_plan_not_active',409);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==p.revision)throw fail('codex_review_plan_revision_conflict',409);
  if(!Number.isSafeInteger(stepIndex)||stepIndex!==p.current_index)throw fail('codex_review_step_out_of_order',409);
  const step=db.prepare('SELECT * FROM codex_review_steps WHERE plan_id=? AND step_index=?').get(planId,stepIndex);
  if(step?.state!=='ready')throw fail('codex_review_step_not_ready',409);
  const reportText=text(summary,4000,'codex_review_report_invalid'),proof=text(evidence,4000,'codex_review_evidence_required');
  const hash=crypto.createHash('sha256').update(JSON.stringify([planId,stepIndex,reportText,proof])).digest('hex');
  busy=true;
  try{
   const claim=db.prepare("UPDATE codex_review_plans SET status='reviewing',revision=revision+1,updated_ms=? WHERE id=? AND status='active' AND revision=?").run(Date.now(),planId,expectedRevision);
   if(claim.changes!==1)throw fail('codex_review_claim_conflict',409);
   db.prepare("UPDATE codex_review_steps SET state='reviewing',report=?,evidence=?,report_sha256=? WHERE plan_id=? AND step_index=? AND state='ready'").run(reportText,proof,hash,planId,stepIndex);
   let outcome;
   try{
    if(typeof plus.runReviewReport!=='function')throw fail('codex_review_runtime_missing',503);
    outcome=await plus.runReviewReport({planTitle:p.title,step:{title:step.title,acceptance:step.acceptance},
      report:reportText,evidence:proof,last:stepIndex===steps(planId).length-1,
      upcoming:steps(planId)[stepIndex+1]?.title||null});
   }catch(e){outcome={completed:false,status:'failed',summary:'Codex review failed: '+String(e.message||e).slice(0,100)};}
   const raw=String(outcome?.summary||'').slice(0,7000);
   const parsed=outcome?.completed===true?parseGoldCodexGate(raw,{last:stepIndex===steps(planId).length-1}):
     {decision:'WAIT_OWNER',reason:'codex_review_failed'};
   const decision=parsed.decision,accepted=decision!=='WAIT_OWNER';
   const state=decision==='WAIT_OWNER'?'waiting_owner':decision==='DONE'?'completed':'active';
   const id=crypto.randomUUID(),now=Date.now();
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('INSERT INTO codex_review_receipts(id,plan_id,step_index,report_sha256,decision,reason,summary,status,created_ms) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,planId,stepIndex,hash,decision,parsed.reason,raw,String(outcome?.status||'unknown').slice(0,32),now);
    db.prepare('UPDATE codex_review_steps SET state=?,receipt_id=? WHERE plan_id=? AND step_index=?').run(accepted?'accepted':'waiting_owner',id,planId,stepIndex);
    if(decision==='CONTINUE')db.prepare("UPDATE codex_review_steps SET state='ready' WHERE plan_id=? AND step_index=? AND state='locked'").run(planId,stepIndex+1);
    const update=db.prepare("UPDATE codex_review_plans SET status=?,current_index=?,revision=revision+1,updated_ms=? WHERE id=? AND status='reviewing' AND current_index=?")
      .run(state,stepIndex+(accepted?1:0),now,planId,stepIndex);
    if(update.changes!==1)throw fail('codex_review_lease_lost',409);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return {receiptId:id,decision,reason:parsed.reason,reportHash:hash,plan:get(planId)};
  }finally{busy=false;}
 }
 return {create,get,list,report,receipts};
}
