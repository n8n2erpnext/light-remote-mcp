import {DatabaseSync} from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Pure staging simulator persistence. It never spawns a device command or charges UsageRegistry. */
export class DurableTeamUatError extends Error {
  constructor(message,status=409){super(message);this.status=status;}
}
const deny=(code,status=409)=>{throw new DurableTeamUatError(code,status)};
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(x);
const assertId=(value,label)=>{if(!validId(value))deny('invalid_'+label,400);return value};
const month=ms=>new Date(ms).toISOString().slice(0,7);
const publicJob=r=>r?Object.freeze({jobId:r.job_id,ownerAccountId:r.owner_id,
 actorAccountId:r.actor_id,deviceId:r.device_id,operationId:r.operation_id,
 kind:r.kind,state:r.state,slot:r.slot_no,generation:r.generation,
 createdAt:r.created_at,finishedAt:r.finished_at,previewOnly:true}):null;

/**
 * A SQLite BEGIN IMMEDIATE transaction coordinates workers across PROCESSES on
 * the same filesystem. No separate JSON lock or process-local counter.
 * Required trusted callbacks check owner+member entitlement and AB consent on
 * EVERY claim (including retry). No remote command channel is accessible here.
 */
export class DurableTeamUatStore {
 constructor({dbFile,now=()=>Date.now(),authorize,budgetFor,leaseMs=30000}={}){
  if(!dbFile||dbFile===':memory:'||typeof authorize!=='function'||typeof budgetFor!=='function'||typeof now!=='function')
    deny('durable_store_dependencies_required',400);
  if(!Number.isInteger(leaseMs)||leaseMs<1000||leaseMs>600000)deny('lease_duration_invalid',400);
  this.now=now;this.authorize=authorize;this.budgetFor=budgetFor;this.leaseMs=leaseMs;
  fs.mkdirSync(path.dirname(dbFile),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(dbFile,{timeout:10000});
  this.db.exec("PRAGMA busy_timeout=10000;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA foreign_keys=ON;");
  this.db.exec([
    'CREATE TABLE IF NOT EXISTS devices(device_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS slots(device_id TEXT NOT NULL,slot_no INTEGER NOT NULL CHECK(slot_no BETWEEN 1 AND 3),',
    'generation INTEGER NOT NULL DEFAULT 0,job_id TEXT,token TEXT,expires_at INTEGER,',
    'PRIMARY KEY(device_id,slot_no),FOREIGN KEY(device_id) REFERENCES devices(device_id));',
    'CREATE TABLE IF NOT EXISTS jobs(job_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,actor_id TEXT NOT NULL,',
    'agent_id TEXT NOT NULL,device_id TEXT NOT NULL,operation_id TEXT NOT NULL,kind TEXT NOT NULL,',
    'fingerprint TEXT NOT NULL,state TEXT NOT NULL,slot_no INTEGER,generation INTEGER,token TEXT,',
    'created_at INTEGER NOT NULL,finished_at INTEGER,',
    'UNIQUE(owner_id,actor_id,agent_id,device_id,operation_id));',
    'CREATE TABLE IF NOT EXISTS charges(job_id TEXT PRIMARY KEY REFERENCES jobs(job_id),',
    'owner_id TEXT NOT NULL,month TEXT NOT NULL,tool_calls INTEGER NOT NULL,charged_at INTEGER NOT NULL);',
    'CREATE INDEX IF NOT EXISTS charges_owner_month ON charges(owner_id,month);'
  ].join(''));
  fs.chmodSync(dbFile,0o600);
 }
 tx(fn){
  this.db.exec('BEGIN IMMEDIATE');
  try{const value=fn();this.db.exec('COMMIT');return value}
  catch(err){try{this.db.exec('ROLLBACK')}catch{}throw err}
 }
 _expire(at){
  const rows=this.db.prepare('SELECT * FROM slots WHERE job_id IS NOT NULL AND expires_at<=?').all(at);
  for(const r of rows){
   this.db.prepare("UPDATE jobs SET state='lease_expired',finished_at=? WHERE job_id=? AND state='running'").run(at,r.job_id);
   this.db.prepare('UPDATE slots SET job_id=NULL,token=NULL,expires_at=NULL WHERE device_id=? AND slot_no=? AND job_id=?')
     .run(r.device_id,r.slot_no,r.job_id);
  }
  return rows.length;
 }
 _device(device,owner){
  const row=this.db.prepare('SELECT owner_id FROM devices WHERE device_id=?').get(device);
  if(row&&row.owner_id!==owner)deny('device_owner_conflict',403);
  if(!row){
   this.db.prepare('INSERT INTO devices(device_id,owner_id) VALUES(?,?)').run(device,owner);
   for(let i=1;i<=3;i++)this.db.prepare('INSERT INTO slots(device_id,slot_no) VALUES(?,?)').run(device,i);
  }
 }
 /**
  * Atomic worker reservation AND durable owner-budget debit, preview only.
  * Owner jobs take the SAME three shared slots but do not debit TEAM budget.
  * No implicit replay of interrupted jobs after restart.
  */
 claim({ownerAccountId,actorAccountId,agentId,deviceId,operationId,fingerprint,kind='member'}={}){
  const owner=assertId(ownerAccountId,'owner'),actor=assertId(actorAccountId,'actor'),
    agent=assertId(agentId,'agent'),device=assertId(deviceId,'device'),
    op=assertId(operationId,'operation');
  if(!/^[0-9a-f]{64}$/.test(String(fingerprint))||!['owner','member'].includes(kind)||
    (kind==='owner')!==(owner===actor))deny('claim_identity_invalid',403);
  const at=this.now();
  if(!Number.isSafeInteger(at)||at<0)deny('invalid_clock',503);
  return this.tx(()=>{
   this._expire(at);
   if(this.authorize({ownerAccountId:owner,actorAccountId:actor,agentId:agent,
     deviceId:device,operationId:op,kind})!==true)deny('dispatch_authorization_denied',403);
   const prior=this.db.prepare('SELECT * FROM jobs WHERE owner_id=? AND actor_id=? AND agent_id=? AND device_id=? AND operation_id=?')
     .get(owner,actor,agent,device,op);
   if(prior){
    if(prior.fingerprint!==fingerprint||prior.kind!==kind)deny('operation_id_conflict');
    return {job:publicJob(prior),lease:prior.state==='running'?
      {token:prior.token,generation:prior.generation,slot:prior.slot_no}:null,retry:true};
   }
   this._device(device,owner);
   const slot=this.db.prepare('SELECT * FROM slots WHERE device_id=? AND job_id IS NULL ORDER BY slot_no LIMIT 1').get(device);
   if(!slot)deny('device_worker_slots_busy',429);
   if(kind==='member'){
    const budget=Number(this.budgetFor(owner));
    if(!Number.isSafeInteger(budget)||budget<1||budget>1000000)deny('member_budget_required',403);
    const used=this.db.prepare('SELECT COUNT(*) AS n FROM charges WHERE owner_id=? AND month=?')
      .get(owner,month(at)).n;
    if(used>=budget)deny('member_budget_exhausted',429);
   }
   const jobId='tuat-'+crypto.randomUUID(),token=crypto.randomBytes(24).toString('base64url'),
      generation=slot.generation+1;
   this.db.prepare('INSERT INTO jobs(job_id,owner_id,actor_id,agent_id,device_id,operation_id,kind,fingerprint,state,slot_no,generation,token,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
     .run(jobId,owner,actor,agent,device,op,kind,fingerprint,'running',slot.slot_no,generation,token,at);
   this.db.prepare('UPDATE slots SET generation=?,job_id=?,token=?,expires_at=? WHERE device_id=? AND slot_no=?')
     .run(generation,jobId,token,at+this.leaseMs,device,slot.slot_no);
   if(kind==='member')this.db.prepare('INSERT INTO charges(job_id,owner_id,month,tool_calls,charged_at) VALUES(?,?,?,?,?)')
     .run(jobId,owner,month(at),1,at);
   return {job:publicJob(this.db.prepare('SELECT * FROM jobs WHERE job_id=?').get(jobId)),
     lease:{token,generation,slot:slot.slot_no,expiresAt:at+this.leaseMs},retry:false};
  });
 }
 _lease(id,token,generation,at){
  const job=this.db.prepare('SELECT * FROM jobs WHERE job_id=?').get(id);
  if(!job||job.state!=='running'||job.token!==token||job.generation!==generation)deny('stale_lease');
  const slot=this.db.prepare('SELECT * FROM slots WHERE device_id=? AND slot_no=?').get(job.device_id,job.slot_no);
  if(!slot||slot.job_id!==id||slot.token!==token||slot.generation!==generation||
     slot.expires_at<=at)deny('stale_lease');
  return job;
 }
 renew({jobId,token,generation}={}){
  const id=assertId(jobId,'job'),at=this.now();
  return this.tx(()=>{
   this._expire(at);const job=this._lease(id,token,generation,at);
   this.db.prepare('UPDATE slots SET expires_at=? WHERE device_id=? AND slot_no=?')
     .run(at+this.leaseMs,job.device_id,job.slot_no);
   return {jobId:id,expiresAt:at+this.leaseMs};
  });
 }
 finish({jobId,token,generation,cancelled=false}={}){
  const id=assertId(jobId,'job'),at=this.now();
  return this.tx(()=>{
   this._expire(at);const job=this._lease(id,token,generation,at);
   this.db.prepare('UPDATE jobs SET state=?,finished_at=? WHERE job_id=?')
     .run(cancelled?'cancelled':'completed',at,id);
   this.db.prepare('UPDATE slots SET job_id=NULL,token=NULL,expires_at=NULL WHERE device_id=? AND slot_no=?')
     .run(job.device_id,job.slot_no);
   return publicJob(this.db.prepare('SELECT * FROM jobs WHERE job_id=?').get(id));
  });
 }
 /** Caller MUST invoke on consent or Team entitlement revocation. */
 revoke({ownerAccountId,actorAccountId=null,deviceId=null}={}){
  const owner=assertId(ownerAccountId,'owner');
  if(actorAccountId!==null)assertId(actorAccountId,'actor');
  if(deviceId!==null)assertId(deviceId,'device');
  return this.tx(()=>{
   this._expire(this.now());let count=0;
   const rows=this.db.prepare("SELECT * FROM jobs WHERE owner_id=? AND state='running'").all(owner);
   for(const row of rows){
    if(actorAccountId!==null&&row.actor_id!==actorAccountId||
       deviceId!==null&&row.device_id!==deviceId)continue;
    this.db.prepare("UPDATE jobs SET state='revoked',finished_at=? WHERE job_id=?")
      .run(this.now(),row.job_id);
    this.db.prepare('UPDATE slots SET job_id=NULL,token=NULL,expires_at=NULL WHERE device_id=? AND slot_no=? AND job_id=?')
      .run(row.device_id,row.slot_no,row.job_id);count++;
   }
   return {interrupted:count};
  });
 }
 sweep(){return this.tx(()=>this._expire(this.now()))}
 summary(ownerAccountId){
  const owner=assertId(ownerAccountId,'owner');
  return this.tx(()=>{
   this._expire(this.now());
   const spent=this.db.prepare('SELECT COUNT(*) AS n FROM charges WHERE owner_id=? AND month=?')
     .get(owner,month(this.now())).n;
   const running=this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE owner_id=? AND state='running'")
     .get(owner).n;
   return {ownerAccountId:owner,month:month(this.now()),memberCalls:spent,runningSlots:running,
     previewOnly:true,realDispatchEnabled:false};
  });
 }
 job(jobId){
  return publicJob(this.db.prepare('SELECT * FROM jobs WHERE job_id=?').get(assertId(jobId,'job')));
 }
 close(){this.db.close()}
}
