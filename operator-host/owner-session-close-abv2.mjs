// Isolated AB V2 owner-close cutover: bind one Agent lane to its exact
// client->device->grant before revoking. Never revoke an unrelated Agent or
// a newer grant that now belongs to a DIFFERENT session.
export class OwnerSessionCloseGrantError extends Error {
  constructor(code,status=409){super(code);this.status=status;}
}
export function closeOwnerSessionAndGrant({sessionId,agentId,accountId,deviceId,
  connectionId,sessions,accessGrants,agentClients}={}){
  const session=sessions.get(sessionId,agentId);
  if(session.deviceId!==deviceId||session.accountId!==accountId)
    throw new OwnerSessionCloseGrantError('owner_close_session_scope_mismatch',403);
  if(session.state==='closed')return {session,revokedGrants:0};
  if((session.activeJobs||[]).length)
    throw new OwnerSessionCloseGrantError('session_busy',409);
  const active=accessGrants.activeGrantsForDevice(deviceId,connectionId)
    .filter(g=>g.accountId===accountId&&g.agentId===agentId&&
      String(g.purpose||'device')==='device');
  const mappings=[];
  for(const client of agentClients.rows.values()){
    if(client.closedAt||client.agentId!==agentId||client.accountId!==accountId)
      continue;
    const binding=client.bindings?.[deviceId];
    if(!binding||binding.workingContext?.sessionId!==sessionId)
      continue;
    const grant=active.find(g=>g.grantId===binding.grantId);
    if(grant)mappings.push({clientSessionId:client.clientSessionId,grantId:grant.grantId});
  }
  // If the Agent still holds active grants and NONE can be proven to belong
  // to THIS session, refuse false success (no broad Agent-wide revocation).
  // An older session with a distinct later active session may be closed:
  // that later session keeps its own independently approved grant.
  if(!mappings.length&&active.length){
    const laterActive=[...agentClients.rows.values()].some(client=>
      !client.closedAt&&client.accountId===accountId&&client.agentId===agentId&&
      client.bindings?.[deviceId]?.workingContext?.sessionId!==sessionId&&
      active.some(g=>g.grantId===client.bindings?.[deviceId]?.grantId));
    if(!laterActive)
      throw new OwnerSessionCloseGrantError('owner_close_session_grant_binding_unverified');
  }
  for(const {grantId,clientSessionId} of mappings){
    accessGrants.close(grantId,'owner_closed_from_wall');
    agentClients.detachGrant(clientSessionId,{agentId,accountId,deviceId,grantId,
      reason:'owner_closed_from_wall'});
  }
  // sendJson flushes PG and Redis before acknowledging the mutation.
  const closed=sessions.close(sessionId,agentId,'owner_closed_from_wall');
  return {session:closed,revokedGrants:mappings.length};
}
