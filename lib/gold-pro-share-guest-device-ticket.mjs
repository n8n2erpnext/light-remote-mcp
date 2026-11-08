// P2-I4C3c2: separate, short-lived, signed Guest device command ticket.
// Not a classic Owner Fleet grant. Issuer must verify fresh PG B + accepted
// share + owner device + UNKNOWN slot before signing. The enrolled Device
// verifies the pinned policy signer and its OWN final local deny policy.
import crypto from 'node:crypto';
import {goldGuestIntentHash,normalizeGoldGuestProcessIntent}
 from './gold-pro-share-guest-process-contract.mjs';

export class GoldGuestDeviceTicketError extends Error {
 constructor(reason,status=403){super(reason);this.name='GoldGuestDeviceTicketError';this.status=status;}
}
const fail=(reason,status=403)=>{throw new GoldGuestDeviceTicketError(reason,status)};
const ID=/^[A-Za-z0-9._:-]{1,180}$/;
const SHA=/^[a-f0-9]{64}$/;
const HEX=/^[a-f0-9]{32}$/;
const SIG=/^[A-Za-z0-9_-]{85,89}$/;
const PROP=['purpose','version','commandId','jobId','operationId','ownerAccountId',
 'guestAccountId','agentId','deviceId','connectionId','grantId',
 'permissionRevision','devicePolicyRevision','payloadSha256',
 'requiredCapabilities','issuedAt','expiresAt','nonce'];
const required=key=>key!=='purpose'&&key!=='version'&&key!=='permissionRevision'&&
 key!=='devicePolicyRevision'&&key!=='payloadSha256'&&
 key!=='requiredCapabilities'&&key!=='issuedAt'&&key!=='expiresAt'&&key!=='nonce';
function canonical(t){
 if(!t||typeof t!=='object'||Array.isArray(t)||
    Object.keys(t).sort().join('|')!==[...PROP].sort().join('|'))
  fail('guest_ticket_fields_invalid');
 if(t.purpose!=='pro-share-guest-process'||t.version!==1||
    PROP.some(k=>required(k)&&!ID.test(t[k]||''))||
    t.ownerAccountId===t.guestAccountId||
    !SHA.test(t.payloadSha256||'')||!HEX.test(t.nonce||'')||
    !Number.isSafeInteger(t.permissionRevision)||t.permissionRevision<1||
    !Number.isSafeInteger(t.devicePolicyRevision)||t.devicePolicyRevision<1||
    !Number.isSafeInteger(t.issuedAt)||!Number.isSafeInteger(t.expiresAt)||
    t.expiresAt<=t.issuedAt||t.expiresAt-t.issuedAt>20_000||
    !Array.isArray(t.requiredCapabilities)||
    t.requiredCapabilities.length<1||t.requiredCapabilities.length>16||
    t.requiredCapabilities.some(c=>!ID.test(c)||c.length>80)||
    JSON.stringify(t.requiredCapabilities)!==
      JSON.stringify([...new Set(t.requiredCapabilities)].sort()))
  fail('guest_ticket_format_invalid');
 return Buffer.from(JSON.stringify(['gold-guest-device-ticket-v1',
  ...PROP.map(k=>t[k])]));
}
const fieldsMatch=(a,b,fields)=>fields.every(k=>a[k]===b[k]);
export function createGoldGuestDeviceTicketIssuer({
 sign,assertFreshAuthority,env=process.env,now=Date.now
}={}){
 const enabled=env.LR_GOLD_PRO_SHARE_GUEST_TICKET_ISSUE==='1';
 if(enabled&&(env.LR_GOLD_PRO_SHARE_CORE!=='1'||
   env.LR_GOLD_PRO_SHARE_GUEST_SLOTS!=='1'||
   env.LR_GOLD_PRO_SHARE_GUEST_QUEUE!=='1'||
   env.LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL!=='1'||
   typeof sign!=='function'||typeof assertFreshAuthority!=='function'))
  fail('guest_ticket_issuer_prerequisites_missing',503);
 return Object.freeze({
  async issue({job,slot,commandId,payload,devicePolicyRevision}={}){
   if(!enabled)fail('guest_ticket_issue_disabled',404);
   if(!job||job.state!=='unknown'||job.operation!=='process'||
      slot?.state!=='unknown'||slot.jobId!==job.jobId||
      slot.operationId!==job.operationId||slot.deviceId!==job.deviceId||
      slot.ownerAccountId!==job.ownerAccountId||
      slot.guestAccountId!==job.actorAccountId||
      slot.grantId!==job.grantId||
      slot.connectionId!==job.connectionId)
    fail('guest_ticket_durable_unknown_slot_required');
   if(!/^cmd_[a-f0-9-]{36}$/.test(commandId||''))
    fail('guest_ticket_command_invalid');
   const intent=normalizeGoldGuestProcessIntent(payload),at=now();
   const verified=await assertFreshAuthority(job);
   if(verified?.verifiedB!==true||
      verified?.grantPurpose!=='pro-share-guest'||
      verified?.ownerShareActive!==true||
      verified?.deviceOwnerAccountId!==job.ownerAccountId||
      verified?.connectionId!==job.connectionId||
      verified?.grantId!==job.grantId||
      verified?.guestAccountId!==job.actorAccountId||
      verified?.agentId!==job.agentId||
      verified?.permissionRevision!==job.permissionRevision||
      verified?.devicePolicyRevision!==devicePolicyRevision||
      verified?.guestDeviceProtocol!=='signed-pro-share-guest-v1'||
      !Number.isSafeInteger(verified.approvalExpiresAt)||
      !Number.isSafeInteger(verified.connectionExpiresAt)||
      verified.approvalExpiresAt<=at||
      verified.connectionExpiresAt<=at)
    fail('guest_ticket_fresh_b_and_share_denied');
   const expiresAt=Math.min(at+15000,verified.approvalExpiresAt,
    verified.connectionExpiresAt);
   if(expiresAt-at<1000)fail('guest_ticket_authority_expiring');
   const ticket={
    purpose:'pro-share-guest-process',version:1,commandId,
    jobId:job.jobId,operationId:job.operationId,
    ownerAccountId:job.ownerAccountId,guestAccountId:job.actorAccountId,
    agentId:job.agentId,deviceId:job.deviceId,
    connectionId:job.connectionId,grantId:job.grantId,
    permissionRevision:job.permissionRevision,devicePolicyRevision,
    payloadSha256:goldGuestIntentHash(intent),
    requiredCapabilities:[...new Set(job.requiredCapabilities)].sort(),
    issuedAt:at,expiresAt,nonce:crypto.randomBytes(16).toString('hex')
   };
   const bytes=canonical(ticket);
   const signature=await sign(bytes);
   if(!Buffer.isBuffer(signature)||signature.length!==64)
    fail('guest_ticket_signer_failed',503);
   return Object.freeze({ticket:Object.freeze(ticket),
    signature:signature.toString('base64url')});
  }
 });
}
export function verifyGoldGuestDeviceTicket({
 envelope,state,commandId,payload,requiredCapabilities=[],
 inferRequiredCapabilities=()=>[],hardDeny=()=>null,now=Date.now()
}={}){
 if(!envelope||Object.keys(envelope).sort().join('|')!=='signature|ticket'||
    !SIG.test(envelope.signature||''))fail('guest_ticket_envelope_invalid');
 const ticket=envelope.ticket,bytes=canonical(ticket),at=now();
 if(ticket.commandId!==commandId||at<ticket.issuedAt-5000||
    at>=ticket.expiresAt)fail('guest_ticket_expired_or_wrong_command');
 const e=state?.enrollment,c=state?.cloud,p=state?.policy;
 if(!e?.signer?.publicKey||!e?.accountId||!e?.deviceId||
    !p?.localFinalDenyBoundary||
    !Number.isSafeInteger(p.serverPolicyRevision)||
    !c?.connectionId||c.state!=='connected'||
    !Number.isFinite(Number(c.hardExpiresAt))||
    Number(c.hardExpiresAt)<=at||
    !fieldsMatch(ticket,{ownerAccountId:e.accountId,
      deviceId:e.deviceId,connectionId:c.connectionId},
      ['ownerAccountId','deviceId','connectionId'])||
    p.serverPolicyRevision<ticket.devicePolicyRevision)
  fail('guest_ticket_device_owner_connection_policy_denied');
 let publicKey,valid=false;
 try{
  publicKey=crypto.createPublicKey({
   key:Buffer.from(e.signer.publicKey,'base64'),format:'der',type:'spki'});
  valid=crypto.verify(null,bytes,publicKey,
   Buffer.from(envelope.signature,'base64url'));
 }catch{/* always deny an invalid pinned signer */}
 if(!valid)fail('guest_ticket_pinned_signer_invalid');
 const actual=goldGuestIntentHash(payload);
 if(actual!==ticket.payloadSha256)
  fail('guest_ticket_payload_digest_mismatch');
 const inferred=inferRequiredCapabilities(payload.script,{shell:payload.shell});
 if(!Array.isArray(inferred)||inferred.some(c=>typeof c!=='string'))
  fail('guest_ticket_local_inference_invalid');
 const expected=[...new Set([...requiredCapabilities,...inferred])].sort();
 const signed=new Set(ticket.requiredCapabilities),
  approved=new Set(state.effectiveCapabilities||[]);
 if(!expected.length||expected.some(c=>!signed.has(c)||!approved.has(c))||
    ticket.requiredCapabilities.some(c=>!approved.has(c)))
  fail('guest_ticket_local_capability_denied');
 const hard=hardDeny(payload.script);
 if(hard)fail('guest_ticket_platform_hard_deny');
 return Object.freeze({ticket,command:normalizeGoldGuestProcessIntent(payload),
  ownerAccountId:ticket.ownerAccountId,guestAccountId:ticket.guestAccountId,
  jobId:ticket.jobId,operationId:ticket.operationId,
  agentId:ticket.agentId,grantId:ticket.grantId,
  connectionId:ticket.connectionId,payloadSha256:actual});
}
