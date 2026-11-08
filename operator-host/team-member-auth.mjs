import {resolveTeamEntitlement,TeamEntitlementError} from './team-entitlement-policy.mjs';

/**
 * Check a shared-device actor against independently approved local A/B state.
 * The device and connection are server-trusted objects, not caller-submitted
 * account ownership claims. NEVER reuse the owner's grant for a team member.
 *
 * This is a fail-closed authorization primitive; job routing must separately
 * preserve actor, device owner, billing owner, and the active grant lifetime.
 */
export function verifyTeamMemberAuthorization({
  device,connection,actorAccountId,agentId,accessGrantId,
  accessGrants,teamRegistry,planFor
}={}){
  if(!device||!device.deviceId||!device.accountId||device.state==='revoked')
    throw new TeamEntitlementError('team_device_unavailable',403);
  if(!connection||!connection.connectionId)
    throw new TeamEntitlementError('team_connection_required',403);
  if(!accessGrants||!accessGrantId||!actorAccountId||!agentId)
    throw new TeamEntitlementError('team_actor_approval_required',403);

  // No approval means no team route; owner A/B is not inherited by members.
  const grant=accessGrants.assert(accessGrantId,{
    accountId:actorAccountId,
    agentId,
    deviceId:device.deviceId,
    connectionId:connection.connectionId,
    touch:false
  });
  if(!grant||grant.closedAt)
    throw new TeamEntitlementError('team_actor_approval_required',403);
  // The generic grant registry permits legacy unscoped grants for older
  // single-owner clients. A team member must NEVER inherit such a grant.
  if(!grant.agentId||grant.agentId!==String(agentId))
    throw new TeamEntitlementError('team_agent_scoped_grant_required',403);
  if(grant.purpose!=='team-member')
    throw new TeamEntitlementError('team_member_grant_purpose_required',403);

  const entitlement=resolveTeamEntitlement({
    deviceOwnerAccountId:device.accountId,
    actorAccountId,
    deviceId:device.deviceId,
    teamRegistry,
    planFor,
    memberAbApproved:true
  });
  return {
    ...entitlement,
    agentId,
    deviceId:device.deviceId,
    connectionId:connection.connectionId,
    accessGrantId:grant.grantId,
    accessExpiresAt:Math.min(grant.expiresAt,grant.absoluteExpiresAt),
  };
}
