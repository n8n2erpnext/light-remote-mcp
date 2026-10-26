/**
 * Owner-scoped Memory lifecycle. A local delete never implies remote erasure.
 * Durable tombstones stay on the device so reconnect cannot resurrect a deleted scope.
 * Account-wide purge MUST use a separately signed, acknowledged offline-safe protocol.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import {appendGoldScopedCheckpoint,goldScopedExport} from './gold-memory-scope.mjs';
const fail=(code,status=409)=>Object.assign(new Error(code),{status});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZERO='0'.repeat(64);
export function ensureMemoryScopeLifecycle(db){
  db.exec(`CREATE TABLE IF NOT EXISTS lm_scope_local_tombstones(
    scope_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,
    home_device_id TEXT NOT NULL,home_epoch INTEGER NOT NULL,
    deleted_at INTEGER NOT NULL,reason TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lm_scope_context_settings(
    scope_id TEXT PRIMARY KEY REFERENCES lm_scopes(scope_id),
    account_id TEXT NOT NULL,full_context_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(full_context_opt_in IN (0,1)),
    updated_at INTEGER NOT NULL
  );`);
}
const scopeRow=(db,{accountId,scopeId})=>{
  if(!UUID.test(String(scopeId||'')))throw fail('memory_scope_id_invalid',400);
  const row=db.prepare('SELECT * FROM lm_scopes WHERE scope_id=? AND account_id=?').get(scopeId,accountId);
  if(!row)throw fail('gold_scope_not_found',404);
  return row;
};
function tablesWithScopeId(db){
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'lm_%'").all().map(x=>x.name);
  return new Set(tables.filter(t=>/^[a-z_][a-z0-9_]*$/.test(t)&&
    db.prepare('PRAGMA table_info('+t+')').all().some(c=>c.name==='scope_id')));
}
export function getMemoryScopeContextPreference(db,{accountId,scopeId}){
  ensureMemoryScopeLifecycle(db);
  scopeRow(db,{accountId,scopeId});
  const x=db.prepare('SELECT full_context_opt_in AS enabled FROM lm_scope_context_settings WHERE scope_id=? AND account_id=?').get(scopeId,accountId);
  return {scopeId,fullContextOptIn:x?.enabled===1};
}
export function setMemoryScopeContextPreference(db,{accountId,scopeId,enabled}){
  if(typeof enabled!=='boolean')throw fail('memory_full_context_preference_invalid',400);
  ensureMemoryScopeLifecycle(db);
  const scope=scopeRow(db,{accountId,scopeId});
  if(scope.status!=='active')throw fail('memory_scope_not_active');
  db.prepare(`INSERT INTO lm_scope_context_settings(scope_id,account_id,full_context_opt_in,updated_at)
    VALUES(?,?,?,?) ON CONFLICT(scope_id) DO UPDATE SET
    full_context_opt_in=excluded.full_context_opt_in,updated_at=excluded.updated_at`)
    .run(scopeId,accountId,Number(enabled),Date.now());
  return {scopeId,fullContextOptIn:enabled};
}
export function memoryScopeArchive(db,{accountId,scopeId,ownerConfirmed=false}={}){
  if(!ownerConfirmed)throw fail('memory_scope_owner_confirmation_required',403);
  const scope=scopeRow(db,{accountId,scopeId});
  if(scope.status!=='active')throw fail('memory_scope_not_active');
  db.prepare("UPDATE lm_scopes SET status='archived',updated_at=? WHERE scope_id=? AND account_id=? AND status='active'")
    .run(Date.now(),scopeId,accountId);
  return {scopeId,status:'archived',localOnly:true,retainsSignedHistory:true};
}
export function memoryScopeRestore(db,{accountId,scopeId,ownerConfirmed=false}={}){
  if(!ownerConfirmed)throw fail('memory_scope_owner_confirmation_required',403);
  ensureMemoryScopeLifecycle(db);
  const scope=scopeRow(db,{accountId,scopeId});
  if(db.prepare('SELECT 1 FROM lm_scope_local_tombstones WHERE scope_id=?').get(scopeId))
    throw fail('memory_scope_deleted_cannot_restore',409);
  if(scope.status!=='archived')throw fail('memory_scope_not_archived',409);
  db.prepare("UPDATE lm_scopes SET status='active',updated_at=? WHERE scope_id=? AND account_id=?")
    .run(Date.now(),scopeId,accountId);
  return {scopeId,status:'active',preservedSignedHistory:true};
}
export function memoryScopeLocalDelete(db,{accountId,scopeId,confirmName,ownerConfirmed=false}={}){
  if(!ownerConfirmed)throw fail('memory_scope_owner_confirmation_required',403);
  ensureMemoryScopeLifecycle(db);
  const scope=scopeRow(db,{accountId,scopeId});
  if(String(confirmName)!==scope.display_name)throw fail('memory_scope_delete_name_mismatch',400);
  const previous=db.prepare('SELECT * FROM lm_scope_local_tombstones WHERE scope_id=?').get(scopeId);
  if(previous)throw fail('memory_scope_already_deleted',409);
  const tableSet=tablesWithScopeId(db);
  // Explicit dependency order for checkpoint references and peer/event subrecords.
  const order=['lm_evidence_manual_release','lm_event_batches','lm_events',
    'lm_evidence_inbox','lm_evidence_outbox','lm_peer_seen_nonce','lm_peer_routes',
    'lm_sync_outbox','lm_sync_inbox','lm_replica_ack','lm_sync_recipient_keys',
    'lm_scope_members','lm_work_bindings','lm_scope_context_settings','lm_checkpoint_v2'];
  const count=db.prepare('SELECT count(*) AS n FROM lm_checkpoint_v2 WHERE scope_id=?').get(scopeId).n;
  const bytes=db.prepare('SELECT coalesce(sum(length(cast(body AS blob))),0) AS n FROM lm_checkpoint_v2 WHERE scope_id=?')
    .get(scopeId).n;
  db.exec('PRAGMA secure_delete=ON');
  db.exec('BEGIN IMMEDIATE');
  try{
    // Tombstone is committed atomically with deletion, retained independently of checkpoint data.
    db.prepare(`INSERT INTO lm_scope_local_tombstones(scope_id,account_id,home_device_id,home_epoch,deleted_at,reason)
      VALUES(?,?,?,?,?,?)`).run(scopeId,accountId,scope.home_device_id,scope.home_epoch,Date.now(),'owner_delete_local');
    db.prepare("UPDATE lm_scopes SET status='archived',display_name='[locally deleted]',sync_policy='local_only',updated_at=? WHERE scope_id=? AND account_id=?")
      .run(Date.now(),scopeId,accountId);
    for(const table of order){
      if(tableSet.has(table))db.prepare('DELETE FROM '+table+' WHERE scope_id=?').run(scopeId);
    }
    // V1 mapping is a foreign-key reference to the scope; it must not retain an invalid association.
    db.prepare('UPDATE lm_legacy_map SET scope_id=NULL WHERE scope_id=?').run(scopeId);
    db.prepare('UPDATE lm_heads SET revision=0,head_hash=?,updated_at=? WHERE scope_id=?')
      .run(ZERO,Date.now(),scopeId);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  let walCompacted=false;
  try{const checkpoint=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();walCompacted=checkpoint?.busy===0;}
  catch{}
  return {scopeId,status:'deleted_locally',checkpointsDeleted:count,checkpointBodyBytesDeleted:bytes,
    tombstoneRetained:true,walCompacted,otherDevicesUntouched:true,backupsUntouched:true,
    note:'Deletion affects SQLite live records only; old backups, snapshots and exported copies remain.'};
}
export function saveOwnerFullContext(db,keyFile,{accountId,deviceId,scopeId,text,title='Owner-provided full context',source='owner_paste',confirmed=false}={}){
  if(confirmed!==true)throw fail('memory_full_context_explicit_opt_in_required',403);
  const consent=getMemoryScopeContextPreference(db,{accountId,scopeId});
  if(!consent.fullContextOptIn)throw fail('memory_full_context_scope_opt_in_disabled',403);
  const scope=scopeRow(db,{accountId,scopeId});
  if(scope.status!=='active'||scope.home_device_id!==deviceId)
    throw fail('memory_full_context_home_only',403);
  if(typeof text!=='string'||!text.trim())throw fail('memory_full_context_text_required',400);
  const bytes=Buffer.byteLength(text,'utf8');
  if(bytes>512*1024)throw fail('memory_full_context_snapshot_exceeds_512kib',413);
  if(!['owner_paste','owner_file'].includes(source))throw fail('memory_full_context_untrusted_source',400);
  if(typeof title!=='string'||!title.trim()||title.length>140)throw fail('memory_full_context_title_invalid',400);
  const captureId=crypto.randomUUID(),hash=crypto.createHash('sha256').update(text,'utf8').digest('hex');
  // Unicode-safe splitting; every part signed by the authoritative Home.
  const codepoints=Array.from(text),parts=[],batchChars=5000;
  for(let start=0;start<codepoints.length;start+=batchChars)
    parts.push(codepoints.slice(start,start+batchChars).join(''));
  if(parts.length>128)throw fail('memory_full_context_too_many_parts',413);
  const results=[],src='owner-full-context:'+captureId;
  db.exec('BEGIN IMMEDIATE');
  try{
    for(let i=0;i<parts.length;i++){
      results.push(appendGoldScopedCheckpoint(db,keyFile,{
        accountId,deviceId,scopeId,title:title.trim()+' · part '+(i+1)+'/'+parts.length,
        body:parts[i],source:src,status:'owner_approved',kind:'checkpoint',
        evidence:['owner_full_context_opt_in','part:'+String(i+1),'sha256:'+hash]
      },{transactionManaged:true}));
    }
    results.push(appendGoldScopedCheckpoint(db,keyFile,{
      accountId,deviceId,scopeId,title:title.trim()+' · complete',
      body:'Owner-authorized complete-context snapshot. Capture ID: '+captureId+
        '\nParts: '+parts.length+'\nUTF-8 bytes: '+bytes+'\nSHA-256: '+hash+
        '\nSource: '+source+'\nDo not claim to have captured hidden ChatGPT transcript.',
      source:src,status:'owner_approved',kind:'handoff',evidence:['owner_full_context_opt_in','sha256:'+hash]
    },{transactionManaged:true}));
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return {scopeId,captureId,parts:parts.length,bytes,sha256:hash,
    lastRevision:results[results.length-1].revision,integrity:'home_ed25519_signed'};
}
export function readOwnerFullContext(db,{accountId,scopeId}={}){
  const exportData=goldScopedExport(db,{accountId,scopeId});
  const checkpoints=exportData.checkpoints||[];
  const completed=checkpoints.filter(c=>c.kind==='handoff'&&
    /^owner-full-context:[0-9a-f-]+$/.test(c.source||''));
  if(!completed.length)return {scopeId,available:false,reason:'no_owner_provided_full_context'};
  const manifest=completed.at(-1),parts=checkpoints.filter(c=>c.source===manifest.source&&c.kind==='checkpoint');
  const m=/Capture ID: ([a-f0-9-]+)\nParts: (\d+)\nUTF-8 bytes: (\d+)\nSHA-256: ([0-9a-f]{64})/.exec(manifest.body||'');
  if(!m||parts.length!==Number(m[2]))throw fail('memory_full_context_parts_missing',409);
  const body=parts.map(x=>x.body).join('');
  const bytes=Buffer.byteLength(body,'utf8'),sha=crypto.createHash('sha256').update(body,'utf8').digest('hex');
  if(bytes!==Number(m[3])||sha!==m[4])throw fail('memory_full_context_hash_mismatch',409);
  return {scopeId,available:true,title:manifest.title,text:body,bytes,sha256:sha,
    parts:parts.length,checkpointRevision:manifest.revision,integrity:'full_context_verified'};
}
export function memoryScopeAccountDeleteGate(){
  // Do not emit any success token until signed tombstone propagation + offline ACK exists.
  throw fail('memory_scope_account_delete_requires_signed_tombstone_offline_delivery_and_acks',501);
}
export function memoryLocalUsage(db,{accountId,filePath}={}){
  ensureMemoryScopeLifecycle(db);
  const scopeRows=db.prepare(`SELECT s.scope_id AS scopeId,s.display_name AS displayName,
    s.capture_mode AS captureMode,s.home_device_id AS homeDeviceId,s.status,
    count(c.checkpoint_id) AS checkpoints,
    coalesce(sum(length(cast(c.body AS blob))),0) AS checkpointBodyBytes
    FROM lm_scopes s LEFT JOIN lm_checkpoint_v2 c ON c.scope_id=s.scope_id
    WHERE s.account_id=? GROUP BY s.scope_id ORDER BY s.updated_at DESC`).all(accountId);
  const scoped=db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all().map(r=>r.name);
  const tableSet=new Set(scoped);
  let lastConfirmedSyncAt=null;
  for(const table of ['lm_replica_ack','lm_sync_inbox']){
    if(!tableSet.has(table))continue;
    const field=table==='lm_replica_ack'?'received_at':'received_at';
    const q=db.prepare(`SELECT max(x.${field}) AS stamp FROM ${table} x JOIN lm_scopes s ON s.scope_id=x.scope_id WHERE s.account_id=?`).get(accountId);
    if(Number.isSafeInteger(q?.stamp)&&(!lastConfirmedSyncAt||q.stamp>lastConfirmedSyncAt))
      lastConfirmedSyncAt=q.stamp;
  }
  const lastByScope={};
  if(tableSet.has('lm_replica_ack')){
    for(const row of db.prepare(`SELECT a.scope_id AS id,max(a.received_at) AS stamp
      FROM lm_replica_ack a JOIN lm_scopes s ON s.scope_id=a.scope_id
      WHERE s.account_id=? GROUP BY a.scope_id`).all(accountId))lastByScope[row.id]=row.stamp;
  }
  if(tableSet.has('lm_sync_inbox')){
    for(const row of db.prepare(`SELECT a.scope_id AS id,max(a.received_at) AS stamp
      FROM lm_sync_inbox a JOIN lm_scopes s ON s.scope_id=a.scope_id
      WHERE s.account_id=? GROUP BY a.scope_id`).all(accountId))
      lastByScope[row.id]=Math.max(lastByScope[row.id]||0,row.stamp);
  }
  const deviceSync=tableSet.has('lm_replica_ack')?
    db.prepare(`SELECT a.device_id AS deviceId,max(a.received_at) AS lastAckAt,
        sum(CASE WHEN a.revision>0 THEN 1 ELSE 0 END) AS acknowledgedScopes
      FROM lm_replica_ack a JOIN lm_scopes s ON s.scope_id=a.scope_id
      WHERE s.account_id=? GROUP BY a.device_id`).all(accountId):[];
  const pageCount=db.prepare('PRAGMA page_count').get().page_count,
    pageSize=db.prepare('PRAGMA page_size').get().page_size,
    freePages=db.prepare('PRAGMA freelist_count').get().freelist_count;
  const totalBytes=pageCount*pageSize;
  const localFileBytes=typeof filePath==='string'&&filePath?
    [filePath,filePath+'-wal',filePath+'-shm'].reduce((sum,p)=>{
      try{return sum+fs.statSync(p).size;}catch{return sum;}
    },0):null;
  return {scope:'device_local',accountId,lastConfirmedSyncAt,deviceSync,localFileBytes,
    localDatabaseBytes:totalBytes,localDatabaseLiveBytes:(pageCount-freePages)*pageSize,
    checkpointBodyBytes:scopeRows.reduce((sum,row)=>sum+row.checkpointBodyBytes,0),
    // These are local DB measurements, not total remote account storage.
    scopes:scopeRows.map(row=>({...row,lastConfirmedSyncAt:lastByScope[row.scopeId]||null,
      tombstoned:db.prepare('SELECT 1 FROM lm_scope_local_tombstones WHERE scope_id=?').get(row.scopeId)!=null})),
    note:'Sync timestamp means ACK received at Home or verified frame received at Replica; never merely the last sync request.'};
}
