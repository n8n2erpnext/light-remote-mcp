import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ContinuityStore} from '../../device-agent/project-continuity-store.mjs';
import {
 provisionContinuityOwnerAuthority,
 signContinuityConsent,
 rekeyContinuityOwnerAuthority,
 ownerAuthorityPublicKey
} from '../../device-agent/project-continuity-owner-grants.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-continuity-rekey-'));
const signerDir=path.join(root,'owner-only');
const oldPassword='fixture-owner-password-before-rotation';
const newPassword='fixture-owner-password-after-rotation';
let store;
try {
 provisionContinuityOwnerAuthority({root,signerDir,password:oldPassword});
 const privatePath=path.join(signerDir,'continuity-owner-private.enc.json');
 const publicBefore=ownerAuthorityPublicKey(root).export({type:'spki',format:'der'});
 const firstEnvelope=fs.readFileSync(privatePath,'utf8');
 assert.equal(firstEnvelope.includes('BEGIN PRIVATE KEY'),false);
 store=new ContinuityStore({root});
 const project=store.createProject({projectName:'Durable authorized project'});
 store.setModules(project.id,{memory:true,expectedRevision:1});
 store.memoryPut(project.id,{body:'Owned and attributed durable fact',sourceRef:'owner:fixture'});
 const initialProof=signContinuityConsent({root,signerDir,password:oldPassword,
  projectId:project.id,enabled:true,revision:2,principal:'owner'});
 assert.equal(store.setRemoteReadConsent(project.id,{proof:initialProof}).remoteReadEnabled,true);
 assert.match(store.remoteBrief(project.id).content,/Owned and attributed durable fact/);
 // Password must be verified before private-key envelope is changed.
 assert.throws(()=>rekeyContinuityOwnerAuthority({
  root,signerDir,oldPassword:'wrong-password',newPassword
 }),/continuity_owner_signer_unlock_failed/);
 assert.equal(fs.readFileSync(privatePath,'utf8'),firstEnvelope);
 assert.throws(()=>rekeyContinuityOwnerAuthority({
  root,signerDir,oldPassword,newPassword:'short'
 }),/continuity_new_password_too_weak/);
 assert.throws(()=>rekeyContinuityOwnerAuthority({
  root,signerDir,oldPassword,newPassword:oldPassword
 }),/continuity_new_password_unchanged/);
 const marker=path.join(signerDir,'continuity-owner-rekey.lock');
 fs.writeFileSync(marker,'recovery required',{mode:0o600,flag:'wx'});
 assert.throws(()=>rekeyContinuityOwnerAuthority({root,signerDir,oldPassword,newPassword}),
  /continuity_owner_rekey_busy_manual_recovery/);
 assert.throws(()=>signContinuityConsent({root,signerDir,password:oldPassword,
  projectId:project.id,enabled:false,revision:3,principal:'owner'}),
  /continuity_owner_rekey_busy_manual_recovery/);
 fs.rmSync(marker);
 const result=rekeyContinuityOwnerAuthority({root,signerDir,oldPassword,newPassword});
 assert.deepEqual(result,{rewrapped:true,publicKeyUnchanged:true});
 assert.notEqual(fs.readFileSync(privatePath,'utf8'),firstEnvelope);
 assert.equal(fs.existsSync(marker),false);
 assert.deepEqual(ownerAuthorityPublicKey(root).export({type:'spki',format:'der'}),publicBefore);
 assert.equal(fs.statSync(privatePath).mode&0o077,0);
 assert.throws(()=>signContinuityConsent({root,signerDir,password:oldPassword,
  projectId:project.id,enabled:false,revision:3,principal:'owner'}),
  /continuity_owner_signer_unlock_failed/);
 // A properly signed earlier grant stays valid because public key is pinned.
 assert.match(store.remoteBrief(project.id).content,/Owned and attributed durable fact/);
 const disableProof=signContinuityConsent({root,signerDir,password:newPassword,
  projectId:project.id,enabled:false,revision:3,principal:'owner'});
 store.setRemoteReadConsent(project.id,{proof:disableProof});
 assert.throws(()=>store.remoteBrief(project.id),/continuity_remote_read_denied/);
 // Direct SQLite flag tampering no longer grants remote read without a receipt.
 store.db.prepare('UPDATE remote_project_consent SET enabled=1 WHERE project_id=?').run(project.id);
 assert.throws(()=>store.remoteBrief(project.id),/continuity_remote_consent_receipt_missing/);
 store.db.prepare('UPDATE remote_project_consent SET enabled=0 WHERE project_id=?').run(project.id);
 const enableProof=signContinuityConsent({root,signerDir,password:newPassword,
  projectId:project.id,enabled:true,revision:4,principal:'owner'});
 store.setRemoteReadConsent(project.id,{proof:enableProof});
 store.db.prepare("UPDATE remote_consent_attestations SET signature='tampered' WHERE project_id=?").run(project.id);
 assert.throws(()=>store.remoteBrief(project.id),/continuity_remote_consent_receipt_invalid/);
 store.db.prepare('UPDATE remote_consent_attestations SET signature=? WHERE project_id=?')
  .run(enableProof.signature,project.id);
 assert.match(store.remoteBrief(project.id).content,/Owned and attributed durable fact/);
 store.close();store=null;
 // Legacy SQLite v6 consent rows with enabled=1 MUST NOT be grandfathered
 // into a verified remote-sharing state after migration to v7.
 const oldRoot=path.join(root,'legacy-v6');
 fs.mkdirSync(oldRoot,{recursive:true});
 let legacy=new ContinuityStore({root:oldRoot});
 const unverified=legacy.createProject({projectName:'Legacy source'});
 legacy.setModules(unverified.id,{memory:true,expectedRevision:1});
 legacy.db.prepare('INSERT INTO remote_project_consent(project_id,enabled,updated_at) VALUES (?,1,?)')
  .run(unverified.id,new Date().toISOString());
 legacy.close();
 const {DatabaseSync}=await import('node:sqlite');
 let raw=new DatabaseSync(path.join(oldRoot,'continuity.db'));
 raw.exec('DROP TABLE remote_consent_attestations; PRAGMA user_version=6');
 raw.close();
 legacy=new ContinuityStore({root:oldRoot});
 assert.equal(legacy.db.prepare('PRAGMA user_version').get().user_version,7);
 assert.throws(()=>legacy.remoteBrief(unverified.id),/continuity_remote_consent_receipt_missing/);
 legacy.close();
 console.log('P2_REKEY_PRESERVES_PUBLIC_IDENTITY_AND_CONSENT_PASS');
 console.log('P2_REKEY_WRONG_PASSWORD_AND_LOCK_FAIL_CLOSED_PASS');
 console.log('P2_REMOTE_CONSENT_SIGNED_RECEIPT_AND_SQL_TAMPER_DENY_PASS');
 console.log('P2_LEGACY_V6_UNSIGNED_REMOTE_CONSENT_DENIED_PASS');
}finally{
 try{store?.close();}catch{}
 fs.rmSync(root,{recursive:true,force:true});
}
