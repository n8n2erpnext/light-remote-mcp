import assert from 'node:assert/strict';
import {createGoldProShareDispatchGate} from '../../operator-host/pro-share-dispatch-gate.mjs';
const env={LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_GUEST_DISPATCH:'1'};
let clock=1850000000000,revision=3,revoked=false,quota=false,slotBusy=false,
 calls=0,slots=0,checks=0,charged=0,dispatched=0,changedConnection=false,terminalRelease=null;
const jobs=new Map(),events=new Map();
const job=(name,options={})=>({jobId:name,identitySource:'verified-oauth',state:'queued',
 actorAccountId:'guest-1',agentId:'agent-1',deviceId:'device-1',
 grantId:'guest-grant',operationId:name+'-operation-accepted',
 operation:'exec',requiredCapabilities:['filesystem'],...options});
const device={deviceId:'device-1',nodeId:'node-1',accountId:'owner-1',state:'online'};
const baseConnection={deviceId:'device-1',accountId:'owner-1',
 connectionId:'connection-1',state:'connected',hardExpiresAt:clock+50000};
const store={
 async authorizeOperation(input){
  checks++;
  assert.equal(input.authenticatedActorAccountId,'guest-1');
  if(input.authenticatedAgentId!=='agent-1')throw Error('pro_share_guest_independent_agent_denied');
  assert.equal(input.grantId,'guest-grant');
  assert.equal(input.operation,'exec');
  assert.deepEqual(input.requiredCapabilities,['filesystem']);
  if(revoked)throw Error('pro_share_guest_device_or_addon_required');
  if(!input.routeCapabilities.includes('filesystem'))throw Error('shared_device_capability_denied');
  return {actorAccountId:'guest-1',agentId:'agent-1',deviceId:'device-1',
   connectionId:input.connection.connectionId,grantId:'guest-grant',
   deviceOwnerAccountId:'owner-1',billedAccountId:'owner-1',
   permissionRevision:revision,accessExpiresAt:clock+40000,
   maxGuestConcurrentJobs:1,requiredCapabilities:['filesystem']};
 },
 async billOnce({operationId,...args}){
  assert.equal(args.authenticatedActorAccountId,'guest-1');
  assert.equal(args.device.accountId,'owner-1');
  assert.equal(args.units,1);
  if(quota)throw Error('pro_share_guest_monthly_budget_exhausted');
  const prior=events.has(operationId);
  if(!prior){events.set(operationId,true);charged++}
  return {billedAccountId:'owner-1',operationId,charged:!prior,idempotent:prior};
 }
};
const getJob=async id=>jobs.get(id);
const getContext=async()=>({device,connection:{
 ...baseConnection,connectionId:changedConnection?'connection-2':'connection-1'},
 nodeId:'node-1',approvedCapabilities:['filesystem'],routeCapabilities:['filesystem']});
const acquireGuestSlot=async ({maxConcurrent})=>{
 assert.equal(maxConcurrent,1);
 if(slotBusy)return {acquired:false};
 slotBusy=true;slots++;
 const release=async()=>{slotBusy=false};terminalRelease=release;
 return {acquired:true,release};
};
const dispatchEffect=async payload=>{
 dispatched++;
 assert.equal(payload.ownerAccountId,'owner-1');
 assert.equal(payload.actorAccountId,'guest-1');
 assert.deepEqual(payload.requiredCapabilities,['filesystem']);
 return {accepted:true};
};
const opts={env,store,accessGrants:{assert(){}},loadTrustedJob:getJob,
 loadFreshContext:getContext,acquireGuestSlot,dispatchEffect,now:()=>clock};
const off=createGoldProShareDispatchGate({...opts,env:{}});
await assert.rejects(off.admit({jobId:'job-off'}),/pro_share_dispatch_disabled/);
assert.throws(()=>createGoldProShareDispatchGate({...opts,acquireGuestSlot:null}),
 /pro_share_dispatch_dependencies_missing/);
const gate=createGoldProShareDispatchGate(opts);
jobs.set('job-one',job('job-one'));
const one=await gate.admit({jobId:'job-one'});
assert.equal(one.dispatchable,true);
assert.equal((await gate.dispatch({ticketId:one.ticketId})).accepted,true);
assert.equal(charged,1);
assert.equal(dispatched,1);
assert.equal(slots,1);
assert.equal(slotBusy,true,'accepted job holds slot until signed terminal evidence');
await terminalRelease(); // mocked signed terminal reconciler (not an Operator ACK)
await assert.rejects(gate.dispatch({ticketId:one.ticketId}),/pro_share_ticket_not_queued/);
jobs.set('job-revoked',job('job-revoked'));
const r=await gate.admit({jobId:'job-revoked'});
revoked=true;
await assert.rejects(gate.dispatch({ticketId:r.ticketId}),/pro_share_guest_device_or_addon_required/);
assert.equal(dispatched,1);
revoked=false;
jobs.set('job-revision',job('job-revision'));
const rev=await gate.admit({jobId:'job-revision'});
revision++;
await assert.rejects(gate.dispatch({ticketId:rev.ticketId}),/pro_share_permission_revision_changed/);
assert.equal(dispatched,1);
jobs.set('job-connection',job('job-connection'));
const conn=await gate.admit({jobId:'job-connection'});
changedConnection=true;
await assert.rejects(gate.dispatch({ticketId:conn.ticketId}),/pro_share_permission_revision_changed/);
changedConnection=false;
jobs.set('job-no-slot',job('job-no-slot'));
const busy=await gate.admit({jobId:'job-no-slot'});
slotBusy=true;
await assert.rejects(gate.dispatch({ticketId:busy.ticketId}),/pro_share_guest_slot_unavailable/);
slotBusy=false;
jobs.set('job-over-quota',job('job-over-quota'));
const over=await gate.admit({jobId:'job-over-quota'});
quota=true;
await assert.rejects(gate.dispatch({ticketId:over.ticketId}),/pro_share_guest_monthly_budget_exhausted/);
assert.equal(dispatched,1);
quota=false;
jobs.set('job-job-change',job('job-job-change'));
const mut=await gate.admit({jobId:'job-job-change'});
jobs.set('job-job-change',job('job-job-change',{agentId:'evil-agent'}));
await assert.rejects(gate.dispatch({ticketId:mut.ticketId}),/pro_share_guest_independent_agent_denied/);
assert.equal(dispatched,1);
jobs.set('job-bad-oauth',job('job-bad-oauth',{identitySource:'client-body'}));
await assert.rejects(gate.admit({jobId:'job-bad-oauth'}),/pro_share_trusted_queued_job_required/);
assert.equal(charged,1);
assert.equal(slotBusy,false);
assert.ok(checks>=10);
console.log('GOLD_P2I4C_GUEST_ADMISSION_DISPATCH_REVOKE_CAPABILITY_BUDGET_SINGLE_SLOT=PASS');
console.log('GOLD_P2I4C_LEGACY_ROUTES_UNMOUNTED_AND_DEFAULT_OFF=PASS');
