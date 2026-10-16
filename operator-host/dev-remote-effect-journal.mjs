/**
 * rc50 opt-in DEV-ONLY write-ahead ledger for outbound Fleet OS effects.
 *
 * NOT a global writer epoch, not an Agent ACK verifier, and not a full
 * consistent checkpoint. Explicit UAT provisioning of an EMPTY 0600 file
 * is required; missing/invalid/nonempty files fail closed at startup.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {durableAtomicWriteSync} from '../lib/durable-atomic-file.mjs';

const ID=/^[A-Za-z0-9._:-]{1,128}$/;
const MAX_ROWS=1024;
const FIELDS=['accountId','commandId','deviceId','jobId','nodeId'];
function valid(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||
     Object.keys(row).sort().join(',')!==FIELDS.join(',')||
     !FIELDS.every(k=>typeof row[k]==='string'&&ID.test(row[k])))
    throw Error('DEV_REMOTE_EFFECT_JOURNAL_INVALID_ROW');
  return {...row};
}
function parse(raw){
  let data;
  try{data=JSON.parse(raw);}catch{throw Error('DEV_REMOTE_EFFECT_JOURNAL_INVALID_JSON');}
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).sort().join(',')!=='pending,schemaVersion'||
     data.schemaVersion!==1||!Array.isArray(data.pending)||data.pending.length>MAX_ROWS)
    throw Error('DEV_REMOTE_EFFECT_JOURNAL_INVALID_FORMAT');
  const entries=data.pending.map(valid);
  const keys=new Set(entries.map(r=>r.commandId));
  if(keys.size!==entries.length)throw Error('DEV_REMOTE_EFFECT_JOURNAL_DUPLICATE');
  return entries;
}
export class DevRemoteEffectJournal {
  constructor({file,write=durableAtomicWriteSync}={}){
    if(typeof file!=='string'||!path.isAbsolute(file)||
       typeof write!=='function')throw Error('DEV_REMOTE_EFFECT_JOURNAL_PATH_REQUIRED');
    const parent=fs.lstatSync(path.dirname(file));
    if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o022)!==0)
      throw Error('DEV_REMOTE_EFFECT_JOURNAL_UNTRUSTED_PARENT');
    // No implicit create. Absence might be a deleted/rolled-back journal,
    // not a first install. UAT operator explicitly provisions an empty file.
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    let text;
    try{
      const st=fs.fstatSync(fd);
      if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600||
         st.size>1024*1024)throw Error('DEV_REMOTE_EFFECT_JOURNAL_UNTRUSTED_FILE');
      text=fs.readFileSync(fd,'utf8');
    }finally{fs.closeSync(fd);}
    this.rows=new Map(parse(text).map(row=>[row.commandId,row]));
    if(this.rows.size)throw Error('DEV_REMOTE_EFFECT_JOURNAL_PENDING_RESTART_REFUSED');
    this.file=file;
    this.write=write;
    // O_EXCL owner lease prevents two DEV Operator instances overwriting the
    // same journal concurrently. A crash leaves the lock: manual reconciliation
    // is required; never trust PID-reuse/mtime to steal an orphan lock.
    this.lockPath=file+'.owner.lock';
    this.lockFd=fs.openSync(this.lockPath,
      fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|
      fs.constants.O_NOFOLLOW,0o600);
    try{
      fs.writeSync(this.lockFd,crypto.randomBytes(24).toString('hex')+'\n');
      fs.fsyncSync(this.lockFd);
      const parentFd=fs.openSync(path.dirname(file),
        fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
      try{fs.fsyncSync(parentFd);}finally{fs.closeSync(parentFd);}
    }catch(error){fs.closeSync(this.lockFd);throw error;}
    this.closed=false;
  }
  get pending(){return this.rows.size;}
  _assertOwner(){
    if(this.closed)throw Error('DEV_REMOTE_EFFECT_JOURNAL_CLOSED');
    const fdStat=fs.fstatSync(this.lockFd),nameStat=fs.lstatSync(this.lockPath);
    if(!nameStat.isFile()||nameStat.isSymbolicLink()||nameStat.nlink!==1||
       (nameStat.mode&0o777)!==0o600||
       fdStat.dev!==nameStat.dev||fdStat.ino!==nameStat.ino)
      throw Error('DEV_REMOTE_EFFECT_JOURNAL_OWNER_LOST');
  }
  _commit(next){
    this._assertOwner();
    this.write(this.file,JSON.stringify({schemaVersion:1,pending:[...next.values()]})+'\n',
      {mode:0o600});
    this.rows=next; // memory state changes only AFTER durable fsync/rename
  }
  releaseClean(){
    if(this.rows.size)throw Error('DEV_REMOTE_EFFECT_JOURNAL_RELEASE_PENDING');
    this._assertOwner();
    fs.unlinkSync(this.lockPath);
    const parentFd=fs.openSync(path.dirname(this.file),
      fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(parentFd);}finally{fs.closeSync(parentFd);}
    fs.closeSync(this.lockFd);
    this.closed=true;
    return true;
  }
  prepare(input){
    const row=valid(input);
    if(this.rows.has(row.commandId))throw Error('DEV_REMOTE_EFFECT_JOURNAL_COMMAND_DUPLICATE');
    if(this.rows.size>=MAX_ROWS)throw Error('DEV_REMOTE_EFFECT_JOURNAL_FULL');
    const next=new Map(this.rows);next.set(row.commandId,row);
    this._commit(next);
    return row.commandId;
  }
  settle(commandId){
    if(typeof commandId!=='string'||!ID.test(commandId)||
       !this.rows.has(commandId))
      throw Error('DEV_REMOTE_EFFECT_JOURNAL_UNKNOWN_COMMAND');
    const next=new Map(this.rows);next.delete(commandId);
    this._commit(next);
    return true;
  }
}
