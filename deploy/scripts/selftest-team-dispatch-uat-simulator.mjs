import assert from 'node:assert/strict';
import {TeamDispatchUatSimulator,teamUatCapabilities} from
  '../../operator-host/team-dispatch-uat-simulator.mjs';
import {TeamSessionUatRegistry} from '../../operator-host/team-session-uat-registry.mjs';
import {authorizeTrustedTeamDispatch} from '../../operator-host/team-dispatch-authority.mjs';
import {DeviceAccessGrantRegistry,AB_GRANT_MAX_LIFETIME_MS} from
  '../../operator-host/device-access-grant-registry.mjs';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
import {teamOAuthAgentId} from '../../lib/team-oauth-principal-proof.mjs';

let now=Date.now(),plan='pro';
const owner='paid-owner',device={deviceId:'shared-device',nodeId:'shared-node',
  accountId:owner,state:'online'};
const connection={connectionId:'owner-connection',accountId:owner,
  state:'connected',hardExpiresAt:now+AB_GRANT_MAX_LIFETIME_MS};
const allowed=['filesystem','terminal','desktop','desktop-input'];
const grants=new DeviceAccessGrantRegistry({now:()=>now});
const teams=new ProTeamRegistry({now:()=>now,planFor:()=>plan,
  accountActive:()=>true,onRevoke:({memberAccountId,deviceId,reason})=>
    grants.revokeTeamMember({accountId:memberAccountId,deviceId,reason})});
teams.create({ownerAccountId:owner});
teams.shareDevice({ownerAccountId:owner,deviceId:device.deviceId,
  deviceOwnerAccountId:owner});
const enroll=(name,clientId)=>{
  const invitation=teams.invite({ownerAccountId:owner,memberAccountId:name});
  teams.accept({memberAccountId:name,inviteCode:invitation.inviteCode});
  const agent=teamOAuthAgentId({accountId:name,clientId});
  const request=grants.request({accountId:name,agentId:agent,
    deviceId:device.deviceId,connectionId:connection.connectionId,
    connectionExpiresAt:connection.hardExpiresAt,forceApproval:true,
    purpose:'team-member'});
  grants.approve(request.request.requestId,{
    deviceId:device.deviceId,connectionId:connection.connectionId,
    connectionExpiresAt:connection.hardExpiresAt
  });
  return {authenticatedActorAccountId:name,authenticatedAgentId:agent};
};
const a=enroll('memberA','client-A'),b=enroll('memberB','client-B'),
  c=enroll('memberC','client-C'),d=enroll('memberD','client-D');
assert.throws(()=>teams.invite({ownerAccountId:owner,
  memberAccountId:'memberE'}),/team_seat_limit/,'owner plus four members max');
const authority=params=>authorizeTrustedTeamDispatch({
  ...params,device,connection,accessGrants:grants,teamRegistry:teams,
  planFor:()=>plan,now,approvedCapabilities:allowed,routeCapabilities:allowed
});
const sessions=new TeamSessionUatRegistry({now:()=>now,
  resolveAuthority:authority,maxActive:12,maxPerNode:8});
const open=(identity,operation='fs',requiredCapabilities=['filesystem'])=>
  sessions.open({...identity,deviceId:device.deviceId,operation,requiredCapabilities});
const as=open(a),bs=open(b),cs=open(c);
let meterEvents=[],meterFailNext=false;
const inferred=[];
const inferCommandCapabilities=(script)=>{
  inferred.push(script);
  const result=script.includes('sudo')?['sudo-on-demand','filesystem']:['filesystem'];
  return result;
};
const sim=new TeamDispatchUatSimulator({teamSessions:sessions,
  inferCommandCapabilities,now:()=>now,maxQueued:8,meterPreview:e=>{
    if(meterFailNext){meterFailNext=false;throw Error('meter_preview_failure');}
    meterEvents.push(e);
  }});
const admission=(identity,session,operationId,descriptor={family:'fs',action:'read',path:'/data'})=>
  sim.admit({identity,sessionId:session.sessionId,deviceId:device.deviceId,
    operationId,descriptor});

// 1 worker belongs to paying owner; 2 team workers share remaining slots.
sim.reserveOwner({deviceId:device.deviceId,ownerAccountId:owner,ownerJobId:'owner-running-1'});
assert.deepEqual(sim.slots(device.deviceId),{deviceId:device.deviceId,
  owner:1,team:0,total:1,free:2,limit:3,previewOnly:true});
const aj=admission(a,as,'op-a-001'),bj=admission(b,bs,'op-b-001'),
  cj=admission(c,cs,'op-c-001');
assert.equal(meterEvents.length,0,'queued jobs must not consume owner tool quota');
assert.equal(admission(a,as,'op-a-001').jobId,aj.jobId,'retry returns original');
assert.throws(()=>admission(a,as,'op-a-001',
  {family:'fs',action:'delete',path:'/data'}),/team_simulator_idempotency_conflict/);
const otherActorSameId=admission(b,bs,'op-a-001');
assert.notEqual(otherActorSameId.jobId,aj.jobId,
  'identical ID by separate actor is isolated');
assert.throws(()=>sim.cancel(otherActorSameId.jobId,a),
  /team_simulator_job_actor_denied/);
assert.equal(sim.cancel(otherActorSameId.jobId,b).state,'cancelled');
assert.equal(sim.dispatchNext(device.deviceId).jobId,aj.jobId);
assert.equal(sim.dispatchNext(device.deviceId).jobId,bj.jobId);
assert.equal(sim.dispatchNext(device.deviceId),null);
assert.equal(sim.slots(device.deviceId).total,3);
assert.throws(()=>sim.reserveOwner({deviceId:device.deviceId,
  ownerAccountId:owner,ownerJobId:'owner-running-2'}),/team_simulator_workers_busy/);
assert.equal(sim.ledger(owner).length,2);
assert.equal(sim.ledger('memberA').length,0);
assert(meterEvents.every(e=>e.billedAccountId===owner&&e.previewOnly===true));
assert.throws(()=>sim.job(aj.jobId,b),/team_simulator_job_actor_denied/);
assert.equal(sim.job(aj.jobId,a).state,'running');
assert.equal(sim.finish(aj.jobId).state,'completed');
assert.equal(sim.dispatchNext(device.deviceId).jobId,cj.jobId);
assert.equal(sim.slots(device.deviceId).total,3);
assert.equal(sim.ledger(owner).length,3);
assert.equal(admission(a,as,'op-a-001').state,'completed','final idempotency state');
assert.equal(sim.finish(bj.jobId).state,'completed');
assert.equal(sim.finish(cj.jobId).state,'completed');
assert.equal(sim.releaseOwner('owner-running-1').total,0);
assert.equal(sim.ledger(owner).length,3,'completed retry never double charges');
// Owner may occupy ALL three slots: member work must remain queued.
// No optimistic capacity borrowing is allowed by the simulator.
sim.reserveOwner({deviceId:device.deviceId,ownerAccountId:owner,ownerJobId:'owner-1'});
sim.reserveOwner({deviceId:device.deviceId,ownerAccountId:owner,ownerJobId:'owner-2'});
sim.reserveOwner({deviceId:device.deviceId,ownerAccountId:owner,ownerJobId:'owner-3'});
const waitingOwner=admission(a,as,'op-a-owner-full');
assert.equal(sim.dispatchNext(device.deviceId),null);
assert.equal(sim.job(waitingOwner.jobId,a).state,'queued');
sim.releaseOwner('owner-1');
assert.equal(sim.dispatchNext(device.deviceId).jobId,waitingOwner.jobId);
assert.equal(sim.slots(device.deviceId).total,3);
assert.throws(()=>sim.reserveOwner({deviceId:device.deviceId,
  ownerAccountId:owner,ownerJobId:'owner-1'}),/team_simulator_workers_busy/);
sim.finish(waitingOwner.jobId);
sim.releaseOwner('owner-2');sim.releaseOwner('owner-3');
assert.equal(sim.slots(device.deviceId).total,0);
assert.equal(sim.ledger(owner).length,4);


// Capabilities are derived at server, not from caller assertion.
assert.deepEqual(teamUatCapabilities({family:'desktop',action:'input'}).requiredCapabilities,
  ['desktop','desktop-input']);
assert.deepEqual(teamUatCapabilities({family:'search',action:'start'}).requiredCapabilities,
  ['filesystem']);
assert.throws(()=>teamUatCapabilities({family:'terminal',action:'input',data:'sudo whoami'}),
  /team_interactive_input_policy_unimplemented/);
assert.throws(()=>teamUatCapabilities({family:'process',action:'input',data:'sudo whoami'}),
  /team_interactive_input_policy_unimplemented/);
assert.throws(()=>teamUatCapabilities({family:'billing',action:'refund'}),
  /team_descriptor_operation_denied/);
assert.throws(()=>teamUatCapabilities({family:'exec',action:'run',script:'sudo systemctl stop test'}),
  /team_platform_command_policy_required/);
assert.throws(()=>teamUatCapabilities({family:'exec',action:'run',script:'sudo test'},
  {inferCommandCapabilities:()=>[]}),/team_command_capability_inference_invalid/);
assert.throws(()=>teamUatCapabilities({family:'fs',action:'read',
  requiredCapabilities:[]}),/team_descriptor_privileged_fields_forbidden/);
const execSession=open(d,'exec',['filesystem']);
assert.throws(()=>admission(d,execSession,'op-a-sudo',
  {family:'exec',action:'run',script:'sudo systemctl stop some-service'}),
  /team_simulator_session_policy_denied/);
assert.equal(inferred.at(-1),'sudo systemctl stop some-service');
assert.throws(()=>admission(a,as,'op-a-other-op',
  {family:'desktop',action:'input'}),/team_simulator_session_policy_denied/);
assert.throws(()=>admission(a,as,'op-a-identity',
  {family:'fs',action:'read',agentId:b.authenticatedAgentId}),
  /team_descriptor_privileged_fields_forbidden/);
assert.equal(sim.ledger(owner).length,4,'denied attempts cannot bill');
assert.throws(()=>teamUatCapabilities({family:'fs',action:'read',
  payload:'x'.repeat(140_000)}),/team_descriptor_too_large/);
// Hold suspends dispatch without destroying a still-authorized queue entry.
const paused=admission(b,bs,'op-b-paused');
assert.equal(sessions.hold(bs.sessionId,b,'member_paused').state,'hold');
assert.equal(sim.dispatchNext(device.deviceId),null);
assert.equal(sim.job(paused.jobId,b).state,'queued');
assert.equal(sim.slots(device.deviceId).team,0);
assert.equal(sessions.resume(bs.sessionId,b).state,'active');
assert.equal(sim.dispatchNext(device.deviceId).jobId,paused.jobId);
sim.finish(paused.jobId);


// Preview meter failure leaves queue intact, can retry exactly once.
// Atomic in-process scheduling stress: no owner or Team slot oversubscription.
const stressSim=new TeamDispatchUatSimulator({teamSessions:sessions,
  now:()=>now,maxQueued:20});
const stressIds=Array.from({length:15},(_,i)=>
  stressSim.admit({identity:b,sessionId:bs.sessionId,deviceId:device.deviceId,
    operationId:'op-b-stress-'+i,descriptor:{family:'fs',action:'read'}}).jobId);
const started=await Promise.all(Array.from({length:15},async()=>
  stressSim.dispatchNext(device.deviceId)));
assert.equal(started.filter(Boolean).length,3);
assert.equal(stressSim.slots(device.deviceId).total,3);
for(const job of started.filter(Boolean))stressSim.finish(job.jobId);
// Cancel remaining queued stress jobs: cannot accidentally be dispatched.
for(const id of stressIds){
  if(stressSim.job(id,b).state==='queued')stressSim.cancel(id,b);
}
assert.equal(stressSim.slots(device.deviceId).total,0);
assert.equal(stressSim.ledger(owner).length,3);
const retry=admission(a,as,'op-a-meter-failure');
meterFailNext=true;
assert.throws(()=>sim.dispatchNext(device.deviceId),/meter_preview_failure/);
assert.equal(sim.job(retry.jobId,a).state,'queued');
assert.equal(sim.slots(device.deviceId).team,0);
assert.equal(sim.dispatchNext(device.deviceId).jobId,retry.jobId);
assert.equal(meterEvents.filter(e=>e.jobId===retry.jobId).length,1);
sim.finish(retry.jobId);

// Revoked member queue must not start, while other member still works.
const blocked=admission(a,as,'op-a-revoked'),fine=admission(b,bs,'op-b-valid');
teams.remove({ownerAccountId:owner,memberAccountId:'memberA'});
assert.equal(sim.dispatchNext(device.deviceId).jobId,fine.jobId);
assert.equal(sim.job(blocked.jobId,a).state,'cancelled');
assert.equal(sim.ledger(owner).some(e=>e.jobId===blocked.jobId),false);
assert.equal(sim.job(fine.jobId,b).state,'running');
sim.finish(fine.jobId);

// Revocation of an in-flight SIMULATED lease removes its worker slot.
const runningB=admission(b,bs,'op-b-inflight');
assert.equal(sim.dispatchNext(device.deviceId).jobId,runningB.jobId);
const unstartedC=admission(c,cs,'op-c-pending');
teams.unshareDevice({ownerAccountId:owner,deviceId:device.deviceId});
assert.equal(sim.reapRevoked(),2);
assert.equal(sim.slots(device.deviceId).total,0);
assert.equal(sim.job(runningB.jobId,b).state,'cancelled');
assert.equal(sim.job(unstartedC.jobId,c).state,'cancelled');
assert.equal(sim.ledger(owner).some(e=>e.jobId===unstartedC.jobId),false);
teams.shareDevice({ownerAccountId:owner,deviceId:device.deviceId,
  deviceOwnerAccountId:owner});
assert.throws(()=>admission(c,cs,'op-c-after-reshare'),
  /team_member_access_grant_required|team_session_not_found/);

// New local B grant is required even after paid owner reshares.
const approvedAgain=grants.request({accountId:'memberC',
  agentId:c.authenticatedAgentId,deviceId:device.deviceId,
  connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt,
  forceApproval:true,purpose:'team-member'});
grants.approve(approvedAgain.request.requestId,{deviceId:device.deviceId,
  connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt});
const newSessionC=open(c);
assert.notEqual(newSessionC.sessionId,cs.sessionId);
const beforeDowngrade=admission(c,newSessionC,'op-c-owner-downgrade');
plan='free';
assert.equal(sim.reapRevoked(),1);
assert.equal(sim.job(beforeDowngrade.jobId,c).state,'cancelled');
assert.equal(sim.ledger(owner).some(e=>e.jobId===beforeDowngrade.jobId),false);
plan='pro';
assert.throws(()=>sim.job(beforeDowngrade.jobId,a),/team_simulator_job_actor_denied/);

const freshAfterDowngrade=open(c);
assert.notEqual(freshAfterDowngrade.sessionId,newSessionC.sessionId);

// Queue limit applies across all members and cannot be bypassed by retries.
const bounded=new TeamDispatchUatSimulator({teamSessions:sessions,now:()=>now,
  maxQueued:1});
const queueOne=bounded.admit({identity:c,sessionId:freshAfterDowngrade.sessionId,
  deviceId:device.deviceId,operationId:'bounded-1',
  descriptor:{family:'fs',action:'read'}});
assert.equal(bounded.admit({identity:c,sessionId:freshAfterDowngrade.sessionId,
  deviceId:device.deviceId,operationId:'bounded-1',
  descriptor:{family:'fs',action:'read'}}).jobId,queueOne.jobId);
assert.throws(()=>bounded.admit({identity:c,sessionId:freshAfterDowngrade.sessionId,
  deviceId:device.deviceId,operationId:'bounded-2',
  descriptor:{family:'fs',action:'read'}}),/team_simulator_queue_full/);

console.log('team_uat_owner_and_members_shared_three_worker_cap=PASS');
console.log('team_uat_idempotent_scoped_admission_and_owner_preview_billing=PASS');
console.log('team_uat_server_inferred_required_capabilities_no_spoof=PASS');
console.log('team_uat_owner_previews_once_and_meter_failure_rolls_back=PASS');
console.log('team_uat_prestart_reauthorization_and_revocation=PASS');
console.log('team_uat_simulated_running_revocation_releases_slot=PASS');
console.log('team_uat_reshare_new_B_and_paid_plan_required=PASS');
console.log('team_uat_max_queued_and_no_live_execution=PASS');
console.log('team_uat_owner_three_slots_and_parallel_member_stress=PASS');
console.log('team_uat_hold_pauses_dispatch_resume_revalidates=PASS');
