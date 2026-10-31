// Gold P2-I4C3c2: only a result from the authenticated, signed Device
// channel may attest a Guest launch. The operator must have originated this
// exact Guest ticket and bound it to the canonical Guest queue+slot beforehand.
// A device statement alone, or any signed OWNER-only result, is insufficient.
export class GoldGuestLaunchEvidenceError extends Error{
 constructor(reason){super(reason);this.name='GoldGuestLaunchEvidenceError';this.status=403;}
}
const deny=x=>{throw new GoldGuestLaunchEvidenceError(x)};
const P=/^lp_[A-Za-z0-9_-]{20,80}$/;
const FIELDS=['jobId','ownerAccountId','guestAccountId','agentId','grantId',
 'connectionId','operationId','permissionRevision','payloadSha256','commandId'];
export function verifyGoldGuestLaunchEvidence({
 authenticatedDeviceChannel=false,command,job,result
}={}){
 if(authenticatedDeviceChannel!==true)
  deny('guest_launch_signed_device_channel_required');
 const t=job?.guestTicketEnvelope?.ticket;
 if(!t||job.guestDispatch?.purpose!=='pro-share-guest'||
   job.guestDispatch?.trustedServerOrigin!==true||
   command?.payload?.type!=='guest-process-v1'||
   !command?.payload?.ticketEnvelope||
   command.payload.ticketEnvelope.signature!==job.guestTicketEnvelope.signature||
   JSON.stringify(command.payload.ticketEnvelope.ticket)!==JSON.stringify(t)||
   command.commandId!==t.commandId||
   command.jobId!==t.jobId||
   job.id!==t.jobId||job.accountId!==t.ownerAccountId||
   job.deviceId!==t.deviceId||job.operationId!==t.operationId||
   job.guestDispatch.grantId!==t.grantId||
   job.guestDispatch.actorAccountId!==t.guestAccountId||
   job.guestDispatch.agentId!==t.agentId)
  deny('guest_launch_server_origin_or_scope_invalid');
 const d=result?.data?.guestLaunch;
 if(result?.status!=='ok'||result.exitCode!==0||
    result.data?.operation!=='start'||result.data?.ok!==true||
    !P.test(d?.processId||'')||
    result.data?.process?.processId!==d.processId||
    d?.purpose!=='pro-share-guest'||
    !FIELDS.every(k=>d[k]===t[k]))
  deny('guest_launch_device_result_identity_or_handle_invalid');
 return Object.freeze({
  purpose:'pro-share-guest',ownerAccountId:t.ownerAccountId,
  guestAccountId:t.guestAccountId,agentId:t.agentId,
  grantId:t.grantId,connectionId:t.connectionId,
  operationId:t.operationId,permissionRevision:t.permissionRevision,
  payloadSha256:t.payloadSha256,jobId:t.jobId,
  deviceId:t.deviceId,commandId:t.commandId,processId:d.processId
 });
}
