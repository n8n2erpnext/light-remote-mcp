/*
 * Local checkpoint and Codex observer receipts.
 * HMAC provides local integrity, not hardware/public attestation.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {requireGoldMemoryPrivateKey} from './gold-memory-key-permissions.mjs';

function fail(code,status=400){return Object.assign(new Error(code),{status});}
function str(v,n,code){if(typeof v!=='string'||!v.trim()||v.length>n)throw fail(code);return v.trim();}
function signKey(filename,create=false){
  if(!fs.existsSync(filename)){
    if(!create)throw fail('gold_checkpoint_signing_key_missing',503);
    fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
    try{fs.writeFileSync(filename,crypto.randomBytes(32),{flag:'wx',mode:0o600});}
    catch(e){if(e.code!=='EEXIST')throw e;}
  }
  requireGoldMemoryPrivateKey(filename,'gold_checkpoint_signing_key_permissions');
  const key=fs.readFileSync(filename);
  if(key.length!==32)throw fail('gold_checkpoint_signing_key_invalid',503);
  return key;
}
function wire(x){const {id,version,kind,title,body,source,createdAt}=x;return JSON.stringify({id,version,kind,title,body,source,createdAt});}
function mac(key,x){return crypto.createHmac('sha256',key).update('gold-checkpoint-v1\n').update(wire(x)).digest('hex');}
export function prepareGoldLedger(db){
 db.exec('CREATE TABLE IF NOT EXISTS gold_checkpoints(id TEXT PRIMARY KEY,version INTEGER NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL,signature TEXT NOT NULL);'
 + 'CREATE INDEX IF NOT EXISTS gold_checkpoints_time ON gold_checkpoints(created_at DESC);'
 + 'CREATE TABLE IF NOT EXISTS gold_observer_receipts(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL,status TEXT NOT NULL,summary TEXT NOT NULL,task_snapshot TEXT NOT NULL,reviewed INTEGER NOT NULL DEFAULT 0 CHECK(reviewed IN(0,1)));');
}
function row(r){return {id:r.id,version:r.version,kind:r.kind,title:r.title,body:r.body,source:r.source,createdAt:r.created_at,signature:r.signature};}
export function saveGoldCheckpoint(db,keyFile,input={}){
 prepareGoldLedger(db);
 const version=1,id=crypto.randomUUID(),createdAt=Date.now(),kind=input.kind||'checkpoint';
 if(!['checkpoint','decision','handoff'].includes(kind))throw fail('gold_checkpoint_kind_invalid');
 const title=str(input.title,240,'gold_checkpoint_title_invalid'),body=str(input.body,12000,'gold_checkpoint_body_invalid'),source=str(input.source,512,'gold_checkpoint_source_required');
 const value={id,version,kind,title,body,source,createdAt},signature=mac(signKey(keyFile,true),value);
 db.prepare('INSERT INTO gold_checkpoints(id,version,kind,title,body,source,created_at,signature) VALUES(?,?,?,?,?,?,?,?)')
   .run(id,version,kind,title,body,source,createdAt,signature);
 return {id,version,kind,title,source,createdAt,signature};
}
export function readGoldCheckpoint(db,keyFile,id){
 prepareGoldLedger(db);
 const found=db.prepare('SELECT * FROM gold_checkpoints WHERE id=?').get(str(id,64,'gold_checkpoint_id_invalid'));
 if(!found)throw fail('gold_checkpoint_not_found',404);
 const item=row(found),actual=mac(signKey(keyFile),item);
 if(!/^[a-f0-9]{64}$/.test(item.signature)||!crypto.timingSafeEqual(Buffer.from(item.signature,'hex'),Buffer.from(actual,'hex')))
    throw fail('gold_checkpoint_integrity_failed',409);
 return {...item,integrity:'device_hmac_verified'};
}
export function listGoldCheckpoints(db,keyFile,{query='',limit=15}={}){
 prepareGoldLedger(db);
 if(typeof query!=='string'||query.length>160)throw fail('gold_checkpoint_query_invalid');
 if(!Number.isSafeInteger(limit)||limit<1||limit>30)throw fail('gold_checkpoint_limit_invalid');
 const q=query.trim().replace(/[%_\\]/g,'');
 const rows=q?db.prepare('SELECT id FROM gold_checkpoints WHERE title LIKE ? OR source LIKE ? ORDER BY created_at DESC,id DESC LIMIT ?').all('%'+q+'%','%'+q+'%',limit):
    db.prepare('SELECT id FROM gold_checkpoints ORDER BY created_at DESC,id DESC LIMIT ?').all(limit);
 return rows.map(r=>{const {body,...item}=readGoldCheckpoint(db,keyFile,r.id);return {...item,bodyBytes:Buffer.byteLength(body,'utf8')};});
}
export function goldHandoff(db,keyFile,{limit=5}={}){
 const list=listGoldCheckpoints(db,keyFile,{limit});
 return {schemaVersion:1,source:'device_local_owner_checkpoint',checkpointCount:list.length,
 checkpoints:list.map(r=>readGoldCheckpoint(db,keyFile,r.id)),
 trust:'Only explicitly submitted checkpoints; HMAC is device-local integrity evidence, not transcript access.'};
}
export function saveGoldObserverReceipt(db,{summary,status,tasks}={}){
 prepareGoldLedger(db);
 if(status!=='completed')throw fail('gold_observer_receipt_not_completed');
 const safeSummary=str(summary,4000,'gold_observer_summary_invalid');
 if(!Array.isArray(tasks)||tasks.length>30)throw fail('gold_observer_snapshot_invalid');
 const prior=tasks.map(t=>({id:str(t.id,64,'gold_task_id_invalid'),state:str(t.state,20,'gold_task_state_invalid'),changedAt:Number(t.changedAt)||0}));
 const id=crypto.randomUUID(),createdAt=Date.now();
 db.prepare('INSERT INTO gold_observer_receipts(id,created_at,status,summary,task_snapshot) VALUES(?,?,?,?,?)')
   .run(id,createdAt,status,safeSummary,JSON.stringify(prior));
 return {id,createdAt,status,taskCount:prior.length,requiresOwnerReview:true};
}
export function listGoldObserverReceipts(db){
 prepareGoldLedger(db);
 return db.prepare('SELECT id,created_at,summary,reviewed,task_snapshot FROM gold_observer_receipts ORDER BY created_at DESC LIMIT 20')
 .all().map(r=>({id:r.id,createdAt:r.created_at,summary:r.summary,reviewed:!!r.reviewed,tasks:JSON.parse(r.task_snapshot)}));
}
export function confirmGoldObserverTask(db,{receiptId,taskId,toState,confirm}={}){
 prepareGoldLedger(db);
 if(confirm!==true)throw fail('gold_observer_owner_confirmation_required',403);
 const rid=str(receiptId,64,'gold_observer_receipt_id_invalid'),tid=str(taskId,64,'gold_observer_task_id_invalid');
 if(!['todo','working','waiting','done'].includes(toState))throw fail('gold_observer_target_state_invalid');
 const receipt=db.prepare('SELECT task_snapshot FROM gold_observer_receipts WHERE id=?').get(rid);
 if(!receipt)throw fail('gold_observer_receipt_not_found',404);
 const prior=JSON.parse(receipt.task_snapshot).find(t=>t.id===tid);
 if(!prior)throw fail('gold_observer_task_not_in_receipt',409);
 const changed=db.prepare('UPDATE observer_tasks SET state=?,changed_ms=? WHERE id=? AND state=? AND changed_ms=? AND deleted_ms IS NULL')
   .run(toState,Date.now(),tid,prior.state,prior.changedAt);
 if(changed.changes!==1)throw fail('gold_observer_task_changed_since_receipt',409);
 db.prepare('UPDATE gold_observer_receipts SET reviewed=1 WHERE id=?').run(rid);
 return {receiptId:rid,taskId:tid,state:toState,approvedBy:'owner_explicit',applied:true};
}
