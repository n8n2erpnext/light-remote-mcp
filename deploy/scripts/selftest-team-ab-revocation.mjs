import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-team-ab-revoke-'));
let now=Date.now();
const devices=['owner-device-a','owner-device-b'],connectionIds=['owner-conn-a','owner-conn-b'];
try{
  const accessGrants=new DeviceAccessGrantRegistry({stateFile:path.join(dir,'grants.json'),now:()=>now});
  const teamRegistry=new ProTeamRegistry({
    stateFile:path.join(dir,'team.json'),now:()=>now,planFor:()=> 'pro',
    accountActive:()=>true,
    onRevoke:({memberAccountId,deviceId,reason})=>
      accessGrants.revokeTeamMember({accountId:memberAccountId,deviceId,reason})
  });
  teamRegistry.grantTeamAccess({ownerAccountId:'owner',validUntil:now+30*86400000});
  teamRegistry.create({ownerAccountId:'owner'});
  for(const deviceId of devices)
    teamRegistry.shareDevice({ownerAccountId:'owner',deviceId,deviceOwnerAccountId:'owner'});
  const join=(member)=>{
    const invitation=teamRegistry.invite({ownerAccountId:'owner',memberAccountId:member});
    teamRegistry.accept({memberAccountId:member,inviteCode:invitation.inviteCode});
  };
  join('memberA');join('memberB');
  const pending=(member,deviceId,agentId)=>{
    const connectionId=connectionIds[devices.indexOf(deviceId)];
    return accessGrants.request({accountId:member,agentId,deviceId,connectionId,
      connectionExpiresAt:now+86400000,forceApproval:true,
      purpose:member==='owner'?'device':'team-member'});
  };
  const approved=(member,deviceId,agentId)=>{
    const request=pending(member,deviceId,agentId);
    const connectionId=connectionIds[devices.indexOf(deviceId)];
    return accessGrants.approve(request.request.requestId,
      {deviceId,connectionId,connectionExpiresAt:now+86400000});
  };
  const ownerGrant=approved('owner',devices[0],'owner-agent-1234567');
  const memberAGrantA=approved('memberA',devices[0],'member-a-agent-123');
  const memberAGrantB=approved('memberA',devices[1],'member-a-agent-123');
  const memberBGrantA=approved('memberB',devices[0],'member-b-agent-123');
  const memberBGrantB=approved('memberB',devices[1],'member-b-agent-123');
  const pendingA=pending('memberA',devices[0],'member-a-second-agent-123');
  const pendingB=pending('memberB',devices[0],'member-b-second-agent-123');
  teamRegistry.remove({ownerAccountId:'owner',memberAccountId:'memberA'});
  assert.throws(()=>accessGrants.assert(memberAGrantA.grantId,{touch:false}),
    /device_access_grant_required/);
  assert.throws(()=>accessGrants.assert(memberAGrantB.grantId,{touch:false}),
    /device_access_grant_required/);
  assert.throws(()=>accessGrants.poll({
    requestId:pendingA.request.requestId,pollToken:pendingA.pollToken
  }),/plus_authorization_denied/);
  for(const grant of [ownerGrant,memberBGrantA,memberBGrantB])
    assert.equal(accessGrants.assert(grant.grantId,{touch:false}).grantId,grant.grantId);
  assert.equal(accessGrants.poll({
    requestId:pendingB.request.requestId,pollToken:pendingB.pollToken
  }).state,'pending');
  join('memberA');
  assert.equal(teamRegistry.authorize({
    deviceOwnerAccountId:'owner',actorAccountId:'memberA',deviceId:devices[0]
  }),true);
  assert.throws(()=>accessGrants.activeTeamGrant({
    accountId:'memberA',agentId:'member-a-agent-123',
    deviceId:devices[0],connectionId:connectionIds[0]
  }),/team_member_access_grant_required/);
  approved('memberA',devices[0],'member-a-agent-123');
  const afterReinvite=accessGrants.activeTeamGrant({
    accountId:'memberA',agentId:'member-a-agent-123',
    deviceId:devices[0],connectionId:connectionIds[0]
  });
  teamRegistry.unshareDevice({ownerAccountId:'owner',deviceId:devices[0]});
  assert.throws(()=>accessGrants.assert(afterReinvite.grantId,{touch:false}),
    /device_access_grant_required/);
  assert.throws(()=>accessGrants.assert(memberBGrantA.grantId,{touch:false}),
    /device_access_grant_required/);
  assert.equal(accessGrants.assert(memberBGrantB.grantId,{touch:false}).grantId,
    memberBGrantB.grantId,'unshare one device must preserve member access on other device');
  assert.equal(accessGrants.assert(ownerGrant.grantId,{touch:false}).grantId,
    ownerGrant.grantId,'owner device grant is not a Team grant');
  teamRegistry.shareDevice({ownerAccountId:'owner',deviceId:devices[0],
    deviceOwnerAccountId:'owner'});
  assert.throws(()=>accessGrants.activeTeamGrant({
    accountId:'memberB',agentId:'member-b-agent-123',
    deviceId:devices[0],connectionId:connectionIds[0]
  }),/team_member_access_grant_required/);
  const persisted=new DeviceAccessGrantRegistry({
    stateFile:path.join(dir,'grants.json'),now:()=>now
  });
  assert.throws(()=>persisted.assert(memberAGrantA.grantId,{touch:false}),
    /device_access_grant_required/);
  assert.equal(persisted.assert(ownerGrant.grantId,{touch:false}).grantId,
    ownerGrant.grantId);
  console.log('team_revoke_member_closes_grants_on_all_shared_devices=PASS');
  console.log('team_revoke_member_denies_pending_B=PASS');
  console.log('team_other_member_and_owner_grants_preserved=PASS');
  console.log('team_unshare_scoped_device_and_reshares_require_new_B=PASS');
  console.log('team_revocation_survives_registry_reload=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
