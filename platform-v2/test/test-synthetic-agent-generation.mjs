import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SyntheticAgentGeneration} from '../portability/synthetic-agent-generation.mjs';
import {writeSyntheticJsonDurably} from '../portability/durable-json-synthetic.mjs';

let passed=0;
function run(name,fn){fn();passed++;console.log('PASS '+name);}
function fixture(callback){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-agent-fixture-'));
  const agentId='uat_agent_dev_alpha';
  const create=(writer=null)=>new SyntheticAgentGeneration({root,agentId,writer});
  const epoch=(gen=50)=>({generation:gen,controlProof:'uat_ctrl_synthetic_epoch_'+gen});
  const envelope=(commandId='uat_cmd_fake_0001',gen=50)=>({
    agentId,commandId,generation:gen,payload:{kind:'fake_noop',message:'hello synthetic'}
  });
  try{return callback({root,create,epoch,envelope,agentId});}
  finally{fs.rmSync(root,{recursive:true,force:true});}
}
run('new_agent_requires_explicit_fake_epoch',()=>fixture(({create,envelope})=>{
  const a=create();
  assert.equal(a.generation,0);
  assert.throws(()=>a.receive(envelope()),/stale_or_unapproved_agent_generation/);
  assert.equal(a.status.realCommandExecutionAllowed,false);
}));
run('epoch_persisted_and_survives_reopen',()=>fixture(({create,epoch})=>{
  const a=create();
  assert.equal(a.advanceEpoch(epoch()).generation,50);
  assert.equal(create().generation,50);
  assert.equal(a.advanceEpoch(epoch()).status,'already_current');
  assert.equal(a.status.productionCutoverAuthorized,false);
}));
run('fake_command_receipts_are_persisted_before_start_and_finish',()=>fixture(({create,epoch,envelope,root})=>{
  const a=create();a.advanceEpoch(epoch());
  assert.equal(a.receive(envelope()).status,'accepted_receipt_persisted');
  assert.equal(a.startFake('uat_cmd_fake_0001').executed,false);
  assert.equal(a.completeFake('uat_cmd_fake_0001').executed,false);
  const row=a.receipts().uat_cmd_fake_0001;
  assert.equal(row.status,'completed');
  assert.match(row.resultDigest,/^[a-f0-9]{64}$/);
  assert.equal(create().receipts().uat_cmd_fake_0001.status,'completed');
  assert.equal(fs.statSync(path.join(root,'receipts.json')).mode&0o777,0o600);
}));
run('duplicate_idempotent_without_execution',()=>fixture(({create,epoch,envelope})=>{
  const a=create();a.advanceEpoch(epoch());a.receive(envelope());
  assert.equal(a.receive(envelope()).status,'duplicate_no_execution');
  assert.equal(a.receive(envelope()).willExecute,false);
  a.startFake('uat_cmd_fake_0001');
  assert.throws(()=>a.startFake('uat_cmd_fake_0001'),/command_not_safe_to_start/);
}));
run('conflicting_same_command_id_denied',()=>fixture(({create,epoch,envelope})=>{
  const a=create();a.advanceEpoch(epoch());a.receive(envelope());
  const changed=envelope();changed.payload.message='changed';
  assert.throws(()=>a.receive(changed),/command_id_conflicting_envelope/);
}));
run('old_generation_denied_after_epoch_advance',()=>fixture(({create,epoch,envelope})=>{
  const a=create();a.advanceEpoch(epoch());a.receive(envelope());
  a.advanceEpoch(epoch(51));
  assert.equal(a.receipts().uat_cmd_fake_0001.status,'fenced');
  assert.throws(()=>a.receive(envelope('uat_cmd_fake_0002',50)),/stale_or_unapproved_agent_generation/);
  assert.throws(()=>a.startFake('uat_cmd_fake_0001'),/command_not_safe_to_start/);
}));
run('already_started_becomes_uncertain_on_fence',()=>fixture(({create,epoch,envelope})=>{
  const a=create();a.advanceEpoch(epoch());a.receive(envelope());a.startFake('uat_cmd_fake_0001');
  a.advanceEpoch(epoch(51));
  assert.equal(a.receipts().uat_cmd_fake_0001.status,'uncertain');
  assert.throws(()=>a.completeFake('uat_cmd_fake_0001'),/command_not_safe_to_complete/);
}));
run('restart_never_auto_reexecutes_inflight_fake_command',()=>fixture(({create,epoch,envelope})=>{
  const a=create();a.advanceEpoch(epoch());a.receive(envelope());a.startFake('uat_cmd_fake_0001');
  const restarted=create();
  assert.equal(restarted.receipts().uat_cmd_fake_0001.status,'uncertain');
  assert.equal(restarted.receive(envelope()).status,'duplicate_no_execution');
  assert.throws(()=>restarted.startFake('uat_cmd_fake_0001'),/command_not_safe_to_start/);
}));
run('restart_marks_accepted_command_uncertain',()=>fixture(({create,epoch,envelope})=>{
  const a=create();a.advanceEpoch(epoch());a.receive(envelope());
  const restarted=create();
  assert.equal(restarted.receipts().uat_cmd_fake_0001.status,'uncertain');
}));
run('higher_epoch_only_with_new_control_proof',()=>fixture(({create,epoch})=>{
  const a=create();a.advanceEpoch(epoch());
  assert.throws(()=>a.advanceEpoch(epoch(49)),/stale_epoch_control/);
  assert.throws(()=>a.advanceEpoch({generation:50,controlProof:'uat_ctrl_other_approval'}),/conflicting_epoch_control/);
  assert.equal(a.advanceEpoch(epoch(51)).generation,51);
}));
run('unknown_kind_and_identity_denied',()=>fixture(({create,epoch,envelope})=>{
  const a=create();a.advanceEpoch(epoch());
  const e=envelope();e.payload.kind='pty';
  assert.throws(()=>a.receive(e),/invalid_fake_command_envelope/);
  e.payload.kind='fake_noop';e.agentId='uat_agent_other_agent';
  assert.throws(()=>a.receive(e),/invalid_fake_command_envelope/);
}));
run('path_escape_and_nonfixture_root_denied',()=>fixture(({root,agentId})=>{
  assert.throws(()=>new SyntheticAgentGeneration({root:'/tmp',agentId}),/not_synthetic_agent_fixture_root/);
  assert.throws(()=>new SyntheticAgentGeneration({root:root+'/../escape',agentId}),/not_synthetic_agent_fixture_root/);
}));
run('receipt_state_corruption_is_rejected',()=>fixture(({create,epoch,root})=>{
  const a=create();a.advanceEpoch(epoch());
  const file=path.join(root,'receipts.json');
  const state=JSON.parse(fs.readFileSync(file));
  state.generation=-1;
  fs.writeFileSync(file,JSON.stringify(state)+'\n',{mode:0o600});
  assert.throws(()=>create(),/invalid_synthetic_agent_state/);
}));
run('file_fsync_error_poison_denies_future_commands',()=>fixture(({root,agentId,epoch,envelope})=>{
  const writer=(file,value)=>writeSyntheticJsonDurably({
    root,file,value,ops:{...fs,fsyncSync(){throw new Error('fake fsync EIO');}}
  });
  const a=new SyntheticAgentGeneration({root,agentId,writer});
  assert.throws(()=>a.advanceEpoch(epoch()),/synthetic_agent_persist_failed/);
  assert.equal(a.status.poisoned,true);
  assert.throws(()=>a.receive(envelope()),/synthetic_agent_poisoned_restart_and_reconcile/);
}));
run('receipt_symlink_target_not_read',()=>fixture(({create,root})=>{
  const external=path.join(root,'elsewhere.json');
  fs.writeFileSync(external,JSON.stringify({unexpected:true})+'\\n',{mode:0o600});
  fs.symlinkSync(external,path.join(root,'receipts.json'));
  assert.throws(()=>create(),/unsafe_synthetic_receipt_file/);
}));
run('world_readable_receipt_file_not_read',()=>fixture(({create,root})=>{
  const file=path.join(root,'receipts.json');
  fs.writeFileSync(file,'{}\\n');
  fs.chmodSync(file,0o644);
  assert.throws(()=>create(),/unsafe_synthetic_receipt_file/);
}));
run('completed_receipt_survives_generational_fence',()=>fixture(({create,epoch,envelope})=>{
  const a=create();a.advanceEpoch(epoch());a.receive(envelope());a.startFake('uat_cmd_fake_0001');a.completeFake('uat_cmd_fake_0001');
  a.advanceEpoch(epoch(51));
  assert.equal(a.receipts().uat_cmd_fake_0001.status,'completed');
  assert.equal(create().receive(envelope()).willExecute,false);
}));
console.log('RC50_SYNTHETIC_AGENT_GENERATION_PASS '+passed+'/'+passed);
