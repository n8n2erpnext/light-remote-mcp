// Gold account execution limits. Session retention and Agent/OS worker slots
// are distinct dimensions. This module has no user-input derived owner grants.
export const PERSONAL_CAPACITY = Object.freeze({
  free: Object.freeze({sessionLimit:2, agentConcurrencyLimit:1}),
  pro: Object.freeze({sessionLimit:12, agentConcurrencyLimit:3}),
  vip: Object.freeze({sessionLimit:12, agentConcurrencyLimit:3})
});
export const TEAM_CAPACITY = Object.freeze({
  seats:5, sessionLimit:20, sessionsPerSeat:4,
  agentConcurrencyLimit:5, agentsPerSeat:2
});
export function personalCapacity(plan) {
  return PERSONAL_CAPACITY[String(plan||'free').toLowerCase()] || PERSONAL_CAPACITY.free;
}
// Trusted operator-side billing scope; Team is never inferred from member plan.
export function executionScope({actorAccountId,agentId,deviceOwnerAccountId,teamAuthority=null}={}) {
  const actor=String(actorAccountId||''),agent=String(agentId||''),
    owner=String(deviceOwnerAccountId||'');
  if(!actor||!agent||!owner)throw new Error('execution_scope_identity_required');
  if(!teamAuthority){
    if(actor!==owner)throw new Error('cross_account_execution_not_authorized');
    return Object.freeze({scopeType:'personal',scopeId:actor,
      actorAccountId:actor,billedAccountId:actor,deviceOwnerAccountId:owner,agentId:agent});
  }
  if(teamAuthority.teamShared!==true||teamAuthority.actorAccountId!==actor||
     teamAuthority.deviceOwnerAccountId!==owner||teamAuthority.billedAccountId!==owner||
     teamAuthority.agentId!==agent||!teamAuthority.accessGrantId||
     Number(teamAuthority.accessExpiresAt)<=Date.now())
    throw new Error('team_execution_authority_invalid');
  // Only trusted OAuth + independent member A/B authority may produce this.
  return Object.freeze({scopeType:'team',scopeId:owner,
    actorAccountId:actor,billedAccountId:owner,deviceOwnerAccountId:owner,
    agentId:agent,accessGrantId:teamAuthority.accessGrantId});
}
