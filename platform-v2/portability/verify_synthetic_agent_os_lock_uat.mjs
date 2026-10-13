#!/usr/bin/env node
/**
 * rc50 P0 Linux multi-process Agent receipt lock UAT.
 * Uses flock -n -F exclusive advisory lock on stable fixture-local inode.
 * No Docker/remote API/PTY/production data; only fake_noop receipts.
 * The child worker alone is NOT safe: this supervisor owns all launches.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import crypto from 'node:crypto';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-agent-fixture-lock-'));
const worker=path.join(import.meta.dirname,'synthetic-agent-locked-worker.mjs');
const lockFile=path.join(root,'receipt.lock');
const lockArgs=(action)=>['-x','-n','-E','77','-F',lockFile,process.execPath,worker,root,action];
let holding=null,lockIdentity=null;
const requireTrue=(cond,msg)=>{if(!cond)throw Error('RC50_AGENT_MUTEX_UAT_FAILED:'+msg);};
function createLock(){
  const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
    (fs.constants.O_NOFOLLOW||0);
  const fd=fs.openSync(lockFile,flags,0o600);
  try{fs.fchmodSync(fd,0o600);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const dir=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
  try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  const st=fs.lstatSync(lockFile);
  requireTrue(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&(st.mode&0o777)===0o600,
    'invalid_private_lock_inode');
  return {dev:st.dev,ino:st.ino};
}
function openVerifiedLock(){
  const fd=fs.openSync(lockFile,fs.constants.O_RDWR|(fs.constants.O_NOFOLLOW||0));
  const st=fs.fstatSync(fd);
  const target=fs.lstatSync(lockFile);
  if(!st.isFile()||st.dev!==target.dev||st.ino!==target.ino
    ||st.dev!==lockIdentity?.dev||st.ino!==lockIdentity?.ino
    ||st.nlink!==1||(st.mode&0o777)!==0o600){fs.closeSync(fd);throw Error('lock_inode_changed');}
  return fd;
}
function runLocked(action){
  const fd=openVerifiedLock();
  let result;
  try{
    result=spawnSync('flock',lockArgs(action),{
      encoding:'utf8',timeout:12000,maxBuffer:1024*1024,cwd:root,
      stdio:['ignore','pipe','pipe',fd]
    });
  }finally{fs.closeSync(fd);}
  requireTrue(!result.error,'flock_spawn_failed_'+action);
  return result;
}
async function holdLock(){
  const fd=openVerifiedLock();
  let child;
  try{child=spawn('flock',lockArgs('hold'),{
    cwd:root,stdio:['ignore','pipe','pipe',fd]
  });}finally{fs.closeSync(fd);}
  holding=child;
  let output='',errors='';
  child.stderr.on('data',chunk=>{errors+=String(chunk).slice(0,150);});
  const ready=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('locked_worker_timeout')),8000);
    child.stdout.on('data',chunk=>{
      output+=String(chunk);
      if(output.includes('RC50_EXCLUSIVE_WORKER_LOCK_HELD')){
        clearTimeout(timer);resolve(true);
      }
    });
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',(code,signal)=>{
      if(!output.includes('RC50_EXCLUSIVE_WORKER_LOCK_HELD')){
        clearTimeout(timer);reject(Error('worker_exit_before_lock_ready_'+code+'_'+signal+'_'+errors));
      }
    });
  });
  requireTrue(ready,'hold_not_acquired');
  return child;
}
const result={status:'SYNTHETIC_ONLY',realCommandExecuted:false,
  productionCutoverAuthorized:false,globalWriterFenceProven:false};
try{
  lockIdentity=createLock();
  requireTrue(process.platform==='linux','linux_flock_only');
  holding=await holdLock();
  const original=JSON.parse(fs.readFileSync(path.join(root,'receipts.json'),'utf8'));
  const unguarded=spawnSync(process.execPath,[worker,root,'second'],{
    encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']
  });
  requireTrue(unguarded.status===2&&/missing_inherited_lock_fd|inherited_lock_inode_mismatch/.test(unguarded.stderr),
    'direct_worker_bypass_not_rejected_'+unguarded.status+'_'+String(unguarded.stderr).slice(0,125));
  result.direct_worker_without_lock_fd_rejected=true;
  requireTrue(original.commands.uat_cmd_mutex_first.status==='started',
    'first_writer_did_not_persist_started');
  // Second process races against the same immutable flock inode.
  const blocked=runLocked('second');
  requireTrue(blocked.status===77,'second_writer_not_denied');
  requireTrue(!String(blocked.stdout).includes('RC50_EXCLUSIVE_SECOND_RECEIPT_SAVED'),
    'second_worker_executed_while_held');
  const beforeCrash=JSON.parse(fs.readFileSync(path.join(root,'receipts.json'),'utf8'));
  requireTrue(Object.keys(beforeCrash.commands).length===1,'second_writer_modified_state');
  result.concurrent_process_refused=true;
  // An independent process locks the *actual receipt.lock pathname* instead
  // of relying on this supervisor's possibly incorrect flock argv.
  const outsider=spawnSync('flock',['-x','-n','-E','77',lockFile,'/bin/true'],{
    cwd:root,encoding:'utf8',timeout:8000,stdio:['ignore','pipe','pipe']
  });
  requireTrue(!outsider.error && outsider.status===77,
    'kernel_lock_not_held_on_receipt_inode_'+String(outsider.status));
  requireTrue(!fs.existsSync(path.join(root,'3')),
    'numeric_flock_argument_mistaken_for_path');
  result.independent_inode_lock_probe_refused=true;

  // SIGKILL mimics a worker crash. The kernel releases this process-held lock.
  const stopped=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('worker_did_not_exit_after_sigkill')),7000);
    holding.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});
  });
  holding.kill('SIGKILL');
  const exited=await stopped;
  requireTrue(exited.signal==='SIGKILL','worker_not_killed');
  holding=null;
  result.lock_released_after_sigkill=true;

  // Subsequent workers acquire lock, mark STARTED receipt UNCERTAIN,
  // reject duplicate delivery and persist a different fake receipt.
  const reopen=runLocked('reopen');
  requireTrue(reopen.status===0&&reopen.stdout.includes('RC50_EXCLUSIVE_RECOVERED_UNCERTAIN'),
    'restart_recovery_failed_'+reopen.stderr);
  const duplicate=runLocked('duplicate');
  requireTrue(duplicate.status===0&&duplicate.stdout.includes('RC50_EXCLUSIVE_DUPLICATE_REJECTED'),
    'duplicate_reexecuted_'+duplicate.stderr);
  result.inflight_uncertain_no_auto_reexecution=true;
  const second=runLocked('second');
  requireTrue(second.status===0&&second.stdout.includes('RC50_EXCLUSIVE_SECOND_RECEIPT_SAVED'),
    'second_receipt_not_saved_'+second.stderr);
  const inspect=runLocked('inspect');
  requireTrue(inspect.status===0&&inspect.stdout.includes('RC50_EXCLUSIVE_TWO_RECEIPTS_PRESERVED'),
    'receipts_corrupt_or_lost_'+inspect.stderr);
  result.serialized_two_writer_receipts_preserved=true;

  const stat=fs.lstatSync(lockFile);
  requireTrue(stat.ino===lockIdentity.ino&&stat.dev===lockIdentity.dev&&stat.nlink===1,
    'lock_file_replaced_inode_aba');
  requireTrue((stat.mode&0o777)===0o600,'lock_file_mode_changed');
  result.lock_inode_stable_not_unlinked=true;
  result.testedProcesses=8;
  result.uniqueRun=crypto.createHash('sha256').update(path.basename(root)).digest('hex').slice(0,12);
  console.log('RC50_AGENT_OS_EXCLUSIVE_LOCK_UAT_PASS '+JSON.stringify(result));
}catch(error){
  process.stderr.write('RC50_AGENT_OS_EXCLUSIVE_LOCK_UAT_FAIL '+
    String(error?.message||error).slice(0,260)+'\n');
  process.exitCode=1;
}finally{
  if(holding){
    holding.kill('SIGKILL');
    await new Promise(resolve=>{
      if(holding.exitCode!==null||holding.signalCode!==null)resolve();
      else{
        const timer=setTimeout(resolve,4000);
        holding.once('exit',()=>{clearTimeout(timer);resolve();});
      }
    });
  }
  // Never unlink a live lock in product logic. This deletion is ONLY after
  // all fixture workers are dead, inside a private one-shot temp test folder.
  fs.rmSync(root,{recursive:true,force:true});
}
