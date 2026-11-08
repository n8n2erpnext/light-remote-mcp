import assert from 'node:assert/strict';
import {createGoldProShareVerifiedLaunch} from '../../operator-host/pro-share-verified-launch.mjs';
const pid='lp_'+'A'.repeat(22),jobId='c0fe740e-681d-43df-b391-541f3d2403a5';
const base={ownerAccountId:'owner1',deviceId:'device1',jobId,processId:pid};
const signedJob={jobId,accountId:'owner1',deviceId:'device1',
 signedResultVerified:true,signedGuestDelegationVerified:true,
 guestDelegation:{purpose:'pro-share-guest',ownerAccountId:'owner1',
  guestAccountId:'guest1',agentId:'agent1',grantId:'grant1',
  connectionId:'conn1',operationId:'guestop-1',permissionRevision:7,
  jobId,deviceId:'device1',processId:pid},
 jobRole:'process_launch',
 effectState:'result_observed',status:'ok',exitCode:0,
 finishedAt:1850000000000};
let rows=[{job_id:jobId,account_id:'owner1',device_id:'device1',
 process_id:pid,worker_state:'running',status:'ok',signed_job:signedJob,
 guest_slot_state:'submitted',guest_owner:'owner1',
 guest_actor:'guest1',guest_agent:'agent1',guest_grant:'grant1',
 guest_connection:'conn1',guest_operation:'guestop-1',guest_revision:7}];
const sql=[];
const pool={async query(q,args){
 sql.push({q,args});
 assert.deepEqual(args,[jobId,'owner1','device1',pid]);
 assert.match(q,/lr_gold_job_records/);
 assert.match(q,/lr_gold_pro_share_guest_jobs/);
 assert.match(q,/lr_gold_pro_share_guest_slots/);
 assert.match(q,/s.state='submitted'/);
 assert.match(q,/s.process_id=\$4/);
 assert.match(q,/lr_gold_device_resource_claims/);
 return {rowCount:rows.length,rows};
}};
const opts={pool,env:{LR_GOLD_PRO_SHARE_CORE:'1',
 LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1',
 LR_GOLD_PRO_SHARE_GUEST_SIGNED_LAUNCH:'1'}};
assert.equal(await createGoldProShareVerifiedLaunch({...opts,env:{}})(base),false);
assert.throws(()=>createGoldProShareVerifiedLaunch({...opts,env:{
 LR_GOLD_PRO_SHARE_GUEST_SIGNED_LAUNCH:'1'}}),/prerequisite_off/);
const verify=createGoldProShareVerifiedLaunch(opts);
assert.equal(await verify(base),true);
const original=structuredClone(rows[0]);
for(const changes of [
 {status:'running'},{signed_job:{...signedJob,signedResultVerified:false}},
 {signed_job:{...signedJob,jobRole:'operation'}},
 {signed_job:{...signedJob,jobId:'other-job'}},
 {signed_job:{...signedJob,exitCode:1}},
 {signed_job:{...signedJob,effectState:'unknown'}},
 {worker_state:'terminal_unknown'},
 {guest_slot_state:'unknown'},
 {signed_job:{...signedJob,guestDelegation:{...signedJob.guestDelegation,
  processId:'lp_'+'B'.repeat(22)}}},
 {process_id:'lp_'+'B'.repeat(22)},
 {account_id:'unrelated'},
 {device_id:'another-device'}]){
 rows=[{...original,...changes}];
 assert.equal(await verify(base),false,JSON.stringify(changes));
}
rows=[];
assert.equal(await verify(base),false);
rows=[original,original];
assert.equal(await verify(base),false,'ambiguous launch evidence');
rows=[original];
assert.equal(await verify({...base,processId:'not-an-agent-process'}),false);
assert.equal(sql.length,15);
console.log('GOLD_P2I4C3B_SIGNED_LAUNCH_REQUIRES_PG_JOB_AND_EXACT_M4_CLAIM=PASS');
console.log('GOLD_P2I4C3B_UNSIGNED_ACK_UNKNOWN_FOREIGN_PROCESS_DENIED=PASS');
