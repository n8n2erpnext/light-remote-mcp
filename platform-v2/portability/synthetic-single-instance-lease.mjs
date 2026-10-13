/**
 * rc50 UAT ONLY: fail-closed exclusive local file lease.
 * NOT a distributed lock or an authorization boundary against the same UID.
 * An unclean exit leaves a stale lease and deliberately prevents auto-restart.
 */
import fs from 'node:fs';
import path from 'node:path';
const EXCL=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
 fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC;
function syncParent(folder){
 const fd=fs.openSync(folder,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|
  fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
export class SyntheticSingleInstanceLease{
 constructor(journalPath){
  if(typeof journalPath!=='string'||!path.isAbsolute(journalPath))
   throw Error('LEASE_PATH_INVALID');
  this.file=journalPath+'.owner-lock';
  this.folder=path.dirname(this.file);
  this.fd=null;
  this.live=false;
  // All file paths must be prepared on a dedicated owner-only volume.
  const dir=fs.lstatSync(this.folder);
  if(!dir.isDirectory()||dir.isSymbolicLink()||
   dir.uid!==process.getuid()||(dir.mode&0o077)!==0)
    throw Error('LEASE_PARENT_UNTRUSTED');
  try{
   // No automatic lock break or PID-based stale-lock reaping.
   this.fd=fs.openSync(this.file,EXCL,0o600);
   const st=fs.fstatSync(this.fd);
   if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid()||
      (st.mode&0o077)!==0)throw Error('LEASE_FILE_UNTRUSTED');
   this.identity={dev:st.dev,ino:st.ino};
   const record=Buffer.from('LR_RC50_UAT_OWNER_V1\n'+String(process.pid)+'\n');
   if(fs.writeSync(this.fd,record)!==record.length)
     throw Error('LEASE_WRITE_SHORT');
   fs.fsyncSync(this.fd);
   syncParent(this.folder);
   this.live=true;
  }catch{
   // Do NOT unlink on partial acquisition: a failure is deliberately sticky
   // until the owner inspects/reconciles the file.
   if(this.fd!==null){fs.closeSync(this.fd);this.fd=null;}
   throw Error('LEASE_NOT_ACQUIRED');
  }
 }
 owns(){
  if(!this.live||this.fd===null)return false;
  try{
   const a=fs.fstatSync(this.fd),b=fs.lstatSync(this.file);
   return a.dev===this.identity.dev&&a.ino===this.identity.ino&&
     b.dev===a.dev&&b.ino===a.ino&&b.isFile()&&b.nlink===1&&
     b.uid===process.getuid()&&(b.mode&0o077)===0;
  }catch{return false;}
 }
 release(){
  if(!this.owns())throw Error('LEASE_OWNERSHIP_LOST');
  this.live=false;
  // Only a clean, in-process release can remove the exact inode.
  fs.unlinkSync(this.file);
  syncParent(this.folder);
  fs.closeSync(this.fd);
  this.fd=null;
 }
}
