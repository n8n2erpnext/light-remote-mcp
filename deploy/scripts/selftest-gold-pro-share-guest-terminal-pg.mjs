import assert from 'node:assert/strict';
import {GoldGuestTerminalSettlementPg}
 from '../../operator-host/pro-share-guest-terminal-pg.mjs';
import {GoldProShareGuestSlotPg} from '../../operator-host/pro-share-guest-slot-pg.mjs';
const jobId='0af5a9c1-8050-478a-83d1-5e26821cf101',
 owner='owner1',guest='guest1',device='device1',
 pid='lp_'+('p'.repeat(24));
const signed={signedResultVerified:true,signedGuestDelegationVerified:true,
 guestDelegation:{purpose:'pro-share-guest',jobId,ownerAccountId:owner,guestAccountId:guest,
 deviceId:device,processId:pid}};
const base={job_id:jobId,operation_id:'guestop-one-123456',
 owner_account_id:owner,guest_account_id:guest,device_id:device,
 queue_state:'unknown',slot_state:'submitted',slot_pid:pid,
 m3_state:'unknown',launch_job_status:'ok',launch_evidence:signed,
 claim_job:jobId,claim_owner:owner,claim_device:device,
 claim_pid:pid,claim_state:'running',
 ack_owner:owner,ack_device:device,ack_job:jobId,ack_pid:pid,
 terminal_state:'finished',finished_at_ms:'1850000001234',
 acked_at:new Date('2026-10-31T00:00:00Z')};
let row={...base},modifications=0,forceFailure=false;
const calls=[];
const query=async(sql,args=[])=>{
 const q=sql.replace(/\s+/g,' ').trim();calls.push(q);
 if(['BEGIN','ROLLBACK','COMMIT'].includes(q))return {rowCount:0,rows:[]};
 if(q.startsWith('SELECT device_id FROM lr_gold_pro_share_guest_jobs'))
  return {rowCount:1,rows:[{device_id:device}]};
 if(q.includes('pg_advisory_xact_lock'))return {rowCount:1,rows:[{}]};
 if(q.startsWith('SELECT g.job_id'))return {rowCount:1,rows:[row]};
 if(q.startsWith('DELETE FROM lr_gold_device_resource_claims')){
  assert.deepEqual(args,[jobId,owner,device,pid]);
  modifications++;return {rowCount:1,rows:[{job_id:jobId}]};
 }
 if(q.startsWith('UPDATE lr_gold_personal_agent_work')){
  assert.deepEqual(args,[jobId,owner,device]);
  modifications++;return {rowCount:1,rows:[{job_id:jobId}]};
 }
 if(q.startsWith('UPDATE lr_gold_pro_share_guest_slots')){
  assert.equal(args[3],'finished');
  if(forceFailure)return {rowCount:0,rows:[]};
  modifications++;return {rowCount:1,rows:[{operation_id:base.operation_id}]};
 }
 if(q.startsWith('UPDATE lr_gold_pro_share_guest_jobs')){
  modifications++;return {rowCount:1,rows:[{job_id:jobId}]};
 }
 throw Error('fixture_unmodelled_query');
};
const pool={connect:async()=>({query,release(){}})};
const env={LR_GOLD_PRO_SHARE_CORE:'1',
 LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1',LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',
 LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE:'1',
 LR_GOLD_PRO_SHARE_GUEST_LAUNCH_BIND:'1',
 LR_GOLD_PRO_SHARE_GUEST_TERMINAL_SETTLE:'1'};
const terminal=new GoldGuestTerminalSettlementPg({pool,env});
await assert.rejects(new GoldGuestTerminalSettlementPg({pool,env:{}})
 .settle({jobId}),/guest_terminal_disabled/);
assert.throws(()=>new GoldGuestTerminalSettlementPg({
 pool,env:{LR_GOLD_PRO_SHARE_GUEST_TERMINAL_SETTLE:'1'}
}),/guest_terminal_prerequisites_off/);
for(const modified of [
 {ack_owner:null},{ack_pid:'lp_'+('q'.repeat(24))},
 {ack_job:'other-job'},{slot_state:'unknown'},
 {claim_state:'admitting'},
 {launch_evidence:{...signed,signedGuestDelegationVerified:false}},
 {launch_evidence:{...signed,
  guestDelegation:{...signed.guestDelegation,guestAccountId:'foreign'}}},
 {terminal_state:'running'},{m3_state:'finished'},
 {queue_state:'queued'}
]){
 row={...base,...modified};
 await assert.rejects(terminal.settle({jobId}),
  /guest_terminal_signed_m6_ack_not_confirmed|guest_terminal_partial_or_conflicting_completion/);
 assert.equal(modifications,0);
}
row={...base};forceFailure=true;
await assert.rejects(terminal.settle({jobId}),
 /guest_terminal_slot_transition_failed/);
assert.equal(calls.at(-1),'ROLLBACK');
forceFailure=false;modifications=0;
const ended=await terminal.settle({jobId});
assert.equal(ended.settled,true);
assert.equal(ended.terminalState,'finished');
assert.equal(ended.m3Released,true);
assert.equal(ended.m4Released,true);
assert.equal(ended.shouldReissue,false);
assert.equal(modifications,4);
row={...base,claim_job:null,claim_owner:null,claim_device:null,
 claim_pid:null,claim_state:null};
modifications=0;
assert.equal((await terminal.settle({jobId})).settled,true);
assert.equal(modifications,3,'already released M6 claim does not cause another release');
// ACK retry / Operator restart must not run a second M4 or M3 release.
const completed={...base,queue_state:'terminal',slot_state:'terminal',
 m3_state:'finished',m3_disposition:'guest_signed_m6_terminal',
 slot_terminal_state:'finished',slot_terminal_acked_at:base.acked_at,
 claim_job:null,claim_owner:null,claim_device:null,claim_pid:null,
 claim_state:null};
row={...completed};
modifications=0;
const duplicate=await terminal.settle({jobId});
assert.equal(duplicate.settled,true);
assert.equal(duplicate.alreadySettled,true);
assert.equal(duplicate.shouldReissue,false);
assert.equal(modifications,0,'terminal replay must be read-only');
for(const bad of [
 {slot_terminal_state:'error'},
 {slot_terminal_acked_at:new Date('2026-10-31T00:00:01Z')},
 {m3_disposition:'operator_restart_reconcile'},
 {claim_job:jobId,claim_owner:owner,claim_device:device,
  claim_pid:pid,claim_state:'running'},
 {ack_pid:'lp_'+('q'.repeat(24))},
 {launch_evidence:{...signed,signedGuestDelegationVerified:false}}
]){
 row={...completed,...bad};
 await assert.rejects(terminal.settle({jobId}),
 /guest_terminal_signed_m6_ack_not_confirmed|guest_terminal_partial_or_conflicting_completion/);
 assert.equal(modifications,0,'partial or forged terminal retry must never mutate');
}
const slot=new GoldProShareGuestSlotPg({pool,env});
await assert.rejects(slot.reconcileSignedTerminal({
 ownerAccountId:owner,deviceId:device,jobId,processId:pid
}),/guest_slot_use_atomic_m6_terminal_settlement/);
await assert.rejects(slot.reconcileDevice({
 ownerAccountId:owner,deviceId:device
}),/guest_slot_use_atomic_m6_terminal_settlement/);
console.log('GOLD_P2I4C3C2B3_M6_EXACT_SIGNED_RECEIPT_M3_M4_SLOT_QUEUE=PASS');
console.log('GOLD_P2I4C3C2B3_M6_UNSIGNED_WRONG_PID_OTHER_GUEST_DENIED=PASS');
console.log('GOLD_P2I4C3C2B3_M6_ONLY_ATOMIC_SETTLEMENT_NO_SLOT_ONLY_RELEASE=PASS');
console.log('GOLD_P2I4C3C2B3_M6_RESTART_REPLAY_EXACT_RECEIPT_READONLY=PASS');
