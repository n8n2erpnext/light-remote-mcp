/* Gold G3 durable per-device Manual evidence release. No cloud payload. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import {requireGoldMemoryPrivateKey} from './gold-memory-key-permissions.mjs';

export const MANUAL_EVIDENCE_PROTOCOL='light-remote-memory-manual-release-v1';
const fault=(code)=>Object.assign(new Error(code),{status:403});
function prepare(db){
  db.exec('CREATE TABLE IF NOT EXISTS lm_evidence_manual_release ('+
    'account_id TEXT NOT NULL,device_id TEXT NOT NULL,request_seq INTEGER NOT NULL,'+
    'through_rowid INTEGER NOT NULL,created_at INTEGER NOT NULL,'+
    'PRIMARY KEY(account_id,device_id,request_seq))');
}
function signer(file){
  requireGoldMemoryPrivateKey(file,'gold_evidence_private_key_permissions');
  const key=crypto.createPrivateKey(fs.readFileSync(file));
  if(key.asymmetricKeyType!=='ed25519')throw fault('gold_manual_signing_key_invalid');
  return key;
}
function signature(key,record){
  return crypto.sign(null,Buffer.from('gold-evidence-v1\n'+JSON.stringify(record)),key).toString('base64');
}
export function manualEvidenceCap(db,{accountId,deviceId,requestSeq}={}){
  if(typeof accountId!=='string'||!accountId||typeof deviceId!=='string'||!deviceId||
    !Number.isSafeInteger(requestSeq)||requestSeq<1||requestSeq%2===0)throw fault('gold_manual_request_invalid');
  prepare(db);
  db.prepare('INSERT OR IGNORE INTO lm_evidence_manual_release '+
    '(account_id,device_id,request_seq,through_rowid,created_at) VALUES(?,?,?,'+
    'COALESCE((SELECT MAX(rowid) FROM lm_evidence_outbox),0),?)')
    .run(accountId,deviceId,requestSeq,Date.now());
  return db.prepare('SELECT through_rowid FROM lm_evidence_manual_release '+
    'WHERE account_id=? AND device_id=? AND request_seq=?')
    .get(accountId,deviceId,requestSeq).through_rowid;
}
export function signManualEvidenceFrames(frames,signFile,{accountId,deviceId,requestSeq}={}){
  const key=signer(signFile);
  return frames.map(frame=>{
    const m=frame.meta;
    if(m.accountId!==accountId||m.deviceId!==deviceId)
      throw fault('gold_manual_frame_identity_invalid');
    const proof={protocol:MANUAL_EVIDENCE_PROTOCOL,accountId,deviceId,
      eventId:m.eventId,scopeId:m.scopeId,homeDeviceId:m.homeDeviceId,
      homeEpoch:m.homeEpoch,grantId:m.grantId,requestSeq};
    return {...frame,manualRelease:{...proof,signature:signature(key,proof)}};
  });
}
export function verifyManualEvidenceRelease(frame,replicaSigningKey,requestSeq){
  if(!Number.isSafeInteger(requestSeq)||requestSeq<1||requestSeq%2===0)throw fault('gold_manual_request_missing');
  const m=frame?.meta,r=frame?.manualRelease;
  if(!r||r.protocol!==MANUAL_EVIDENCE_PROTOCOL||r.requestSeq!==requestSeq||
    r.accountId!==m?.accountId||r.deviceId!==m?.deviceId||
    r.eventId!==m?.eventId||r.scopeId!==m?.scopeId||
    r.homeDeviceId!==m?.homeDeviceId||r.homeEpoch!==m?.homeEpoch||
    r.grantId!==m?.grantId)throw fault('gold_manual_release_mismatch');
  const {signature:proofSignature,...body}=r;
  try{
    if(typeof proofSignature!=='string'||proofSignature.length>300||
      !crypto.verify(null,Buffer.from('gold-evidence-v1\n'+JSON.stringify(body)),
        crypto.createPublicKey({key:Buffer.from(replicaSigningKey,'base64'),
          format:'der',type:'spki'}),Buffer.from(proofSignature,'base64')))
      throw fault('gold_manual_release_signature_invalid');
  }catch{throw fault('gold_manual_release_signature_invalid');}
  return true;
}
