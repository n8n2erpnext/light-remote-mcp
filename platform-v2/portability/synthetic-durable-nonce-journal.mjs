/**
 * rc50 UAT ONLY — one-process, crash-durable HMAC nonce replay journal.
 * No automatic deletion, truncation, repair or rotating journal. Fail closed.
 * Directory must be preprovisioned owner-only; this is NOT a cluster lock.
 */
import fs from 'node:fs';
import path from 'node:path';
const HEX_NONCE=/^[a-f0-9]{32}$/;
const MAGIC='LR_RC50_UAT_REPLAY_V1\n';
const RECORD=33;
const MAX_RECORDS=1024;
const FLAGS=fs.constants.O_RDWR|fs.constants.O_APPEND|
  fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC;
function validateDir(folder){
 const st=fs.lstatSync(folder);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||
    (st.mode&0o077)!==0)throw Error('REPLAY_DIR_UNTRUSTED');
}
// One-time explicit provisioning only. The live service MUST NEVER call this.
export function initializeSyntheticReplayJournal(filename){
 if(typeof filename!=='string'||!path.isAbsolute(filename))
  throw Error('REPLAY_PATH_INVALID');
 const folder=path.dirname(filename);
 validateDir(folder);
 let fd;
 try{
  fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
  const bytes=Buffer.from(MAGIC);
  if(fs.writeSync(fd,bytes)!==bytes.length)throw Error('REPLAY_INIT_SHORT_WRITE');
  fs.fsyncSync(fd);
  const parent=fs.openSync(folder,fs.constants.O_RDONLY|
    fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
export class SyntheticReplayJournal{
 constructor(filename,{limit=MAX_RECORDS}={}){
  if(!Number.isInteger(limit)||limit<1||limit>MAX_RECORDS)
    throw Error('REPLAY_LIMIT_INVALID');
  if(typeof filename!=='string'||!path.isAbsolute(filename))
    throw Error('REPLAY_PATH_INVALID');
  const folder=path.dirname(filename);
  validateDir(folder);
  this.failed=true;
  this.fd=null;
  this.limit=limit;
  this.filename=filename;
  this.seen=new Set();
  try{
   // Dedicated non-symlink, owner-only regular file; no inherited user state.
   // Missing journal is a denial, never a reason to reset anti-replay state.
   this.fd=fs.openSync(filename,FLAGS);
   const st=fs.fstatSync(this.fd);
   if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid()||
      (st.mode&0o077)!==0||st.size>MAGIC.length+RECORD*limit)
     throw Error('REPLAY_FILE_UNTRUSTED');
   const actual=fs.fstatSync(this.fd).size;
   this.identity={dev:st.dev,ino:st.ino};
   this.expectedBytes=actual;
   if(actual<MAGIC.length||actual>MAGIC.length+RECORD*limit)
     throw Error('REPLAY_SIZE_INVALID');
   const bytes=Buffer.alloc(actual);
   if(fs.readSync(this.fd,bytes,0,actual,0)!==actual)
     throw Error('REPLAY_READ_SHORT');
   const text=bytes.toString('utf8');
   if(!text.startsWith(MAGIC))throw Error('REPLAY_MAGIC_INVALID');
   const data=text.slice(MAGIC.length);
   if(data.length%RECORD!==0)throw Error('REPLAY_TORN_RECORD');
   for(let i=0;i<data.length;i+=RECORD){
    const nonce=data.slice(i,i+32);
    if(!HEX_NONCE.test(nonce)||data[i+32]!=='\n'||this.seen.has(nonce))
      throw Error('REPLAY_RECORD_INVALID');
    this.seen.add(nonce);
   }
   this.failed=false;
  }catch{
   if(this.fd!==null){fs.closeSync(this.fd);this.fd=null;}
   throw Error('REPLAY_JOURNAL_NOT_READY');
  }
 }
 claim(nonce){
  if(this.failed||this.fd===null)return 503;
  if(!HEX_NONCE.test(nonce??''))return 401;
  if(this.seen.has(nonce))return 409;
  if(this.seen.size>=this.limit)return 503;
  try{
   const a=fs.fstatSync(this.fd),b=fs.lstatSync(this.filename);
   if(!a.isFile()||!b.isFile()||b.isSymbolicLink()||
     a.dev!==this.identity.dev||a.ino!==this.identity.ino||
     b.dev!==a.dev||b.ino!==a.ino||a.nlink!==1||b.nlink!==1||
     a.uid!==process.getuid()||(a.mode&0o077)!==0||
     a.size!==this.expectedBytes||b.size!==this.expectedBytes)
    throw Error('REPLAY_LIVE_FILE_CHANGED');
   const bytes=Buffer.from(nonce+'\n','ascii');
   if(fs.writeSync(this.fd,bytes)!==RECORD)
     throw Error('REPLAY_APPEND_SHORT');
   // Durable before this request may be accepted or any verification invoked.
   fs.fsyncSync(this.fd);
   this.expectedBytes+=RECORD;
   this.seen.add(nonce);
   return 200;
  }catch{this.failed=true;return 503;}
 }
 close(){if(this.fd!==null){fs.closeSync(this.fd);this.fd=null;}this.failed=true;}
}
