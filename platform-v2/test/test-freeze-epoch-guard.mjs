import assert from 'node:assert/strict';
import {SyntheticFreezeEpochGuard,SYNTHETIC_FREEZE_LANES}
  from '../portability/freeze-epoch-guard.mjs';

let passed=0;
function run(name,fn){ fn(); console.log('PASS '+name); passed++; }
const freeze='lr_rc50_fake_test_epoch_20261012';
function newGuard(){ return new SyntheticFreezeEpochGuard({generation:50}); }
function advanceToDrained(){
  const g=newGuard();g.fence(freeze);
  g.reportExternalWork({jobs:0,ptys:0,commands:0});g.drain();return g;
}
run('freeze_denies_new_mutations_and_drains_prior_mutations',()=>{
  const g=newGuard(),token=g.beginMutation();
  g.fence(freeze);
  assert.throws(()=>g.beginMutation(),/writer_fenced/);
  assert.throws(()=>g.drain(),/active_mutations_not_drained/);
  g.finishMutation(token);g.reportExternalWork({jobs:0,ptys:0,commands:0});
  assert.equal(g.drain().state,'DRAINED');
});
run('active_pty_denies_barrier',()=>{
  const g=newGuard();g.fence(freeze);
  g.reportExternalWork({jobs:0,ptys:1,commands:0});
  assert.throws(()=>g.drain(),/active_external_jobs_or_pty/);
});
run('active_command_denies_barrier',()=>{
  const g=newGuard();g.fence(freeze);
  g.reportExternalWork({jobs:0,ptys:0,commands:1});
  assert.throws(()=>g.drain(),/active_external_jobs_or_pty/);
});
run('unknown_or_unflushed_lane_rejected',()=>{
  const g=advanceToDrained();
  assert.throws(()=>g.acknowledgeLane('phantom',{flushAcknowledged:true,watermark:'test_watermark',generation:50}),/unknown_freeze_lane/);
  assert.throws(()=>g.acknowledgeLane(SYNTHETIC_FREEZE_LANES[0],{flushAcknowledged:false,watermark:'test_watermark',generation:50}),/unflushed_lane/);
  assert.throws(()=>g.checkpoint(),/missing_lane_flush_ack/);
});
run('cross_generation_ack_rejected',()=>{
  const g=advanceToDrained();
  assert.throws(()=>g.acknowledgeLane(SYNTHETIC_FREEZE_LANES[0],{flushAcknowledged:true,watermark:'test_watermark',generation:49}),/lane_generation_mismatch/);
});
run('duplicate_lane_ack_rejected',()=>{
  const g=advanceToDrained(),id=SYNTHETIC_FREEZE_LANES[0];
  g.acknowledgeLane(id,{flushAcknowledged:true,watermark:'test_watermark',generation:50});
  assert.throws(()=>g.acknowledgeLane(id,{flushAcknowledged:true,watermark:'test_watermark',generation:50}),/duplicate_lane_ack/);
});
run('all_lane_acks_enable_synthetic_checkpoint_only',()=>{
  const g=advanceToDrained();
  for(const lane of SYNTHETIC_FREEZE_LANES)
    g.acknowledgeLane(lane,{flushAcknowledged:true,watermark:'synthetic_ledger_50',generation:50});
  const result=g.checkpoint();
  assert.equal(result.state,'CHECKPOINTED');
  assert.equal(result.acknowledgedLanes,6);
  assert.equal(result.realBackupProven,false);
  assert.equal(result.productionCutoverAuthorized,false);
});
run('cannot_checkpoint_twice_or_reopen_without_owner',()=>{
  const g=advanceToDrained();
  for(const lane of SYNTHETIC_FREEZE_LANES)
    g.acknowledgeLane(lane,{flushAcknowledged:true,watermark:'synthetic_ledger_50',generation:50});
  g.checkpoint();
  assert.throws(()=>g.checkpoint(),/checkpoint_not_drained/);
  assert.throws(()=>g.fence(freeze),/freeze_transition_denied/);
});
run('wrong_epoch_prefix_rejected',()=>{
  const g=newGuard();
  assert.throws(()=>g.fence('real_production_freeze'),/invalid_synthetic_freeze_id/);
});
run('negative_or_zero_source_generation_rejected',()=>{
  assert.throws(()=>new SyntheticFreezeEpochGuard({generation:0}),/invalid_source_generation/);
  assert.throws(()=>new SyntheticFreezeEpochGuard({generation:-1}),/invalid_source_generation/);
});
run('unknown_ticket_rejected',()=>{
  const g=newGuard();
  assert.throws(()=>g.finishMutation('bogus'),/unknown_mutation_ticket/);
});
run('missing_external_report_fails_closed',()=>{
  const g=newGuard();g.fence(freeze);
  assert.equal(g.view().jobs,null);
  assert.throws(()=>g.drain(),/missing_external_work_report/);
});
console.log('RC50_FREEZE_EPOCH_SYNTHETIC_TESTS_PASS '+passed+'/'+passed);
