/** Synthetic-only fsynced journal watermark experiment; never wired into live Operator. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export class SyntheticJournalError extends Error {
  constructor(code,cause){super(code,{cause});this.name='SyntheticJournalError';this.code=code;}
}
const deny=(code,cause)=>{throw new SyntheticJournalError(code,cause);};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const FILE_FLAGS=fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|
  (fs.constants.O_NOFOLLOW||0);
const DIR_FLAGS=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|
  (fs.constants.O_NOFOLLOW||0);

function validateFixture(root,file,io){
  const tmp=path.resolve(os.tmpdir());
  if(typeof root!=='string'||path.resolve(root)!==root||path.dirname(root)!==tmp||
     !path.basename(root).startsWith('lr-rc50-journal-fixture-'))
    deny('journal_fixture_root_required');
  if(typeof file!=='string'||file!==path.join(root,'activity.jsonl'))
    deny('journal_fixture_file_required');
  let st;
  try{st=io.lstatSync(root);}catch(error){deny('journal_fixture_missing',error);}
  if(!st.isDirectory()||st.isSymbolicLink())deny('journal_fixture_not_real_directory');
  try{st=io.lstatSync(file);}
  catch(error){if(error?.code!=='ENOENT')deny('journal_file_check_failed',error);return false;}
  if(!st.isFile()||st.isSymbolicLink())deny('journal_file_not_regular');
  if((st.mode&0o077)!==0)deny('journal_file_mode_not_private');
  return true;
}
function encodeRecord(sequence,event,previousDigest){
  const record={schemaVersion:1,sequence,event,previousDigest};
  const value=JSON.stringify(record);
  const digest=sha(Buffer.from(value,'utf8'));
  return {record:{...record,digest},bytes:Buffer.from(JSON.stringify({...record,digest})+'\n','utf8'),digest};
}
export class SyntheticJournalWatermark {
  #root;
  #file;
  #io;
  #failed=false;
  #sequence=0;
  #lastAckedSequence=0;
  #offset=0;
  #digest='0'.repeat(64);
  constructor({root,file,ops=fs}={}){
    const exists=validateFixture(root,file,ops);
    this.#root=root;this.#file=file;this.#io=ops;
    if(exists)this.#readPrevious();
  }
  #readPrevious(){
    let raw;
    try{raw=this.#io.readFileSync(this.#file);}catch(error){deny('journal_read_failed',error);}
    if(raw.length>4*1024*1024)deny('journal_fixture_too_large');
    if(raw.length && raw.at(-1)!==10)deny('journal_incomplete_tail');
    const lines=raw.toString('utf8').split('\n').filter(Boolean);
    for(const line of lines){
      let row;
      try{row=JSON.parse(line);}catch(error){deny('journal_record_invalid',error);}
      const {schemaVersion,sequence,event,previousDigest,digest}=row||{};
      if(schemaVersion!==1||!Number.isSafeInteger(sequence)||
         sequence!==this.#sequence+1||previousDigest!==this.#digest||
         typeof digest!=='string'||!/^([a-f0-9]{64})$/.test(digest)||
         !event||typeof event!=='object'||Array.isArray(event))
        deny('journal_replay_validation_failed');
      const canonical=encodeRecord(sequence,event,previousDigest);
      if(canonical.digest!==digest||canonical.bytes.toString('utf8')!==line+'\n')
        deny('journal_replay_digest_mismatch');
      this.#sequence=sequence;this.#digest=digest;
    }
    this.#offset=raw.length;
  }
  get failed(){return this.#failed;}
  watermark(){
    if(this.#failed)deny('journal_restart_required_after_failure');
    return Object.freeze({status:'SYNTHETIC_ONLY_NOT_PRODUCTION_EVIDENCE',
      sequence:this.#sequence,byteOffset:this.#offset,sha256:this.#digest,
      fsyncAcknowledged:this.#sequence>0&&this.#lastAckedSequence===this.#sequence,
      realBackupProven:false,productionCutoverAuthorized:false});
  }
  append(event){
    if(this.#failed)deny('journal_restart_required_after_failure');
    if(!event||typeof event!=='object'||Array.isArray(event))deny('journal_object_required');
    if(this.#sequence>=10000)deny('journal_fixture_record_limit');
    const {bytes,digest}=encodeRecord(this.#sequence+1,event,this.#digest);
    if(bytes.length>64*1024)deny('journal_record_too_large');
    const newlyCreated=!validateFixture(this.#root,this.#file,this.#io);
    let fd=null,dirFd=null;
    let stage='open';
    try{
      fd=this.#io.openSync(this.#file,FILE_FLAGS,0o600);
      const st=this.#io.fstatSync(fd);
      if(!st.isFile()||(st.mode&0o077)!==0)deny('journal_opened_file_not_private');
      stage='append';
      let position=0;
      while(position<bytes.length){
        const size=this.#io.writeSync(fd,bytes,position,bytes.length-position);
        if(!Number.isSafeInteger(size)||size<=0)deny('journal_short_write');
        position+=size;
      }
      stage='file_fsync';this.#io.fsyncSync(fd);
      this.#io.closeSync(fd);fd=null;
      if(newlyCreated){
        stage='directory_fsync';dirFd=this.#io.openSync(this.#root,DIR_FLAGS);
        this.#io.fsyncSync(dirFd);
        this.#io.closeSync(dirFd);dirFd=null;
      }
      this.#offset+=bytes.length;
      this.#sequence++;
      this.#digest=digest;
      this.#lastAckedSequence=this.#sequence;
      return this.watermark();
    }catch(error){
      this.#failed=true;
      if(error instanceof SyntheticJournalError)throw error;
      deny('journal_io_failed_at_'+stage,error);
    }finally{
      if(fd!==null){try{this.#io.closeSync(fd);}catch{}}
      if(dirFd!==null){try{this.#io.closeSync(dirFd);}catch{}}
    }
  }
}
