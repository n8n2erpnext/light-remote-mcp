/*
 * Light Remote Gold G3: peer-authorized, device-local checkpoint replication.
 *
 * This module only creates/consumes E2EE frames and signed receipts on devices.
 * The no-storage network transport is NOT implemented in this module.
 * Each device owns independent SQLite; never copy a live SQLite database.
 */
import crypto from 'node:crypto';
import {requireGoldMemoryPrivateKey} from './gold-memory-key-permissions.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {prepareGoldMemoryV2,verifyGoldHomeSignedRecord} from './gold-memory-scope.mjs';

const PROTOCOL='light-remote-memory-sync-v1';
const MAX_FRAME=48000, MAX_BODY=18000;
const ZERO='0'.repeat(64);
const ready=new WeakSet();
function fail(code,status=400){return Object.assign(new Error(code),{status});}
function clean(s,max,code){
  if(typeof s!=='string'||!s.trim()||s.length>max)throw fail(code);
  return s.trim();
}
function publicKey(base64,type){
  if(typeof base64!=='string'||base64.length>1800)throw fail('gold_sync_public_key_invalid');
  let key;try{key=crypto.createPublicKey({key:Buffer.from(base64,'base64'),format:'der',type:'spki'});}
  catch{throw fail('gold_sync_public_key_invalid');}
  if(key.asymmetricKeyType!==type)throw fail('gold_sync_key_type_invalid');
  return key;
}
function publicString(key){const pub=key.type==='public'?key:crypto.createPublicKey(key);return pub.export({format:'der',type:'spki'}).toString('base64');}
function sha(s){return crypto.createHash('sha256').update(s).digest('hex');}
function writePrivate(file,kind){
  if(!fs.existsSync(file)){
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    const {privateKey}=crypto.generateKeyPairSync(kind);
    try{fs.writeFileSync(file,privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});}
    catch(e){if(e.code!=='EEXIST')throw e;}
  }
  requireGoldMemoryPrivateKey(file,'gold_sync_private_key_permissions');
  let privateKey;
  try{privateKey=crypto.createPrivateKey(fs.readFileSync(file));}
  catch{throw fail('gold_sync_private_key_invalid',503);}
  if(privateKey.asymmetricKeyType!==kind)throw fail('gold_sync_private_key_type_invalid',503);
  return privateKey;
}
function identity(signFile,encFile,create=false){
  if(!create&&(!fs.existsSync(signFile)||!fs.existsSync(encFile)))
    throw fail('gold_sync_identity_uninitialized',503);
  const signer=writePrivate(signFile,'ed25519'),encryptor=writePrivate(encFile,'x25519');
  const signPublicKey=publicString(signer),encPublicKey=publicString(encryptor);
  return {signer,encryptor,signPublicKey,encPublicKey,
    fingerprint:sha(signPublicKey+'\n'+encPublicKey).slice(0,32)};
}
function sign(signer,value){return crypto.sign(null,Buffer.from(JSON.stringify(value)),signer).toString('base64');}
function verify(pub,value,sig){
  return typeof sig==='string'&&sig.length<300&&crypto.verify(
    null,Buffer.from(JSON.stringify(value)),publicKey(pub,'ed25519'),Buffer.from(sig,'base64'));
}
function scoped(db,accountId,scopeId){
  const s=db.prepare('SELECT * FROM lm_scopes WHERE account_id=? AND scope_id=? AND status=?')
    .get(clean(accountId,160,'gold_sync_account_required'),clean(scopeId,70,'gold_sync_scope_required'),'active');
  if(!s)throw fail('gold_sync_scope_not_found',404);
  return s;
}
export function prepareGoldMemorySync(db){
  if(ready.has(db))return;
  prepareGoldMemoryV2(db);
  db.exec(`CREATE TABLE IF NOT EXISTS lm_scope_members (
    scope_id TEXT NOT NULL REFERENCES lm_scopes(scope_id),device_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('home','replica')),
    grant_id TEXT NOT NULL,grant_epoch INTEGER NOT NULL,
    sign_public_key TEXT NOT NULL,enc_public_key TEXT NOT NULL,
    revoked_at INTEGER NULL,created_at INTEGER NOT NULL,
    PRIMARY KEY(scope_id,device_id),UNIQUE(grant_id)
  );
  CREATE TABLE IF NOT EXISTS lm_sync_recipient_keys (
    scope_id TEXT PRIMARY KEY REFERENCES lm_scopes(scope_id),
    grant_id TEXT NOT NULL,sign_public_key TEXT NOT NULL,enc_public_key TEXT NOT NULL,
    accepted_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lm_sync_outbox (
    scope_id TEXT NOT NULL REFERENCES lm_scopes(scope_id),device_id TEXT NOT NULL,
    home_epoch INTEGER NOT NULL,revision INTEGER NOT NULL,checkpoint_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,frame_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','acked')),
    created_at INTEGER NOT NULL,acked_at INTEGER NULL,
    PRIMARY KEY(scope_id,device_id,home_epoch,revision)
  );
  CREATE INDEX IF NOT EXISTS lm_sync_outbox_queue
    ON lm_sync_outbox(device_id,state,scope_id,revision);
  CREATE TABLE IF NOT EXISTS lm_sync_inbox (
    scope_id TEXT NOT NULL REFERENCES lm_scopes(scope_id),
    home_epoch INTEGER NOT NULL,revision INTEGER NOT NULL,
    checkpoint_id TEXT NOT NULL,content_hash TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY(scope_id,home_epoch,revision)
  );
  CREATE TABLE IF NOT EXISTS lm_replica_ack (
    scope_id TEXT NOT NULL REFERENCES lm_scopes(scope_id),device_id TEXT NOT NULL,
    home_epoch INTEGER NOT NULL,revision INTEGER NOT NULL,head_hash TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY(scope_id,device_id)
  );`);
  ready.add(db);
}
export function goldSyncIdentity(signFile,encFile,{deviceId,accountId}={}){
  const who={deviceId:clean(deviceId,160,'gold_sync_device_invalid'),
    accountId:clean(accountId,160,'gold_sync_account_required')};
  const id=identity(signFile,encFile,true);
  return {...who,signPublicKey:id.signPublicKey,encPublicKey:id.encPublicKey,
    fingerprint:id.fingerprint};
}
export function goldGrantReplica(db,signFile,encFile,{accountId,deviceId,scopeId,peer,
 expectedFingerprint,ownerConfirmed=false}={}){
  prepareGoldMemorySync(db);
  if(!ownerConfirmed)throw fail('gold_sync_owner_confirmation_required',403);
  const s=scoped(db,accountId,scopeId);
  if(s.home_device_id!==deviceId)throw fail('gold_sync_only_home_grants',403);
  if(s.sync_policy==='local_only')throw fail('gold_sync_local_only_policy',409);
  if(!peer||peer.accountId!==accountId||peer.deviceId===deviceId)
    throw fail('gold_sync_peer_account_or_device_invalid',403);
  const peerId=clean(peer.deviceId,160,'gold_sync_peer_device_invalid');
  publicKey(peer.signPublicKey,'ed25519');
  publicKey(peer.encPublicKey,'x25519');
  const fp=sha(peer.signPublicKey+'\n'+peer.encPublicKey).slice(0,32);
  if(expectedFingerprint!==fp)throw fail('gold_sync_peer_fingerprint_unconfirmed',403);
  const self=identity(signFile,encFile);
  if(self.signPublicKey!==s.home_public_key)throw fail('gold_sync_home_identity_mismatch',409);
  const before=db.prepare('SELECT * FROM lm_scope_members WHERE scope_id=? AND device_id=?')
    .get(scopeId,peerId);
  if(before&&!before.revoked_at){
    if(before.sign_public_key!==peer.signPublicKey||before.enc_public_key!==peer.encPublicKey)
      throw fail('gold_sync_peer_key_rotation_requires_regrant',409);
    throw fail('gold_sync_peer_already_granted',409);
  }
  const grantId=crypto.randomUUID(),grantEpoch=before?before.grant_epoch+1:1,now=Date.now();
  const invite={protocol:PROTOCOL,scopeId,accountId,homeDeviceId:deviceId,
    toDeviceId:peerId,homeEpoch:s.home_epoch,grantEpoch,grantId,
    displayName:s.display_name,homeSignPublicKey:self.signPublicKey,
    homeEncPublicKey:self.encPublicKey,peerSignPublicKey:peer.signPublicKey,
    peerEncPublicKey:peer.encPublicKey,createdAt:now};
  const signature=sign(self.signer,invite);
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare(`INSERT INTO lm_scope_members(scope_id,device_id,role,grant_id,grant_epoch,
      sign_public_key,enc_public_key,revoked_at,created_at)
      VALUES(?,?,?,?,?,?,?,NULL,?)
      ON CONFLICT(scope_id,device_id) DO UPDATE SET role=excluded.role,grant_id=excluded.grant_id,
      grant_epoch=excluded.grant_epoch,sign_public_key=excluded.sign_public_key,
      enc_public_key=excluded.enc_public_key,revoked_at=NULL,created_at=excluded.created_at`)
      .run(scopeId,peerId,'replica',grantId,grantEpoch,peer.signPublicKey,peer.encPublicKey,now);
    if(before){
      // Re-enrollment may change the peer key or lose its entire local database.
      // Never replay a frame encrypted for the prior grant; begin reconciliation at r1.
      db.prepare('DELETE FROM lm_sync_outbox WHERE scope_id=? AND device_id=?').run(scopeId,peerId);
      db.prepare('DELETE FROM lm_replica_ack WHERE scope_id=? AND device_id=?').run(scopeId,peerId);
    }
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return {invite,signature};
}
export function goldAcceptReplicaInvite(db,signFile,encFile,{accountId,deviceId,package:pkg,
 expectedHomeFingerprint,ownerConfirmed=false}={}){
  prepareGoldMemorySync(db);
  if(!ownerConfirmed)throw fail('gold_sync_owner_confirmation_required',403);
  const invite=pkg?.invite;
  if(!invite||invite.protocol!==PROTOCOL||invite.accountId!==accountId||
     invite.toDeviceId!==deviceId||invite.homeDeviceId===deviceId)
    throw fail('gold_sync_invitation_invalid',403);
  const self=identity(signFile,encFile,true);
  if(invite.peerSignPublicKey!==self.signPublicKey||invite.peerEncPublicKey!==self.encPublicKey)
    throw fail('gold_sync_invitation_recipient_mismatch',403);
  const homeFp=sha(invite.homeSignPublicKey+'\n'+invite.homeEncPublicKey).slice(0,32);
  if(expectedHomeFingerprint!==homeFp)throw fail('gold_sync_home_fingerprint_unconfirmed',403);
  publicKey(invite.homeEncPublicKey,'x25519');
  if(!verify(invite.homeSignPublicKey,invite,pkg.signature))throw fail('gold_sync_invitation_signature_invalid',403);
  if(!Number.isSafeInteger(invite.homeEpoch)||invite.homeEpoch<1||
     !Number.isSafeInteger(invite.grantEpoch)||invite.grantEpoch<1)
    throw fail('gold_sync_invitation_epoch_invalid',403);
  const prior=db.prepare('SELECT * FROM lm_scopes WHERE scope_id=?').get(invite.scopeId);
  if(prior&&(prior.account_id!==accountId||prior.home_device_id!==invite.homeDeviceId||
    prior.home_epoch!==invite.homeEpoch||prior.home_public_key!==invite.homeSignPublicKey))
    throw fail('gold_sync_scope_authority_conflict',409);
  const member=db.prepare('SELECT * FROM lm_scope_members WHERE scope_id=? AND device_id=?')
    .get(invite.scopeId,invite.homeDeviceId);
  if(member&&(member.grant_epoch>invite.grantEpoch||member.revoked_at||
    (member.grant_epoch===invite.grantEpoch&&member.grant_id!==invite.grantId)))
    throw fail('gold_sync_stale_or_revoked_invitation',409);
  const now=Date.now();
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!prior){
      db.prepare(`INSERT INTO lm_scopes(scope_id,account_id,display_name,home_device_id,home_epoch,
        capture_mode,sync_policy,home_public_key,status,created_at,updated_at)
        VALUES(?,?,?,?,?,'manual','selected_devices',?,'active',?,?)`)
        .run(invite.scopeId,accountId,clean(invite.displayName,240,'gold_sync_scope_name_invalid'),
          invite.homeDeviceId,invite.homeEpoch,invite.homeSignPublicKey,now,now);
      db.prepare('INSERT INTO lm_heads(scope_id,home_epoch,revision,head_hash,updated_at) VALUES(?,?,?,?,?)')
        .run(invite.scopeId,invite.homeEpoch,0,ZERO,now);
    }
    db.prepare(`INSERT INTO lm_scope_members(scope_id,device_id,role,grant_id,grant_epoch,
      sign_public_key,enc_public_key,revoked_at,created_at)
      VALUES(?,?,?,?,?,?,?,NULL,?)
      ON CONFLICT(scope_id,device_id) DO UPDATE SET grant_id=excluded.grant_id,
        grant_epoch=excluded.grant_epoch,sign_public_key=excluded.sign_public_key,
        enc_public_key=excluded.enc_public_key,created_at=excluded.created_at`)
       .run(invite.scopeId,invite.homeDeviceId,'home',invite.grantId,invite.grantEpoch,
         invite.homeSignPublicKey,invite.homeEncPublicKey,now);
    db.prepare(`INSERT INTO lm_sync_recipient_keys(scope_id,grant_id,sign_public_key,enc_public_key,accepted_at)
      VALUES(?,?,?,?,?) ON CONFLICT(scope_id) DO UPDATE SET grant_id=excluded.grant_id,
        sign_public_key=excluded.sign_public_key,enc_public_key=excluded.enc_public_key,
        accepted_at=excluded.accepted_at`)
      .run(invite.scopeId,invite.grantId,self.signPublicKey,self.encPublicKey,now);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return {scopeId:invite.scopeId,homeDeviceId:invite.homeDeviceId,
    homeEpoch:invite.homeEpoch,grantId:invite.grantId,revision:prior?
      db.prepare('SELECT revision FROM lm_heads WHERE scope_id=?').get(invite.scopeId).revision:0,
    status:'replica_authorized'};
}

function recordFromRow(row){
  const evidence=JSON.parse(row.evidence_json);
  if(!Array.isArray(evidence))throw fail('gold_sync_evidence_corrupt',409);
  return {checkpointId:row.checkpoint_id,scopeId:row.scope_id,homeEpoch:row.home_epoch,
    revision:row.revision,prevHash:row.prev_hash,kind:row.kind,title:row.title,
    body:row.body,source:row.source,status:row.status,evidence,
    committedAt:row.committed_at,contentHash:row.content_hash,
    homeSignature:row.home_signature};
}
function grantRow(db,scopeId,deviceId,role){
  const grant=db.prepare(`SELECT * FROM lm_scope_members
    WHERE scope_id=? AND device_id=? AND role=? AND revoked_at IS NULL`)
    .get(scopeId,deviceId,role);
  if(!grant)throw fail('gold_sync_scope_member_not_authorized',403);
  return grant;
}
function metaForFrame({scopeId,accountId,homeDeviceId,toDeviceId,homeEpoch,revision,checkpointId,grantId,contentHash}){
  return {protocol:PROTOCOL,scopeId,accountId,homeDeviceId,toDeviceId,homeEpoch,revision,
    checkpointId,grantId,contentHash};
}
function seal(recipientPub,meta,payload,signer){
  const {privateKey,publicKey}=crypto.generateKeyPairSync('x25519');
  const nonce=crypto.randomBytes(12),salt=crypto.randomBytes(16);
  const shared=crypto.diffieHellman({privateKey,publicKey:publicKeyFor(recipientPub)});
  const key=Buffer.from(crypto.hkdfSync('sha256',shared,salt,Buffer.from('gold-lm-g3/1'),32));
  const encrypted=crypto.createCipheriv('aes-256-gcm',key,nonce);
  encrypted.setAAD(Buffer.from(JSON.stringify(meta)));
  const ciphertext=Buffer.concat([encrypted.update(Buffer.from(JSON.stringify(payload))),encrypted.final()]);
  const frame={meta,ephPublicKey:publicString(publicKey),salt:salt.toString('base64'),
    nonce:nonce.toString('base64'),tag:encrypted.getAuthTag().toString('base64'),
    ciphertext:ciphertext.toString('base64')};
  return {...frame,signature:sign(signer,frame)};
}
function publicKeyFor(pub){return publicKey(pub,'x25519');}
function openEnvelope(frame,receiverKey,homeSigning){
  if(!frame?.meta||frame.meta.protocol!==PROTOCOL)throw fail('gold_sync_frame_protocol_invalid');
  const {signature,...unsigned}=frame;
  if(!verify(homeSigning,unsigned,signature))throw fail('gold_sync_frame_signature_invalid',403);
  const eph=publicKey(frame.ephPublicKey,'x25519');
  const salt=Buffer.from(frame.salt||'','base64'),nonce=Buffer.from(frame.nonce||'','base64');
  const tag=Buffer.from(frame.tag||'','base64'),encrypted=Buffer.from(frame.ciphertext||'','base64');
  if(salt.length!==16||nonce.length!==12||tag.length!==16||encrypted.length>MAX_FRAME)
    throw fail('gold_sync_frame_crypto_invalid');
  const shared=crypto.diffieHellman({privateKey:receiverKey,publicKey:eph});
  const key=Buffer.from(crypto.hkdfSync('sha256',shared,salt,Buffer.from('gold-lm-g3/1'),32));
  try{
    const d=crypto.createDecipheriv('aes-256-gcm',key,nonce);
    d.setAAD(Buffer.from(JSON.stringify(frame.meta)));d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(encrypted),d.final()]).toString('utf8'));
  }catch{throw fail('gold_sync_frame_decrypt_failed',403);}
}
function checkPayload(item,meta,homePub){
  if(!item||item.scopeId!==meta.scopeId||item.homeEpoch!==meta.homeEpoch||
    item.revision!==meta.revision||item.checkpointId!==meta.checkpointId||
    item.contentHash!==meta.contentHash)
    throw fail('gold_sync_payload_mismatch',409);
  if(typeof item.body!=='string'||item.body.length>12000||
    typeof item.title!=='string'||item.title.length>240||
    !Array.isArray(item.evidence)||item.evidence.length>24)
    throw fail('gold_sync_payload_oversize',413);
  verifyGoldHomeSignedRecord(homePub,item);
}
function signedReceipt({scopeId,accountId,homeDeviceId,deviceId,homeEpoch,revision,checkpointId,contentHash,grantId},signer){
  const receipt={protocol:PROTOCOL,scopeId,accountId,homeDeviceId,deviceId,
    homeEpoch,revision,checkpointId,contentHash,grantId};
  return {...receipt,signature:sign(signer,receipt)};
}
export function goldNextSyncFrame(db,signFile,encFile,{accountId,deviceId,scopeId,replicaDeviceId}={}){
  prepareGoldMemorySync(db);
  const scope=scoped(db,accountId,scopeId);
  if(scope.home_device_id!==deviceId)throw fail('gold_sync_only_home_can_send',403);
  if(scope.sync_policy==='local_only')throw fail('gold_sync_local_only_policy',409);
  const member=grantRow(db,scopeId,clean(replicaDeviceId,160,'gold_sync_peer_device_invalid'),'replica');
  const i=identity(signFile,encFile);
  if(i.signPublicKey!==scope.home_public_key)throw fail('gold_sync_home_key_mismatch',409);
  const ack=db.prepare('SELECT * FROM lm_replica_ack WHERE scope_id=? AND device_id=?')
    .get(scopeId,replicaDeviceId);
  const next=(ack?.revision||0)+1;
  const head=db.prepare('SELECT revision,home_epoch FROM lm_heads WHERE scope_id=?').get(scopeId);
  if(head.home_epoch!==scope.home_epoch)throw fail('gold_sync_home_epoch_conflict',409);
  if(next>head.revision)return {state:'up_to_date',scopeId,revision:head.revision};
  const cached=db.prepare(`SELECT frame_json FROM lm_sync_outbox WHERE scope_id=? AND device_id=?
    AND home_epoch=? AND revision=?`).get(scopeId,replicaDeviceId,scope.home_epoch,next);
  if(cached)return {state:'pending',frame:JSON.parse(cached.frame_json),reused:true};
  const row=db.prepare('SELECT * FROM lm_checkpoint_v2 WHERE scope_id=? AND home_epoch=? AND revision=?')
    .get(scopeId,scope.home_epoch,next);
  if(!row)throw fail('gold_sync_missing_home_revision',409);
  const item=recordFromRow(row);
  checkPayload(item,metaForFrame({scopeId,accountId,homeDeviceId:deviceId,
    toDeviceId:replicaDeviceId,homeEpoch:scope.home_epoch,revision:next,
    checkpointId:item.checkpointId,grantId:member.grant_id,contentHash:item.contentHash}),scope.home_public_key);
  const meta=metaForFrame({scopeId,accountId,homeDeviceId:deviceId,
    toDeviceId:replicaDeviceId,homeEpoch:scope.home_epoch,revision:next,
    checkpointId:item.checkpointId,grantId:member.grant_id,contentHash:item.contentHash});
  const frame=seal(member.enc_public_key,meta,item,i.signer);
  const json=JSON.stringify(frame);
  if(json.length>MAX_FRAME)throw fail('gold_sync_frame_too_large',413);
  const saved=db.prepare(`INSERT OR IGNORE INTO lm_sync_outbox(scope_id,device_id,home_epoch,revision,
    checkpoint_id,content_hash,frame_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(scopeId,replicaDeviceId,scope.home_epoch,next,item.checkpointId,item.contentHash,json,Date.now());
  if(!saved.changes){
    const existing=db.prepare(`SELECT frame_json FROM lm_sync_outbox
      WHERE scope_id=? AND device_id=? AND home_epoch=? AND revision=?`)
      .get(scopeId,replicaDeviceId,scope.home_epoch,next);
    return {state:'pending',frame:JSON.parse(existing.frame_json),reused:true};
  }
  return {state:'pending',frame,reused:false};
}
export function goldApplySyncFrame(db,signFile,encFile,{accountId,deviceId,frame}={}){
  prepareGoldMemorySync(db);
  if(!frame||JSON.stringify(frame).length>MAX_FRAME)throw fail('gold_sync_frame_too_large',413);
  const meta=frame.meta;
  if(!meta||meta.protocol!==PROTOCOL||meta.accountId!==accountId||meta.toDeviceId!==deviceId)
    throw fail('gold_sync_wrong_account_or_recipient',403);
  const scope=scoped(db,accountId,meta.scopeId);
  if(scope.home_device_id===deviceId||scope.home_device_id!==meta.homeDeviceId ||
    scope.home_epoch!==meta.homeEpoch)
    throw fail('gold_sync_wrong_home_or_epoch',403);
  const member=grantRow(db,scope.scope_id,scope.home_device_id,'home');
  if(member.grant_id!==meta.grantId)throw fail('gold_sync_grant_epoch_or_id_mismatch',403);
  const self=identity(signFile,encFile);
  const localPin=db.prepare('SELECT * FROM lm_sync_recipient_keys WHERE scope_id=?').get(scope.scope_id);
  if(!localPin||localPin.grant_id!==meta.grantId||
    localPin.sign_public_key!==self.signPublicKey||
    localPin.enc_public_key!==self.encPublicKey)
    throw fail('gold_sync_local_recipient_identity_mismatch',403);
  const item=openEnvelope(frame,self.encryptor,member.sign_public_key);
  checkPayload(item,meta,scope.home_public_key);
  const head=db.prepare('SELECT * FROM lm_heads WHERE scope_id=?').get(scope.scope_id);
  if(head.home_epoch!==meta.homeEpoch)throw fail('gold_sync_replica_epoch_mismatch',409);
  if(item.revision<=head.revision){
    const row=db.prepare(`SELECT checkpoint_id,content_hash FROM lm_checkpoint_v2
      WHERE scope_id=? AND home_epoch=? AND revision=?`)
      .get(scope.scope_id,scope.home_epoch,item.revision);
    if(!row||row.checkpoint_id!==item.checkpointId||row.content_hash!==item.contentHash)
      throw fail('gold_sync_replica_history_conflict',409);
    return {status:'duplicate',revision:item.revision,
      ack:signedReceipt({...meta,deviceId},self.signer)};
  }
  if(item.revision!==head.revision+1)throw fail('gold_sync_replica_gap',409);
  if(item.prevHash!==head.head_hash)throw fail('gold_sync_replica_hash_chain_conflict',409);
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare(`INSERT INTO lm_checkpoint_v2(checkpoint_id,scope_id,home_epoch,revision,prev_hash,
      content_hash,home_signature,kind,title,body,source,status,evidence_json,committed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(item.checkpointId,item.scopeId,item.homeEpoch,item.revision,item.prevHash,
        item.contentHash,item.homeSignature,item.kind,item.title,item.body,item.source,item.status,
        JSON.stringify(item.evidence),item.committedAt);
    const changed=db.prepare(`UPDATE lm_heads SET revision=?,head_hash=?,updated_at=?
      WHERE scope_id=? AND home_epoch=? AND revision=?`)
      .run(item.revision,item.contentHash,Date.now(),scope.scope_id,scope.home_epoch,head.revision);
    if(changed.changes!==1)throw fail('gold_sync_replica_head_conflict',409);
    db.prepare(`INSERT INTO lm_sync_inbox(scope_id,home_epoch,revision,checkpoint_id,content_hash,received_at)
      VALUES(?,?,?,?,?,?)`).run(scope.scope_id,scope.home_epoch,item.revision,
      item.checkpointId,item.contentHash,Date.now());
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return {status:'applied',scopeId:scope.scope_id,revision:item.revision,
    integrity:'home_ed25519_verified',ack:signedReceipt({...meta,deviceId},self.signer)};
}
export function goldApplySyncAck(db,{accountId,deviceId,receipt}={}){
  prepareGoldMemorySync(db);
  if(!receipt||receipt.protocol!==PROTOCOL||receipt.accountId!==accountId ||
    receipt.homeDeviceId!==deviceId)throw fail('gold_sync_ack_invalid',403);
  const scope=scoped(db,accountId,receipt.scopeId);
  if(scope.home_device_id!==deviceId||scope.home_epoch!==receipt.homeEpoch)
    throw fail('gold_sync_ack_wrong_home_epoch',409);
  const member=grantRow(db,scope.scope_id,receipt.deviceId,'replica');
  if(member.grant_id!==receipt.grantId)throw fail('gold_sync_ack_grant_invalid',403);
  const {signature,...unsigned}=receipt;
  if(!verify(member.sign_public_key,unsigned,signature))
    throw fail('gold_sync_ack_signature_invalid',403);
  const row=db.prepare(`SELECT * FROM lm_sync_outbox
    WHERE scope_id=? AND device_id=? AND home_epoch=? AND revision=?`)
    .get(scope.scope_id,receipt.deviceId,scope.home_epoch,receipt.revision);
  if(!row||row.checkpoint_id!==receipt.checkpointId||row.content_hash!==receipt.contentHash)
    throw fail('gold_sync_ack_record_mismatch',409);
  const previous=db.prepare('SELECT revision FROM lm_replica_ack WHERE scope_id=? AND device_id=?')
    .get(scope.scope_id,receipt.deviceId);
  if(previous&&receipt.revision<=previous.revision)
    return {status:'duplicate',scopeId:scope.scope_id,revision:previous.revision};
  if(receipt.revision!==(previous?.revision||0)+1)throw fail('gold_sync_ack_gap',409);
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare(`UPDATE lm_sync_outbox SET state='acked',acked_at=?
      WHERE scope_id=? AND device_id=? AND home_epoch=? AND revision=?`)
      .run(Date.now(),scope.scope_id,receipt.deviceId,scope.home_epoch,receipt.revision);
    db.prepare(`INSERT INTO lm_replica_ack(scope_id,device_id,home_epoch,revision,head_hash,received_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(scope_id,device_id) DO UPDATE SET home_epoch=excluded.home_epoch,
        revision=excluded.revision,head_hash=excluded.head_hash,received_at=excluded.received_at`)
      .run(scope.scope_id,receipt.deviceId,scope.home_epoch,receipt.revision,
        receipt.contentHash,Date.now());
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return {status:'acked',scopeId:scope.scope_id,revision:receipt.revision};
}
export function goldRevokeReplica(db,{accountId,deviceId,scopeId,replicaDeviceId,ownerConfirmed=false}={}){
  prepareGoldMemorySync(db);
  if(!ownerConfirmed)throw fail('gold_sync_owner_confirmation_required',403);
  const scope=scoped(db,accountId,scopeId);
  if(scope.home_device_id!==deviceId)throw fail('gold_sync_only_home_can_revoke',403);
  const replica=clean(replicaDeviceId,160,'gold_sync_peer_device_invalid');
  const peer=grantRow(db,scopeId,replica,'replica');
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('UPDATE lm_scope_members SET revoked_at=? WHERE scope_id=? AND device_id=?')
      .run(Date.now(),scopeId,replica);
    db.prepare(`DELETE FROM lm_sync_outbox WHERE scope_id=? AND device_id=?
      AND state='pending'`).run(scopeId,replica);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return {scopeId,deviceId:replica,grantId:peer.grant_id,status:'revoked',
    note:'Previously received decrypted data cannot be erased remotely'};
}
export function goldSyncStatus(db,{accountId,scopeId,deviceId}={}){
  prepareGoldMemorySync(db);
  const scope=scoped(db,accountId,scopeId);
  const head=db.prepare('SELECT revision,head_hash FROM lm_heads WHERE scope_id=?').get(scopeId);
  const peers=db.prepare(`SELECT m.device_id AS deviceId,m.role,m.revoked_at AS revokedAt,
    a.revision AS ackRevision FROM lm_scope_members m
    LEFT JOIN lm_replica_ack a ON a.scope_id=m.scope_id AND a.device_id=m.device_id
    WHERE m.scope_id=? ORDER BY m.device_id`).all(scopeId);
  return {scopeId,deviceId,isHome:scope.home_device_id===deviceId,homeDeviceId:scope.home_device_id,
    homeEpoch:scope.home_epoch,localRevision:head.revision,localHeadHash:head.head_hash,
    syncPolicy:scope.sync_policy,peers:peers.map(x=>({...x,
      behind:x.ackRevision===null?null:Math.max(0,head.revision-x.ackRevision)}))};
}
