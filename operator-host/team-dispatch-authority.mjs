import {verifyTeamMemberAuthorization} from './team-member-auth.mjs';
import {TeamEntitlementError} from './team-entitlement-policy.mjs';

// Deliberately NOT connected to production targetRoute or FleetRouter.
// Owner device access and account billing are validated before any Team job
// dispatch can be enabled. Future integrations must revalidate EVERY operation.
export const TEAM_UAT_OPERATION_FAMILIES=Object.freeze([
  'exec','fs','search','process','terminal','scp','desktop'
]);

export class TeamDispatchAuthorityError extends Error{
  constructor(message,status=403){super(message);this.status=status;}
}
const validId=(value,max=160)=>new RegExp('^[A-Za-z0-9._:-]{1,'+max+'}$').test(String(value||''));

export function authorizeTeamDispatch({
  authenticatedActorAccountId,authenticatedAgentId,accessGrantId,
  operation,requiredCapabilities=[],device,connection,approvedCapabilities,routeCapabilities,
  teamRegistry,accessGrants,planFor,now=Date.now()
}={}){
  // This module trusts a caller-authenticated OAuth identity, *not* any body
  // fields named ownerAccountId, billingAccountId or device.accountId.
  // The device and connection must be loaded by ID from server registries.
  const actor=String(authenticatedActorAccountId||'');
  const agent=String(authenticatedAgentId||'');
  const requestedOperation=String(operation||'');
  if(!validId(actor,128)||!validId(agent,160)||!validId(accessGrantId))
    throw new TeamDispatchAuthorityError('team_oauth_identity_or_ab_required',403);
  if(!TEAM_UAT_OPERATION_FAMILIES.includes(requestedOperation))
    throw new TeamDispatchAuthorityError('team_operation_not_allowed',403);
  if(!device||!validId(device.deviceId)||!validId(device.accountId,128)||!validId(device.nodeId))
    throw new TeamDispatchAuthorityError('team_device_context_required',400);
  if(actor===device.accountId)
    throw new TeamDispatchAuthorityError('team_owner_must_use_normal_route',409);
  if(device.state!=='online')
    throw new TeamDispatchAuthorityError('team_device_unavailable',409);
  if(!connection||connection.state!=='connected'||connection.accountId!==device.accountId||
     !connection.connectionId||!Number.isFinite(Number(connection.hardExpiresAt))||
     Number(connection.hardExpiresAt)<=Number(now))
    throw new TeamDispatchAuthorityError('team_owner_connection_required',409);
  if(!Array.isArray(requiredCapabilities)||requiredCapabilities.length>32||
     requiredCapabilities.some(c=>!validId(c,80)))
    throw new TeamDispatchAuthorityError('team_required_capabilities_invalid',400);
  if(!Array.isArray(approvedCapabilities)||!Array.isArray(routeCapabilities))
    throw new TeamDispatchAuthorityError('team_device_policy_required',403);
  const approved=new Set(approvedCapabilities),routed=new Set(routeCapabilities);
  if(requiredCapabilities.some(c=>!approved.has(c)||!routed.has(c)))
    throw new TeamDispatchAuthorityError('team_device_capability_denied',403);

  const decision=verifyTeamMemberAuthorization({
    device,connection,actorAccountId:actor,agentId:agent,accessGrantId,
    accessGrants,teamRegistry,planFor
  });
  const accessExpiresAt=Math.min(Number(decision.accessExpiresAt)||0,
    Number(connection.hardExpiresAt));
  if(accessExpiresAt<=Number(now))
    throw new TeamDispatchAuthorityError('team_ab_expired',403);
  if(decision.billedAccountId!==device.accountId||!decision.sharedTeam)
    throw new TeamDispatchAuthorityError('team_owner_billing_mismatch',403);
  return Object.freeze({
    schemaVersion:1,
    actorAccountId:actor,
    deviceOwnerAccountId:device.accountId,
    billedAccountId:device.accountId,
    agentId:agent,
    accessGrantId,
    accessExpiresAt,
    deviceId:device.deviceId,
    nodeId:device.nodeId,
    operation:requestedOperation,
    requiredCapabilities:Object.freeze([...new Set(requiredCapabilities)].sort()),
    maxWorkers:Math.min(3,Number(decision.maxWorkers)||1),
    teamShared:true
  });
}

// Server-side entry point: lookup the A/B grant by authenticated OAuth actor
// and stable agent. An MCP caller never gets to pick another actor's grant ID.
// NO live queue or route references this function until separate UAT approval.
export function authorizeTrustedTeamDispatch({
  authenticatedActorAccountId,authenticatedAgentId,device,connection,
  accessGrants,...policy
}={}){
  if(!accessGrants||!device||!connection)
    throw new TeamDispatchAuthorityError('team_authority_registries_required',403);
  const grant=accessGrants.activeTeamGrant({
    accountId:authenticatedActorAccountId,agentId:authenticatedAgentId,
    deviceId:device.deviceId,connectionId:connection.connectionId
  });
  return authorizeTeamDispatch({
    ...policy,authenticatedActorAccountId,authenticatedAgentId,
    device,connection,accessGrants,accessGrantId:grant.grantId
  });
}

// A durable session is always owned by the member (actor), NEVER impersonates
// owner. The owner is a separate server-validated billing/routing principal.
// This does NOT open/authorize a session by itself.
export function assertTeamBoundSession({session,authority}={}){
  if(!session||!authority||authority.teamShared!==true)
    throw new TeamDispatchAuthorityError('team_bound_session_required',403);
  if(session.accountId!==authority.actorAccountId||
     session.agentId!==authority.agentId||
     session.deviceId!==authority.deviceId||
     session.nodeId!==authority.nodeId||
     session.deviceOwnerAccountId!==authority.deviceOwnerAccountId||
     session.billedAccountId!==authority.billedAccountId||
     session.accessGrantId!==authority.accessGrantId||
     Number(session.accessExpiresAt)!==Number(authority.accessExpiresAt))
    throw new TeamDispatchAuthorityError('team_bound_session_identity_mismatch',403);
  if(session.state!=='active'&&session.state!=='hold')
    throw new TeamDispatchAuthorityError('team_session_not_active',410);
  return true;
}
