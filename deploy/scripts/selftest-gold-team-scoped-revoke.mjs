import assert from 'node:assert/strict';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
const now=Date.now();
const events=[];
const ab=new DeviceAccessGrantRegistry({now:()=>now,emit:e=>events.push(e)});
const connectionExpiresAt=now+3_600_000;
function create(accountId,deviceId,agentId,purpose='device'){
 const q=ab.request({accountId,deviceId,agentId,connectionId:'con_shared_gold',
  connectionExpiresAt,forceApproval:true,purpose});
 assert.equal(q.state,'pending');
 const g=ab.approve(q.request.requestId,{connectionId:'con_shared_gold',connectionExpiresAt});
 return {q,g};
}
const member=create('team_member','shared_owner_device','member_agent','team-member');
const owner=create('team_owner','shared_owner_device','owner_agent','device');
const other=create('another_member','shared_owner_device','other_agent','team-member');
const ownOtherDevice=create('team_member','other_device','member_agent','device');
assert.equal(member.g.purpose,'team-member');
assert.equal(owner.g.purpose,'device');
assert.throws(()=>ab.request({accountId:'team_member',agentId:'member_agent',deviceId:'shared_owner_device',
  connectionId:'con_shared_gold',connectionExpiresAt,forceApproval:false,purpose:'team-member'}),/invalid_access_grant_purpose/);
const pending=ab.request({accountId:'team_member',agentId:'member_agent_2',deviceId:'shared_owner_device',
  connectionId:'con_shared_gold',connectionExpiresAt,forceApproval:true,purpose:'team-member'});
const result=ab.revokeTeamMember({accountId:'team_member',deviceId:'shared_owner_device',reason:'team_device_unshared'});
assert.equal(result.grants,1);assert.equal(result.requests,1);
assert.ok(ab.grants.get(member.g.grantId).closedAt);
assert.equal(ab.grants.get(member.g.grantId).closeReason,'team_device_unshared');
assert.equal(ab.requests.get(pending.request.requestId).state,'denied');
assert.equal(ab.grants.get(owner.g.grantId).closedAt,null,'owner grant must survive');
assert.equal(ab.grants.get(other.g.grantId).closedAt,null,'other member grant must survive');
assert.equal(ab.grants.get(ownOtherDevice.g.grantId).closedAt,null,'unrelated own-device grant survives');
const again=ab.revokeTeamMember({accountId:'team_member',deviceId:'shared_owner_device'});
assert.equal(again.grants,0);
assert.equal(again.requests,0);
console.log('GOLD_TEAM_MEMBER_AB_PURPOSE_AND_SCOPED_REVOCATION=PASS');
const revoke=[];
const team=new ProTeamRegistry({
  planFor:id=>id==='team_owner'?'pro':'free',
  accountActive:()=>true,
  onRevoke:row=>revoke.push(row)
});
team.grantTeamAccess({ownerAccountId:'team_owner',validUntil:now+86_400_000,source:'uat-addon'});
team.create({ownerAccountId:'team_owner'});
const invite=team.invite({ownerAccountId:'team_owner',memberAccountId:'team_member'});
team.accept({memberAccountId:'team_member',inviteCode:invite.inviteCode});
team.shareDevice({ownerAccountId:'team_owner',deviceId:'shared_owner_device',deviceOwnerAccountId:'team_owner'});
assert.equal(team.revokeTeamAccess('team_owner',{expectedSource:'wrong-source'}),false);
assert.equal(revoke.length,0);
assert.equal(team.revokeTeamAccess('team_owner',{expectedSource:'uat-addon'}),true);
assert.equal(revoke.length,1);
assert.deepEqual(revoke[0],{
 ownerAccountId:'team_owner',memberAccountId:'team_member',
 deviceId:'shared_owner_device',reason:'team_addon_revoked'
});
assert.equal(team.teamEntitlement('team_owner').active,false);
console.log('GOLD_TEAM_ADDON_REVOKE_CLEARS_MEMBER_APPROVAL=PASS');
