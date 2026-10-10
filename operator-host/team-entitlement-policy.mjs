import {PRO_TEAM_MAX_SEATS} from './pro-team-registry.mjs';

export class TeamEntitlementError extends Error{
  constructor(message,status=403){super(message);this.status=status;}
}
/**
 * Payee is the subscribed device-owning team leader, not a Free member.
 * This check does NOT replace per-OAuth-client local A/B approval.
 */
export function resolveTeamEntitlement({deviceOwnerAccountId,actorAccountId,deviceId,
  teamRegistry,planFor,memberAbApproved=false}={}){
  if(!teamRegistry||typeof planFor!=='function')throw Error('team_policy_not_configured');
  const owner=String(deviceOwnerAccountId||''),actor=String(actorAccountId||'');
  if(!owner||!actor||!deviceId)throw new TeamEntitlementError('team_device_context_required',400);
  const plan=String(planFor(owner)||'free').toLowerCase();
  if(actor===owner)return {allowed:true,billedAccountId:owner,actorAccountId:actor,
    plan,maxSeats:['pro','vip'].includes(plan)?PRO_TEAM_MAX_SEATS:1,
    maxWorkers:['pro','vip'].includes(plan)?3:1,sharedTeam:false};
  if(!['pro','vip'].includes(plan)||!teamRegistry.authorize({deviceOwnerAccountId:owner,actorAccountId:actor,deviceId}))
    throw new TeamEntitlementError('pro_team_membership_required');
  if(!memberAbApproved)throw new TeamEntitlementError('team_member_device_approval_required');
  return {allowed:true,billedAccountId:owner,actorAccountId:actor,plan,maxSeats:PRO_TEAM_MAX_SEATS,
    maxWorkers:3,sharedTeam:true};
}
