import assert from 'node:assert/strict';
import {SessionRegistry} from '../../operator-host/session-manager.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';
import {TeamSessionUatRegistry} from '../../operator-host/team-session-uat-registry.mjs';
import {authorizeTrustedTeamDispatch} from '../../operator-host/team-dispatch-authority.mjs';
import {DeviceAccessGrantRegistry,AB_GRANT_MAX_LIFETIME_MS} from '../../operator-host/device-access-grant-registry.mjs';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';

let now=Date.now(),ownerPlan='pro',authChecks=0;
const accessGrants=new DeviceAccessGrantRegistry({now:()=>now});
const teamRegistry=new ProTeamRegistry({now:()=>now,planFor:()=>ownerPlan,
  accountActive:()=>true,onRevoke:({memberAccountId,deviceId,reason})=>
    accessGrants.revokeTeamMember({accountId:memberAccountId,deviceId,reason})});
const device={deviceId:'shared-dev',nodeId:'shared-node',accountId:'owner',state:'online'};
const connection={connectionId:'owner-connection',accountId:'owner',state:'connected',
  hardExpiresAt:now+AB_GRANT_MAX_LIFETIME_MS};
const approvedCapabilities=['filesystem','terminal','desktop-input','desktop-observe'];
teamRegistry.create({ownerAccountId:'owner'});
teamRegistry.shareDevice({ownerAccountId:'owner',deviceId:device.deviceId,deviceOwnerAccountId:'owner'});
const approveMember=(id,agent)=>{
  const invitation=teamRegistry.invite({ownerAccountId:'owner',memberAccountId:id});
  teamRegistry.accept({memberAccountId:id,inviteCode:invitation.inviteCode});
  const request=accessGrants.request({
    accountId:id,agentId:agent,deviceId:device.deviceId,connectionId:connection.connectionId,
    connectionExpiresAt:connection.hardExpiresAt,forceApproval:true,purpose:'team-member'
  });
  return accessGrants.approve(request.request.requestId,{
    deviceId:device.deviceId,connectionId:connection.connectionId,
    connectionExpiresAt:connection.hardExpiresAt
  });
};
const renewMemberB=(id,agent)=>{
  const request=accessGrants.request({
    accountId:id,agentId:agent,deviceId:device.deviceId,connectionId:connection.connectionId,
    connectionExpiresAt:connection.hardExpiresAt,forceApproval:true,purpose:'team-member'
  });
  return accessGrants.approve(request.request.requestId,{
    deviceId:device.deviceId,connectionId:connection.connectionId,
    connectionExpiresAt:connection.hardExpiresAt
  });
};
const actor1='member1',actor2='member2',agent1='oauth-agent-member1-a',agent2='oauth-agent-member2-b';
const grant1=approveMember(actor1,agent1),grant2=approveMember(actor2,agent2);
const authority=(p)=>{
  authChecks++;
  if(p.deviceId!==device.deviceId)throw Error('device_not_found');
  return authorizeTrustedTeamDispatch({
    ...p,device,connection,accessGrants,teamRegistry,planFor:()=>ownerPlan,
    operation:p.operation,requiredCapabilities:p.requiredCapabilities,
    approvedCapabilities,routeCapabilities:approvedCapabilities,now
  });
};
const uat=new TeamSessionUatRegistry({now:()=>now,resolveAuthority:authority,
  maxActive:8,maxPerNode:5});
const ownerSessions=new SessionRegistry({now:()=>now});
const ownerSession=ownerSessions.open({
  accountId:'owner',agentId:'oauth-owner-agent-0001',deviceId:'shared-dev',nodeId:'shared-node'
});
const in1={authenticatedActorAccountId:actor1,authenticatedAgentId:agent1,
  deviceId:device.deviceId,operation:'exec',requiredCapabilities:['filesystem']};
const in2={authenticatedActorAccountId:actor2,authenticatedAgentId:agent2,
  deviceId:device.deviceId,operation:'fs',requiredCapabilities:['filesystem']};
assert.throws(()=>uat.open({...in1,requiredCapabilities:[]}),
  /team_session_capabilities_required/);
const s1=uat.open({...in1,openId:'first-member-open-0001',workspace:'/workspace'});
const s2=uat.open({...in2,openId:'second-member-open-0002'});
assert.notEqual(s1.sessionId,s2.sessionId);
assert.notEqual(s1.sessionId,ownerSession.sessionId);
assert.equal(s1.actorAccountId,actor1);
assert.equal(s1.accountId,actor1);
assert.equal(s1.deviceOwnerAccountId,'owner');
assert.equal(s1.billedAccountId,'owner');
assert.equal(s1.activeJobs.length,0);
assert(!('grantId' in s1)&&!('accessGrantId' in s1),'session views never leak bearer A/B grant');
assert.equal(s1.previewOnly,true);
assert.equal(s1.crossAccountExecutionEnabled,false);
assert.equal(uat.sessions.list().length,2);
assert.equal(ownerSessions.get(ownerSession.sessionId).state,'active','owner lives in separate registry');
assert.deepEqual(uat.list(in1).map(s=>s.sessionId),[s1.sessionId]);
assert.deepEqual(uat.list(in2).map(s=>s.sessionId),[s2.sessionId]);
assert.equal(uat.open(in1).sessionId,s1.sessionId,'same client lane safely reuses active session');
assert.throws(()=>uat.open({...in1,operation:'terminal',requiredCapabilities:['terminal']}),
  /team_session_operation_conflict/);
assert.throws(()=>uat.get(s1.sessionId,in2),/team_session_oauth_actor_mismatch/);
assert.throws(()=>uat.get(s1.sessionId,{...in1,authenticatedAgentId:'different-agent'}),
  /team_session_oauth_actor_mismatch/);
assert.equal(uat.get(s1.sessionId,in1).sessionId,s1.sessionId);
const baseChecks=authChecks;
const held=uat.hold(s1.sessionId,in1,'agent_inactive');
assert.equal(held.state,'hold');
assert.equal(uat.resume(s1.sessionId,in1).state,'active');
assert.equal(uat.touch(s1.sessionId,in1,'uat-preview').state,'active');
assert(authChecks>=baseChecks+3,'every hold/resume/touch must reauthorize');
assert.equal(uat.sessions.get(s1.sessionId,agent1).stats.toolCalls,1);
assert.equal(uat.sessions.get(s1.sessionId,agent1).stats.jobsStarted,0);
assert.equal(ownerSessions.get(ownerSession.sessionId).stats.toolCalls,0);

// Real source Operator routes, against a second PRIVATE registry, with no
// main SessionRegistry, fleet/jobs/usage/write access injected.
const routeUat=new TeamSessionUatRegistry({now:()=>now,resolveAuthority:authority});
let queued=0,charged=0;
const routes={
  AccountError:class AccountError extends Error{
    constructor(message,status=403){super(message);this.status=status;}
  },
  teamSessions:routeUat,
  operationalAccount:id=>{
    if(!['member1','member2','owner'].includes(id))throw Error('account_not_found');
    return {accountId:id};
  },
  readJson:async req=>req.body,
  sendJson:(res,status,data)=>{res.status=status;res.data=data;return true;},
  fleet:{enqueue:()=>queued++},
  usage:{record:()=>charged++}
};
const teamRoute=async(path,body,enabled=true)=>{
  const dep={...routes,teamSessions:enabled?routeUat:null},res={};
  await handleAccountRoutes({method:'POST',body},res,
    new URL('http://local/v1/plugin/team/sessions/uat/'+path),dep);
  return res;
};
await assert.rejects(()=>teamRoute('open',{...in1,actorAccountId:actor1,agentId:agent1},false),
  /team_session_uat_disabled/);
const opened=(await teamRoute('open',{
  actorAccountId:actor1,agentId:agent1,deviceId:device.deviceId,
  operation:'exec',requiredCapabilities:['filesystem']
})).data.session;
assert.equal(opened.accountId,'member1');
assert.equal(opened.billedAccountId,'owner');
assert(!('accessGrantId' in opened));
const routeBody={actorAccountId:actor1,agentId:agent1};
assert.equal((await teamRoute(opened.sessionId+'/hold',routeBody)).data.session.state,'hold');
assert.equal((await teamRoute(opened.sessionId+'/resume',routeBody)).data.session.state,'active');
assert.equal((await teamRoute(opened.sessionId+'/touch',routeBody)).data.session.state,'active');
assert.equal((await teamRoute(opened.sessionId+'/get',routeBody)).data.session.deviceOwnerAccountId,'owner');
await assert.rejects(()=>teamRoute(opened.sessionId+'/get',
  {actorAccountId:actor2,agentId:agent2}),/team_session_oauth_actor_mismatch/);
assert.equal((await teamRoute(opened.sessionId+'/close',routeBody)).data.session.state,'closed');
await assert.rejects(()=>teamRoute(opened.sessionId+'/get',routeBody),/team_session_not_found/);
assert.equal(queued,0,'UAT API may not enqueue commands');
assert.equal(charged,0,'UAT API may not charge account');
assert.equal(ownerSessions.get(ownerSession.sessionId).state,'active',
  'owner production-style registry is totally separate');

const revokeThenAssert=(sessionId,revoke,restore,pattern)=>{
  revoke();
  assert.throws(()=>uat.touch(sessionId,in1),pattern);
  assert.throws(()=>uat.get(sessionId,in1),/team_session_not_found/);
  assert.equal(uat.sessions.get(sessionId,agent1).state,'closed');
  if(uat.bindings.has(s2.sessionId)){
    assert.throws(()=>uat.get(s2.sessionId,in2),pattern,
      'owner unshare/downgrade must revoke every member on that device');
    assert.equal(uat.sessions.get(s2.sessionId,agent2).state,'closed');
  }
  restore();
};
revokeThenAssert(s1.sessionId,
  ()=>teamRegistry.unshareDevice({ownerAccountId:'owner',deviceId:device.deviceId}),
  ()=>teamRegistry.shareDevice({ownerAccountId:'owner',deviceId:device.deviceId,deviceOwnerAccountId:'owner'}),
  /team_member_access_grant_required/
);
assert.throws(()=>uat.open(in1),/team_member_access_grant_required/,
  'after unshare/re-share old B cannot become valid again');
renewMemberB(actor1,agent1);
renewMemberB(actor2,agent2);
const s1Again=uat.open(in1);
assert.notEqual(s1Again.sessionId,s1.sessionId);
revokeThenAssert(s1Again.sessionId,
  ()=>{ownerPlan='free';},
  ()=>{ownerPlan='pro';},
  /pro_team_membership_required/
);
// Accessing existing session after owner plan restored must require a NEW
// device-independent B grant only if the original grant has been revoked.
// Re-authorization may allow same still-valid B in current policy, but must
// never revive a closed or tombstoned session.
// Revoking one member must not affect the other after independent new B.
const s1MemberBeforeRemoval=uat.open(in1);
const s2Reapproved=uat.open(in2);
teamRegistry.remove({ownerAccountId:'owner',memberAccountId:actor1});
assert.throws(()=>uat.touch(s1MemberBeforeRemoval.sessionId,in1),/team_member_access_grant_required/);
assert.equal(uat.get(s2Reapproved.sessionId,in2).state,'active');
const reinvite=teamRegistry.invite({ownerAccountId:'owner',memberAccountId:actor1});
teamRegistry.accept({memberAccountId:actor1,inviteCode:reinvite.inviteCode});
assert.throws(()=>uat.open(in1),/team_member_access_grant_required/,
  'removal then re-invitation must force a fresh owner B');
renewMemberB(actor1,agent1);
// Explicit owner reapproval invalidates only the member whose B grant rotated.
const oldMember2Session=uat.get(s2Reapproved.sessionId,in2);
renewMemberB(actor2,agent2);
assert.throws(()=>uat.resume(oldMember2Session.sessionId,in2),
  /team_session_authority_rotated/);
assert.equal(uat.sessions.get(oldMember2Session.sessionId,agent2).state,'closed');
const member2AfterB=uat.open(in2);
assert.notEqual(member2AfterB.sessionId,oldMember2Session.sessionId);
const s1Fresh=uat.open(in1);
assert.notEqual(s1Fresh.sessionId,s1Again.sessionId);
const originalExpiry=s1Fresh.accessExpiresAt;
connection.hardExpiresAt+=AB_GRANT_MAX_LIFETIME_MS;
accessGrants.renewConnection(device.deviceId,{
  connectionId:connection.connectionId,
  connectionExpiresAt:connection.hardExpiresAt
});
assert.equal(uat.get(s1Fresh.sessionId,in1).accessExpiresAt,originalExpiry,
  'renew must not extend session authorization expiry');
assert.equal(uat.close(s1Fresh.sessionId,in1).state,'closed');
assert.throws(()=>uat.get(s1Fresh.sessionId,in1),/team_session_not_found/);
assert.equal(ownerSessions.get(ownerSession.sessionId).state,'active');

const expiring=uat.open(in1);
// Keep the ordinary 60-minute grace alive without ever extending 24h B.
while(now+50*60_000<expiring.accessExpiresAt){
  now+=50*60_000;
  uat.touch(expiring.sessionId,in1,'keepalive-uat');
}
now=expiring.accessExpiresAt+1;
connection.hardExpiresAt=now+60000;
assert.throws(()=>uat.resume(expiring.sessionId,in1),/team_session_ab_expired/);
assert.equal(uat.sessions.get(expiring.sessionId,agent1).state,'closed');
assert.throws(()=>uat.open(in1),/team_member_access_grant_required/);
console.log('team_uat_operator_routes_flagged_and_zero_enqueue_charge=PASS');
console.log('team_uat_private_registry_owner_sessions_untouched=PASS');
console.log('team_uat_member_agent_isolation_and_lane_reuse=PASS');
console.log('team_uat_hold_resume_touch_reauthorize=PASS');
console.log('team_uat_unshare_downgrade_fail_closed=PASS');
console.log('team_uat_member_remove_reinvite_requires_fresh_owner_b=PASS');
console.log('team_uat_owner_b_reapproval_rotates_exact_member_only=PASS');
console.log('team_uat_connection_renew_cannot_extend_ab=PASS');
console.log('team_uat_expiry_closes_session_not_jobs=PASS');
console.log('team_uat_no_grant_secret_and_no_live_execution=PASS');
