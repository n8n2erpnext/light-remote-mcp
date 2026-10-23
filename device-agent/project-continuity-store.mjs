/* P1 local deterministic store. Not imported by production Gold Agent. */
import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const uid=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const STATES={
 READY:['RUNNING','WAIT_OWNER','BLOCKED','FAILED'],
 RUNNING:['CHECKPOINTED','WAIT_OWNER','BLOCKED','DONE','FAILED','UNKNOWN'],
 CHECKPOINTED:['READY','WAIT_OWNER','BLOCKED'],
 WAIT_OWNER:['READY','BLOCKED','FAILED'],BLOCKED:['READY','FAILED'],
 FAILED:['READY'],UNKNOWN:['BLOCKED','FAILED'],DONE:[]
};
function req(ok,message){if(!ok)throw Error(message);}
function label(s,max=160){req(typeof s==='string'&&!!s.trim()&&s.length<=max&&!/[\u0000-\u001f]/.test(s),'continuity_invalid_text');return s.trim();}
function guid(s){req(typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s),'continuity_invalid_id');return s;}
export function continuityDefaultRoot(){
 const home=os.homedir();
 if(process.platform==='win32')return path.join(process.env.LOCALAPPDATA||path.join(home,'AppData','Local'),'Light Remote','Continuity');
 if(process.platform==='darwin')return path.join(home,'Library','Application Support','Light Remote','Continuity');
 return path.join(process.env.XDG_DATA_HOME||path.join(home,'.local','share'),'light-remote','continuity');
}
export class ContinuityStore {
 constructor({root=continuityDefaultRoot()}={}){
  this.root=path.resolve(root);fs.mkdirSync(this.root,{recursive:true,mode:0o700});
  if(process.platform!=='win32')fs.chmodSync(this.root,0o700);
  this.db=new DatabaseSync(path.join(this.root,'continuity.db'),{timeout:3000});
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA synchronous=FULL');
  const openedVersion=this.db.prepare('PRAGMA user_version').get().user_version;
  if(openedVersion>3){this.db.close();throw Error('continuity_future_schema_version');}
  this.db.exec([
  'CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,workspace TEXT NOT NULL,memory_enabled INTEGER NOT NULL DEFAULT 0 CHECK(memory_enabled IN(0,1)),codex_enabled INTEGER NOT NULL DEFAULT 0 CHECK(codex_enabled IN(0,1)),revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,created_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sections(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),title TEXT NOT NULL,state TEXT NOT NULL DEFAULT "READY",revision INTEGER NOT NULL DEFAULT 1,reason TEXT,updated_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS section_deps(section_id TEXT NOT NULL REFERENCES sections(id),depends_on TEXT NOT NULL REFERENCES sections(id),PRIMARY KEY(section_id,depends_on),CHECK(section_id<>depends_on))',
  'CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,section_id TEXT NOT NULL REFERENCES sections(id),reference TEXT NOT NULL,sha256 TEXT,verified_by TEXT NOT NULL,created_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,section_id TEXT NOT NULL REFERENCES sections(id),status TEXT NOT NULL CHECK(status IN (\'pending\',\'approved\',\'denied\')),reason TEXT NOT NULL,decided_by TEXT,created_at TEXT NOT NULL,decided_at TEXT)',
  'CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL REFERENCES projects(id),actor TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT,old_state TEXT,new_state TEXT,detail TEXT,created_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS memory_facts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),body TEXT NOT NULL,kind TEXT NOT NULL,source_ref TEXT NOT NULL,created_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS operations(project_id TEXT NOT NULL REFERENCES projects(id),operation_id TEXT NOT NULL,intent_hash TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(project_id,operation_id))',
  'CREATE INDEX IF NOT EXISTS idx_task_project ON tasks(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_sections_task ON sections(task_id)',
  'CREATE INDEX IF NOT EXISTS idx_evidence_section ON evidence(section_id)'
  ].join(';\n')+';');
  // Additive, typed migration; never rehydrate from exported JSON.
  this.db.exec([
   'CREATE TABLE IF NOT EXISTS section_claims(section_id TEXT PRIMARY KEY REFERENCES sections(id),project_id TEXT NOT NULL REFERENCES projects(id),operation_id TEXT NOT NULL,worker TEXT NOT NULL,lease_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN (\'held\',\'unknown\',\'released\')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL, UNIQUE(project_id,operation_id))',
   'CREATE TABLE IF NOT EXISTS memory_annotations(fact_id TEXT PRIMARY KEY REFERENCES memory_facts(id),confidence TEXT NOT NULL CHECK(confidence IN (\'unverified\',\'owner_confirmed\',\'source_verified\')),superseded INTEGER NOT NULL DEFAULT 0 CHECK(superseded IN(0,1)))',
   'CREATE INDEX IF NOT EXISTS idx_events_project_seq ON events(project_id,seq)',
   'CREATE INDEX IF NOT EXISTS idx_memory_project_time ON memory_facts(project_id,created_at)'
  ].join(';\n')+';');
  this.db.exec('PRAGMA user_version=2');
  this.db.exec("CREATE TABLE IF NOT EXISTS codex_threads(project_id TEXT PRIMARY KEY REFERENCES projects(id),thread_id TEXT NOT NULL,last_turn_status TEXT NOT NULL DEFAULT 'idle',updated_at TEXT NOT NULL)");
  this.db.exec('PRAGMA user_version=3');
  this.reconcileStartup();
 }
 reconcileStartup(){
  // Previous runner may have survived the database service. Never claim completion
  // or re-dispatch any unacknowledged native effect; preserve UNKNOWN for review.
  const running=this.db.prepare("SELECT s.id,t.project_id FROM sections s JOIN tasks t ON t.id=s.task_id WHERE s.state='RUNNING'").all();
  const held=this.db.prepare("SELECT section_id,project_id FROM section_claims WHERE status='held'").all();
  if(running.length===0&&held.length===0)return;
  this.tx(()=>{
   for(const s of running){
    this.db.prepare("UPDATE sections SET state='UNKNOWN',revision=revision+1,reason='restart_requires_reconciliation',updated_at=? WHERE id=?").run(now(),s.id);
    this.event(s.project_id,'controller','restart_unknown',s.id,'RUNNING','UNKNOWN');
   }
   for(const x of held){
    this.db.prepare("UPDATE section_claims SET status='unknown',updated_at=? WHERE section_id=?").run(now(),x.section_id);
    this.event(x.project_id,'controller','claim_unknown',x.section_id,'held','unknown');
   }
  });
 }
  close(){this.db.close();}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 project(pid){return this.db.prepare('SELECT * FROM projects WHERE id=?').get(guid(pid))||null;}
 projects(){return this.db.prepare('SELECT * FROM projects ORDER BY created_at,id').all();}
 event(pid,who,what,eid='',from='',to='',detail=''){this.db.prepare('INSERT INTO events(project_id,actor,kind,entity_id,old_state,new_state,detail,created_at) VALUES (?,?,?,?,?,?,?,?)').run(pid,who,what,eid,from,to,detail,now());}
 createProject({projectName,workspace=''}){
  req(typeof workspace==='string'&&workspace.length<=4096,'continuity_invalid_workspace');
  const pid=uid(),ts=now();
  return this.tx(()=>{this.db.prepare('INSERT INTO projects(id,name,workspace,created_at,updated_at) VALUES (?,?,?,?,?)').run(pid,label(projectName),workspace,ts,ts);this.event(pid,'owner','project_created',pid);return this.project(pid);});
 }
 setModules(pid,{memory,codex,expectedRevision}){
  const old=this.project(pid);req(old,'continuity_project_missing');
  req(Number.isInteger(expectedRevision)&&expectedRevision===old.revision,'continuity_stale_revision');
  const m=memory===undefined?old.memory_enabled:memory===true?1:memory===false?0:-1;
  const c=codex===undefined?old.codex_enabled:codex===true?1:codex===false?0:-1;
  req(m!==-1&&c!==-1,'continuity_invalid_modules');
  return this.tx(()=>{
   const r=this.db.prepare('UPDATE projects SET memory_enabled=?,codex_enabled=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(m,c,now(),pid,expectedRevision);
   req(r.changes===1,'continuity_stale_revision');
   this.event(pid,'owner','modules_changed',pid,JSON.stringify({memory:old.memory_enabled,codex:old.codex_enabled}),JSON.stringify({memory:m,codex:c}));
   return this.project(pid);
  });
 }
 task(tid){
  const t=this.db.prepare('SELECT * FROM tasks WHERE id=?').get(guid(tid));if(!t)return null;
  return {...t,sections:this.db.prepare('SELECT * FROM sections WHERE task_id=? ORDER BY rowid').all(tid).map(s=>({...s,dependsOn:this.db.prepare('SELECT depends_on FROM section_deps WHERE section_id=? ORDER BY depends_on').all(s.id).map(d=>d.depends_on)}))};
 }
 createTask(pid,title){
  req(this.project(pid),'continuity_project_missing');const tid=uid();
  return this.tx(()=>{this.db.prepare('INSERT INTO tasks(id,project_id,title,created_at) VALUES (?,?,?,?)').run(tid,pid,label(title),now());this.event(pid,'owner','task_created',tid);return this.task(tid);});
 }
 addSection(tid,{title,dependsOn=[]}){
  const t=this.task(tid);req(t,'continuity_task_missing');
  req(Array.isArray(dependsOn)&&dependsOn.length<=64&&new Set(dependsOn).size===dependsOn.length,'continuity_invalid_dependencies');
  for(const d of dependsOn){guid(d);const s=this.db.prepare('SELECT task_id FROM sections WHERE id=?').get(d);req(s?.task_id===tid,'continuity_dependency_outside_task');}
  const sid=uid();
  const n=dependsOn.filter(d=>this.section(d).state!=='DONE').length;
  const state=n>0?'BLOCKED':'READY',reason=n>0?'dependency':null;
  return this.tx(()=>{this.db.prepare('INSERT INTO sections(id,task_id,title,state,reason,updated_at) VALUES (?,?,?,?,?,?)').run(sid,tid,label(title),state,reason,now());for(const d of dependsOn)this.db.prepare('INSERT INTO section_deps(section_id,depends_on) VALUES (?,?)').run(sid,d);this.event(t.project_id,'owner','section_created',sid,'',state);return this.section(sid);});
 }
 section(sid){return this.db.prepare('SELECT s.*,t.project_id FROM sections s JOIN tasks t ON t.id=s.task_id WHERE s.id=?').get(guid(sid))||null;}
 evidence(sid,{reference,sha256=null,verifiedBy='owner'}){
  const s=this.section(sid);req(s,'continuity_section_missing');
  req(['owner','trusted_tool'].includes(verifiedBy),'continuity_evidence_verifier_invalid');
  req(sha256===null||/^[a-f0-9]{64}$/i.test(sha256),'continuity_evidence_sha_invalid');
  const eid=uid();
  return this.tx(()=>{this.db.prepare('INSERT INTO evidence(id,section_id,reference,sha256,verified_by,created_at) VALUES (?,?,?,?,?,?)').run(eid,sid,label(reference,2048),sha256,verifiedBy,now());this.event(s.project_id,verifiedBy,'evidence_added',eid);return {id:eid,sectionId:sid};});
 }
 transition(sid,{to,expectedRevision,actor='controller',reason=null}){
  const s=this.section(sid);req(s,'continuity_section_missing');
  req(STATES[s.state]?.includes(to),'continuity_illegal_transition');
  req(s.revision===expectedRevision,'continuity_stale_revision');
  req(['controller','owner','worker'].includes(actor),'continuity_actor_invalid');
  if(s.state==='WAIT_OWNER')throw Error('continuity_owner_approval_required');
  if(to==='WAIT_OWNER')throw Error('continuity_use_request_approval');
  if(to==='RUNNING'||to==='READY'){const d=this.db.prepare("SELECT COUNT(*) n FROM section_deps d JOIN sections s ON d.depends_on=s.id WHERE d.section_id=? AND s.state<>'DONE'").get(sid).n;req(d===0,'continuity_dependencies_incomplete');}
  if(to==='DONE'){const e=this.db.prepare('SELECT COUNT(*) n FROM evidence WHERE section_id=?').get(sid).n;req(e>0,'continuity_done_requires_evidence');}
  return this.tx(()=>{
   const r=this.db.prepare('UPDATE sections SET state=?,revision=revision+1,reason=?,updated_at=? WHERE id=? AND revision=?').run(to,reason===null?null:label(reason,500),now(),sid,expectedRevision);
   req(r.changes===1,'continuity_stale_revision');this.event(s.project_id,actor,'section_transition',sid,s.state,to,reason||'');
   if(to==='DONE'){
    const blocked=this.db.prepare("SELECT d.section_id FROM section_deps d JOIN sections c ON c.id=d.section_id WHERE d.depends_on=? AND c.state='BLOCKED' AND c.reason='dependency'").all(sid);
    for(const candidate of blocked){
     const other=this.db.prepare("SELECT COUNT(*) n FROM section_deps d JOIN sections s ON s.id=d.depends_on WHERE d.section_id=? AND s.state<>'DONE'").get(candidate.section_id).n;
     if(other===0){
      this.db.prepare("UPDATE sections SET state='READY',reason=NULL,revision=revision+1,updated_at=? WHERE id=? AND state='BLOCKED' AND reason='dependency'").run(now(),candidate.section_id);
      this.event(s.project_id,'controller','dependency_satisfied',candidate.section_id,'BLOCKED','READY');
     }
    }
   }
   return this.section(sid);
  });
 }
 requestApproval(sid,reason){
  const s=this.section(sid);req(s&&s.state!=='DONE','continuity_section_unavailable');
  const already=this.db.prepare("SELECT id FROM approvals WHERE section_id=? AND status='pending'").get(sid);req(!already,'continuity_approval_pending');
  const aid=uid();
  return this.tx(()=>{
   this.db.prepare("INSERT INTO approvals(id,section_id,status,reason,created_at) VALUES (?,?,'pending',?,?)").run(aid,sid,label(reason,500),now());
   this.db.prepare("UPDATE sections SET state='WAIT_OWNER',revision=revision+1,reason=?,updated_at=? WHERE id=?").run(reason,now(),sid);
   this.event(s.project_id,'controller','approval_requested',sid,s.state,'WAIT_OWNER');return {id:aid,status:'pending'};
  });
 }
 decideApproval(aid,{decision,ownerVerified=false}){
  req(ownerVerified===true,'continuity_owner_proof_required');
  req(['approved','denied'].includes(decision),'continuity_decision_invalid');
  const a=this.db.prepare('SELECT a.*,s.state,t.project_id FROM approvals a JOIN sections s ON a.section_id=s.id JOIN tasks t ON s.task_id=t.id WHERE a.id=?').get(guid(aid));
  req(a?.status==='pending'&&a.state==='WAIT_OWNER','continuity_approval_not_pending');
  const missing=this.db.prepare("SELECT COUNT(*) n FROM section_deps d JOIN sections s ON s.id=d.depends_on WHERE d.section_id=? AND s.state<>'DONE'").get(a.section_id).n;
  const next=decision==='approved'?(missing?'BLOCKED':'READY'):'BLOCKED';
  return this.tx(()=>{
   this.db.prepare('UPDATE approvals SET status=?,decided_by=?,decided_at=? WHERE id=?').run(decision,'owner',now(),aid);
   this.db.prepare('UPDATE sections SET state=?,revision=revision+1,reason=?,updated_at=? WHERE id=?').run(next,decision==='approved'&&missing?'dependency':null,now(),a.section_id);
   this.event(a.project_id,'owner','approval_decided',a.section_id,'WAIT_OWNER',next,decision);return this.section(a.section_id);
  });
 }
 codexThread(pid){
  const p=this.project(pid);req(p,'continuity_project_missing');req(p.codex_enabled===1,'continuity_codex_disabled');
  return this.db.prepare('SELECT thread_id,last_turn_status,updated_at FROM codex_threads WHERE project_id=?').get(pid)||null;
 }
 recordCodexThread(pid,{threadId,lastTurnStatus='idle'}){
  req(this.project(pid)?.codex_enabled===1,'continuity_codex_disabled');
  req(typeof threadId==='string'&&threadId.length>=4&&threadId.length<=256,'continuity_codex_thread_invalid');
  req(['idle','inProgress','completed','failed','interrupted','unknown'].includes(lastTurnStatus),'continuity_codex_turn_status_invalid');
  return this.tx(()=>{
   this.db.prepare('INSERT INTO codex_threads(project_id,thread_id,last_turn_status,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET thread_id=excluded.thread_id,last_turn_status=excluded.last_turn_status,updated_at=excluded.updated_at')
    .run(pid,threadId,lastTurnStatus,now());
   this.event(pid,'controller','codex_thread_updated',threadId);
   return this.codexThread(pid);
  });
 }
 claimSection(sid,{expectedRevision,operationId,worker,ownerAuthorized=false}){
  const s=this.section(sid);req(s,'continuity_section_missing');
  const p=this.project(s.project_id);
  req(p.codex_enabled===1,'continuity_codex_disabled');
  req(ownerAuthorized===true,'continuity_delegation_owner_required');
  req(s.state==='READY'&&s.revision===expectedRevision,'continuity_not_ready_or_stale');
  req(typeof operationId==='string'&&/^[A-Za-z0-9._:-]{16,160}$/.test(operationId),'continuity_operation_id_invalid');
  const holder=label(worker,160);
  const pending=this.db.prepare("SELECT COUNT(*) n FROM section_deps d JOIN sections dep ON dep.id=d.depends_on WHERE d.section_id=? AND dep.state<>'DONE'").get(sid).n;
  req(pending===0,'continuity_dependencies_incomplete');
  const token=crypto.randomBytes(32).toString('hex'),hash=crypto.createHash('sha256').update(token).digest('hex');
  return this.tx(()=>{
   const existing=this.db.prepare('SELECT status,operation_id FROM section_claims WHERE section_id=?').get(sid);
   req(!existing,'continuity_claim_exists_or_unknown');
   const duplicate=this.db.prepare('SELECT section_id FROM section_claims WHERE project_id=? AND operation_id=?').get(s.project_id,operationId);
   req(!duplicate,'continuity_operation_reused');
   this.db.prepare("INSERT INTO section_claims(section_id,project_id,operation_id,worker,lease_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,'held',?,?)").run(sid,s.project_id,operationId,holder,hash,now(),now());
   this.db.prepare("UPDATE sections SET state='RUNNING',reason=NULL,revision=revision+1,updated_at=? WHERE id=? AND state='READY'").run(now(),sid);
   this.event(s.project_id,'controller','claim_reserved',sid,'READY','RUNNING',operationId);
   return {sectionId:sid,operationId,leaseToken:token,state:'RUNNING',revision:s.revision+1};
  });
 }
 markClaimUnknown(sid,{leaseToken}){
  const s=this.section(sid);req(s,'continuity_section_missing');
  const hash=crypto.createHash('sha256').update(label(leaseToken,64)).digest('hex');
  return this.tx(()=>{
   const r=this.db.prepare("UPDATE section_claims SET status='unknown',updated_at=? WHERE section_id=? AND status='held' AND lease_hash=?").run(now(),sid,hash);
   req(r.changes===1,'continuity_lease_unknown_or_invalid');
   this.db.prepare("UPDATE sections SET state='UNKNOWN',reason='effect_unverified',revision=revision+1,updated_at=? WHERE id=? AND state='RUNNING'").run(now(),sid);
   this.event(s.project_id,'controller','claim_unknown',sid,'RUNNING','UNKNOWN');
   return this.section(sid);
  });
 }
 reconcileClaim(sid,{ownerVerified=false,evidenceReference,verdict}){
  req(ownerVerified===true,'continuity_owner_proof_required');
  req(['not_started','terminal_failed','terminal_succeeded'].includes(verdict),'continuity_reconciliation_invalid');
  const s=this.section(sid);req(s?.state==='UNKNOWN','continuity_not_unknown');
  const claim=this.db.prepare("SELECT * FROM section_claims WHERE section_id=? AND status='unknown'").get(sid);
  req(claim,'continuity_claim_unverified');
  const evidenceRef=label(evidenceReference,2048);
  // No auto-READY in uncertainty: owner certifies exact outcome and records evidence.
  const next=verdict==='terminal_succeeded'?'CHECKPOINTED':'FAILED';
  return this.tx(()=>{
   const eid=uid();
   this.db.prepare('INSERT INTO evidence(id,section_id,reference,sha256,verified_by,created_at) VALUES (?,?,?,?,?,?)').run(eid,sid,evidenceRef,null,'owner',now());
   this.db.prepare("UPDATE section_claims SET status='released',updated_at=? WHERE section_id=?").run(now(),sid);
   this.db.prepare("UPDATE sections SET state=?,reason=?,revision=revision+1,updated_at=? WHERE id=?").run(next,'reconciled_'+verdict,now(),sid);
   this.event(s.project_id,'owner','claim_reconciled',sid,'UNKNOWN',next,verdict);
   return this.section(sid);
  });
 }
 memoryPut(pid,{body,kind='observation',sourceRef}){
  req(this.project(pid)?.memory_enabled===1,'continuity_memory_disabled');
  req(['observation','fact','decision','hypothesis'].includes(kind),'continuity_memory_kind_invalid');
  const fid=uid(),b=label(body,12000),ref=label(sourceRef,2048);
  // Only a heuristic prevention boundary; encrypted secrets remain in OS vaults.
  const secretPattern=/(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:sk-proj-|sk-|github_pat_)[A-Za-z0-9_-]{14,}|Bearer\s+[A-Za-z0-9._-]{20,})/i;
  req(!secretPattern.test(b)&&!secretPattern.test(ref),'continuity_sensitive_content_rejected');
  return this.tx(()=>{
   // FTS table only initialized after opting in, not for Codex-only.
   this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(fact_id UNINDEXED,project_id UNINDEXED,body,tokenize='unicode61')");
   this.db.prepare('INSERT INTO memory_facts(id,project_id,body,kind,source_ref,created_at) VALUES (?,?,?,?,?,?)').run(fid,pid,b,kind,ref,now());
   this.db.prepare('INSERT INTO memory_annotations(fact_id,confidence) VALUES (?,?)').run(fid,kind==='hypothesis'?'unverified':'unverified');
   this.db.prepare('INSERT INTO memory_fts(fact_id,project_id,body) VALUES (?,?,?)').run(fid,pid,b);
   this.event(pid,'owner','memory_added',fid);return {id:fid,kind,sourceRef:ref};
  });
 }
 confirmMemory(pid,factId,{ownerVerified=false}={}){
  req(ownerVerified===true,'continuity_owner_proof_required');
  req(this.project(pid)?.memory_enabled===1,'continuity_memory_disabled');
  const fact=this.db.prepare('SELECT id FROM memory_facts WHERE id=? AND project_id=?').get(guid(factId),pid);
  req(fact,'continuity_fact_not_found');
  return this.tx(()=>{
   this.db.prepare("UPDATE memory_annotations SET confidence='owner_confirmed' WHERE fact_id=?").run(factId);
   this.event(pid,'owner','fact_confirmed',factId);
   return {id:factId,confidence:'owner_confirmed'};
  });
 }
  memorySearch(pid,query,{limit=8}={}){
  req(this.project(pid)?.memory_enabled===1,'continuity_memory_disabled');
  req(Number.isInteger(limit)&&limit>=1&&limit<=25,'continuity_invalid_limit');
  const exists=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_fts'").get();if(!exists)return [];
  return this.db.prepare('SELECT m.id,m.body,m.kind,m.source_ref,a.confidence FROM memory_fts JOIN memory_facts m ON m.id=memory_fts.fact_id JOIN memory_annotations a ON a.fact_id=m.id AND a.superseded=0 WHERE memory_fts MATCH ? AND memory_fts.project_id=? ORDER BY rank LIMIT ?').all('"'+label(query,300).replaceAll('"','""')+'"',pid,limit);
 }
 contextBrief(pid,{query='',maxChars=10000}={}){
  const p=this.project(pid);req(p,'continuity_project_missing');
  req(p.memory_enabled===1,'continuity_memory_disabled');
  req(Number.isInteger(maxChars)&&maxChars>=512&&maxChars<=16000,'continuity_context_limit');
  const snap=this.checkpoint(pid);
  const recent=this.db.prepare('SELECT f.id,f.body,f.kind,f.source_ref,f.created_at,a.confidence FROM memory_facts f JOIN memory_annotations a ON a.fact_id=f.id WHERE f.project_id=? AND a.superseded=0 ORDER BY CASE WHEN a.confidence=\'owner_confirmed\' THEN 0 ELSE 1 END,f.created_at DESC LIMIT 24').all(pid);
  const matches=typeof query==='string'&&query.trim()?this.memorySearch(pid,query,{limit:10}):[];
  const selected=[...matches,...recent].filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i).slice(0,24);
  const lines=[
   '# Project Continuity — Evidence-scoped handoff',
   'Project: '+p.name,
   'Project ID: '+p.id,
   'Project revision: '+p.revision,
   'Checkpoint event sequence: '+snap.sequence,
   'Workspace (reference only, NOT permission): '+p.workspace,
   '',
   '## Tasks / Sections',
   ...snap.tasks.flatMap(t=>['Task: '+t.title+' ['+t.id+']',...t.sections.map(s=>' - '+s.title+' ['+s.id+'] = '+s.state+(s.reason?' ('+s.reason+')':''))]),
   '',
   '## Owner approvals pending',
   ...snap.pendingApprovals.map(a=>' - '+a.section_id+': '+a.reason),
   '',
   '## Knowledge (source attribution required; unverified is not confirmed)',
   ...selected.map(m=>' - ['+m.kind+'; '+m.confidence+'; '+m.source_ref+'] '+m.body)
  ];
  let output='';
  for(const line of lines){if(output.length+line.length+1>maxChars){output+='\n[TRUNCATED: more context available by bounded search]\n';break;}output+=line+'\n';}
  return {projectId:pid,sequence:snap.sequence,content:output,factsReturned:selected.length,truncated:output.includes('[TRUNCATED')};
 }
 checkpoint(pid){
  const p=this.project(pid);req(p,'continuity_project_missing');
  const tasks=this.db.prepare('SELECT id FROM tasks WHERE project_id=? ORDER BY created_at,id').all(pid).map(t=>this.task(t.id));
  const pending=this.db.prepare("SELECT a.id,a.section_id,a.reason FROM approvals a JOIN sections s ON a.section_id=s.id JOIN tasks t ON t.id=s.task_id WHERE t.project_id=? AND a.status='pending'").all(pid);
  const sequence=this.db.prepare('SELECT COALESCE(MAX(seq),0) n FROM events WHERE project_id=?').get(pid).n;
  return {schema:1,project:{id:p.id,name:p.name,workspace:p.workspace,revision:p.revision,memoryEnabled:!!p.memory_enabled,codexEnabled:!!p.codex_enabled},sequence,tasks,pendingApprovals:pending};
 }
 async onlineBackup(){
  const directory=path.join(this.root,'backups');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const output=path.join(directory,'continuity-'+now().replace(/[:.]/g,'-')+'-'+uid()+'.sqlite');
  const temp=output+'.tmp';
  try{
   await backup(this.db,temp);
   fs.chmodSync(temp,0o600);
   const verify=new DatabaseSync(temp);
   try{req(verify.prepare('PRAGMA quick_check').get().quick_check==='ok','continuity_backup_integrity_error');}
   finally{verify.close();}
   fs.renameSync(temp,output);
   return {path:output,sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')};
  }finally{if(fs.existsSync(temp))fs.rmSync(temp,{force:true});}
 }
 exportHandoff(pid,{query='',maxChars=10000}={}){
  const data=this.contextBrief(pid,{query,maxChars});
  const target=path.join(this.root,'handoff-'+guid(pid)+'.md');
  const tmp=target+'.'+uid()+'.tmp';
  try{
   fs.writeFileSync(tmp,data.content,{mode:0o600,flag:'wx'});
   fs.renameSync(tmp,target);
  }finally{if(fs.existsSync(tmp))fs.rmSync(tmp,{force:true});}
  return {projectId:pid,path:target,sequence:data.sequence,
   sha256:crypto.createHash('sha256').update(data.content).digest('hex'),
   factsReturned:data.factsReturned,truncated:data.truncated};
 }
 exportCheckpoint(pid){
  const data=this.checkpoint(pid),target=path.join(this.root,'checkpoint-'+guid(pid)+'.json'),tmp=target+'.'+uid()+'.tmp';
  const bytes=JSON.stringify(data,null,2)+'\n';
  try{fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(tmp,target);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  return {path:target,sequence:data.sequence,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 }
}
