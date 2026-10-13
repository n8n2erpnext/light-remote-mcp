/**
 * Crash-durable single-file atomic replacement for rc50 dev registries.
 *
 * Guarantees ONLY each individual file was written, fsynced, renamed and
 * its parent directory fsynced before ACK. Not a transaction spanning files,
 * a global writer lease, or permission to mutate after a cutover.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MODES=new Set([0o600,0o640]);
function assertTarget(file,mode,io){
  if(typeof file!=='string'||!path.isAbsolute(file)||typeof mode!=='number'||
     !MODES.has(mode))throw Error('durable_state_invalid_path_or_mode');
  const dir=path.dirname(file);
  const stat=io.lstatSync(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o022)!==0)
    throw Error('durable_state_untrusted_directory');
  try{
    const old=io.lstatSync(file);
    if(!old.isFile()||old.isSymbolicLink()||old.nlink!==1)
      throw Error('durable_state_untrusted_target');
  }catch(err){
    if(err?.code!=='ENOENT')throw err;
  }
  return dir;
}
export function createDurableAtomicWriter({io=fs,randomBytes=crypto.randomBytes}={}){
  let failed=null;
  function write(file,data,{mode=0o600}={}){
    if(failed)throw failed;
    let fd=null,tmp=null,renamed=false;
    try{
      if(typeof data!=='string'&&!Buffer.isBuffer(data))
        throw Error('durable_state_payload_invalid');
      const dir=assertTarget(file,mode,io);
      // An unpredictable O_EXCL temp prevents PID reuse/symlink overwrite.
      tmp=path.join(dir,'.'+path.basename(file)+'.'+
        randomBytes(16).toString('hex')+'.tmp');
      fd=io.openSync(tmp,io.constants.O_CREAT|io.constants.O_EXCL|
        io.constants.O_WRONLY|io.constants.O_NOFOLLOW,mode);
      const buf=Buffer.isBuffer(data)?data:Buffer.from(data,'utf8');
      let at=0;
      while(at<buf.length){
        const n=io.writeSync(fd,buf,at,buf.length-at);
        if(!Number.isInteger(n)||n<=0)throw Error('durable_state_short_write');
        at+=n;
      }
      io.fchmodSync(fd,mode);
      io.fsyncSync(fd);
      io.closeSync(fd);fd=null;
      // Reject target exchange-to-symlink between writing and rename.
      assertTarget(file,mode,io);
      io.renameSync(tmp,file);renamed=true;
      const dirFd=io.openSync(dir,io.constants.O_RDONLY|
        io.constants.O_DIRECTORY|io.constants.O_NOFOLLOW);
      try{io.fsyncSync(dirFd);}finally{io.closeSync(dirFd);}
      return true;
    }catch(error){
      failed=error instanceof Error?error:new Error(String(error));
      throw failed;
    }finally{
      if(fd!==null){try{io.closeSync(fd);}catch(e){failed??=e;}}
      if(tmp&&!renamed){try{io.unlinkSync(tmp);}catch{}}
    }
  }
  return {write,get failed(){return failed;}};
}
// Sticky process-wide failure: a failed registry persistence is NOT quietly
// retried as though the earlier in-memory mutation had committed.
const defaultWriter=createDurableAtomicWriter();
export function durableAtomicWriteSync(file,data,options){
  return defaultWriter.write(file,data,options);
}
export function durableStateWriteFailed(){return defaultWriter.failed!==null;}
