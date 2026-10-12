/**
 * Synthetic-only durable JSON atomic replace prototype for rc50 P0 portability.
 *
 * This module has no imports from Operator/Plugin and is NOT wired to live state.
 * Caller must pass an existing isolated fixture root. No production paths.
 *
 * Sequence: refuse symlinks -> create exclusive temp -> write all bytes ->
 * fsync temp -> close -> rename -> fsync containing directory.
 * Directory fsync failure is ambiguous: rename may already be visible, so
 * NEVER report success and NEVER automatically roll back or delete target.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class SyntheticDurableWriteError extends Error {
  constructor(code,cause){super(code,{cause});this.code=code;this.name='SyntheticDurableWriteError';}
}
const fail=(code,cause)=>{throw new SyntheticDurableWriteError(code,cause);};
const DIRECTORY_FLAGS=fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | (fs.constants.O_NOFOLLOW||0);
const FILE_FLAGS=fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW||0);
const STAGES=Object.freeze(['validate','create','write','file_sync','rename','directory_sync']);
export const SYNTHETIC_DURABLE_JSON_STAGES=STAGES;

function assertRealDirectory(p,io){
  let stat;
  try{stat=io.lstatSync(p);}catch(error){fail('synthetic_parent_missing',error);}
  if(stat.isSymbolicLink()||!stat.isDirectory())fail('synthetic_parent_not_real_directory');
}
function assertPath(root,file,io){
  if(typeof root!=='string'||!path.isAbsolute(root)||typeof file!=='string'||!path.isAbsolute(file))
    fail('synthetic_absolute_paths_required');
  const normalizedRoot=path.resolve(root), target=path.resolve(file);
  if(target!==file||normalizedRoot!==root)fail('synthetic_path_not_normalized');
  const relative=path.relative(normalizedRoot,target);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))
    fail('synthetic_target_outside_fixture_root');
  // Root and every nested parent must already exist as real directories.
  assertRealDirectory(normalizedRoot,io);
  const segments=path.dirname(relative).split(path.sep).filter(x=>x&&x!=='.');
  let folder=normalizedRoot;
  for(const segment of segments){folder=path.join(folder,segment);assertRealDirectory(folder,io);}
  try{
    const st=io.lstatSync(target);
    if(st.isSymbolicLink()||!st.isFile())fail('synthetic_target_not_regular_file');
  }catch(error){
    if(error instanceof SyntheticDurableWriteError)throw error;
    if(error?.code!=='ENOENT')fail('synthetic_target_check_failed',error);
  }
  return target;
}

/**
 * No hidden filesystem destination: root must be an existing isolated fixture.
 * The 'ops' hook is injectable for UAT simulated I/O failures only.
 *
 * A thrown error never certifies a successful checkpoint. After rename but
 * before directory fsync the target content might be new; inspect before retry.
 */
export function writeSyntheticJsonDurably({
  root,file,value,mode=0o600,ops=fs
}={}){
  if(mode!==0o600)fail('synthetic_mode_must_be_0600');
  if(!value||typeof value!=='object'||Array.isArray(value))
    fail('synthetic_json_object_required');
  let bytes;
  try{bytes=Buffer.from(JSON.stringify(value)+'\n','utf8');}
  catch(error){fail('synthetic_json_encoding_failed',error);}
  if(bytes.length>8*1024*1024)fail('synthetic_fixture_size_limit');
  const target=assertPath(root,file,ops);
  const parent=path.dirname(target);
  const temporary=path.join(parent,'.lr-synthetic-'+crypto.randomUUID()+'.tmp');
  let fd=null,dirfd=null,renamed=false,stage='create';
  try{
    fd=ops.openSync(temporary,FILE_FLAGS,mode);
    try{ops.fchmodSync(fd,mode);}
    catch(error){fail('synthetic_chmod_failed',error);}
    stage='write';
    let offset=0;
    while(offset<bytes.length){
      const written=ops.writeSync(fd,bytes,offset,bytes.length-offset);
      if(!Number.isSafeInteger(written)||written<=0)fail('synthetic_short_write');
      offset+=written;
    }
    stage='file_sync';
    ops.fsyncSync(fd);
    ops.closeSync(fd);fd=null;
    stage='rename';
    // Reject symlink created after earlier lstat; operations remain fixture-only.
    try{
      const st=ops.lstatSync(target);
      if(st.isSymbolicLink()||!st.isFile())fail('synthetic_target_changed_type');
    }catch(error){
      if(error instanceof SyntheticDurableWriteError)throw error;
      if(error?.code!=='ENOENT')throw error;
    }
    ops.renameSync(temporary,target);renamed=true;
    stage='directory_sync';
    dirfd=ops.openSync(parent,DIRECTORY_FLAGS);
    ops.fsyncSync(dirfd);
    ops.closeSync(dirfd);dirfd=null;
    return Object.freeze({
      status:'SYNTHETIC_FILE_DURABLE_WRITE_PASS',
      bytes:bytes.length,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      fileSynced:true,directorySynced:true,
      realBackupProven:false,productionCutoverAuthorized:false
    });
  }catch(error){
    if(error instanceof SyntheticDurableWriteError)throw error;
    fail('synthetic_io_failed_at_'+stage,error);
  }finally{
    if(fd!==null){try{ops.closeSync(fd);}catch{}}
    if(dirfd!==null){try{ops.closeSync(dirfd);}catch{}}
    if(!renamed){try{ops.unlinkSync(temporary);}catch(error){if(error?.code!=='ENOENT') {/* cleanup best effort */}}}
  }
}
