/*
 * Gold local-first Memory selection. Device IDs are chosen by the owner from
 * the signed account directory; no IP, manual key exchange, or cloud payloads.
 * Preference belongs ONLY to the current enrolled (account,home device).
 */
import {prepareGoldMemorySync} from './gold-memory-sync.mjs';
const clean=(s)=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(s);
function fail(code,status=400){return Object.assign(new Error(code),{status});}
function setup(db){
  prepareGoldMemorySync(db);
  db.exec(`CREATE TABLE IF NOT EXISTS lm_sync_device_selection(
    account_id TEXT NOT NULL, home_device_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    receive_blocked INTEGER NOT NULL DEFAULT 0 CHECK(receive_blocked IN (0,1)),
    device_ids_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(account_id,home_device_id)
  )`);
}
export function goldDeviceSelection(db,{accountId,deviceId}={}){
  if(!clean(accountId)||!clean(deviceId))throw fail('gold_sync_selection_identity_invalid',403);
  setup(db);
  const r=db.prepare('SELECT * FROM lm_sync_device_selection WHERE account_id=? AND home_device_id=?')
    .get(accountId,deviceId);
  let selectedDeviceIds=[];
  if(r)try{selectedDeviceIds=JSON.parse(r.device_ids_json)}catch{throw fail('gold_sync_selection_corrupt',503);}
  if(!Array.isArray(selectedDeviceIds)||selectedDeviceIds.some(id=>!clean(id)))
    throw fail('gold_sync_selection_corrupt',503);
  return {enabled:r?.enabled===1,receiveBlocked:r?.receive_blocked===1,
    selectedDeviceIds,updatedAt:r?.updated_at||null};
}
export function goldSetDeviceSelection(db,{accountId,deviceId,enabled,selectedDeviceIds}={}){
  if(!clean(accountId)||!clean(deviceId))throw fail('gold_sync_selection_identity_invalid',403);
  if(typeof enabled!=='boolean'||!Array.isArray(selectedDeviceIds)||selectedDeviceIds.length>100||
    selectedDeviceIds.some(id=>!clean(id)||id===deviceId)||
    new Set(selectedDeviceIds).size!==selectedDeviceIds.length)
    throw fail('gold_sync_selection_invalid');
  setup(db);
  const previous=goldDeviceSelection(db,{accountId,deviceId});
  const selected=[...selectedDeviceIds].sort();
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare(`INSERT INTO lm_sync_device_selection
      (account_id,home_device_id,enabled,receive_blocked,device_ids_json,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,home_device_id) DO UPDATE SET
        enabled=excluded.enabled,receive_blocked=excluded.receive_blocked,
        device_ids_json=excluded.device_ids_json,updated_at=excluded.updated_at`)
      .run(accountId,deviceId,Number(enabled),Number(!enabled),JSON.stringify(selected),Date.now());
    // Sync control applies to ALL scopes Home owns on this device; never touch
    // replica scopes whose Home authority is another account device.
    db.prepare(`UPDATE lm_scopes SET sync_policy=?,updated_at=?
      WHERE account_id=? AND home_device_id=? AND status='active'`)
      .run(enabled?'selected_devices':'local_only',Date.now(),accountId,deviceId);
    if(!enabled||previous.selectedDeviceIds.some(id=>!selected.includes(id))){
      const affected=db.prepare(`SELECT scope_id,device_id FROM lm_scope_members
        WHERE role='replica' AND revoked_at IS NULL AND scope_id IN
        (SELECT scope_id FROM lm_scopes WHERE account_id=? AND home_device_id=?)`)
        .all(accountId,deviceId);
      for(const p of affected){
        if(enabled&&selected.includes(p.device_id))continue;
        db.prepare('UPDATE lm_scope_members SET revoked_at=? WHERE scope_id=? AND device_id=?')
          .run(Date.now(),p.scope_id,p.device_id);
        db.prepare("DELETE FROM lm_sync_outbox WHERE scope_id=? AND device_id=? AND state='pending'")
          .run(p.scope_id,p.device_id);
      }
    }
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return goldDeviceSelection(db,{accountId,deviceId});
}
