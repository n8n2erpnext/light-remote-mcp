// Destructive Memory reset is device-local only. Account-wide erasure needs
// durable owner-signed tombstones and acknowledgment from every enrolled device.
const MEMORY_TABLES_IN_DEPENDENCY_ORDER=Object.freeze([
  'lm_evidence_manual_release','lm_evidence_outbox','lm_evidence_inbox',
  'lm_peer_seen_nonce','lm_peer_routes','lm_events','lm_event_batches',
  'lm_sync_outbox','lm_sync_inbox','lm_replica_ack','lm_sync_recipient_keys',
  'lm_scope_members','lm_work_bindings','lm_checkpoint_v2','lm_heads',
  'lm_legacy_map','lm_quarantine','lm_scopes',
  'lm_sync_device_selection','gold_checkpoints','owner_notes'
]);
const fault=(code,status=409)=>Object.assign(new Error(code),{status});
function existing(db){const rows=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  return new Set(rows.map(row=>row.name));}
export function localMemoryDeletePreview(db){
  const tables=existing(db),counts={};
  for(const t of MEMORY_TABLES_IN_DEPENDENCY_ORDER)
    if(tables.has(t))counts[t]=Number(db.prepare('SELECT count(*) AS n FROM '+t).get().n);
  return {scope:'device_local',totalRows:Object.values(counts).reduce((a,b)=>a+b,0),
    counts,accountWide:false,requiresSyncDisabled:true};
}
export function clearLocalMemory(db,{confirmed=false}={}){
  if(confirmed!==true)throw fault('memory_local_delete_confirmation_required',400);
  const preview=localMemoryDeletePreview(db);
  const tables=existing(db);
  db.exec('PRAGMA secure_delete=ON');
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const t of MEMORY_TABLES_IN_DEPENDENCY_ORDER){
      if(!tables.has(t))continue;
      if(t==='lm_sync_device_selection'){
        // Persist a local receiving fence after content is removed.
        db.exec("UPDATE lm_sync_device_selection SET enabled=0,receive_blocked=1,device_ids_json='[]',updated_at="+Date.now());
      }else db.prepare('DELETE FROM '+t).run();
    }
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  // Vacuum is deliberately outside the transaction; fail closed if compaction
  // cannot finish, so the UI does not falsely claim a completed secure wipe.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  return {...preview,deleted:true,localFence:true,
    note:'SQLite historical backups and previously exported copies are outside this local database.'};
}
export function accountMemoryDeleteUnavailable(){
  throw fault('memory_account_delete_requires_durable_tombstone_and_offline_device_ack',501);
}
