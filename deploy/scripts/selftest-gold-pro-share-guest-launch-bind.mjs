import assert from 'node:assert/strict';
import {GoldProShareGuestLaunchBindPg}
 from '../../operator-host/pro-share-guest-launch-bind-pg.mjs';
const jobId='0af5a9c1-8050-478a-83d1-5e26821cf101';
const pid='lp_'+('a'.repeat(24));
const account='owner1',guest='guest1',device='device1',cmd=
 'cmd_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const delegation={purpose:'pro-share-guest',jobId,
 ownerAccountId:account,guestAccountId:guest,deviceId:device,
 agentId:'agent1',grantId:'grant1',connectionId:'conn1',
 operationId:'guestop-one-12345',permissionRevision:7,
 payloadSha256:'a'.repeat(64),commandId:cmd,processId:pid};
const source={job_id:jobId,operation_id:delegation.operationId,
 owner_account_id:account,guest_account_id:guest,device_id:device,
 agent_id:'agent1',grant_id:'grant1',connection_id:'conn1',
 permission_revision:7,queue_state:'unknown',slot_state:'unknown',
 slot_pid:null,outbound_state:'unknown',command_id:cmd,
 payload_sha256:'a'.repeat(64),
 ticket_envelope:{ticket:{...delegation,
  purpose:'pro-share-guest-process'}},
 m4_state:'unknown',ledger_status:'ok',ledger_exit_code:0,
 signed_job:{jobId,accountId:account,deviceId:device,
  status:'ok',exitCode:0,finishedAt:1850000001000,
  jobRole:'process_launch',effectState:'result_observed',
  signedResultVerified:true,signedGuestDelegationVerified:true,
  guestDelegation:delegation},
 claim_owner:account,claim_state:'admitting',claim_pid:null};
let current={...source},mutations=0,changes=[];
const query=async sql=>{
 const q=sql.replace(/\s+/g,' ').trim();changes.push(q);
 if(['BEGIN','COMMIT','ROLLBACK'].includes(q))return {rowCount:0,rows:[]};
 if(q.startsWith('SELECT device_id FROM lr_gold_pro_share_guest_jobs'))
  return {rowCount:1,rows:[{device_id:device}]};
 if(q.includes('pg_advisory_xact_lock'))return {rowCount:1,rows:[{}]};
 if(q.startsWith('SELECT g.job_id'))return {rowCount:1,rows:[current]};
 if(q.startsWith('UPDATE lr_gold_device_resource_claims')||
    q.startsWith('UPDATE lr_gold_pro_share_guest_slots')){
  mutations++;return {rowCount:1,rows:[{job_id:jobId}]};
 }
 throw Error('fixture_unmodeled_sql');
};
const pool={connect:async()=>({query,release(){}})};
const bridge=new GoldProShareGuestLaunchBindPg({pool,env:{
 LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1',
 LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',
 LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE:'1',
 LR_GOLD_PRO_SHARE_GUEST_SIGNED_LAUNCH:'1',
 LR_GOLD_PRO_SHARE_GUEST_OUTBOUND_PREPARE:'1',
 LR_GOLD_PRO_SHARE_GUEST_LAUNCH_BIND:'1'}});
const off=new GoldProShareGuestLaunchBindPg({pool,env:{}});
await assert.rejects(off.bindFromSignedLedger({jobId}),
 /guest_launch_bind_disabled/);
for(const change of [
 {slot_state:'reserved'},
 {outbound_state:'prepared'},
 {claim_state:'running'},
 {signed_job:{...source.signed_job,signedResultVerified:false}},
 {signed_job:{...source.signed_job,
  guestDelegation:{...delegation,guestAccountId:'foreign'}}},
 {signed_job:{...source.signed_job,
  guestDelegation:{...delegation,processId:'lp_'+('z'.repeat(24))},
  signedGuestDelegationVerified:false}},
 {ticket_envelope:{ticket:{...source.ticket_envelope.ticket,grantId:'wrong'}}}
]){
 current={...source,...change};
 await assert.rejects(bridge.bindFromSignedLedger({jobId}),
  /guest_launch_bind_signed_receipt_provenance_invalid/);
 assert.equal(mutations,0);
}
current={...source};
const result=await bridge.bindFromSignedLedger({jobId});
assert.equal(result.bound,true);
assert.equal(result.processId,pid);
assert.equal(result.terminalAckStillRequired,true);
assert.equal(mutations,2);
assert.ok(changes.indexOf('SELECT pg_advisory_xact_lock(hashtext($1))')>=0);
assert.equal(changes.at(-2).startsWith('UPDATE lr_gold_pro_share_guest_slots'),true);
console.log('GOLD_P2I4C3C2B2_AUTHENTICATED_GUEST_LEDGER_M4_SLOT_ATOMIC_BIND=PASS');
console.log('GOLD_P2I4C3C2B2_REJECT_FOREIGN_UNVERIFIED_AND_REPLAY_LAUNCH=PASS');
