/* Durable Home-signed account-scoped memory erasure with offline device ACK. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import {requireGoldMemoryPrivateKey} from './gold-memory-key-permissions.mjs';
import {ensureMemoryScopeLifecycle,memoryScopeLocalDelete} from './gold-memory-scope-admin.mjs';
import {prepareGoldMemoryV2} from './gold-memory-scope.mjs';
const fail=(code,status=400)=>Object.assign(new Error(code),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROTOCOL='lr-memory-account-delete-v1';
export function checkAccountDeletionEnvelope(value){
  const record=value?.record;
  if(!record||record.protocol!==PROTOCOL||!uuid.test(record.scopeId||'')||
     typeof record.accountId!=='string'||record.accountId.length>160||
     typeof record.homeDeviceId!=='string'||record.homeDeviceId.length>160||
     !Number.isSafeInteger(record.homeEpoch)||record.homeEpoch<1||
     record.generation!==1||typeof record.scopeName!=='string'||!record.scopeName.trim()||record.scopeName.length>240||!Number.isSafeInteger(record.issuedAt)||record.issuedAt<=0||
     typeof value.homeSignPublicKey!=='string'||value.homeSignPublicKey.length>1800||
     typeof value.signature!=='string'||value.signature.length>300)
    throw fail('memory_account_delete_envelope_invalid');
  let key;
  try{
    key=crypto.createPublicKey({key:Buffer.from(value.homeSignPublicKey,'base64'),format:'der',type:'spki'});
    if(key.asymmetricKeyType!=='ed25519'||
       key.export({format:'der',type:'spki'}).toString('base64')!==value.homeSignPublicKey||
       !crypto.verify(null,Buffer.from(JSON.stringify(record)),key,Buffer.from(value.signature,'base64')))
      throw Error('bad signature');
  }catch{throw fail('memory_account_delete_home_signature_invalid',403);}
  return record;
}
export function signAccountScopeDelete(db,scopeKeyFile,{accountId,deviceId,scopeId,confirmName,ownerConfirmed}={}){
  if(ownerConfirmed!==true)throw fail('memory_account_delete_owner_confirmation_required',403);
  if(!uuid.test(scopeId||''))throw fail('memory_account_delete_scope_invalid',400);
  ensureMemoryScopeLifecycle(db);
  const scope=db.prepare('SELECT * FROM lm_scopes WHERE account_id=? AND scope_id=?')
    .get(accountId,scopeId);
  if(!scope)throw fail('gold_scope_not_found',404);
  if(scope.home_device_id!==deviceId)throw fail('memory_account_delete_authoritative_home_required',409);
  if(scope.display_name!==confirmName)throw fail('memory_account_delete_exact_name_required',403);
  if(db.prepare('SELECT 1 FROM lm_scope_local_tombstones WHERE scope_id=?').get(scopeId))
    throw fail('memory_account_delete_already_tombstoned',409);
  requireGoldMemoryPrivateKey(scopeKeyFile,'gold_scope_device_signing_key_permissions');
  const privateKey=crypto.createPrivateKey(fs.readFileSync(scopeKeyFile,'utf8'));
  const homeSignPublicKey=crypto.createPublicKey(privateKey).export({format:'der',type:'spki'}).toString('base64');
  if(scope.home_public_key!==homeSignPublicKey)throw fail('memory_account_delete_home_key_mismatch',409);
  const record={protocol:PROTOCOL,accountId,scopeId,homeDeviceId:deviceId,
    homeEpoch:scope.home_epoch,generation:1,scopeName:scope.display_name,issuedAt:Date.now()};
  const envelope={record,homeSignPublicKey,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(record)),privateKey).toString('base64')};
  checkAccountDeletionEnvelope(envelope);
  return envelope;
}
export function applyAccountScopeDelete(db,{accountId,deviceId,envelope}={}){
  const record=checkAccountDeletionEnvelope(envelope);
  if(record.accountId!==accountId)throw fail('memory_account_delete_account_mismatch',403);
  prepareGoldMemoryV2(db);
  ensureMemoryScopeLifecycle(db);
  const scope=db.prepare('SELECT * FROM lm_scopes WHERE account_id=? AND scope_id=?')
    .get(accountId,record.scopeId);
  if(scope&&(scope.home_device_id!==record.homeDeviceId||
     scope.home_epoch!==record.homeEpoch||scope.home_public_key!==envelope.homeSignPublicKey))
    throw fail('memory_account_delete_scope_authority_mismatch',403);
  db.exec('CREATE TABLE IF NOT EXISTS lm_account_delete_proofs (scope_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,home_device_id TEXT NOT NULL,home_epoch INTEGER NOT NULL,generation INTEGER NOT NULL,home_public_key TEXT NOT NULL,home_signature TEXT NOT NULL,issued_at INTEGER NOT NULL,applied_at INTEGER NOT NULL)');
  const priorProof=db.prepare('SELECT * FROM lm_account_delete_proofs WHERE scope_id=?').get(record.scopeId);
  if(priorProof){
    if(priorProof.account_id!==accountId||priorProof.home_signature!==envelope.signature)
      throw fail('memory_account_delete_conflicting_tombstone',409);
    return {scopeId:record.scopeId,alreadyApplied:true,deviceId};
  }
  const alreadyDeleted=db.prepare('SELECT 1 FROM lm_scope_local_tombstones WHERE scope_id=?').get(record.scopeId);
  if(scope&&!alreadyDeleted)memoryScopeLocalDelete(db,{accountId,scopeId:record.scopeId,confirmName:scope.display_name,ownerConfirmed:true});
  else if(!alreadyDeleted)db.prepare('INSERT INTO lm_scope_local_tombstones(scope_id,account_id,home_device_id,home_epoch,deleted_at,reason) VALUES(?,?,?,?,?,?)').run(record.scopeId,accountId,record.homeDeviceId,record.homeEpoch,Date.now(),'account_delete_signed');
  db.prepare('INSERT INTO lm_account_delete_proofs(scope_id,account_id,home_device_id,home_epoch,generation,home_public_key,home_signature,issued_at,applied_at) VALUES(?,?,?,?,?,?,?,?,?)').run(record.scopeId,accountId,record.homeDeviceId,record.homeEpoch,record.generation,envelope.homeSignPublicKey,envelope.signature,record.issuedAt,Date.now());
  return {scopeId:record.scopeId,deletedLocally:true,tombstoneRetained:true,deviceId,backupsUntouched:true};
}
