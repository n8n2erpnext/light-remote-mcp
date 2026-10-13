#!/usr/bin/env node
/**
 * Test-only Agent worker. Must be launched under Linux flock -n -F on a
 * stable fixture-local inode by the exclusive UAT supervisor.
 * Invoking this script alone is UNSAFE: it doesn't prove flock possession.
 * Never integrated into real Agent and no OS/remote command is executed.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {SyntheticAgentGeneration} from './synthetic-agent-generation.mjs';

const [root,action]=process.argv.slice(2);
function fail(reason){process.stderr.write('RC50_LOCKED_WORKER_REFUSED '+reason+'\n');process.exit(2);}
if(typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root
  ||path.dirname(root)!==path.resolve(os.tmpdir())
  ||!path.basename(root).startsWith('lr-rc50-agent-fixture-lock-'))
  fail('bad_fixture_path');
if(!['hold','reopen','duplicate','second','inspect'].includes(action))fail('bad_fake_action');
try{
  const rootSt=fs.lstatSync(root);
  if(rootSt.isSymbolicLink()||!rootSt.isDirectory())fail('bad_fixture_directory');
  const lock=path.join(root,'receipt.lock');
  const st=fs.lstatSync(lock);
  if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o077)!==0||st.nlink!==1)
    fail('bad_fixture_lock');
  let inherited;
  try{inherited=fs.fstatSync(3);}catch{fail('missing_inherited_lock_fd');}
  if(!inherited.isFile()||inherited.dev!==st.dev||inherited.ino!==st.ino
      ||(inherited.mode&0o077)!==0||inherited.nlink!==1)
    fail('inherited_lock_inode_mismatch');
  // fd 3 is the supervisor's inherited descriptor on which flock -F holds
  // the OS lock. Inode match is necessary but NOT standalone proof of lock.
  const agent=new SyntheticAgentGeneration({root,agentId:'uat_agent_locked_test'});
  const envelope=id=>({agentId:'uat_agent_locked_test',commandId:id,
    generation:50,payload:{kind:'fake_noop',message:'mutex UAT only'}});
  const epoch={generation:50,controlProof:'uat_ctrl_locked_fixture_epoch_50'};
  if(action==='hold'){
    agent.advanceEpoch(epoch);
    const r=agent.receive(envelope('uat_cmd_mutex_first'));
    if(r.status!=='accepted_receipt_persisted')fail('first_receipt_not_persisted');
    agent.startFake('uat_cmd_mutex_first');
    process.stdout.write('RC50_EXCLUSIVE_WORKER_LOCK_HELD\n');
    // Kill by supervisor with SIGKILL: demonstrates OS automatic lock release.
    setInterval(()=>{},1000);
  }else if(action==='reopen'){
    const r=agent.receipts();
    if(r.uat_cmd_mutex_first?.status!=='uncertain')fail('recovered_receipt_not_uncertain');
    process.stdout.write('RC50_EXCLUSIVE_RECOVERED_UNCERTAIN\n');
  }else if(action==='duplicate'){
    agent.advanceEpoch(epoch);
    const r=agent.receive(envelope('uat_cmd_mutex_first'));
    if(r.status!=='duplicate_no_execution'||r.willExecute!==false)
      fail('duplicate_not_quarantined');
    let denied=false;
    try{agent.startFake('uat_cmd_mutex_first');}
    catch(e){if(e.message==='command_not_safe_to_start')denied=true;else throw e;}
    if(!denied)fail('old_receipt_restarted');
    process.stdout.write('RC50_EXCLUSIVE_DUPLICATE_REJECTED\n');
  }else if(action==='second'){
    agent.advanceEpoch(epoch);
    const r=agent.receive(envelope('uat_cmd_mutex_second'));
    if(r.status!=='accepted_receipt_persisted')fail('second_receipt_not_persisted');
    process.stdout.write('RC50_EXCLUSIVE_SECOND_RECEIPT_SAVED\n');
  }else{
    const rows=agent.receipts();
    if(rows.uat_cmd_mutex_first?.status!=='uncertain'
       ||rows.uat_cmd_mutex_second?.status!=='uncertain'
       ||Object.keys(rows).length!==2)fail('lost_or_corrupted_receipt');
    process.stdout.write('RC50_EXCLUSIVE_TWO_RECEIPTS_PRESERVED\n');
  }
}catch(e){
  fail('worker_failed_'+String(e.message).replace(/\s+/g,'_').slice(0,100));
}
