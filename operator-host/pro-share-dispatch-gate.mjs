// Gold P2-I4C: source-only, never mounted to personal/Pro Team routes.
// Admission is NOT dispatch. Load principals/job/route only from trusted
// Operator state; never accept OAuth identity or grant IDs from MCP input.
// The slot provider MUST serialize across Operator workers and devices.
import crypto from 'node:crypto';
export class GoldProShareDispatchError extends Error {
 constructor(reason,status=403){super(reason);this.name='GoldProShareDispatchError';this.status=status;}
}
const deny=(reason,status=403)=>{throw new GoldProShareDispatchError(reason,status)};
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const valid=v=>typeof v==='string'&&ID.test(v);
const eq=(a,b)=>a===b;
export function createGoldProShareDispatchGate({
 env=process.env,store,accessGrants,loadTrustedJob,loadFreshContext,
 acquireGuestSlot,loadTrustedIntent,dispatchEffect,now=Date.now
}={}){
 const on=env.LR_GOLD_PRO_SHARE_GUEST_DISPATCH==='1';
 const tickets=new Map();
 if(on&&(
  env.LR_GOLD_PRO_SHARE_CORE!=='1'||
  env.LR_GOLD_PRO_SHARE_GUEST_PAYLOAD_STAGE!=='1'||
  env.LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL!=='1'||
  !store||typeof store.authorizeOperation!=='function'||
  typeof store.billOnce!=='function'||!accessGrants?.assert||
  typeof loadTrustedJob!=='function'||typeof loadFreshContext!=='function'||
  typeof acquireGuestSlot!=='function'||
  typeof loadTrustedIntent!=='function'||typeof dispatchEffect!=='function'
 ))deny('pro_share_dispatch_dependencies_missing',503);
 async function context(jobId){
  if(!on)deny('pro_share_dispatch_disabled',404);
  if(!valid(jobId))deny('pro_share_job_id_invalid',400);
  const job=await loadTrustedJob(jobId);
  // A trusted queue item has a verified OAuth principal, an immutable
  // operation ID and an independently authorized Guest A/B grant.
  if(!job||job.jobId!==jobId||job.identitySource!=='verified-oauth'||
     job.state!=='queued'||
     !Number.isSafeInteger(job.permissionRevision)||job.permissionRevision<1||
     !valid(job.actorAccountId)||
     !valid(job.agentId)||!valid(job.deviceId)||!valid(job.grantId)||
     !valid(job.ownerAccountId)||!valid(job.connectionId)||
     !valid(job.clientSessionId)||
     !valid(job.operationId)||job.operationId.length<16||
     !valid(job.operation)||!Array.isArray(job.requiredCapabilities)||
     job.requiredCapabilities.length===0||
     job.requiredCapabilities.length>32)
   deny('pro_share_trusted_queued_job_required',403);
  const current=await loadFreshContext(job.deviceId);
  if(!current?.device||!current?.connection||
     !Array.isArray(current.approvedCapabilities)||
     !Array.isArray(current.routeCapabilities)||
     current.device.deviceId!==job.deviceId||
     current.device.accountId===job.actorAccountId||
     current.device.accountId!==job.ownerAccountId||
     current.connection.connectionId!==job.connectionId||
     current.connection.deviceId!==job.deviceId||
     current.connection.accountId!==current.device.accountId||
     current.device.nodeId!==current.nodeId||
     current.guestNativeProtocol!=='signed-pro-share-guest-v1')
   deny('pro_share_fresh_owner_route_required',403);
  const authority=await store.authorizeOperation({
   authenticatedActorAccountId:job.actorAccountId,
   authenticatedAgentId:job.agentId,device:current.device,
   connection:current.connection,grantId:job.grantId,accessGrants,
   operation:job.operation,requiredCapabilities:job.requiredCapabilities,
   approvedCapabilities:current.approvedCapabilities,
   routeCapabilities:current.routeCapabilities
  });
  if(authority.actorAccountId!==job.actorAccountId||
     authority.agentId!==job.agentId||
     authority.deviceId!==job.deviceId||
     authority.connectionId!==current.connection.connectionId||
     authority.grantId!==job.grantId||
     authority.deviceOwnerAccountId!==undefined&&
       authority.deviceOwnerAccountId!==current.device.accountId||
     authority.billedAccountId!==current.device.accountId||
     !Number.isSafeInteger(authority.permissionRevision)||
     authority.permissionRevision!==job.permissionRevision||
     authority.accessExpiresAt<=now()||
     authority.maxGuestConcurrentJobs!==1)
   deny('pro_share_authority_mismatch',403);
  // An immutable encrypted intent is mandatory; previous versions of
  // this gate had no payload binding and must never be enabled with an
  // arbitrary callback. Only the independent Guest process lane is staged.
  if(job.operation!=='process')
   deny('guest_dispatch_process_only_until_native_protocol',403);
  const intent=await loadTrustedIntent(job);
  if(!intent||!(/^[a-f0-9]{64}$/.test(intent.payloadSha256||''))||
     intent.command?.type!=='process-start'||intent.operation!=='process'||
     intent.jobId!==job.jobId||
     intent.ownerAccountId!==job.ownerAccountId||
     intent.actorAccountId!==job.actorAccountId||
     intent.agentId!==job.agentId||
     intent.deviceId!==job.deviceId||
     intent.grantId!==job.grantId||
     intent.connectionId!==job.connectionId||
     intent.operationId!==job.operationId||
     intent.permissionRevision!==job.permissionRevision)
   deny('guest_dispatch_immutable_payload_required',403);
  // Snapshot immutable ticket identity; the queue provider may later
  // update its own objects, but it cannot rewrite an admitted ticket.
  const snapshot=Object.freeze({...job,
   requiredCapabilities:Object.freeze([...job.requiredCapabilities])});
  return {job:snapshot,authority,current,intent};
 }
 function assertSame(original,later){
  const a=original.job,b=later.job;
  for(const k of ['jobId','actorAccountId','agentId','deviceId',
   'grantId','operationId','operation','identitySource',
   'permissionRevision','clientSessionId','ownerAccountId','connectionId'])
   if(!eq(a[k],b[k]))deny('pro_share_queue_identity_changed',409);
  if(JSON.stringify(a.requiredCapabilities)!==JSON.stringify(b.requiredCapabilities))
   deny('pro_share_queue_capabilities_changed',409);
  if(original.intent.payloadSha256!==later.intent.payloadSha256)
   deny('guest_dispatch_payload_digest_changed',409);
  if(original.authority.permissionRevision!==later.authority.permissionRevision||
     original.authority.connectionId!==later.authority.connectionId||
     original.authority.billedAccountId!==later.authority.billedAccountId)
   deny('pro_share_permission_revision_changed',409);
 }
 return Object.freeze({
  async admit({jobId}={}){
   const evidence=await context(jobId);
   if([...tickets.values()].some(x=>x.evidence.job.jobId===jobId))
    deny('pro_share_job_already_admitted',409);
   const ticketId='pst_'+crypto.randomBytes(24).toString('hex');
   tickets.set(ticketId,{state:'queued',evidence});
   return Object.freeze({ticketId,jobId,accessExpiresAt:evidence.authority.accessExpiresAt,
    permissionRevision:evidence.authority.permissionRevision,dispatchable:true});
  },
  async dispatch({ticketId}={}){
   if(!on)deny('pro_share_dispatch_disabled',404);
   const t=tickets.get(ticketId);
   if(!t||t.state!=='queued')deny('pro_share_ticket_not_queued',409);
   t.state='dispatching';let slot,effectSubmitted=false;
   try{
    const fresh=await context(t.evidence.job.jobId);
    assertSame(t.evidence,fresh);
    // The provider must use a durable atomic semaphore (one running Guest
    // per shared device), NOT a process-local counter.
    slot=await acquireGuestSlot({
     ownerAccountId:fresh.authority.billedAccountId,
     deviceId:fresh.job.deviceId,guestAccountId:fresh.job.actorAccountId,
     operationId:fresh.job.operationId,jobId:fresh.job.jobId,
     grantId:fresh.job.grantId,connectionId:fresh.authority.connectionId,
     maxConcurrent:1
    });
    if(!slot||typeof slot.release!=='function'||
       typeof slot.markDispatchAttempt!=='function'||slot.acquired!==true)
     deny('pro_share_guest_slot_unavailable',409);
    const atDispatch=await context(t.evidence.job.jobId);
    assertSame(t.evidence,atDispatch);
    // Charge exactly once for this server-owned operation ID BEFORE any
    // OS dispatch. A rejected/failed OS submission may still count as an
    // attempted call; retrying an ambiguous side effect is forbidden.
    const billed=await store.billOnce({
     authenticatedActorAccountId:atDispatch.job.actorAccountId,
     authenticatedAgentId:atDispatch.job.agentId,
     device:atDispatch.current.device,connection:atDispatch.current.connection,
     grantId:atDispatch.job.grantId,accessGrants,
     operationId:atDispatch.job.operationId,units:1
    });
    if(billed.billedAccountId!==atDispatch.authority.billedAccountId||
       billed.operationId!==atDispatch.job.operationId)
     deny('pro_share_meter_receipt_mismatch',503);
    const last=await context(t.evidence.job.jobId);
    assertSame(t.evidence,last);
    // After this boundary, an OS side effect may be running even if its
    // ACK is lost. Keep the durable Guest slot until signed terminal
    // reconciliation, rather than releasing it on an initial ACK.
    // Durable unknown intent must be committed BEFORE calling any OS effect.
    // Once an unknown intent exists, even a callback exception may describe
    // an executing process; the reservation is released only from M6 ACK.
    await slot.markDispatchAttempt();
    effectSubmitted=true;
    const receipt=await dispatchEffect(Object.freeze({
     jobId:last.job.jobId,operationId:last.job.operationId,
     actorAccountId:last.job.actorAccountId,agentId:last.job.agentId,
     deviceId:last.job.deviceId,ownerAccountId:last.authority.billedAccountId,
     grantId:last.job.grantId,connectionId:last.authority.connectionId,
     operation:last.job.operation,
     requiredCapabilities:last.authority.requiredCapabilities,
     // Explicitly a GUEST payload, never an owner session/command.
     guestPayloadSha256:last.intent.payloadSha256,
     guestProcessIntent:last.intent.command
    }));
    // dispatchEffect is responsible for durable OS-effect receipt tracking.
    if(!receipt||receipt.accepted!==true)
     deny('pro_share_dispatch_receipt_missing',503);
    t.state='accepted';
    return Object.freeze({accepted:true,terminalReleaseRequired:true,
     jobId:last.job.jobId,
     operationId:last.job.operationId,charged:billed.charged===true,
     idempotent:billed.idempotent===true});
   }catch(error){t.state='unknown_or_denied';throw error}
   finally{
    // Pre-dispatch refusals can free the reservation immediately. Once the
    // callback was invoked, only the external trusted signed terminal ACK /
    // owner recovery reconciler may release the durable reservation.
    if(slot?.acquired===true&&!effectSubmitted)await slot.release();
   }
  }
 });
}
