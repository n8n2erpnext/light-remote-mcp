// Crash-safe Supervisor bookkeeping. This journal does NOT preserve OS process
// execution across Supervisor termination; it preserves the ownership, lifecycle
// and UNKNOWN evidence so retries cannot silently re-execute side effects.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_RECORDS=2048;
const OWNER_FIELDS=['accountId','deviceId','sessionId','agentId'];
const JOURNAL_NAME='supervisor-jobs-v1.json';
const owned=x=>x&&OWNER_FIELDS.every(k=>/^[A-Za-z0-9._:-]{1,180}$/.test(String(x[k]||'')));
export class SupervisorJournalError extends Error {
  constructor(message,status=409){super(message);this.status=status;this.name='SupervisorJournalError';}
}
export class SupervisorJobJournal {
  constructor({dir,now=()=>Date.now()}={}){
    if(!path.isAbsolute(String(dir||'')))throw new SupervisorJournalError('journal_absolute_directory_required',400);
    const stat=fs.statSync(dir);
    if(!stat.isDirectory()||(stat.mode&0o077)||typeof process.getuid==='function'&&stat.uid!==process.getuid())
      throw new SupervisorJournalError('journal_private_directory_required',403);
    this.dir=dir;this.file=path.join(dir,JOURNAL_NAME);this.now=now;
    this.rows=new Map();this.operations=new Map();
    this.load();
  }
  load(){
    let payload;
    try {
      const stat=fs.lstatSync(this.file);
      if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||
          (typeof process.getuid==='function'&&stat.uid!==process.getuid()))
        throw new SupervisorJournalError('journal_permissions_invalid',403);
      payload=JSON.parse(fs.readFileSync(this.file,'utf8'));
    }catch(e){if(e?.code==='ENOENT')return;throw e;}
    if(payload?.version!==1||!Array.isArray(payload.rows)||payload.rows.length>MAX_RECORDS)
      throw new SupervisorJournalError('journal_corrupt',503);
    for(const row of payload.rows){
      if(!row||!owned(row.owner)||!['reserved','running','finished','stopped','timeout','error','unknown'].includes(row.state)||
        typeof row.operationKey!=='string'||! /^[0-9a-f]{64}$/.test(row.operationKey)||
        typeof row.fingerprint!=='string'||! /^[0-9a-f]{64}$/.test(row.fingerprint)||
        typeof row.recordId!=='string'||! /^sj_[0-9a-f]{32}$/.test(row.recordId)||
        row.processId!==null&&!/^lp_[A-Za-z0-9_-]{20,80}$/.test(String(row.processId||'')))
        throw new SupervisorJournalError('journal_record_invalid',503);
      if(this.operations.has(row.operationKey)||this.rows.has(row.recordId))
        throw new SupervisorJournalError('journal_duplicate_operation',503);
      // After an unclean shutdown the original process status is unproven.
      if(['reserved','running'].includes(row.state)){
        row.state='unknown';row.unknownReason='supervisor_restarted_before_terminal_receipt';
        row.finishedAt=null;row.exitCode=null;
      }
      this.rows.set(row.recordId,row);this.operations.set(row.operationKey,row.recordId);
    }
    this.save();
  }
  save(){
    const payload={version:1,rows:[...this.rows.values()]};
    const tmp=path.join(this.dir,'.supervisor-jobs-'+crypto.randomBytes(8).toString('hex')+'.tmp');
    let fd;
    try{
      fd=fs.openSync(tmp,'wx',0o600);
      fs.writeFileSync(fd,JSON.stringify(payload));
      fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
      fs.renameSync(tmp,this.file);
      const dirFd=fs.openSync(this.dir,'r');try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
    }finally{
      if(fd!==undefined&&fd!==null)try{fs.closeSync(fd);}catch{}
      try{fs.rmSync(tmp,{force:true});}catch{}
    }
  }
  key(owner,operationId){
    if(!owned(owner)||! /^[A-Za-z0-9._:-]{16,128}$/.test(String(operationId||'')))
      throw new SupervisorJournalError('invalid_operation_owner_or_id',400);
    return crypto.createHash('sha256').update(JSON.stringify([...OWNER_FIELDS.map(k=>owner[k]),operationId])).digest('hex');
  }
  previous(owner,operationId,fingerprint){
    const key=this.key(owner,operationId),recId=this.operations.get(key);
    if(!recId)return null;
    const record=this.rows.get(recId);
    if(record.fingerprint!==fingerprint)throw new SupervisorJournalError('operation_id_conflict');
    return {...record,owner:{...record.owner}};
  }
  reserve(owner,operationId,fingerprint){
    const operationKey=this.key(owner,operationId);
    if(!/^[a-f0-9]{64}$/.test(String(fingerprint||'')))throw new SupervisorJournalError('invalid_operation_fingerprint',400);
    if(this.operations.has(operationKey))throw new SupervisorJournalError('operation_already_reserved');
    if(this.rows.size>=MAX_RECORDS)throw new SupervisorJournalError('journal_capacity_reached',429);
    const record={recordId:'sj_'+crypto.randomBytes(16).toString('hex'),operationKey,
      fingerprint,owner:{...Object.fromEntries(OWNER_FIELDS.map(k=>[k,owner[k]]))},
      state:'reserved',processId:null,pid:null,startedAt:this.now(),finishedAt:null,exitCode:null};
    this.rows.set(record.recordId,record);this.operations.set(operationKey,record.recordId);
    try{this.save();}catch(e){this.rows.delete(record.recordId);this.operations.delete(operationKey);throw e;}
    return record;
  }
  attach(recordId,process){
    const row=this.rows.get(recordId);if(!row)throw new SupervisorJournalError('journal_record_missing',404);
    row.processId=process.processId;row.pid=process.pid??null;row.state='running';row.startedAt=process.startedAt||row.startedAt;this.save();
    return row;
  }
  // A completed process outcome is persisted, but its bounded in-memory stdout
  // is NOT durable; the UI must never invent a lost stdout stream.
  markFinished(process){
    if(!process?.processId)return;
    for(const row of this.rows.values()){
      if(row.processId!==process.processId)continue;
      if(row.finishedAt)return;
      if(!['finished','stopped','timeout','error'].includes(process.state))return;
      row.state=process.state;row.exitCode=process.exitCode??null;
      row.finishedAt=process.finishedAt||this.now();
      row.stopRequested=Boolean(process.stopRequested);
      row.stopForce=Boolean(process.stopForce);row.unknownReason=null;
      this.save();return;
    }
  }
  reconciled(owner){
    return [...this.rows.values()].filter(row=>OWNER_FIELDS.every(k=>row.owner[k]===owner[k]))
      .map(row=>this.view(row));
  }
  reconciledDevice(accountId,deviceId){
    return [...this.rows.values()].filter(row=>row.owner.accountId===accountId&&row.owner.deviceId===deviceId).map(row=>this.view(row));
  }
  byProcess(processId,owner){
    const row=[...this.rows.values()].find(row=>row.processId===processId&&OWNER_FIELDS.every(k=>row.owner[k]===owner[k]));
    return row?this.view(row):null;
  }
  view(row){return {processId:row.processId,accountId:row.owner.accountId,deviceId:row.owner.deviceId,
    sessionId:row.owner.sessionId,agentId:row.owner.agentId,pid:row.pid||null,
    state:row.state,startedAt:row.startedAt,finishedAt:row.finishedAt,exitCode:row.exitCode,
    resultOrigin:'supervisor_journal',outputAvailable:false,
    unknownReason:row.unknownReason||null};}
}
