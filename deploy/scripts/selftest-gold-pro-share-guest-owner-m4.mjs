import assert from 'node:assert/strict';
import {GoldProShareGuestOwnerM4Pg}
 from '../../operator-host/pro-share-guest-owner-m4-pg.mjs';
const now=1850000000000,expire=new Date(now+600000);
const e={jobId:'0af5a9c1-8050-478a-83d1-5e26821cf101',
 operationId:'guestop-abcde123456789',ownerAccountId:'owner1',
 actorAccountId:'guest1',agentId:'oauth-agent-123456789',
 clientSessionId:'lrc_guest_1',deviceId:'device1',nodeId:'node1',
 grantId:'grant1',connectionId:'conn1',permissionRevision:8,
 payloadSha256:'a'.repeat(64)};
const row={
 job_id:e.jobId,operation_id:e.operationId,
 owner_account_id:e.ownerAccountId,guest_account_id:e.actorAccountId,
 agent_id:e.agentId,client_session_id:e.clientSessionId,
 device_id:e.deviceId,grant_id:e.grantId,
 connection_id:e.connectionId,permission_revision:e.permissionRevision,
 required_capabilities:['filesystem'],
 operation:'process',job_state:'queued',slot_state:'reserved',
 payload_sha256:e.payloadSha256,share_revision:8,addon_state:'active',
 valid_until_ms:now+1000000,seat_status:'accepted',
 shared_device:'device1',ab_purpose:'pro-share-guest',
 ab_closed_at:null,ab_agent:e.agentId,ab_actor:e.actorAccountId,
 ab_expires_at:expire,absolute_expires_at:expire,
 connection_owner:'owner1',connection_closed:null,connection_expires:expire,
 device_owner:'owner1',device_state:'online',device_node:'node1',
 native_client_owner:'guest1',native_agent:e.agentId,
 client_closed:null,client_expires:expire,bound_grant:e.grantId,
 bound_connection:'conn1',bound_purpose:'pro-share-guest'
};
let received={...row},resourceAllowed=true,writeFailures=false,
 cancellationFail=null,
 cancellationStates={queue_state:'cancelled',slot_state:'cancelled',
 worker_state:'admitting',process_id:null,m3_state:'running',
 gold_status:'queued',outbound_job:null};
const statements=[],events=[];
const query=async(sql,args=[])=>{
 const q=sql.replace(/\s+/g,' ').trim();
 statements.push({sql:q,args});
 if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK'){
  events.push(q);return {rowCount:0,rows:[]};
 }
 if(q.includes('pg_advisory_xact_lock'))return {rowCount:1,rows:[]};
 if(q.startsWith('SELECT g.job_id'))return {rowCount:1,rows:[{...received}]};
 if(q.startsWith('INSERT INTO lr_gold_personal_agent_work')){
  events.push('M4_PERSONAL_WORK');return {rowCount:1,rows:[]};
 }
 if(q.startsWith('INSERT INTO lr_gold_job_records')){
  if(writeFailures)throw Error('gold_ledger_failed');
  events.push('GOLD_LEDGER');
  const record=JSON.parse(args[6]);
  assert.equal(record.guestScope.guestAccountId,'guest1');
  assert.equal(record.guestScope.payloadSha256,e.payloadSha256);
  assert.equal(record.signedGuestDelegationVerified,false);
  assert.equal(record.outputStorage,'operator_event_log');
  assert.equal(args[0],e.jobId);assert.equal(args[1],e.ownerAccountId);
  assert.equal(args[3],'gshare_'+e.jobId);
  assert.equal(JSON.stringify(record).includes('printf'),false);
  return {rowCount:1,rows:[]};
 }
 if(q.startsWith('SELECT g.state AS queue_state'))
  return {rowCount:1,rows:[cancellationStates]};
 if(q.startsWith('DELETE FROM lr_gold_device_resource_claims'))
  return cancellationFail==='claim'?{rowCount:0,rows:[]}:
   {rowCount:1,rows:[{job_id:e.jobId}]};
 if(q.startsWith('DELETE FROM lr_gold_personal_agent_work')||
    q.startsWith('DELETE FROM lr_gold_job_records')){
  assert.deepEqual(args,[e.jobId,e.ownerAccountId,e.deviceId]);
  const target=q.includes('lr_gold_personal_agent_work')?'m3':'gold';
  return cancellationFail===target?{rowCount:0,rows:[]}:
    {rowCount:1,rows:[{job_id:e.jobId}]};
 }
 throw Error('unrecognized-query:'+q.slice(0,90));
};
let lockCalls=0;
const resourceLocks={async tryClaim(client,claim){
 lockCalls++;events.push('M4_RESOURCE');
 assert.equal(claim.job_id,e.jobId);
 assert.equal(claim.account_id,'owner1');
 assert.equal(claim.resource_key,'device:unknown');
 assert.equal(claim.resource_mode,'exclusive');
 assert.equal(claim.worker_weight,1);
 return {granted:resourceAllowed};
}};
const pool={connect:async()=>({query,release(){events.push('release')}})};
const env={LR_GOLD_PRO_SHARE_CORE:'1',
 LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1',
 LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',
 LR_GOLD_PRO_SHARE_GUEST_PAYLOAD_STAGE:'1',
 LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL:'1',
 LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE:'1'};
const bridge=new GoldProShareGuestOwnerM4Pg({
 pool,resourceLocks,env,now:()=>now
});
assert.equal((await bridge.reserve(e)).jobId,e.jobId);
assert.deepEqual(events.filter(x=>[
 'BEGIN','M4_PERSONAL_WORK','M4_RESOURCE','GOLD_LEDGER','COMMIT'].includes(x)),
 ['BEGIN','M4_PERSONAL_WORK','M4_RESOURCE','GOLD_LEDGER','COMMIT']);
assert.equal(lockCalls,1);
const invalid=[
 {...e,ownerAccountId:'other'}, {...e,actorAccountId:'other'},
 {...e,grantId:'other'}, {...e,clientSessionId:'other'},
 {...e,connectionId:'other'}, {...e,permissionRevision:9},
 {...e,deviceId:'other'},{...e,payloadSha256:'b'.repeat(64)}
];
for(const evidence of invalid)
 await assert.rejects(bridge.reserve(evidence),
 /guest_m4_fresh_authority_or_scope_denied/);
assert.equal(lockCalls,1);
received={...row,addon_state:'revoked'};
await assert.rejects(bridge.reserve(e),/guest_m4_fresh_authority_or_scope_denied/);
received={...row};
resourceAllowed=false;
await assert.rejects(bridge.reserve(e),/guest_m4_device_resource_unavailable/);
assert.equal(events.at(-2),'ROLLBACK');
resourceAllowed=true;writeFailures=true;
await assert.rejects(bridge.reserve(e),/gold_ledger_failed/);
assert.equal(events.at(-2),'ROLLBACK');
writeFailures=false;
assert.equal((await bridge.cancelBeforeEffect({
 jobId:e.jobId,ownerAccountId:e.ownerAccountId,deviceId:e.deviceId
})).cancelled,true);
// No outbound, same canonical Guest and M4, and all three exact deletes
// are mandatory: any missing Gold/M3/claim must ROLLBACK, never report success.
for(const [target,code] of [
 ['claim','guest_m4_cancel_claim_mismatch'],
 ['m3','guest_m4_cancel_m3_mismatch'],
 ['gold','guest_m4_cancel_gold_mismatch']]){
 cancellationFail=target;
 await assert.rejects(bridge.cancelBeforeEffect({
  jobId:e.jobId,ownerAccountId:e.ownerAccountId,deviceId:e.deviceId
 }),new RegExp(code));
 assert.equal(events.at(-2),'ROLLBACK');
}
cancellationFail=null;
for(const mutated of [
 {outbound_job:e.jobId},{m3_state:'unknown'},{gold_status:'interrupted'},
 {process_id:'lp_'+'x'.repeat(24)},{worker_state:'terminal_unknown'},
 {queue_state:'unknown'},{slot_state:'unknown'}
]){
 cancellationStates={queue_state:'cancelled',slot_state:'cancelled',
  worker_state:'admitting',process_id:null,m3_state:'running',
  gold_status:'queued',outbound_job:null,...mutated};
 await assert.rejects(bridge.cancelBeforeEffect({
  jobId:e.jobId,ownerAccountId:e.ownerAccountId,deviceId:e.deviceId
 }),/guest_m4_cannot_cancel_after_effect/);
 assert.equal(events.at(-2),'ROLLBACK');
}
cancellationStates={queue_state:'unknown',slot_state:'unknown',
 worker_state:'running'};
await assert.rejects(bridge.cancelBeforeEffect({
 jobId:e.jobId,ownerAccountId:e.ownerAccountId,deviceId:e.deviceId
}),/guest_m4_cannot_cancel_after_effect/);
const off=new GoldProShareGuestOwnerM4Pg({pool,env:{}});
await assert.rejects(off.reserve(e),/guest_m4_bridge_disabled/);
assert.throws(()=>new GoldProShareGuestOwnerM4Pg({
 pool,env:{LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE:'1'}
}),/guest_m4_prerequisites_off/);
console.log('GOLD_P2I4C3C2B1_M4_OWNER_UUID_PG_TXN_ATOMIC_RESOURCE_LEDGER=PASS');
console.log('GOLD_P2I4C3C2B1_GUEST_SCOPE_REVOKE_CONFLICT_ROLLBACK=PASS');
console.log('GOLD_P2I4C3C2B1_UNKNOWN_REFUSES_CANCEL_NO_OS_REPLAY=PASS');

console.log('GOLD_GUEST_M4_CANCEL_OUTBOUND_PID_AND_PARTIAL_DELETE_FAIL_CLOSED=PASS');
