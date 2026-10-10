import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {AgentClientRegistry,AgentClientRegistryError} from '../../operator-host/agent-client-registry.mjs';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';
import {mintTeamPrincipalProof,TeamPrincipalProofVerifier,verifyTeamPrincipalRequest,teamOAuthAgentId} from '../../lib/team-oauth-principal-proof.mjs';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
import {DeviceAccessGrantRegistry,AB_GRANT_MAX_LIFETIME_MS} from '../../operator-host/device-access-grant-registry.mjs';
import {authorizeTeamDispatch,authorizeTrustedTeamDispatch,assertTeamBoundSession,TEAM_UAT_OPERATION_FAMILIES} from '../../operator-host/team-dispatch-authority.mjs';

let now=Date.now(),ownerPlan='pro';
const teamRegistry=new ProTeamRegistry({now:()=>now,planFor:()=>ownerPlan,accountActive:()=>true});
const accessGrants=new DeviceAccessGrantRegistry({now:()=>now});
teamRegistry.create({ownerAccountId:'owner'});
const invite=teamRegistry.invite({ownerAccountId:'owner',memberAccountId:'member'});
teamRegistry.accept({memberAccountId:'member',inviteCode:invite.inviteCode});
teamRegistry.shareDevice({ownerAccountId:'owner',deviceId:'dev-team',deviceOwnerAccountId:'owner'});
const device={deviceId:'dev-team',nodeId:'node-team',accountId:'owner',state:'online'};
const connection={accountId:'owner',connectionId:'conn-owner',state:'connected',hardExpiresAt:now+AB_GRANT_MAX_LIFETIME_MS};
const oauthClientId='dispatch-client-123';
const agentId=teamOAuthAgentId({accountId:'member',clientId:oauthClientId});
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
const proofVerifier=new TeamPrincipalProofVerifier({publicKey});
const request=accessGrants.request({accountId:'member',deviceId:'dev-team',agentId,
  connectionId:'conn-owner',connectionExpiresAt:connection.hardExpiresAt,forceApproval:true,purpose:'team-member'});
const grant=accessGrants.approve(request.request.requestId,
  {deviceId:'dev-team',connectionId:'conn-owner',connectionExpiresAt:connection.hardExpiresAt});
const allowed=['filesystem','terminal','desktop-observe','desktop-input'];
const props={
  authenticatedActorAccountId:'member',authenticatedAgentId:agentId,accessGrantId:grant.grantId,
  device,connection,teamRegistry,accessGrants,planFor:()=>ownerPlan,now,
  operation:'exec',requiredCapabilities:['filesystem'],
  approvedCapabilities:allowed,routeCapabilities:allowed
};
const expectDeny=(changes,pattern)=>assert.throws(()=>authorizeTeamDispatch({...props,...changes}),pattern);
for(const operation of TEAM_UAT_OPERATION_FAMILIES){
  const context=authorizeTeamDispatch({...props,operation});
  assert.equal(context.actorAccountId,'member');
  assert.equal(context.deviceOwnerAccountId,'owner');
  assert.equal(context.billedAccountId,'owner');
  assert.equal(context.teamShared,true);
  assert.equal(context.maxWorkers,3);
  assert(context.accessExpiresAt<=connection.hardExpiresAt);
  assert(Object.isFrozen(context));
}
const trustedProps={...props};
delete trustedProps.accessGrantId;
const serverResolved=authorizeTrustedTeamDispatch(trustedProps);
assert.equal(serverResolved.billedAccountId,'owner');
assert.equal(serverResolved.accessGrantId,grant.grantId);
assert.throws(()=>authorizeTrustedTeamDispatch({...trustedProps,authenticatedAgentId:'other-agent'}),
  /team_member_access_grant_required/);
assert.throws(()=>authorizeTrustedTeamDispatch({...trustedProps,authenticatedActorAccountId:'outsider'}),
  /team_member_access_grant_required/);
assert.throws(()=>authorizeTrustedTeamDispatch({...trustedProps,connection:{...connection,connectionId:'new-connection'}}),
  /team_member_access_grant_required/);
// No OAuth team approval may be attached as a normal owner A-code device
// pairing, whether via registry or direct operator HTTP adapter.
const clientRegistry=new AgentClientRegistry();
assert.throws(()=>clientRegistry.attach({accountId:'member',agentId,grant}),
  /team_member_grant_not_device_pairing/);
const attachReq={method:'POST',body:{grantId:grant.grantId,agentId}};
await assert.rejects(()=>handleDeviceChannelRoutes(attachReq,{},
  new URL('http://localhost/v1/agent-client/attach'),{
    readJson:async req=>req.body,accessGrants,AgentClientRegistryError
  }),/team_member_grant_not_device_pairing/);
const oauthCode=fs.readFileSync(new URL('../../plugin-server/oauth.mjs',import.meta.url),'utf8');
const toolsCode=fs.readFileSync(new URL('../../plugin-server/tools.mjs',import.meta.url),'utf8');
assert(oauthCode.includes("flow:String(p.flow||'device-pairing')"));
assert(toolsCode.includes("ctx.flow!=='device-pairing'"));
assert(toolsCode.includes("ctx.flow!=='team-member-approval'"));
assert(toolsCode.includes("flow:'team-member-approval'"));
// Exercise the real Operator route, but only in source test with temporary
// in-memory registries, and NEVER call FleetRouter.enqueue.
const defaultUatFlag=process.env.LIGHT_REMOTE_PRO_TEAM_DISPATCH_UAT;
let queueCalls=0;
const deps={
  AccountError:class AccountError extends Error{
    constructor(message,status=403){super(message);this.status=status;}
  },
  devices:{get:id=>{if(id!==device.deviceId)throw Error('device_not_found');return device;}},
  connections:{assertConnected:id=>{
    if(id!==device.deviceId)throw Error('device_not_found');
    return connection;
  }},
  accessGrants,proTeams:teamRegistry,
  verifyTeamPrincipal:(req,url,body)=>verifyTeamPrincipalRequest(req,url,body,proofVerifier),
  operationalAccount:id=>{
    if(!['owner','member'].includes(id))throw Error('account_not_found');
    return {accountId:id,plan:id==='owner'?ownerPlan:'free'};
  },
  enrollments:{binding:id=>({approvedCapabilities:allowed})},
  targetRoute:(nodeId,{accountId})=>{
    if(nodeId!==device.nodeId||accountId!=='owner')throw Error('owner_target_route_mismatch');
    return {nodeId,deviceId:device.deviceId,capabilities:allowed};
  },
  readJson:async req=>req.body,
  sendJson:(res,status,data)=>{res.status=status;res.data=data;return true;},
  fleet:{enqueue:()=>{queueCalls++;throw Error('unexpected_queue_call');}}
};
const callPreflight=async(overrides={},identity={accountId:'member',clientId:oauthClientId})=>{
  const method='POST',targetPath='/v1/plugin/team/dispatch/preflight';
  const body={deviceId:'dev-team',operation:'exec',
    requiredCapabilities:['filesystem'],...overrides};
  const proof=mintTeamPrincipalProof({identity,method,targetPath,body,privateKey});
  const req={method,body,headers:{'x-light-remote-team-proof':proof}},res={};
  await handleAccountRoutes(req,res,new URL('http://local'+targetPath),deps);
  return res;
};
try{
  delete process.env.LIGHT_REMOTE_PRO_TEAM_DISPATCH_UAT;
  await assert.rejects(()=>callPreflight(),/team_dispatch_preflight_not_enabled/);
  process.env.LIGHT_REMOTE_PRO_TEAM_DISPATCH_UAT='1';
  const preview=await callPreflight();
  assert.equal(preview.status,200);
  assert.equal(preview.data.preflight.actorAccountId,'member');
  assert.equal(preview.data.preflight.deviceOwnerAccountId,'owner');
  assert.equal(preview.data.preflight.billedAccountId,'owner');
  assert.equal(preview.data.preflight.previewOnly,true);
  assert.equal(preview.data.preflight.crossAccountExecutionEnabled,false);
  assert(!('grantId' in preview.data.preflight));
  assert(!('accessGrantId' in preview.data.preflight));
  await assert.rejects(()=>callPreflight({agentId:'different-oauth-client'}),/team_caller_identity_fields_forbidden/);
  await assert.rejects(()=>callPreflight({}, {accountId:'member',clientId:'other-client'}),
    /team_member_access_grant_required/);
  await assert.rejects(()=>callPreflight({actorAccountId:'owner'}),/team_caller_identity_fields_forbidden/);
  await assert.rejects(()=>callPreflight({}, {accountId:'owner',clientId:'owner-client'}),
    /team_member_access_grant_required/);
  await assert.rejects(()=>callPreflight({requiredCapabilities:[]}),/team_dispatch_capabilities_required/);
  await assert.rejects(()=>callPreflight({requiredCapabilities:['systemctl']}),/team_device_capability_denied/);
  await assert.rejects(()=>callPreflight({operation:'update'}),/team_operation_not_allowed/);
  assert.equal(queueCalls,0,'preflight must never queue a job');
}finally{
  if(defaultUatFlag===undefined)delete process.env.LIGHT_REMOTE_PRO_TEAM_DISPATCH_UAT;
  else process.env.LIGHT_REMOTE_PRO_TEAM_DISPATCH_UAT=defaultUatFlag;
}
const allowedContext=authorizeTeamDispatch(props);
const validSession={accountId:'member',agentId,deviceId:'dev-team',nodeId:'node-team',
  deviceOwnerAccountId:'owner',billedAccountId:'owner',accessGrantId:grant.grantId,
  accessExpiresAt:allowedContext.accessExpiresAt,state:'active'};
assert.equal(assertTeamBoundSession({session:validSession,authority:allowedContext}),true);
for(const change of [{accountId:'owner'},{agentId:'other-agent'},{deviceId:'other-device'},
  {billedAccountId:'member'},{deviceOwnerAccountId:'member'},{accessGrantId:'fake'},
  {accessExpiresAt:allowedContext.accessExpiresAt+1},{state:'closed'}]){
  assert.throws(()=>assertTeamBoundSession({session:{...validSession,...change},authority:allowedContext}),
    /team_bound_session_identity_mismatch|team_session_not_active/);
}
expectDeny({authenticatedActorAccountId:'owner'},/team_owner_must_use_normal_route/);
expectDeny({authenticatedActorAccountId:'other'},/device_access_grant_account_mismatch/);
expectDeny({authenticatedAgentId:'other-agent'},/device_access_grant_agent_mismatch/);
expectDeny({operation:'update'},/team_operation_not_allowed/);
expectDeny({operation:'billing'},/team_operation_not_allowed/);
expectDeny({requiredCapabilities:['systemctl']},/team_device_capability_denied/);
expectDeny({routeCapabilities:[]},/team_device_capability_denied/);
expectDeny({approvedCapabilities:null},/team_device_policy_required/);
expectDeny({connection:{...connection,accountId:'member'}},/team_owner_connection_required/);
expectDeny({connection:{...connection,state:'expired'}},/team_owner_connection_required/);
expectDeny({device:{...device,state:'offline'}},/team_device_unavailable/);
expectDeny({device:{...device,nodeId:''}},/team_device_context_required/);
const wrongPurpose=accessGrants.request({accountId:'member',deviceId:'dev-team',agentId,
  connectionId:'conn-owner',connectionExpiresAt:connection.hardExpiresAt,forceApproval:true});
const wrongGrant=accessGrants.approve(wrongPurpose.request.requestId,
  {deviceId:'dev-team',connectionId:'conn-owner',connectionExpiresAt:connection.hardExpiresAt});
expectDeny({accessGrantId:wrongGrant.grantId},/team_member_grant_purpose_required/);
assert.equal(accessGrants.activeTeamGrant({accountId:'member',agentId,
  deviceId:'dev-team',connectionId:'conn-owner'}).grantId,grant.grantId,
  'owner-style grant must not replace a legitimate Team grant');
const renewed=accessGrants.request({accountId:'member',deviceId:'dev-team',agentId,
  connectionId:'conn-owner',connectionExpiresAt:connection.hardExpiresAt,forceApproval:true,purpose:'team-member'});
const newGrant=accessGrants.approve(renewed.request.requestId,
  {deviceId:'dev-team',connectionId:'conn-owner',connectionExpiresAt:connection.hardExpiresAt});
const liveProps={...props,accessGrantId:newGrant.grantId};
assert.equal(authorizeTrustedTeamDispatch({...trustedProps}).accessGrantId,newGrant.grantId,
  'new explicit owner B approval must become sole active Team grant');
assert.equal(authorizeTeamDispatch(liveProps).billedAccountId,'owner');
teamRegistry.unshareDevice({ownerAccountId:'owner',deviceId:'dev-team'});
expectDeny({...liveProps},/pro_team_membership_required/);
teamRegistry.shareDevice({ownerAccountId:'owner',deviceId:'dev-team',deviceOwnerAccountId:'owner'});
ownerPlan='free';
expectDeny({...liveProps},/pro_team_membership_required/);
ownerPlan='pro';
teamRegistry.remove({ownerAccountId:'owner',memberAccountId:'member'});
expectDeny({...liveProps},/pro_team_membership_required/);
const invite2=teamRegistry.invite({ownerAccountId:'owner',memberAccountId:'member'});
teamRegistry.accept({memberAccountId:'member',inviteCode:invite2.inviteCode});
now+=AB_GRANT_MAX_LIFETIME_MS+1;
expectDeny({...liveProps,now,connection:{...connection,hardExpiresAt:now+1}},/device_access_grant_expired/);
console.log('team_pre_dispatch_actor_owner_billing_separation=PASS');
console.log('team_all_seven_operation_families_reauthorize=PASS');
console.log('team_capability_and_owner_connection_fail_closed=PASS');
console.log('team_session_identity_immutable_and_scoped=PASS');
console.log('team_owner_billing_not_member_free_plan=PASS');
console.log('team_immediate_unshare_downgrade_removal_denial=PASS');
console.log('team_absolute_ab_expiry_denial=PASS');
console.log('team_server_only_grant_lookup_exact_oauth_identity=PASS');
console.log('team_grant_cannot_attach_as_owner_device_pairing=PASS');
console.log('team_and_owner_continuation_flows_distinct=PASS');
console.log('team_operator_preflight_disabled_default_no_enqueue=PASS');
console.log('team_dispatch_module_not_wired_to_live_queues=PASS');
