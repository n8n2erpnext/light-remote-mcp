/*
 * Light Remote Gold Long Memory V2 — G1 scoped, append-only local ledger.
 * OFF-by-default via Gold module flags. No sync/Auto claims in G1.
 * V1 gold_checkpoints and its HMAC bytes remain untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {requireGoldMemoryPrivateKey} from './gold-memory-key-permissions.mjs';

function problem(code,status=400){return Object.assign(new Error(code),{status});}
function required(s,max,code){
  if(typeof s!=='string'||!s.trim()||s.length>max)throw problem(code);
  return s.trim();
}
function uuid(x){return typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);}
function validId(x,field){if(!uuid(x))throw problem('gold_scope_'+field+'_invalid');return x.toLowerCase();}
const CAPTURE=new Set(['auto','follow_project','manual']);
const SYNC=new Set(['local_only','selected_devices','authorized_devices']);
const KINDS=new Set(['checkpoint','decision','handoff']);
const STATES=new Set(['observed','claimed','test_passed','owner_approved','blocked']);
const BINDINGS=new Set(['workspace','repository','job','task','work_context']);
const ZERO='0'.repeat(64);
const preparedDB=new WeakSet();
function digest(t){return crypto.createHash('sha256').update(t).digest('hex');}
function wire(x){return JSON.stringify({
  checkpointId:x.checkpointId,scopeId:x.scopeId,homeEpoch:x.homeEpoch,
  revision:x.revision,prevHash:x.prevHash,kind:x.kind,title:x.title,
  body:x.body,source:x.source,status:x.status,evidence:x.evidence,committedAt:x.committedAt
});}
function signingKeys(filename,create=false){
  if(!fs.existsSync(filename)){
    if(!create)throw problem('gold_scope_device_signing_key_missing',503);
    fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
    const {privateKey}=crypto.generateKeyPairSync('ed25519');
    try{fs.writeFileSync(filename,privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});}
    catch(e){if(e.code!=='EEXIST')throw e;}
  }
  requireGoldMemoryPrivateKey(filename,'gold_scope_device_signing_key_permissions');
  const privateKey=crypto.createPrivateKey(fs.readFileSync(filename));
  if(privateKey.asymmetricKeyType!=='ed25519')throw problem('gold_scope_device_signing_key_invalid',503);
  const publicKey=crypto.createPublicKey(privateKey);
  return {privateKey,publicKey,publicDer:publicKey.export({format:'der',type:'spki'}).toString('base64')};
}
function checkEvidence(v){
  if(v===undefined)return [];
  if(!Array.isArray(v)||v.length>24||v.some(x=>typeof x!=='string'||!x||x.length>300))
    throw problem('gold_scope_evidence_invalid');
  return v;
}
export function prepareGoldMemoryV2(db){
  if(preparedDB.has(db))return;
  db.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS lm_scopes (
    scope_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, display_name TEXT NOT NULL,
    home_device_id TEXT NOT NULL, home_epoch INTEGER NOT NULL DEFAULT 1 CHECK(home_epoch>0),
    capture_mode TEXT NOT NULL CHECK(capture_mode IN ('auto','follow_project','manual')),
    sync_policy TEXT NOT NULL CHECK(sync_policy IN ('local_only','selected_devices','authorized_devices')),
    home_public_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS lm_scope_account ON lm_scopes(account_id,status,updated_at);
  CREATE TABLE IF NOT EXISTS lm_work_bindings (
    binding_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES lm_scopes(scope_id),
    account_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
    proof_type TEXT NOT NULL, accepted_at INTEGER NOT NULL,
    UNIQUE(account_id,source_type,source_id)
  );
  CREATE INDEX IF NOT EXISTS lm_work_scope ON lm_work_bindings(scope_id);
  CREATE TABLE IF NOT EXISTS lm_checkpoint_v2 (
    checkpoint_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES lm_scopes(scope_id),
    home_epoch INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
    prev_hash TEXT NOT NULL, content_hash TEXT NOT NULL, home_signature TEXT NOT NULL,
    kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, source TEXT NOT NULL,
    status TEXT NOT NULL, evidence_json TEXT NOT NULL, committed_at INTEGER NOT NULL,
    UNIQUE(scope_id,home_epoch,revision)
  );
  CREATE INDEX IF NOT EXISTS lm_cp_scope_head ON lm_checkpoint_v2(scope_id,home_epoch,revision DESC);
  CREATE TABLE IF NOT EXISTS lm_heads (
    scope_id TEXT PRIMARY KEY REFERENCES lm_scopes(scope_id),
    home_epoch INTEGER NOT NULL, revision INTEGER NOT NULL, head_hash TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lm_legacy_map (
    old_checkpoint_id TEXT PRIMARY KEY, scope_id TEXT NULL REFERENCES lm_scopes(scope_id),
    assigned_by TEXT NULL, assigned_at INTEGER NULL
  );
  CREATE TABLE IF NOT EXISTS lm_quarantine (
    id TEXT PRIMARY KEY, reason TEXT NOT NULL, source_type TEXT NOT NULL,
    source_ref TEXT NOT NULL, created_at INTEGER NOT NULL
  );`);
  // Existing V1 records are NOT auto-assigned to a scope; an unused V1 ledger may not exist yet.
  if(db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='gold_checkpoints'").get()){
    db.exec(`INSERT OR IGNORE INTO lm_legacy_map(old_checkpoint_id)
      SELECT id FROM gold_checkpoints WHERE 1=1;`);
  }
  preparedDB.add(db);
}
function ownScope(db,{scopeId,accountId}){
  const id=validId(scopeId,'id');
  const scope=db.prepare('SELECT * FROM lm_scopes WHERE scope_id=? AND account_id=?')
    .get(id,required(accountId,160,'gold_scope_account_invalid'));
  if(!scope)throw problem('gold_scope_not_found',404);
  return scope;
}
export function createGoldScope(db,keyFile,{accountId,homeDeviceId,displayName,captureMode='manual',syncPolicy='local_only'}={}){
  const account=required(accountId,160,'gold_scope_account_invalid');
  const device=required(homeDeviceId,160,'gold_scope_device_invalid');
  const name=required(displayName,240,'gold_scope_name_invalid');
  if(!CAPTURE.has(captureMode)||!SYNC.has(syncPolicy))throw problem('gold_scope_policy_invalid');
  prepareGoldMemoryV2(db);
  const keys=signingKeys(keyFile,true),scopeId=crypto.randomUUID(),now=Date.now();
  db.prepare(`INSERT INTO lm_scopes(scope_id,account_id,display_name,home_device_id,
    capture_mode,sync_policy,home_public_key,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(scopeId,account,name,device,captureMode,syncPolicy,keys.publicDer,now,now);
  db.prepare('INSERT INTO lm_heads(scope_id,home_epoch,revision,head_hash,updated_at) VALUES(?,?,?,?,?)')
    .run(scopeId,1,0,ZERO,now);
  return {scopeId,displayName:name,homeDeviceId:device,homeEpoch:1,captureMode,syncPolicy,revision:0};
}
export function listGoldScopes(db,{accountId}={}){
  prepareGoldMemoryV2(db);
  return db.prepare(`SELECT s.scope_id AS scopeId,s.display_name AS displayName,
  s.home_device_id AS homeDeviceId,s.home_epoch AS homeEpoch,
  s.capture_mode AS captureMode,s.sync_policy AS syncPolicy,
  h.revision AS revision,h.head_hash AS headHash
  FROM lm_scopes s JOIN lm_heads h ON h.scope_id=s.scope_id
  WHERE s.account_id=? AND s.status='active'
  ORDER BY s.updated_at DESC,s.scope_id LIMIT 100`)
    .all(required(accountId,160,'gold_scope_account_invalid'));
}
export function changeGoldScopeSyncPolicy(db,{accountId,deviceId,scopeId,syncPolicy}={}){
  prepareGoldMemoryV2(db);
  if(!SYNC.has(syncPolicy))throw problem('gold_scope_sync_policy_invalid');
  const s=ownScope(db,{accountId,scopeId});
  if(s.status!=='active'||s.home_device_id!==deviceId)
    throw problem('gold_scope_home_policy_only',403);
  db.prepare('UPDATE lm_scopes SET sync_policy=?,updated_at=? WHERE scope_id=? AND account_id=?')
    .run(syncPolicy,Date.now(),s.scope_id,accountId);
  return {scopeId:s.scope_id,syncPolicy};
}
export function changeGoldScopeCapture(db,{accountId,scopeId,captureMode}={}){
  prepareGoldMemoryV2(db);
  if(!CAPTURE.has(captureMode))throw problem('gold_scope_capture_mode_invalid');
  const scope=ownScope(db,{accountId,scopeId});
  if(scope.status!=='active')throw problem('gold_scope_archived',409);
  db.prepare('UPDATE lm_scopes SET capture_mode=?,updated_at=? WHERE scope_id=? AND account_id=?')
    .run(captureMode,Date.now(),scope.scope_id,accountId);
  return {scopeId:scope.scope_id,captureMode};
}
export function bindGoldScope(db,{accountId,scopeId,sourceType,sourceId,proofType}={}){
  prepareGoldMemoryV2(db);
  ownScope(db,{scopeId,accountId});
  if(!BINDINGS.has(sourceType))throw problem('gold_scope_binding_type_invalid');
  const ref=required(sourceId,1024,'gold_scope_binding_ref_invalid');
  const proof=required(proofType,120,'gold_scope_binding_proof_required');
  if(!['owner_explicit','verified_parent','owner_workspace_mapping'].includes(proof))
    throw problem('gold_scope_binding_proof_untrusted');
  // Conflicting bindings must fail closed; NEVER reassociate to another scope silently.
  const prior=db.prepare('SELECT scope_id FROM lm_work_bindings WHERE account_id=? AND source_type=? AND source_id=?')
    .get(accountId,sourceType,ref);
  if(prior){
    if(prior.scope_id!==scopeId)throw problem('gold_scope_binding_conflict',409);
    return {scopeId,sourceType,sourceId:ref,alreadyBound:true};
  }
  const bindingId=crypto.randomUUID();
  db.prepare('INSERT INTO lm_work_bindings(binding_id,scope_id,account_id,source_type,source_id,proof_type,accepted_at) VALUES(?,?,?,?,?,?,?)')
    .run(bindingId,scopeId,accountId,sourceType,ref,proof,Date.now());
  return {bindingId,scopeId,sourceType,sourceId:ref,alreadyBound:false};
}
export function resolveGoldScope(db,{accountId,sourceType,sourceId}={}){
  prepareGoldMemoryV2(db);
  if(!BINDINGS.has(sourceType))throw problem('gold_scope_binding_type_invalid');
  const a=required(accountId,160,'gold_scope_account_invalid');
  const id=required(sourceId,1024,'gold_scope_binding_ref_invalid');
  const row=db.prepare(`SELECT b.scope_id AS scopeId FROM lm_work_bindings b
    JOIN lm_scopes s ON s.scope_id=b.scope_id
    WHERE b.account_id=? AND b.source_type=? AND b.source_id=? AND s.account_id=? AND s.status='active'`)
    .get(a,sourceType,id,a);
  return row||{scopeId:null,unassigned:true};
}
export function appendGoldScopedCheckpoint(db,keyFile,{accountId,deviceId,scopeId,kind='checkpoint',title,body,source,status='observed',evidence}={},internalOptions={}){
  const transactionManaged=internalOptions?.transactionManaged===true;
  prepareGoldMemoryV2(db);
  const s=ownScope(db,{scopeId,accountId});
  if(s.status!=='active')throw problem('gold_scope_archived',409);
  if(s.home_device_id!==required(deviceId,160,'gold_scope_device_invalid'))
    throw problem('gold_scope_home_only',403);
  if(!KINDS.has(kind)||!STATES.has(status))throw problem('gold_scope_checkpoint_type_invalid');
  const heading=required(title,240,'gold_scope_checkpoint_title_invalid');
  const text=required(body,12000,'gold_scope_checkpoint_body_invalid');
  const origin=required(source,512,'gold_scope_checkpoint_source_invalid');
  const proof=checkEvidence(evidence);
  const keys=signingKeys(keyFile);
  if(keys.publicDer!==s.home_public_key)throw problem('gold_scope_home_public_key_mismatch',409);
  if(!transactionManaged)db.exec('BEGIN IMMEDIATE');
  try{
    const head=db.prepare('SELECT * FROM lm_heads WHERE scope_id=?').get(s.scope_id);
    if(!head||head.home_epoch!==s.home_epoch)throw problem('gold_scope_epoch_conflict',409);
    const item={checkpointId:crypto.randomUUID(),scopeId:s.scope_id,homeEpoch:s.home_epoch,
      revision:head.revision+1,prevHash:head.head_hash,kind,title:heading,body:text,
      source:origin,status,evidence:proof,committedAt:Date.now()};
    const contentHash=digest('gold-lm-v2\n'+wire(item));
    const signature=crypto.sign(null,Buffer.from('gold-lm-v2-sig\n'+contentHash),keys.privateKey).toString('base64');
    db.prepare(`INSERT INTO lm_checkpoint_v2(checkpoint_id,scope_id,home_epoch,revision,
      prev_hash,content_hash,home_signature,kind,title,body,source,status,evidence_json,committed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(item.checkpointId,item.scopeId,item.homeEpoch,item.revision,
       item.prevHash,contentHash,signature,item.kind,item.title,item.body,item.source,item.status,
       JSON.stringify(proof),item.committedAt);
    const changed=db.prepare('UPDATE lm_heads SET revision=?,head_hash=?,updated_at=? WHERE scope_id=? AND home_epoch=? AND revision=?')
       .run(item.revision,contentHash,item.committedAt,item.scopeId,item.homeEpoch,head.revision);
    if(changed.changes!==1)throw problem('gold_scope_head_cas_conflict',409);
    if(!transactionManaged)db.exec('COMMIT');
    return {checkpointId:item.checkpointId,scopeId:item.scopeId,homeEpoch:item.homeEpoch,
      revision:item.revision,contentHash,integrity:'home_ed25519_signed'};
  }catch(e){if(!transactionManaged)db.exec('ROLLBACK');throw e;}
}
// Used by G3 replicas: original Home signature is verified, never re-signed by peers.
export function verifyGoldHomeSignedRecord(homePublicKey,item){
  const expected=digest('gold-lm-v2\n'+wire(item));
  if(expected!==item.contentHash)throw problem('gold_scope_checkpoint_hash_invalid',409);
  const key=crypto.createPublicKey({key:Buffer.from(homePublicKey,'base64'),format:'der',type:'spki'});
  if(key.asymmetricKeyType!=='ed25519')throw problem('gold_scope_checkpoint_signer_invalid',409);
  if(!crypto.verify(null,Buffer.from('gold-lm-v2-sig\n'+expected),key,Buffer.from(item.homeSignature||'','base64')))
    throw problem('gold_scope_checkpoint_signature_invalid',409);
  return {integrity:'home_ed25519_verified',contentHash:expected};
}
function verified(db,scope,row){
  if(!row)throw problem('gold_scope_checkpoint_not_found',404);
  let evidence;
  try{evidence=JSON.parse(row.evidence_json);}catch{throw problem('gold_scope_checkpoint_evidence_corrupt',409);}
  const item={checkpointId:row.checkpoint_id,scopeId:row.scope_id,
    homeEpoch:row.home_epoch,revision:row.revision,prevHash:row.prev_hash,
    kind:row.kind,title:row.title,body:row.body,source:row.source,
    status:row.status,evidence,committedAt:row.committed_at};
  const expected=digest('gold-lm-v2\n'+wire(item));
  if(expected!==row.content_hash)throw problem('gold_scope_checkpoint_hash_invalid',409);
  const key=crypto.createPublicKey({key:Buffer.from(scope.home_public_key,'base64'),format:'der',type:'spki'});
  if(!crypto.verify(null,Buffer.from('gold-lm-v2-sig\n'+expected),key,Buffer.from(row.home_signature,'base64')))
    throw problem('gold_scope_checkpoint_signature_invalid',409);
  return {...item,contentHash:expected,integrity:'home_ed25519_verified'};
}
export function readGoldScopedCheckpoint(db,{accountId,scopeId,checkpointId}={}){
  prepareGoldMemoryV2(db);
  const scope=ownScope(db,{scopeId,accountId});
  const id=validId(checkpointId,'checkpoint_id');
  return verified(db,scope,db.prepare('SELECT * FROM lm_checkpoint_v2 WHERE scope_id=? AND checkpoint_id=?')
    .get(scope.scope_id,id));
}
export function goldScopedHandoff(db,{accountId,scopeId,limit=5}={}){
  prepareGoldMemoryV2(db);
  const scope=ownScope(db,{scopeId,accountId});
  if(!Number.isInteger(limit)||limit<1||limit>20)throw problem('gold_scope_limit_invalid');
  const head=db.prepare('SELECT home_epoch AS homeEpoch,revision,head_hash AS headHash FROM lm_heads WHERE scope_id=?')
    .get(scope.scope_id);
  const rows=db.prepare(`SELECT * FROM lm_checkpoint_v2 WHERE scope_id=? AND home_epoch=?
    ORDER BY revision DESC LIMIT ?`).all(scope.scope_id,head.homeEpoch,limit);
  if(head.revision>0 && !rows.length)throw problem('gold_scope_head_integrity_failed',409);
  if(rows[0] && (rows[0].revision!==head.revision || rows[0].content_hash!==head.headHash))
    throw problem('gold_scope_head_integrity_failed',409);
  const checkpoints=rows.map(row=>verified(db,scope,row));
  for(let i=1;i<checkpoints.length;i++){
    if(checkpoints[i-1].revision!==checkpoints[i].revision+1 ||
      checkpoints[i-1].prevHash!==checkpoints[i].contentHash)
      throw problem('gold_scope_checkpoint_chain_invalid',409);
  }
  return {scopeId:scope.scope_id,displayName:scope.display_name,homeDeviceId:scope.home_device_id,
    homeEpoch:head.homeEpoch,revision:head.revision,headHash:head.headHash,
    checkpoints,source:'device_local_scoped_home',stale:false};
}
export function goldLegacyUnassignedCount(db){
  prepareGoldMemoryV2(db);
  const old=db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='gold_checkpoints'").get();
  if(!old)return 0;
  return db.prepare(`SELECT count(*) AS n FROM gold_checkpoints g
    LEFT JOIN lm_legacy_map l ON l.old_checkpoint_id=g.id
    WHERE l.scope_id IS NULL`).get().n;
}
