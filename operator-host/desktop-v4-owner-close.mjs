// Native Desktop Owner's exact per-Agent session close.
// Separate explicit OFF-by-default mutation gate; never reuses MCP or Wall cookie.
import {closeOwnerSessionAndGrant} from './owner-session-close-abv2.mjs';
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const OWNER=/^[A-Za-z0-9._:-]{1,128}$/;
const OWNER_SESSION=/^acctsess_[a-f0-9-]{36}$/;
function deny(code,status=403){throw Object.assign(new Error(code),{status});}
export function createDesktopV4OwnerSessionClose({
 accounts,allDeviceViews,sessions,connections,accessGrants,agentClients,
 closeExact=closeOwnerSessionAndGrant
}={}){
 if(!accounts?.desktopOwnerSessionActive||!accounts?.account||
    typeof allDeviceViews!=='function'||!sessions?.get||
    !connections?.assertConnected||!accessGrants?.activeGrantsForDevice||
    !agentClients?.rows||!agentClients?.detachGrant)
    deny('desktop_owner_close_dependencies_missing',503);
 return function close(input={}){
  const {accountId,accountSessionId,sessionId,agentId,deviceId}=input;
  if(!OWNER.test(accountId||'')||!OWNER_SESSION.test(accountSessionId||'')||
    !ID.test(sessionId||'')||!ID.test(agentId||'')||!ID.test(deviceId||''))
    deny('desktop_owner_close_invalid_input',400);
  if(!accounts.desktopOwnerSessionActive(accountId,accountSessionId))
    deny('desktop_owner_session_required',403);
  const owner=accounts.account(accountId);
  if(owner.accountId!==accountId||owner.isOwner!==true||
     owner.emailVerified!==true||owner.status!=='active')
    deny('desktop_owner_session_required',403);
  const device=allDeviceViews().find(d=>d.deviceId===deviceId);
  if(!device||device.accountId!==accountId||device.revokedAt||
     device.state==='revoked')deny('desktop_owner_device_scope_denied',403);
  const session=sessions.get(sessionId,agentId);
  if(session.accountId!==accountId||session.deviceId!==deviceId||
     session.agentId!==agentId)
    deny('desktop_owner_session_scope_denied',403);
  if(!['active','hold'].includes(session.state))
    deny('desktop_owner_session_not_closable',409);
  if((session.activeJobs||[]).length)
    deny('desktop_owner_session_busy',409);
  const connection=connections.assertConnected(deviceId);
  if(connection.accountId!==accountId||connection.deviceId!==deviceId||
     !connection.connectionId||connection.closedAt)
    deny('desktop_owner_connection_invalid',403);
  const result=closeExact({
    sessionId,agentId,accountId,deviceId,
    connectionId:connection.connectionId,sessions,accessGrants,agentClients
  });
  if(result?.session?.state!=='closed')
    deny('desktop_owner_session_close_unconfirmed',409);
  return {ok:true,sessionId,deviceId,agentId,state:'closed',
    revokedGrants:result.revokedGrants};
 };
}
