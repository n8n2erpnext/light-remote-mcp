import assert from 'node:assert/strict';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
import {DeviceAccessGrantRegistry,AB_GRANT_MAX_LIFETIME_MS} from '../../operator-host/device-access-grant-registry.mjs';
import {verifyTeamMemberAuthorization} from '../../operator-host/team-member-auth.mjs';

let now=Date.now(),plan='pro';
const planFor=()=>plan,teamRegistry=new ProTeamRegistry({now:()=>now,planFor,accountActive:()=>true});
const accessGrants=new DeviceAccessGrantRegistry({now:()=>now});
const device={accountId:'owner',deviceId:'dev_team',state:'online'};
const connection={connectionId:'connection_owner_1'};
teamRegistry.create({ownerAccountId:'owner'});
const invite=teamRegistry.invite({ownerAccountId:'owner',memberAccountId:'member'});
teamRegistry.accept({memberAccountId:'member',inviteCode:invite.inviteCode});
teamRegistry.shareDevice({ownerAccountId:'owner',deviceId:device.deviceId,deviceOwnerAccountId:'owner'});
const agentId='chatgpt-member-agent-001';
const req=accessGrants.request({accountId:'member',agentId,deviceId:device.deviceId,
  connectionId:connection.connectionId,connectionExpiresAt:now+AB_GRANT_MAX_LIFETIME_MS,
  forceApproval:true});
const args={device,connection,actorAccountId:'member',agentId,accessGrantId:null,accessGrants,teamRegistry,planFor};
assert.throws(()=>verifyTeamMemberAuthorization(args),/team_actor_approval_required/);
const grant=accessGrants.approve(req.request.requestId,{deviceId:device.deviceId,connectionId:connection.connectionId,
  connectionExpiresAt:now+AB_GRANT_MAX_LIFETIME_MS});
args.accessGrantId=grant.grantId;
const decision=verifyTeamMemberAuthorization(args);
assert.equal(decision.allowed,true);
assert.equal(decision.billedAccountId,'owner');
assert.equal(decision.actorAccountId,'member');
assert.equal(decision.maxWorkers,3);
assert.equal(decision.sharedTeam,true);
assert.throws(()=>verifyTeamMemberAuthorization({...args,agentId:'other-agent-999999'}),/device_access_grant_agent_mismatch/);
assert.throws(()=>verifyTeamMemberAuthorization({...args,actorAccountId:'outsider'}),/device_access_grant_account_mismatch/);
assert.throws(()=>verifyTeamMemberAuthorization({...args,device:{...device,accountId:'outsider'}}),/pro_team_membership_required/);
assert.throws(()=>verifyTeamMemberAuthorization({...args,device:{...device,state:'revoked'}}),/team_device_unavailable/);
assert.throws(()=>verifyTeamMemberAuthorization({...args,connection:{connectionId:'conn_hijack_22'}}),/device_access_grant_connection_mismatch/);
teamRegistry.unshareDevice({ownerAccountId:'owner',deviceId:device.deviceId});
assert.throws(()=>verifyTeamMemberAuthorization(args),/pro_team_membership_required/);
teamRegistry.shareDevice({ownerAccountId:'owner',deviceId:device.deviceId,deviceOwnerAccountId:'owner'});
teamRegistry.remove({ownerAccountId:'owner',memberAccountId:'member'});
assert.throws(()=>verifyTeamMemberAuthorization(args),/pro_team_membership_required/);
const second=teamRegistry.invite({ownerAccountId:'owner',memberAccountId:'member'});
teamRegistry.accept({memberAccountId:'member',inviteCode:second.inviteCode});
plan='free';
assert.throws(()=>verifyTeamMemberAuthorization(args),/pro_team_membership_required/);
plan='pro';now+=AB_GRANT_MAX_LIFETIME_MS+1;
assert.throws(()=>verifyTeamMemberAuthorization(args),/device_access_grant_expired/);
console.log('team_server_owned_device_and_owner_billing=PASS');
console.log('team_unique_member_agent_ab_grant_required=PASS');
console.log('team_revocation_and_downgrade_immediate_denial=PASS');
console.log('team_ab_24h_absolute_expiry=PASS');
