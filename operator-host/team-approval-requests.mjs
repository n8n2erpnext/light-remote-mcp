import {TeamEntitlementError} from './team-entitlement-policy.mjs';

// Bound requests by authenticated member and device; owner B-code inbox must not be flooded.
const APPROVAL_WINDOW_MS=15*60_000;
const APPROVAL_MAX_REQUESTS=5;
const approvalBuckets=new Map();
function limitMemberRequests(actor,deviceId,now=Date.now()){
  for(const [key,bucket] of approvalBuckets)if(bucket.resetAt<=now)approvalBuckets.delete(key);
  const key=actor+':'+deviceId;
  const bucket=approvalBuckets.get(key)||{count:0,resetAt:now+APPROVAL_WINDOW_MS};
  if(bucket.count>=APPROVAL_MAX_REQUESTS)throw new TeamEntitlementError('team_approval_rate_limited',429);
  bucket.count++;
  approvalBuckets.set(key,bucket);
}


// A member starts an independent Local Wall approval request for a device
// already shared by its paid owner. This creates a PENDING request only.
// It does not unlock a device, rebind its enrolled owner, or mint a team job.
export function requestTeamMemberApproval({
 actorAccountId,deviceId,agentId,label,
 devices,connections,accessGrants,teamRegistry,planFor
}={}){
 const actor=String(actorAccountId||''),did=String(deviceId||''),agent=String(agentId||'');
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(actor)||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(did)||
    !/^[A-Za-z0-9._:-]{1,160}$/.test(agent))
   throw new TeamEntitlementError('invalid_team_approval_identity',400);
 if(!devices||!connections||!accessGrants||!teamRegistry||typeof planFor!=='function')
   throw new TeamEntitlementError('team_approval_unavailable',503);
 const device=devices.get(did);
 if(!device||device.state!=='online')throw new TeamEntitlementError('team_device_unavailable',409);
 // TeamRegistry.authorize checks paid owner, member acceptance, owner sharing,
 // member active status. The member is NEVER allowed to request on Free owner.
 if(device.accountId===actor||
    !teamRegistry.authorize({deviceOwnerAccountId:device.accountId,actorAccountId:actor,deviceId:did})||
    !['pro','vip'].includes(String(planFor(device.accountId)||'').toLowerCase()))
    throw new TeamEntitlementError('pro_team_membership_required',403);
 const connection=connections.assertConnected(did);
 if(!connection||connection.accountId!==device.accountId||
    !connection.connectionId||Number(connection.hardExpiresAt)<=Date.now())
    throw new TeamEntitlementError('team_owner_connection_required',409);
 limitMemberRequests(actor,did);
 const answer=accessGrants.request({
   accountId:actor,agentId:agent,deviceId:did,
   connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt,
   label:String(label||'Pro Team member approval').slice(0,120),
   forceApproval:true,requestTtlMs:5*60_000,purpose:'team-member'
 });
 if(answer.state!=='pending'||!answer.request||!answer.pollToken)
   throw new TeamEntitlementError('team_approval_must_be_explicit',403);
 return {state:'pending',requestId:answer.request.requestId,
   userCode:answer.request.userCode,deviceId:did,agentId:agent,
   expiresAt:answer.request.expiresAt,pollToken:answer.pollToken,
   crossAccountExecutionEnabled:false};
}
