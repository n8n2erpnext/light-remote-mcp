import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {parseGoldCodexGate} from '../../device-agent/gold-codex-coordinator.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-codex-review-loop-'));
let calls=0,wall=null,mod=null;
const plus={stop(){},async runReviewReport({report,evidence,last,upcoming}){
  calls++;
  assert.ok(report.length>4);
  assert.ok(typeof evidence==='string'&&evidence.length>4);
  const decision=evidence.includes('PASS')?(last?'DONE':'CONTINUE'):'WAIT_OWNER';
  return {completed:true,status:'completed',summary:'REASON: Evidence reviewed '+(upcoming||'final')+'\nDECISION: '+decision+'\n'};
}};
const STEPS=[
  {title:'A - prepare result',acceptance:'Show a small file or output and concrete PASS receipt'},
  {title:'B - verify result',acceptance:'Show independent PASS evidence for previous output'},
  {title:'C - final handoff',acceptance:'Produce final handoff with PASS evidence'}
];
try{
 mod=createGoldWallModules({file:path.join(dir,'gold.sqlite'),plusImpl:plus});
 assert.throws(()=>mod.coordinatorList(),/gold_module_disabled/);
 mod.configure({longMemory:false,codexBridge:true,expectedRevision:0});
 assert.deepEqual(parseGoldCodexGate('DECISION: CONTINUE\nDECISION: DONE'),{decision:'WAIT_OWNER',reason:'missing_or_ambiguous_decision'});
 assert.equal(parseGoldCodexGate('DECISION: DONE\nREASON: already',{last:false}).decision,'WAIT_OWNER');
 assert.throws(()=>mod.coordinatorCreate({title:'3 steps',steps:STEPS}),/owner_required/);
 const initial=mod.coordinatorCreate({title:'Coordination test',steps:STEPS,ownerApproved:true});
 assert.equal(initial.steps[0].state,'ready');
 assert.equal(initial.steps[1].state,'locked');
 assert.equal(initial.currentIndex,0);
 await assert.rejects(()=>mod.coordinatorReport({planId:initial.id,stepIndex:1,expectedRevision:1,summary:'bad',evidence:'PASS'}),/step_out_of_order/);
 let checkpoint=initial;
 for(let i=0;i<3;i++){
  const before=checkpoint.revision;
  const review=await mod.coordinatorReport({planId:initial.id,stepIndex:i,expectedRevision:before,
    summary:'Completed microtask '+String(i+1),
    evidence:'PASS output receipt for step '+String(i+1)});
  assert.equal(review.decision,i===2?'DONE':'CONTINUE');
  assert.equal(review.plan.currentIndex,i+1);
  assert.equal(review.plan.status,i===2?'completed':'active');
  assert.equal(review.plan.steps[i].state,'accepted');
  if(i<2)assert.equal(review.plan.steps[i+1].state,'ready');
  assert.equal(mod.coordinatorReceipts(initial.id).length,i+1);
  await assert.rejects(()=>mod.coordinatorReport({planId:initial.id,stepIndex:i,expectedRevision:before,summary:'Replay',evidence:'PASS'}),/not_active|revision_conflict/);
  checkpoint=review.plan;
 }
 assert.equal(calls,3);
 assert.equal(mod.coordinatorGet(initial.id).status,'completed');
 const blocked=mod.coordinatorCreate({title:'Safety gate',steps:STEPS,ownerApproved:true});
 const rejected=await mod.coordinatorReport({planId:blocked.id,stepIndex:0,expectedRevision:blocked.revision,
  summary:'Report with inadequate result',evidence:'Evidence not confirmed'});
 assert.equal(rejected.decision,'WAIT_OWNER');
 assert.equal(rejected.plan.status,'waiting_owner');
 assert.equal(rejected.plan.steps[1].state,'locked');
 assert.equal(mod.coordinatorReceipts(blocked.id).length,1);
 mod.close();mod=null;
 mod=createGoldWallModules({file:path.join(dir,'gold.sqlite'),plusImpl:plus});
 assert.equal(mod.coordinatorGet(initial.id).status,'completed');
 assert.equal(mod.coordinatorReceipts(initial.id).length,3);
 assert.equal(mod.coordinatorGet(blocked.id).status,'waiting_owner');
 assert.throws(()=>mod.coordinatorReopen({planId:blocked.id,
   expectedRevision:rejected.plan.revision}),/owner_required/);
 const resume=mod.coordinatorReopen({planId:blocked.id,
   expectedRevision:rejected.plan.revision,ownerApproved:true});
 assert.equal(resume.status,'active');
 assert.equal(resume.steps[0].state,'ready');
 assert.equal(resume.steps[1].state,'locked');
 await assert.rejects(()=>mod.coordinatorReport({planId:blocked.id,
   stepIndex:0,expectedRevision:resume.revision,
   summary:'Report with inadequate result',evidence:'Evidence not confirmed'}),/new_evidence_required/);
 const fixed=await mod.coordinatorReport({planId:blocked.id,
   stepIndex:0,expectedRevision:resume.revision,
   summary:'Revised verified report with concrete new proof',evidence:'PASS: corrected evidence now verified'});
 assert.equal(fixed.decision,'CONTINUE');
 assert.equal(fixed.plan.steps[1].state,'ready');
 const records=mod.coordinatorReceipts(blocked.id);
 assert.equal(records.length,2);
 assert.equal(records[0].decision,'WAIT_OWNER');
 assert.equal(records[0].evidence,'Evidence not confirmed');
 assert.equal(records[1].decision,'CONTINUE');
 assert.equal(records[1].evidence,'PASS: corrected evidence now verified');
 const auth={enabled:true,identity:req=>req.headers['x-owner']==='yes'?{username:'owner'}:null,
  csrfForRequest:()=> 'fixture-csrf',verifyRequestCsrf:(_r,v)=>v==='fixture-csrf'};
 wall=startLocalWall({host:'127.0.0.1',port:0,modules:mod,auth,
  getLocalStatus:async()=>({deviceName:'Test Gold'})});
 await new Promise((yes,no)=>wall.server.listening?yes():wall.server.once('listening',yes).once('error',no));
 const base='http://127.0.0.1:'+wall.server.address().port;
 const endpoint=base+'/api/gold/modules/coordinator/create';
 const payload=JSON.stringify({title:'Authenticated plan',steps:STEPS,ownerApproved:true});
 let result=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:payload});
 assert.equal(result.status,401);
 result=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-owner':'yes'},body:payload});
 assert.equal(result.status,403);
 result=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-owner':'yes','x-light-remote-csrf':'fixture-csrf'},body:payload});
 assert.equal(result.status,200);
 assert.equal((await result.json()).plan.status,'active');
 console.log('GOLD_CODEX_COORDINATOR_THREE_GATES_WAIT_OWNER_REOPEN_NEW_EVIDENCE_AUDIT_CSRF_PASS');
}finally{await wall?.close().catch(()=>{});mod?.close();fs.rmSync(dir,{recursive:true,force:true});}
