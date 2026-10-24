/*
 * Gold Long Memory V2 G2: durable, scope-bound event capture.
 * Only trusted, typed, observed events. NO transcript collection, no AI inference.
 * No global V1 checkpoint writes. No cloud sync.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {prepareGoldMemoryV2,resolveGoldScope,appendGoldScopedCheckpoint} from './gold-memory-scope.mjs';

const TYPES=new Set(['filesystem_changed','repository_head_changed','task_created','task_state_changed','process_completed']);
const EFFECTS=new Set(['observed','blocked']);
const ID=/^[A-Za-z0-9._:@/-]{1,512}$/;
const NOW_MIN=0;
const LIMIT=25;
const DEFAULT_MS=90_000;
const readyDatabases=new WeakSet();
function fault(code,status=400){return Object.assign(new Error(code),{status});}
function text(x,max,code){
  if(typeof x!=='string'||!x.trim()||x.length>max)throw fault(code);
  return x.trim();
}
export function prepareGoldMemoryAuto(db){
  if(readyDatabases.has(db))return;
  prepareGoldMemoryV2(db);
  db.exec(`CREATE TABLE IF NOT EXISTS lm_events (
    event_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES lm_scopes(scope_id),
    work_context_id TEXT NOT NULL, origin_device_id TEXT NOT NULL,
    event_type TEXT NOT NULL, event_ref TEXT NOT NULL,
    evidence_status TEXT NOT NULL CHECK(evidence_status IN ('observed','blocked')),
    occurred_at INTEGER NOT NULL, ingest_state TEXT NOT NULL DEFAULT 'pending'
      CHECK(ingest_state IN ('pending','committed')),
    checkpoint_id TEXT NULL REFERENCES lm_checkpoint_v2(checkpoint_id),
    UNIQUE(scope_id,event_type,event_ref)
  );
  CREATE INDEX IF NOT EXISTS lm_events_pending
    ON lm_events(scope_id,work_context_id,ingest_state,occurred_at,event_id);
  CREATE TABLE IF NOT EXISTS lm_event_batches (
    checkpoint_id TEXT PRIMARY KEY REFERENCES lm_checkpoint_v2(checkpoint_id),
    scope_id TEXT NOT NULL REFERENCES lm_scopes(scope_id),work_context_id TEXT NOT NULL,
    event_count INTEGER NOT NULL,created_at INTEGER NOT NULL
  );`);
  readyDatabases.add(db);
}
function canonicalFilePath(candidate){
  if(typeof candidate!=='string'||candidate.length>4096||!path.isAbsolute(candidate))return null;
  try{return fs.realpathSync(candidate);}
  catch{
    // A deleted path may no longer exist; verify its actual parent instead.
    try{return path.join(fs.realpathSync(path.dirname(candidate)),path.basename(candidate));}
    catch{return null;}
  }
}
export function resolveGoldAutoWorkspace(db,{accountId,deviceId,filePath}={}){
  prepareGoldMemoryV2(db);
  const target=canonicalFilePath(filePath);
  if(!target)return {scopeId:null,unassigned:true};
  const rows=db.prepare(`SELECT b.scope_id AS scopeId,b.source_id AS sourceId,b.source_type AS sourceType,s.capture_mode AS captureMode
    FROM lm_work_bindings b JOIN lm_scopes s ON s.scope_id=b.scope_id
    WHERE b.account_id=? AND s.account_id=? AND s.home_device_id=? AND s.status='active'
    AND b.source_type IN ('workspace','repository')`).all(accountId,accountId,deviceId);
  const matches=rows.map(row=>({...row,canonical:canonicalFilePath(row.sourceId)}))
    .filter(row=>row.canonical&&(target===row.canonical||target.startsWith(row.canonical+path.sep)))
    .sort((a,b)=>b.canonical.length-a.canonical.length);
  if(!matches.length)return {scopeId:null,unassigned:true};
  if(matches[1]&&matches[1].canonical.length===matches[0].canonical.length &&
    matches[1].scopeId!==matches[0].scopeId)
    return {scopeId:null,unassigned:true,conflict:true};
  return {scopeId:matches[0].scopeId,sourceType:matches[0].sourceType,
    sourceId:matches[0].sourceId,workContextId:matches[0].canonical};
}
function scopeFromBinding(db,{accountId,sourceType,sourceId}){
  const ref=resolveGoldScope(db,{accountId,sourceType,sourceId});
  return ref.scopeId||null;
}
export function ingestGoldAutoFsEffect(db,{accountId,deviceId,operation,filePath,eventRef}={}){
  if(!['write','edit','mkdir','delete'].includes(operation))
    return {accepted:false,reason:'read_only_or_unproven_effect'};
  const binding=resolveGoldAutoWorkspace(db,{accountId,deviceId,filePath});
  if(!binding.scopeId)return {accepted:false,reason:binding.conflict?'ambiguous_scope':'unassigned'};
  return ingestGoldAutoEvent(db,{accountId,deviceId,sourceType:binding.sourceType,
    sourceId:binding.sourceId,workContextId:binding.workContextId,
    eventType:'filesystem_changed',eventRef});
}
export function ingestGoldAutoEvent(db,{accountId,deviceId,sourceType,sourceId,eventType,eventRef,
  workContextId,evidenceStatus='observed',occurredAt=Date.now()}={}){
  if(!TYPES.has(eventType))throw fault('gold_auto_event_type_invalid');
  if(!EFFECTS.has(evidenceStatus))throw fault('gold_auto_evidence_status_invalid');
  const ref=text(eventRef,512,'gold_auto_event_ref_invalid');
  if(!ID.test(ref))throw fault('gold_auto_event_ref_invalid');
  const contextSource=text(workContextId||sourceId,512,'gold_auto_work_context_invalid');
  const context=crypto.createHash('sha256').update(contextSource).digest('hex');
  if(!Number.isSafeInteger(occurredAt)||occurredAt<NOW_MIN)throw fault('gold_auto_event_time_invalid');
  prepareGoldMemoryAuto(db);
  const scopeId=scopeFromBinding(db,{accountId,sourceType,sourceId});
  if(!scopeId)return {accepted:false,reason:'unassigned',checkpointCreated:false};
  const scope=db.prepare('SELECT * FROM lm_scopes WHERE account_id=? AND scope_id=? AND status=?')
    .get(accountId,scopeId,'active');
  if(!scope)return {accepted:false,reason:'scope_inactive',checkpointCreated:false};
  if(scope.home_device_id!==deviceId)return {accepted:false,reason:'not_home',checkpointCreated:false};
  if(scope.capture_mode==='manual')return {accepted:false,reason:'manual_mode',checkpointCreated:false};
  // Scope binding is verified; Follow Project never follows an unbound context.
  if(scope.capture_mode==='follow_project'&&!['workspace','repository'].includes(sourceType))
    return {accepted:false,reason:'follow_project_requires_workspace',checkpointCreated:false};
  // Do not auto-sign guessed outcomes, command bodies, stdout or secrets.
  const eventId=crypto.createHash('sha256').update('gold-lm-v2-event\n')
    .update(scopeId+'\n'+eventType+'\n'+ref).digest('hex');
  const pending=db.prepare('SELECT count(*) AS n FROM lm_events WHERE scope_id=? AND ingest_state=?')
    .get(scopeId,'pending').n;
  if(pending>=5000)return {accepted:false,reason:'event_queue_full',checkpointCreated:false};
  const result=db.prepare(`INSERT OR IGNORE INTO lm_events
    (event_id,scope_id,work_context_id,origin_device_id,event_type,event_ref,evidence_status,occurred_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(eventId,scopeId,context,deviceId,eventType,ref,evidenceStatus,occurredAt);
  return {accepted:true,duplicate:result.changes===0,eventId,scopeId,checkpointCreated:false};
}
export function goldAutoPending(db,{accountId,limit=100}={}){
  prepareGoldMemoryAuto(db);
  if(!Number.isInteger(limit)||limit<1||limit>200)throw fault('gold_auto_limit_invalid');
  return db.prepare(`SELECT e.scope_id AS scopeId,e.work_context_id AS workContextId,
    s.display_name AS displayName,s.capture_mode AS captureMode,
    count(*) AS pending,min(e.occurred_at) AS oldestEvent
    FROM lm_events e JOIN lm_scopes s ON e.scope_id=s.scope_id
    WHERE s.account_id=? AND e.ingest_state='pending' AND s.status='active'
    GROUP BY e.scope_id,e.work_context_id ORDER BY oldestEvent ASC LIMIT ?`).all(accountId,limit);
}
export function flushGoldAuto(db,keyFile,{accountId,deviceId,now=Date.now(),
  coalesceMs=DEFAULT_MS,maxBatches=8}={}){
  if(!Number.isSafeInteger(now)||now<NOW_MIN)throw fault('gold_auto_flush_clock_invalid');
  if(!Number.isInteger(coalesceMs)||coalesceMs<0||coalesceMs>300000)throw fault('gold_auto_coalesce_invalid');
  if(!Number.isInteger(maxBatches)||maxBatches<1||maxBatches>16)throw fault('gold_auto_batches_invalid');
  prepareGoldMemoryAuto(db);
  const rows=db.prepare(`SELECT e.scope_id AS scopeId,e.work_context_id AS workContextId,
    min(e.occurred_at) AS oldest,count(*) AS amount
    FROM lm_events e JOIN lm_scopes s ON s.scope_id=e.scope_id
    WHERE s.account_id=? AND s.home_device_id=? AND s.status='active'
    AND s.capture_mode IN ('auto','follow_project') AND e.ingest_state='pending'
    GROUP BY e.scope_id,e.work_context_id ORDER BY oldest LIMIT ?`).all(accountId,deviceId,maxBatches);
  const completed=[];
  for(const group of rows){
    if(group.amount<LIMIT && group.oldest+coalesceMs>now)continue;
    db.exec('BEGIN IMMEDIATE');
    try{
      const events=db.prepare(`SELECT * FROM lm_events WHERE scope_id=? AND work_context_id=?
        AND ingest_state='pending' ORDER BY occurred_at,event_id LIMIT ?`)
        .all(group.scopeId,group.workContextId,LIMIT);
      if(!events.length){db.exec('COMMIT');continue;}
      const scope=db.prepare('SELECT display_name AS displayName FROM lm_scopes WHERE scope_id=? AND account_id=?')
        .get(group.scopeId,accountId);
      if(!scope)throw fault('gold_auto_scope_missing',409);
      const counts={};for(const item of events)counts[item.event_type]=(counts[item.event_type]||0)+1;
      const lines=Object.entries(counts).sort((a,b)=>a[0].localeCompare(b[0]))
        .map(([type,n])=>type+': '+n);
      const eventRefs=events.map(e=>e.event_id);
      const checkpoint=appendGoldScopedCheckpoint(db,keyFile,{
        accountId,deviceId,scopeId:group.scopeId,kind:'checkpoint',
        title:'Automatic Gold activity · '+scope.displayName,
        body:'Observed '+events.length+' scoped Gold event(s) from trusted Agent/Task Controller.\n'+
          lines.join('\n')+'\nEvent refs:\n'+events.map(e=>e.event_type+' · '+e.event_ref.slice(0,160)).join('\n')+
          '\nNo command output, hidden chat transcript or inferred task completion was captured.',
        source:'gold-agent-auto-journal',
        status:'observed',evidence:eventRefs.map(id=>'event:'+id).slice(0,LIMIT)
      },{transactionManaged:true});
      const stmt=db.prepare(`UPDATE lm_events SET ingest_state='committed',checkpoint_id=?
        WHERE event_id=? AND ingest_state='pending'`);
      for(const event of events)if(stmt.run(checkpoint.checkpointId,event.event_id).changes!==1)
        throw fault('gold_auto_event_cas_conflict',409);
      db.prepare(`INSERT INTO lm_event_batches(checkpoint_id,scope_id,work_context_id,event_count,created_at)
        VALUES(?,?,?,?,?)`).run(checkpoint.checkpointId,group.scopeId,group.workContextId,events.length,now);
      db.exec('COMMIT');
      completed.push({scopeId:group.scopeId,checkpointId:checkpoint.checkpointId,
        revision:checkpoint.revision,events:events.length,integrity:checkpoint.integrity});
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  return {checkpoints:completed,remaining:goldAutoPending(db,{accountId,limit:100}).reduce((sum,g)=>sum+g.pending,0)};
}
