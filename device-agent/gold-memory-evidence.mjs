/*
 * Gold G3 Replica -> Home typed evidence contribution (E2EE, local durable).
 * Replica signs a typed event, Home verifies, atomically turns it into a
 * Home-signed checkpoint. Operator transports only volatile ciphertext.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import {requireGoldMemoryPrivateKey} from './gold-memory-key-permissions.mjs';
import {prepareGoldMemorySync} from './gold-memory-sync.mjs';
import {appendGoldScopedCheckpoint} from './gold-memory-scope.mjs';

const PROTOCOL='light-remote-memory-evidence-v1';
const TYPES=new Set(['test_receipt','fs_change','task_state_changed','operator_receipt','manual_note']);
const ENCRYPT_INFO=Buffer.from('gold-lm-evidence-g3/1');
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const ready=new WeakSet();
const fault=(code,status=400)=>Object.assign(new Error(code),{status});
function checked(value,max,code){
  if(typeof value!=='string'||!value.trim()||value.length>max)throw fault(code);
  return value.trim();
}
function key(file,type){
  requireGoldMemoryPrivateKey(file,'gold_evidence_private_key_permissions');
  const result=crypto.createPrivateKey(fs.readFileSync(file));
  if(result.asymmetricKeyType!==type)throw fault('gold_evidence_private_key_invalid',503);
  return result;
}
function pub(value,type){
  if(typeof value!=='string'||value.length>1800)throw fault('gold_evidence_public_key_invalid',403);
  try{
    const p=crypto.createPublicKey({key:Buffer.from(value,'base64'),format:'der',type:'spki'});
    if(p.asymmetricKeyType===type)return p;
  }catch{}
  throw fault('gold_evidence_public_key_invalid',403);
}
const publicString=k=>crypto.createPublicKey(k).export({format:'der',type:'spki'}).toString('base64');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const sign=(key,value)=>crypto.sign(null,Buffer.from('gold-evidence-v1\n'+JSON.stringify(value)),key).toString('base64');
const verify=(key,value,sig)=>typeof sig==='string'&&sig.length<300&&crypto.verify(
  null,Buffer.from('gold-evidence-v1\n'+JSON.stringify(value)),pub(key,'ed25519'),Buffer.from(sig,'base64'));
function prepare(db){
  if(ready.has(db))return;
  prepareGoldMemorySync(db);
  db.exec(`CREATE TABLE IF NOT EXISTS lm_evidence_outbox (
    event_id TEXT PRIMARY KEY,scope_id TEXT NOT NULL REFERENCES lm_scopes(scope_id),
    home_device_id TEXT NOT NULL,home_epoch INTEGER NOT NULL,grant_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,frame_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','acked')),
    created_at INTEGER NOT NULL,acked_at INTEGER NULL
  );
  CREATE INDEX IF NOT EXISTS lm_evidence_pending ON lm_evidence_outbox(state,scope_id,created_at);
  CREATE TABLE IF NOT EXISTS lm_evidence_inbox (
    event_id TEXT PRIMARY KEY,scope_id TEXT NOT NULL REFERENCES lm_scopes(scope_id),
    from_device_id TEXT NOT NULL,home_epoch INTEGER NOT NULL,grant_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,checkpoint_id TEXT NOT NULL,
    home_revision INTEGER NOT NULL,checkpoint_hash TEXT NOT NULL,received_at INTEGER NOT NULL
  );`);
  ready.add(db);
}
function scope(db,accountId,scopeId){
  const row=db.prepare("SELECT * FROM lm_scopes WHERE account_id=? AND scope_id=? AND status='active'")
    .get(checked(accountId,160,'gold_evidence_account_required'),
      checked(scopeId,90,'gold_evidence_scope_required'));
  if(!row)throw fault('gold_evidence_scope_missing',404);
  return row;
}
function member(db,scopeId,deviceId,role){
  const row=db.prepare("SELECT * FROM lm_scope_members WHERE scope_id=? AND device_id=? AND role=? AND revoked_at IS NULL")
    .get(scopeId,deviceId,role);
  if(!row)throw fault('gold_evidence_membership_denied',403);
  return row;
}
function validatePayload(p){
  if(!p||!TYPES.has(p.eventType)||typeof p.title!=='string'||p.title.length>240||!p.title.trim()
    ||typeof p.body!=='string'||p.body.length>12000||!p.body.trim()
    ||typeof p.source!=='string'||p.source.length>450||!p.source.trim()
    ||!Array.isArray(p.evidence)||p.evidence.length>20||
      p.evidence.some(x=>typeof x!=='string'||x.length>250||!x.trim()))
    throw fault('gold_evidence_payload_invalid',400);
  return p;
}
function seal(homeEnc,meta,payload,signer){
  const eph=crypto.generateKeyPairSync('x25519'),salt=crypto.randomBytes(16),nonce=crypto.randomBytes(12);
  const shared=crypto.diffieHellman({privateKey:eph.privateKey,publicKey:pub(homeEnc,'x25519')});
  const derived=Buffer.from(crypto.hkdfSync('sha256',shared,salt,ENCRYPT_INFO,32));
  const cipher=crypto.createCipheriv('aes-256-gcm',derived,nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(meta)));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  const frame={meta,ephPublicKey:publicString(eph.privateKey),salt:salt.toString('base64'),
    nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
    ciphertext:ciphertext.toString('base64')};
  return {...frame,signature:sign(signer,frame)};
}
function open(frame,homeDecrypt,replicaSign){
  const {signature,...unsigned}=frame;
  if(!verify(replicaSign,unsigned,signature))throw fault('gold_evidence_signature_invalid',403);
  const salt=Buffer.from(frame.salt||'','base64'),nonce=Buffer.from(frame.nonce||'','base64'),
    tag=Buffer.from(frame.tag||'','base64'),ciphertext=Buffer.from(frame.ciphertext||'','base64');
  if(salt.length!==16||nonce.length!==12||tag.length!==16||ciphertext.length>20000)
    throw fault('gold_evidence_cipher_invalid',403);
  const shared=crypto.diffieHellman({privateKey:homeDecrypt,publicKey:pub(frame.ephPublicKey,'x25519')});
  const derived=Buffer.from(crypto.hkdfSync('sha256',shared,salt,ENCRYPT_INFO,32));
  try{
    const d=crypto.createDecipheriv('aes-256-gcm',derived,nonce);
    d.setAAD(Buffer.from(JSON.stringify(frame.meta)));d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(ciphertext),d.final()]).toString('utf8'));
  }catch{throw fault('gold_evidence_decrypt_denied',403);}
}
function ack(meta,row,signer){
  const receipt={protocol:PROTOCOL,accountId:meta.accountId,scopeId:meta.scopeId,
    homeDeviceId:meta.homeDeviceId,deviceId:meta.deviceId,eventId:meta.eventId,
    homeEpoch:meta.homeEpoch,grantId:meta.grantId,payloadHash:meta.payloadHash,
    checkpointId:row.checkpoint_id,checkpointHash:row.checkpoint_hash,
    homeRevision:row.home_revision};
  return {...receipt,signature:sign(signer,receipt)};
}
export function queueGoldReplicaEvidence(db,signFile,encFile,
  {accountId,deviceId,scopeId,eventType,title,body,source,evidence=[],eventRef=null}={}){
  prepare(db);
  const s=scope(db,accountId,scopeId);
  if(s.home_device_id===deviceId)throw fault('gold_evidence_replica_only',403);
  const home=member(db,scopeId,s.home_device_id,'home');
  const pin=db.prepare('SELECT * FROM lm_sync_recipient_keys WHERE scope_id=?').get(scopeId);
  const signer=key(signFile,'ed25519');
  const identity=publicString(signer);
  const encryptor=key(encFile,'x25519');
  if(!pin||pin.grant_id!==home.grant_id||pin.sign_public_key!==identity||
    pin.enc_public_key!==publicString(encryptor))throw fault('gold_evidence_recipient_pin_mismatch',403);
  const payload=validatePayload({eventType,title,body,source,evidence});
  // An attested Agent command ID is a stable local idempotency reference.
  // Retries must never generate a second checkpoint for the same observed act.
  const ref=eventRef===null?null:checked(eventRef,240,'gold_evidence_event_ref_invalid');
  const hex=ref?sha('gold-evidence-event-id\\n'+accountId+'\\n'+deviceId+'\\n'+scopeId+
    '\\n'+eventType+'\\n'+ref):null;
  const eventId=hex?hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+
    '-a'+hex.slice(17,20)+'-'+hex.slice(20,32):crypto.randomUUID();
  const payloadHash=sha(JSON.stringify(payload));
  const previous=db.prepare('SELECT scope_id,payload_hash,state FROM lm_evidence_outbox WHERE event_id=?').get(eventId);
  if(previous){
    if(previous.scope_id!==scopeId||previous.payload_hash!==payloadHash)
      throw fault('gold_evidence_event_ref_conflict',409);
    return {eventId,scopeId,homeDeviceId:s.home_device_id,state:previous.state,duplicate:true};
  }
  const meta={protocol:PROTOCOL,accountId,scopeId,homeDeviceId:s.home_device_id,
    deviceId,homeEpoch:s.home_epoch,grantId:home.grant_id,eventId,payloadHash};
  const frame=seal(home.enc_public_key,meta,payload,signer);
  const json=JSON.stringify(frame);
  if(json.length>39000)throw fault('gold_evidence_frame_too_large',413);
  db.prepare(`INSERT INTO lm_evidence_outbox(event_id,scope_id,home_device_id,
    home_epoch,grant_id,payload_hash,frame_json,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(eventId,scopeId,s.home_device_id,
      s.home_epoch,home.grant_id,payloadHash,json,Date.now());
  return {eventId,scopeId,homeDeviceId:s.home_device_id,state:'pending'};
}
export function pendingGoldReplicaEvidence(db,{accountId,deviceId,limit=4}={}){
  prepare(db);checked(accountId,160,'gold_evidence_account_required');
  const count=Math.min(Math.max(Number(limit)||4,1),8);
  return db.prepare(`SELECT o.frame_json FROM lm_evidence_outbox o
    JOIN lm_scopes s ON s.scope_id=o.scope_id
    JOIN lm_scope_members h ON h.scope_id=o.scope_id AND h.device_id=o.home_device_id
    WHERE s.account_id=? AND s.home_device_id<>? AND o.state='pending'
      AND s.status='active' AND h.role='home' AND h.revoked_at IS NULL
      AND o.grant_id=h.grant_id AND o.home_epoch=s.home_epoch
    ORDER BY o.created_at,o.event_id LIMIT ?`).all(accountId,deviceId,count).map(x=>JSON.parse(x.frame_json));
}
export function acceptGoldReplicaEvidence(db,signFile,encFile,{accountId,deviceId,frame}={}){
  prepare(db);
  if(!frame||JSON.stringify(frame).length>39000||!frame.meta)
    throw fault('gold_evidence_envelope_invalid',403);
  const meta=frame.meta;
  if(meta.protocol!==PROTOCOL||meta.accountId!==accountId||
     meta.homeDeviceId!==deviceId||!uuid.test(meta.eventId||'')||
     !/^[0-9a-f]{64}$/.test(meta.payloadHash||''))
    throw fault('gold_evidence_address_invalid',403);
  const s=scope(db,accountId,meta.scopeId);
  if(s.home_device_id!==deviceId||s.home_epoch!==meta.homeEpoch)
    throw fault('gold_evidence_home_epoch_denied',403);
  const replica=member(db,s.scope_id,meta.deviceId,'replica');
  if(replica.grant_id!==meta.grantId)throw fault('gold_evidence_grant_invalid',403);
  const signer=key(signFile,'ed25519');
  if(publicString(signer)!==s.home_public_key)throw fault('gold_evidence_home_signer_invalid',403);
  const {signature,...unsigned}=frame;
  if(!verify(replica.sign_public_key,unsigned,signature))
    throw fault('gold_evidence_signature_invalid',403);
  const previous=db.prepare('SELECT * FROM lm_evidence_inbox WHERE event_id=?').get(meta.eventId);
  if(previous){
    if(previous.scope_id!==s.scope_id||previous.from_device_id!==meta.deviceId||
       previous.grant_id!==meta.grantId||previous.payload_hash!==meta.payloadHash||
       previous.home_epoch!==meta.homeEpoch)throw fault('gold_evidence_replay_conflict',409);
    return {status:'duplicate',ack:ack(meta,previous,signer)};
  }
  const payload=validatePayload(open(frame,key(encFile,'x25519'),replica.sign_public_key));
  if(sha(JSON.stringify(payload))!==meta.payloadHash)throw fault('gold_evidence_hash_invalid',403);
  db.exec('BEGIN IMMEDIATE');
  try{
    const seen=db.prepare('SELECT * FROM lm_evidence_inbox WHERE event_id=?').get(meta.eventId);
    if(seen){db.exec('ROLLBACK');return {status:'duplicate',ack:ack(meta,seen,signer)};}
    const result=appendGoldScopedCheckpoint(db,signFile,{accountId,deviceId,
      scopeId:s.scope_id,kind:'checkpoint',title:payload.title,
      body:payload.body,source:('replica:'+meta.deviceId+':'+payload.source).slice(0,512),
      status:'claimed',evidence:[...payload.evidence.slice(0,19),
        'replica-proof:'+meta.deviceId+':'+meta.eventId]}, {transactionManaged:true});
    const row={checkpoint_id:result.checkpointId,checkpoint_hash:result.contentHash,
      home_revision:result.revision};
    db.prepare(`INSERT INTO lm_evidence_inbox(event_id,scope_id,from_device_id,
      home_epoch,grant_id,payload_hash,checkpoint_id,home_revision,checkpoint_hash,received_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(meta.eventId,meta.scopeId,meta.deviceId,
      meta.homeEpoch,meta.grantId,meta.payloadHash,result.checkpointId,result.revision,
      result.contentHash,Date.now());
    db.exec('COMMIT');
    return {status:'committed',scopeId:s.scope_id,revision:result.revision,
      integrity:'home_ed25519_signed',ack:ack(meta,row,signer)};
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function applyGoldReplicaEvidenceAck(db,{accountId,deviceId,receipt}={}){
  prepare(db);
  if(!receipt||receipt.protocol!==PROTOCOL||receipt.accountId!==accountId||
    receipt.deviceId!==deviceId||!uuid.test(receipt.eventId||''))
    throw fault('gold_evidence_ack_invalid',403);
  const s=scope(db,accountId,receipt.scopeId);
  if(s.home_device_id!==receipt.homeDeviceId||s.home_epoch!==receipt.homeEpoch)
    throw fault('gold_evidence_ack_authority_denied',403);
  const home=member(db,s.scope_id,s.home_device_id,'home');
  if(home.grant_id!==receipt.grantId)throw fault('gold_evidence_ack_grant_denied',403);
  const {signature,...unsigned}=receipt;
  if(!verify(s.home_public_key,unsigned,signature))throw fault('gold_evidence_ack_signature_invalid',403);
  const pending=db.prepare('SELECT * FROM lm_evidence_outbox WHERE event_id=?').get(receipt.eventId);
  if(!pending||pending.scope_id!==s.scope_id||pending.home_device_id!==receipt.homeDeviceId||
    pending.home_epoch!==receipt.homeEpoch||pending.grant_id!==receipt.grantId||
    pending.payload_hash!==receipt.payloadHash||
    !uuid.test(receipt.checkpointId||'')||
    !/^[0-9a-f]{64}$/.test(receipt.checkpointHash||'')||
    !Number.isSafeInteger(receipt.homeRevision)||receipt.homeRevision<1)
    throw fault('gold_evidence_ack_record_mismatch',409);
  if(pending.state==='acked')return {status:'duplicate',eventId:receipt.eventId};
  db.prepare("UPDATE lm_evidence_outbox SET state='acked',acked_at=? WHERE event_id=? AND state='pending'")
    .run(Date.now(),receipt.eventId);
  return {status:'acked',eventId:receipt.eventId,homeRevision:receipt.homeRevision,
    homeCheckpointId:receipt.checkpointId};
}
