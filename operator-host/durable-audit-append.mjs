/**
 * rc50 dev Operator audit append durability boundary.
 * A successfully resolved batch has been appended, fsynced at the file,
 * and its parent directory has been fsynced. This is NOT a global writer fence
 * or a multi-file snapshot checkpoint. Append errors remain latched by the
 * separately tested AuditAppendBarrier.
 */
import fs from 'node:fs';
import path from 'node:path';

export async function appendDurableAuditBatch(filename,batch,{
  openFile=(name,flags,mode)=>fs.promises.open(name,flags,mode),
  openDirectory=(name,flags)=>fs.promises.open(name,flags)
}={}){
  if(typeof filename!=='string'||!path.isAbsolute(filename)||
      typeof batch!=='string'||batch.length===0)
    throw new TypeError('durable_audit_append_invalid_input');
  let firstError=null;
  let file;
  try{
    file=await openFile(filename,fs.constants.O_WRONLY|
      fs.constants.O_APPEND|fs.constants.O_CREAT|
      fs.constants.O_NOFOLLOW,0o600);
    const st=await file.stat();
    if(!st.isFile()||st.nlink!==1)
      throw new Error('durable_audit_not_regular_file');
    await file.writeFile(batch,{encoding:'utf8'});
    await file.sync();
  }catch(error){firstError=error;}
  finally{
    if(file){
      try{await file.close();}catch(error){firstError??=error;}
    }
  }
  if(firstError)throw firstError;
  let dir,dirError=null;
  try{
    dir=await openDirectory(path.dirname(filename),
      fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
    await dir.sync();
  }catch(error){dirError=error;}
  finally{
    if(dir){
      try{await dir.close();}catch(error){dirError??=error;}
    }
  }
  if(dirError)throw dirError;
}
