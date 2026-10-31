import crypto from 'node:crypto';
import {memoryDirectory,memoryInvites,memoryRelay} from './gold-memory-rendezvous.mjs';
import { DEVICE_DUPLEX_PROTOCOL } from './device-duplex-transport.mjs';
import { handleDeviceDuplexSession } from './device-duplex-session.mjs';
import { ownerFleetJobRows } from './fleet-job-view.mjs';
import { ownerDeviceResourceMetrics } from '../lib/gold-device-resource-metrics.mjs';
import { scanOwnerStaleClaims } from '../lib/gold-stale-claim-detector.mjs';


export async function handleDeviceChannelRoutes(req,res,url,deps){
  const {ACCOUNT_ID,AccountError,AgentClientRegistryError,CLIENT_BACKWARD_RELEASES,CONNECTION_LEASE_ENFORCE,DeviceAccessGrantError,DevicePairingRegistryError,EnrollmentError,FleetAuthorityError,FleetError,MAX_MEMORY_OUTPUT,MAX_RING_EVENTS,MIN_SUPPORTED_CLIENT_VERSION,NODE_ID,VERSION,abandonedCommandReceiptFromDisk,completedCommandReceiptFromDisk,accessGrants,accounts,agentClients,allDeviceViews,applyDeviceTelemetry,capabilities,clientCompatibility,connectionSpec,connections,deviceView,devices,emitStream,enrollments,finishJob,fleet,fleetAuthority,fleetEligibility,fleetTarget,jobView,jobs,goldJobs,deviceResourceLocks,staleClaimMonitor,deviceResourceSampleCache,deviceBootObservations,cancelQueuedPersonalJob,cancelControlJob,deviceStopRequests,requestFleetProcessStop,reconcileSignedTerminalProcessReceipts,executionEpochs,requiresExecutionEpoch,normalizeUpdateReport,pairingCodes,planEntitlements,pushEvent,queueHelperUpdate,readJson,reapAccessGrants,realRemoteLive,recentEvents,requireDeviceConnection,sendJson,sessions,targetRoute,terminalResultSummary,verifiedChannelContext,verifiedFleetContext,verifiedLeafCapabilities,memorySyncPolicy,memoryAccountDelete,accountNotifications,proTeams,goldAbV2SignedPreview,goldAbV2SignedApproval}=deps;
  // Boot telemetry uses the authenticated device channel, never the M4
  // scheduler. Errors are isolated from command ACK and cannot free claims.
  const persistBoot=async(ctx,value,agentVersion)=>{
    if(!value||!deviceBootObservations)return;
    try{await deviceBootObservations.record({
      accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,
      agentVersion,value
    });}catch(error){
      pushEvent({type:'device_boot_telemetry_persist_failed',
        accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,
        status:'error',reason:'boot_store_unavailable'});
    }
  };
  // Enrolled-Agent signed, owner-scoped, READ-ONLY V2 preview.
  // No account cookie or unverified deviceId, no B plaintext, no approve.
  if(req.method==='POST'&&url.pathname==='/v1/device-channel/abv2-pending-preview'){
    if(typeof goldAbV2SignedPreview!=='function')
      return sendJson(res,404,{ok:false,error:'not_found'});
    const envelope=await readJson(req);
    const ctx=await verifiedChannelContext(envelope,'abv2-pending-preview');
    return sendJson(res,200,await goldAbV2SignedPreview(ctx));
  }
  // Dedicated signed mutation, separate from read-only preview.
  if(req.method==='POST'&&url.pathname==='/v1/device-channel/abv2-owner-approve'){
    if(typeof goldAbV2SignedApproval!=='function')
      return sendJson(res,404,{ok:false,error:'not_found'});
    const envelope=await readJson(req);
    const ctx=await verifiedChannelContext(envelope,'abv2-owner-approve');
    return sendJson(res,200,await goldAbV2SignedApproval(ctx));
  }
  // Reuse the canonical account notification inbox. The signed enrollment
  // determines the account; the browser cannot supply an account ID.
  if(req.method==='POST'&&url.pathname==='/v1/device-channel/account-notifications'){
    const payload=await readJson(req),ctx=await verifiedChannelContext(payload,'account-notifications');
    if(!accountNotifications||!proTeams)throw new EnrollmentError('account_notification_service_unavailable',503);
    accounts.assertOperational(ctx.binding.accountId);
    const account=accounts.account(ctx.binding.accountId);
    if(!account||account.state==='revoked'||account.status==='disabled')
      throw new EnrollmentError('account_notification_identity_unavailable',403);
    const [system,team]=await Promise.all([
      accountNotifications.inbox(ctx.binding.accountId,account),
      Promise.resolve(proTeams.inbox({memberAccountId:ctx.binding.accountId}))
    ]);
    // Preview only. Never forward team invite codes, account credentials or
    // arbitrary publisher-supplied URLs to the device browser.
    const notices=[
      ...(system.notifications||[]).map(n=>({
        notificationId:n.notificationId,type:n.type,title:n.title,body:n.body,
        readAt:n.readAt,createdAt:n.createdAt
      })),
      ...(team.notifications||[]).map(n=>({
        notificationId:n.notificationId,type:'team_invitation',title:'Pro Team invitation',
        body:'Invitation from '+String(n.ownerEmail||'a team owner').slice(0,200),
        readAt:n.readAt,createdAt:n.createdAt
      }))
    ].filter(n=>/^sys_[a-f0-9-]{36}$|^tinv_[a-f0-9]{24}$/.test(String(n.notificationId)) && !n.readAt)
      .sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
    return sendJson(res,200,{ok:true,accountEmail:String(account.email||'').trim().toLowerCase(),unreadCount:Number(system.unreadCount||0)+Number(team.unreadCount||0),
      notifications:notices.slice(0,5)});
  }
  if(req.method==='POST'&&url.pathname==='/v1/device-channel/memory-sync-policy'){
    const body=await readJson(req),ctx=await verifiedChannelContext(body,'memory-sync-policy');
    if(!memorySyncPolicy)throw Error('memory_sync_account_pg_unavailable');
    const accountId=ctx.binding.accountId,roster=devices.list(),action=ctx.payload?.action;
    if(action==='get'){
      const policy=await memorySyncPolicy.get(accountId,roster);
      return sendJson(res,200,{ok:true,policy});
    }
    if(action==='set'){
      // SET is reached from the owner-authenticated, CSRF-protected Wall and
      // signed by its enrolled Agent. Same-account roster/CAS validated again.
      const policy=await memorySyncPolicy.set(accountId,ctx.payload.policy,roster);
      return sendJson(res,200,{ok:true,policy});
    }
    if(action==='manual'){
      const manual=await memorySyncPolicy.requestManual(accountId,
        ctx.payload.deviceId,roster);
      return sendJson(res,200,{ok:true,manual});
    }
    throw new EnrollmentError('memory_sync_policy_action_invalid',400);
  }
  if(req.method==='POST'&&url.pathname==='/v1/device-channel/memory-account-delete'){
    const body=await readJson(req),ctx=await verifiedChannelContext(body,'memory-account-delete');
    const action=ctx.payload?.action,accountId=ctx.binding.accountId,deviceId=ctx.binding.deviceId;
    if(!memoryAccountDelete)throw new EnrollmentError('memory_account_delete_pg_unavailable',503);
    if(action==='begin'){
      const roster=devices.list();
      const directory=memoryDirectory({accountId,deviceId,devices:roster});
      const key=directory.find(x=>x.deviceId===deviceId)?.memoryIdentity?.signPublicKey||null;
      const status=await memoryAccountDelete.begin(accountId,deviceId,ctx.payload.envelope,roster,key);
      return sendJson(res,200,{ok:true,status});
    }
    if(action==='poll'){
      return sendJson(res,200,{ok:true,commands:await memoryAccountDelete.pending(accountId,deviceId)});
    }
    if(action==='list'){
      return sendJson(res,200,{ok:true,requests:await memoryAccountDelete.list(accountId)});
    }
    if(action==='ack'){
      return sendJson(res,200,{ok:true,result:await memoryAccountDelete.ack(accountId,deviceId,ctx.payload.scopeId)});
    }
    if(action==='status'){
      return sendJson(res,200,{ok:true,status:await memoryAccountDelete.status(accountId,ctx.payload.scopeId)});
    }
    throw new EnrollmentError('memory_account_delete_action_invalid',400);
  }
  // Account-scoped Memory device discovery: authenticate the enrolled device, not a
  // caller-supplied account ID. Never expose checkpoint bodies or unrelated accounts.
  if(req.method==='POST'&&url.pathname==='/v1/device-channel/memory-peers'){
    const body=await readJson(req),ctx=await verifiedChannelContext(body,'memory-peers');
    const owned=memoryDirectory({accountId:ctx.binding.accountId,
      deviceId:ctx.binding.deviceId,devices:devices.list(),identity:ctx.payload?.identity||null});
    return sendJson(res,200,{ok:true,currentDeviceId:ctx.binding.deviceId,devices:owned});
  }
  if(req.method==='POST'&&url.pathname==='/v1/device-channel/memory-invites'){
    const body=await readJson(req),ctx=await verifiedChannelContext(body,'memory-invites');
    const roster=devices.list(),policy=await memorySyncPolicy.get(ctx.binding.accountId,roster);
    if(!policy.enabled||!policy.devices.some(d=>d.deviceId===ctx.binding.deviceId&&d.selected))
      throw new EnrollmentError('memory_sync_account_disabled_or_unselected',403);
    if(ctx.payload?.action==='offer'&&!policy.devices.some(d=>
      d.deviceId===ctx.payload?.package?.invite?.toDeviceId&&d.selected))
      throw new EnrollmentError('memory_sync_replica_not_selected',403);
    if(ctx.payload?.action==='offer'&&
       await memoryAccountDelete.isDeleted(ctx.binding.accountId,ctx.payload?.package?.invite?.scopeId||''))
      throw new EnrollmentError('memory_scope_deleted_account_wide',409);
    const result=memoryInvites({accountId:ctx.binding.accountId,deviceId:ctx.binding.deviceId,
      devices:roster,payload:ctx.payload||{}});
    return sendJson(res,200,{ok:true,...(Array.isArray(result)?{invites:result}:{result})});
  }
  if(req.method==='POST'&&url.pathname==='/v1/device-channel/memory-relay'){
    const body=await readJson(req),ctx=await verifiedChannelContext(body,'memory-relay');
    const roster=devices.list(),policy=await memorySyncPolicy.get(ctx.binding.accountId,roster);
    if(!policy.enabled||!policy.devices.some(d=>d.deviceId===ctx.binding.deviceId&&d.selected))
      throw new EnrollmentError('memory_sync_account_disabled_or_unselected',403);
    const outgoing=ctx.payload?.action==='push_frame'?
      ctx.payload?.frame?.meta?.toDeviceId:
      ctx.payload?.action==='push_ack'?ctx.payload?.ack?.homeDeviceId:
      ctx.payload?.action==='push_evidence'?ctx.payload?.evidence?.meta?.homeDeviceId:
      ctx.payload?.action==='push_evidence_ack'?ctx.payload?.evidence_ack?.deviceId:null;
    if(outgoing&&!policy.devices.some(d=>d.deviceId===outgoing&&d.selected))
      throw new EnrollmentError('memory_sync_recipient_not_selected',403);
    const relayScope=ctx.payload?.frame?.meta?.scopeId||ctx.payload?.ack?.scopeId||
      ctx.payload?.evidence?.meta?.scopeId||ctx.payload?.evidence_ack?.scopeId;
    if(relayScope&&await memoryAccountDelete.isDeleted(ctx.binding.accountId,relayScope))
      throw new EnrollmentError('memory_scope_deleted_account_wide',409);
    const result=memoryRelay({accountId:ctx.binding.accountId,deviceId:ctx.binding.deviceId,
      devices:roster,payload:ctx.payload||{}});
    return sendJson(res,200,{ok:true,result});
  }
  if(req.method==='POST'&&url.pathname==='/v1/device-channel/capabilities-refresh'){
    const body=await readJson(req),ctx=await verifiedChannelContext(body,'capabilities-refresh');
    const change=enrollments.refreshDiscoveredCapabilities({
      deviceId:ctx.binding.deviceId,accountId:ctx.binding.accountId,capabilities:ctx.payload.capabilities
    });
    // Durable PG write must finish before returning a signed permission revision.
    if(typeof deps.flushGoldRegistries!=='function')throw Error('gold_permission_durable_store_unavailable');
    await deps.flushGoldRegistries();
    const active=Array.isArray(ctx.device.capabilities)?ctx.device.capabilities:[];
    const effective=active.filter(cap=>change.policy.approvedCapabilities.includes(cap));
    if(effective.length)devices.heartbeat(ctx.binding.deviceId,{capabilities:effective});
    if(change.addedCapabilities.length||change.removedCapabilities.length){
      pushEvent({type:'device_capabilities_rescanned',accountId:ctx.binding.accountId,deviceId:ctx.binding.deviceId,status:'updated',addedCapabilities:change.addedCapabilities,removedCapabilities:change.removedCapabilities,policyRevision:change.policy.policyRevision});
    }
    return sendJson(res,200,{ok:true,change,policy:enrollments.policyEnvelope(ctx.binding.deviceId)});
  }
  // Device signatures establish device identity; account credentials establish
  // *owner* intent. Never allow a device signature alone to expand approval.
  if(req.method==='POST'&&url.pathname==='/v1/device-channel/capabilities-owner-approve'){
    const body=await readJson(req),ctx=await verifiedChannelContext(body,'capabilities-owner-approve');
    if(ctx.binding.trustedHost)throw new EnrollmentError('trusted_host_uses_local_capability_authority',409);
    const email=String(ctx.payload.email||'').trim(),password=String(ctx.payload.password||'');
    if(!email||password.length<1||password.length>512)throw new EnrollmentError('owner_credentials_required',401);
    const owner=accounts.verifyCredentials({email,password},{recordLogin:true,eventType:'device_permissions_owner_approved'});
    if(owner.accountId!==ctx.binding.accountId)throw new EnrollmentError('device_account_mismatch',403);
    const policy=enrollments.updatePolicy({deviceId:ctx.binding.deviceId,accountId:owner.accountId,
      approvedCapabilities:ctx.payload.approvedCapabilities,policyProfile:ctx.payload.policyProfile||'custom'});
    if(typeof deps.flushGoldRegistries!=='function')throw Error('gold_permission_durable_store_unavailable');
    await deps.flushGoldRegistries();
    pushEvent({type:'device_permissions_owner_approved',deviceId:ctx.binding.deviceId,accountId:owner.accountId,
      status:'updated',policyRevision:policy.policyRevision,capabilities:policy.approvedCapabilities});
    return sendJson(res,200,{ok:true,policy:enrollments.policyEnvelope(ctx.binding.deviceId)});
  }
  const acceptDesktopLivePush=(ctx,payload=ctx.payload)=>{
    requireDeviceConnection(ctx.device.deviceId);
    const session=sessions.ensure(String(payload.sessionId||''),{agentId:String(payload.agentId||'')});
    if(session.deviceId!==ctx.device.deviceId||session.accountId!==ctx.binding.accountId)throw new DeviceAccessGrantError('device_access_grant_session_mismatch',403);
    const live=realRemoteLive.push({
      deviceId:ctx.device.deviceId,sessionId:session.id,agentId:session.agentId,
      semanticSessionId:payload.semanticSessionId,stateSeq:payload.stateSeq,inputSeq:payload.inputSeq,rootEpoch:payload.rootEpoch,
      events:payload.events,snapshot:payload.snapshot,displayTopologyId:payload.displayTopologyId,cursor:payload.cursor,foreground:payload.foreground,
      resyncRecommended:payload.resyncRecommended,closed:payload.closed,heartbeat:payload.heartbeat,updatedAt:Date.now()
    });
    return {ok:true,live};
  };
  const acceptDeviceResult=async(ctx,result,{resultTransport='unspecified'}={})=>{
    let command;
    try{command=fleet.command(result.commandId);}
    catch(error){
      if(error?.message!=='command_not_found')throw error;
      const receipt=fleet.receipt(result.commandId)||abandonedCommandReceiptFromDisk?.(result.commandId)||completedCommandReceiptFromDisk?.(result.commandId);
      if(!receipt){
        // The terminal job commit carries its command ID. PG is the fallback
        // when Operator crashed after commit but before event-log persistence.
        const terminal=await goldJobs.completedForCommand({
          commandId:result.commandId,accountId:ctx.binding.accountId,
          deviceId:ctx.device.deviceId,nodeId:ctx.device.nodeId
        });
        if(!terminal)throw error;
        return {ok:true,accepted:true,duplicate:true,job:terminal};
      }
      if(receipt.accountId!==ctx.binding.accountId||receipt.deviceId!==ctx.device.deviceId||receipt.nodeId!==ctx.device.nodeId)throw new FleetError('command_device_mismatch',403);
      // A completed Fleet receipt is not itself proof of a terminal result.
      // An abandoned queued command has no verified device execution.
      if(receipt.abandoned)throw new FleetError('command_abandoned_effect_unknown',409);
      const committed=await goldJobs.get(receipt.jobId);
      if(!committed||
         committed.accountId!==ctx.binding.accountId||
         committed.deviceId!==ctx.device.deviceId||
         !committed.finishedAt||
         !['ok','error','timeout','cancelled'].includes(committed.status)||
         !Number.isInteger(committed.exitCode))
        throw new FleetError('command_terminal_commit_unverified',409);
      // PostgreSQL returns an already redacted public snapshot, not a live job.
      return {ok:true,accepted:true,duplicate:true,job:committed};
    }
    if(command.accountId!==ctx.binding.accountId||command.deviceId!==ctx.device.deviceId||command.nodeId!==ctx.device.nodeId)throw new FleetError('command_device_mismatch',403);
    const job=jobs.get(command.jobId);
    // Bind the retained job to the authenticated signed Agent principal as
    // well as the Fleet command. A mismatched job must never receive an ACK.
    if(!job||job.commandId!==command.commandId||
       job.accountId!==ctx.binding.accountId||
       job.deviceId!==ctx.device.deviceId)
      throw new FleetError('remote_job_not_found',404);
    const stdout=String(result.stdout||''),stderr=String(result.stderr||'');
    if(Buffer.byteLength(stdout)>MAX_MEMORY_OUTPUT||Buffer.byteLength(stderr)>MAX_MEMORY_OUTPUT)throw new FleetError('remote_result_too_large',413);
    if(result.data!==undefined&&Buffer.byteLength(JSON.stringify(result.data))>MAX_MEMORY_OUTPUT)throw new FleetError('remote_result_data_too_large',413);
    if(result.data!==undefined){job.resultData=result.data;job.resultSummary='';}
    applyDeviceTelemetry(job,result.telemetry);
    const exitCode=Number(result.exitCode);
    if(!Number.isInteger(exitCode)||exitCode<0||exitCode>255)throw new FleetError('invalid_remote_exit_code');
    if(stdout)emitStream(job,'stdout',Buffer.from(stdout));
    if(stderr)emitStream(job,'stderr',Buffer.from(stderr));
    job.timedOut=String(result.status||'')==='timeout';
    // Only a signed device exit after an owner stop request is proof of Kill.
    if(String(result.status||'')==='cancelled'&&job.stopRequestedAt)
      job.cancelled=true;
    job.signedResultVerified=true;
    finishJob(job,exitCode,null);
    // This signed Agent result is NOT acknowledged until the terminal state
    // is committed to PostgreSQL. Fleet completion must follow the durable
    // ledger commit as well; otherwise a retry could receive a duplicate
    // receipt even though its final result was never persisted.
    await goldJobs.flush();
    fleet.complete({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,nodeId:ctx.device.nodeId,commandId:command.commandId,resultTransport});
    return {ok:true,accepted:true,duplicate:false,job:jobView(job)};
  };
    if (req.method === 'POST' && url.pathname === '/v1/enrollments/begin') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok:true, enrollment:enrollments.begin(body) });
    }
    if (req.method === 'POST' && url.pathname === '/v1/enrollments/poll') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok:true, enrollment:enrollments.poll(body) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/enrollments') {
      return sendJson(res, 200, { ok:true, pending:enrollments.listPending() });
    }
    if (req.method === 'POST' && url.pathname === '/v1/enrollments/cancel') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok:true, enrollment:enrollments.cancel(body) });
    }
    if (req.method === 'POST' && url.pathname === '/v1/enrollments/approve') {
      const body = await readJson(req);
      const approval = enrollments.approve(body);
      const binding = enrollments.binding(approval.deviceId);
      const device = devices.enroll({ accountId:binding.accountId, deviceId:binding.deviceId, nodeId:binding.deviceId, displayName:binding.displayName, platform:binding.platform, architecture:binding.architecture, agentVersion:binding.agentVersion, publicIdentityKey:binding.publicIdentityKey, capabilities:binding.approvedCapabilities, policyProfile:binding.policyProfile });
      return sendJson(res, 200, { ok:true, approval, device });
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-pair/begin') {
      const body=await readJson(req);
      const paired=pairingCodes.redeem(body.aCode,{connectionForDevice:deviceId=>connections.get(deviceId)});
      if(body.accountId!=null&&String(body.accountId)!==paired.accountId)throw new DevicePairingRegistryError('pairing_account_mismatch',403);
      const connection=connections.assertConnected(paired.deviceId);
      if(connection.connectionId!==paired.connectionId) throw new DevicePairingRegistryError('device_connection_changed',409);
      const access=accessGrants.request({accountId:paired.accountId,deviceId:paired.deviceId,connectionId:paired.connectionId,connectionExpiresAt:connection.hardExpiresAt,agentId:body.agentId,label:body.label,forceApproval:true,requestTtlMs:5*60*1000,pairingId:paired.pairingId});
      return sendJson(res,201,{ok:true,access,pairing:{pairingId:paired.pairingId,deviceId:paired.deviceId}});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-access/request') {
      const body=await readJson(req), deviceId=String(body.deviceId||'');
      const device=devices.get(deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
      const accountId=String(body.accountId||ACCOUNT_ID);
      if(device.accountId!==accountId) throw new DeviceAccessGrantError('device_access_account_mismatch',403);
      const connection=connections.assertConnected(deviceId);
      reapAccessGrants();
      const access=accessGrants.request({accountId,deviceId,connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt,agentId:body.agentId,label:body.label});
      return sendJson(res,access.state==='approved'?200:201,{ok:true,access});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-access/poll') {
      const body=await readJson(req);
      return sendJson(res,200,{ok:true,access:accessGrants.poll(body)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-access/recover') {
      const body=await readJson(req);
      reapAccessGrants();
      return sendJson(res,200,{ok:true,access:accessGrants.recoverPairing({accountId:body.accountId,agentId:body.agentId})});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-access/recover-consume') {
      const body=await readJson(req);
      return sendJson(res,200,{ok:true,access:accessGrants.consumeRecoveredPairing({requestId:body.requestId,accountId:body.accountId,agentId:body.agentId})});
    }
    if (req.method === 'GET' && url.pathname === '/v1/device-access/requests') {
      return sendJson(res,200,{ok:true,pending:accessGrants.pendingAll()});
    }
    const accessRequestInfoMatch=url.pathname.match(/^\/v1\/device-access\/requests\/(pa_[A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && accessRequestInfoMatch) {
      return sendJson(res,200,{ok:true,authorization:accessGrants.requestInfo(accessRequestInfoMatch[1])});
    }
    const accessRequestMatch=url.pathname.match(/^\/v1\/device-access\/requests\/(pa_[A-Za-z0-9_-]+)\/(approve|deny)$/);
    if (req.method === 'POST' && accessRequestMatch) {
      const request=accessGrants.requestInfo(accessRequestMatch[1]);
      const connection=connections.assertConnected(request.deviceId);
      if(connection.connectionId!==request.connectionId) throw new DeviceAccessGrantError('device_connection_changed',409);
      if(accessRequestMatch[2]==='approve'){
        const grant=accessGrants.approve(request.requestId,{deviceId:request.deviceId,connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt,idleGraceMs:connection.reconnectGraceMs});
        return sendJson(res,200,{ok:true,grant});
      }
      return sendJson(res,200,{ok:true,authorization:accessGrants.deny(request.requestId,'owner_denied',{deviceId:request.deviceId})});
    }
    const accessGrantMatch=url.pathname.match(/^\/v1\/device-access\/grants\/(dag_[A-Za-z0-9._:-]+)$/);
    if (req.method === 'GET' && accessGrantMatch) {
      reapAccessGrants();
      const grant=accessGrants.assert(accessGrantMatch[1],{touch:false});
      if(grant.purpose==='pro-share-guest')
        throw new AgentClientRegistryError('guest_purpose_owner_grant_view_denied',403);
      const connection=connections.assertConnected(grant.deviceId);
      accessGrants.assert(grant.grantId,{deviceId:grant.deviceId,connectionId:connection.connectionId});
      const device=devices.get(grant.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
      return sendJson(res,200,{ok:true,grant,device:{deviceId:device.deviceId,nodeId:device.nodeId,displayName:device.displayName,platform:device.platform,architecture:device.architecture},connection:connections.get(grant.deviceId)});
    }
    if (req.method === 'GET' && url.pathname === '/v1/agent-client/by-agent') {
      const accountId=String(url.searchParams.get('accountId')||''),agentId=String(url.searchParams.get('agentId')||'');
      const client=agentClients.findActive({accountId,agentId,touch:true});
      const ownerBindings=client.bindings.filter(b=>b.grantPurpose!=='pro-share-guest');
      const visibleDefault=ownerBindings.some(b=>b.deviceId===client.defaultDeviceId)?
        client.defaultDeviceId:null;
      return sendJson(res,200,{ok:true,client:{clientSessionId:client.clientSessionId,accountId:client.accountId,agentId:client.agentId,expiresAt:client.expiresAt,defaultDeviceId:visibleDefault,bindings:ownerBindings}});
    }
    if (req.method === 'POST' && url.pathname === '/v1/agent-client/attach') {
      const body=await readJson(req), grant=accessGrants.assert(body.grantId,{touch:false});
      // Guest delegation can NEVER use the generic owner A/B attach path.
      // Its separate OAuth+B poll checks seat/share/revision and PG044.
      if(grant.purpose==='pro-share-guest')
        throw new AgentClientRegistryError('guest_purpose_requires_verified_pro_share_poll',403);
      const connection=connections.assertConnected(grant.deviceId);
      if(connection.connectionId!==grant.connectionId)throw new AgentClientRegistryError('agent_client_device_connection_mismatch',409);
      const client=agentClients.attach({clientSessionId:body.clientSessionId||null,accountId:grant.accountId,agentId:body.agentId,grant,pairingRequestId:body.pairingRequestId||null});
      const device=devices.get(grant.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
      return sendJson(res,200,{ok:true,client:{clientSessionId:client.clientSessionId,agentId:client.agentId,expiresAt:client.expiresAt},device:{deviceId:device.deviceId,nodeId:device.nodeId,displayName:device.displayName,state:device.state,platform:device.platform,architecture:device.architecture}});
    }
    const agentClientDevicesMatch=url.pathname.match(/^\/v1\/agent-client\/(lrc_[A-Za-z0-9_-]+)\/devices$/);
    if (req.method === 'GET' && agentClientDevicesMatch) {
      const agentId=String(url.searchParams.get('agentId')||''),client=agentClients.view(agentClientDevicesMatch[1],{agentId,touch:true}),authorized=[];
      for(const binding of client.bindings){
        // General owner device enumeration must never list Guest shares.
        if(binding.grantPurpose==='pro-share-guest')continue;
        try{
          const grant=accessGrants.assert(binding.grantId,{agentId:client.agentId,accountId:client.accountId,deviceId:binding.deviceId,connectionId:binding.connectionId,touch:false}),connection=connections.assertConnected(binding.deviceId);
          if(connection.connectionId!==binding.connectionId)throw new AgentClientRegistryError('agent_client_device_connection_mismatch',409);
          const device=devices.get(binding.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
          authorized.push({deviceId:device.deviceId,nodeId:device.nodeId,name:device.displayName,state:device.state,platform:device.platform,architecture:device.architecture,connection:{state:connection.state,remainingMs:connection.remainingMs||Math.max(0,connection.hardExpiresAt-Date.now())}});
        }catch{agentClients.removeDevice(binding.deviceId,'binding_invalid');}
      }
      return sendJson(res,200,{ok:true,client:{clientSessionId:client.clientSessionId,agentId:client.agentId,expiresAt:client.expiresAt},devices:authorized});
    }
    if (req.method === 'POST' && url.pathname === '/v1/agent-client/resolve') {
      const body=await readJson(req),binding=agentClients.resolve(body.clientSessionId,{agentId:body.agentId,deviceId:body.deviceId||null,touch:false});
      if(binding.grantPurpose==='pro-share-guest')
        throw new AgentClientRegistryError('guest_purpose_owner_route_denied',403);
      agentClients.resolve(body.clientSessionId,{agentId:body.agentId,deviceId:binding.deviceId,touch:true});
      try{
        const grant=accessGrants.assert(binding.grantId,{agentId:binding.agentId,accountId:binding.accountId,deviceId:binding.deviceId,connectionId:binding.connectionId}),connection=connections.assertConnected(binding.deviceId);
        if(connection.connectionId!==binding.connectionId)throw new AgentClientRegistryError('agent_client_device_connection_mismatch',409);
        const device=devices.get(binding.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
        return sendJson(res,200,{ok:true,binding,grant,device:{deviceId:device.deviceId,nodeId:device.nodeId,displayName:device.displayName,state:device.state,platform:device.platform,architecture:device.architecture},connection});
      }catch(error){agentClients.removeDevice(binding.deviceId,'binding_invalid');throw error;}
    }
    if (req.method === 'POST' && url.pathname === '/v1/agent-client/context') {
      const body=await readJson(req),binding=agentClients.resolve(body.clientSessionId,{agentId:body.agentId,deviceId:body.deviceId||null,touch:false});
      if(binding.grantPurpose==='pro-share-guest')
        throw new AgentClientRegistryError('guest_purpose_owner_context_denied',403);
      agentClients.resolve(body.clientSessionId,{agentId:body.agentId,deviceId:binding.deviceId,touch:true});
      try{
        const grant=accessGrants.assert(binding.grantId,{agentId:binding.agentId,accountId:binding.accountId,deviceId:binding.deviceId,connectionId:binding.connectionId}),connection=connections.assertConnected(binding.deviceId);
        if(connection.connectionId!==binding.connectionId)throw new AgentClientRegistryError('agent_client_device_connection_mismatch',409);
        const device=devices.get(binding.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)}),route=targetRoute(device.nodeId,{accountId:grant.accountId});
        const workspace=body.workspace==null?String(binding.workingContext?.workspace||''):String(body.workspace||'').slice(0,512);
        const gracePreset=String(body.gracePreset||binding.workingContext?.gracePreset||'60m');
        let session=null;
        if(binding.workingContext?.sessionId){try{const prior=sessions.get(binding.workingContext.sessionId,binding.agentId);if(['active','hold'].includes(prior.state))session=prior;}catch{}}
        if(!session)session=sessions.open({accountId:grant.accountId,agentId:binding.agentId,label:'ChatGPT Light Remote',workspace,gracePreset,nodeId:device.nodeId,deviceId:device.deviceId,maxActiveForNode:route.sessionCeiling,maxActiveForAccount:planEntitlements(accounts.account(grant.accountId)).sessionLimit??null});
        if(process.env.LR_GOLD_SESSION_AGENT_NICKNAME==='1'&&typeof body.agentNickname==='string'){
          // Optional, nonblocking display metadata: never gate A/B or session ready.
          try{session=sessions.setDisplayName(session.sessionId,{accountId:grant.accountId,
            agentId:binding.agentId,displayName:body.agentNickname,source:'agent'});}
          catch(error){if(error?.message==='gold_redis_session_write_failed')throw error;}
        }
        if(workspace!==session.workspace)session=sessions.setWorkspace(session.sessionId,binding.agentId,workspace);
        const context=agentClients.setWorkingContext(binding.clientSessionId,{agentId:binding.agentId,deviceId:device.deviceId,sessionId:session.sessionId,workspace:session.workspace,gracePreset:session.gracePreset});
        return sendJson(res,200,{ok:true,context:{...context,nodeId:device.nodeId,displayName:device.displayName,platform:device.platform,architecture:device.architecture,deviceState:device.state,connectionState:connection.state},session});
      }catch(error){if(['agent_client_device_connection_mismatch','device_connection_closed','device_connection_expired'].includes(error.message))agentClients.removeDevice(binding.deviceId,'binding_invalid');throw error;}
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/connect') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'connect');
      const spec=connectionSpec(ctx.binding.accountId,ctx.payload.requestedLeaseMs),connection=connections.connect({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,plan:spec.plan,requestedLeaseMs:spec.requestedLeaseMs,reconnectGraceMs:ctx.payload.reconnectGraceMs});
      devices.heartbeat(ctx.device.deviceId,{agentVersion:ctx.payload.agentVersion});
      return sendJson(res,200,{ok:true,connection});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/renew') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'renew');
      const spec=connectionSpec(ctx.binding.accountId,ctx.payload.requestedLeaseMs);
      const connection=connections.renew(ctx.device.deviceId,{accountId:ctx.binding.accountId,plan:spec.plan,requestedLeaseMs:spec.requestedLeaseMs,reconnectGraceMs:ctx.payload.reconnectGraceMs});
      accessGrants.renewConnection(ctx.device.deviceId,{connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt});
      devices.heartbeat(ctx.device.deviceId,{agentVersion:ctx.payload.agentVersion});
      return sendJson(res,200,{ok:true,connection});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/disconnect') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'disconnect');
      const connection=connections.disconnect(ctx.device.deviceId,ctx.payload.reason||'client_disconnect');
      sessions.closeByDevice(ctx.device.deviceId,connection.closeReason||'device_connection_closed',{force:true});
      accessGrants.closeByDevice(ctx.device.deviceId,connection.closeReason||'device_connection_closed');
      pairingCodes.invalidateDevice(ctx.device.deviceId,connection.closeReason||'device_connection_closed');
      agentClients.removeDevice(ctx.device.deviceId,connection.closeReason||'device_connection_closed');
      try { devices.markOffline(ctx.device.deviceId,connection.closeReason||'client_disconnect'); } catch {}
      return sendJson(res,200,{ok:true,connection});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/grace') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'grace');
      return sendJson(res,200,{ok:true,connection:connections.setGrace(ctx.device.deviceId,ctx.payload.reconnectGraceMs)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/desktop-live-push') {
      const body=await readJson(req),ctx=await verifiedChannelContext(body,'desktop-live-push');
      return sendJson(res,200,acceptDesktopLivePush(ctx,ctx.payload));
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/account-auth') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'account-auth');
      const account=accounts.verifyCredentials({email:ctx.payload.email,password:ctx.payload.password},{recordLogin:true,eventType:'account_wall_login'});
      if(account.accountId!==ctx.binding.accountId)throw new AccountError('device_account_mismatch',403);
      return sendJson(res,200,{ok:true,account,entitlements:planEntitlements(account)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-intent') {
      const body=await readJson(req),ctx=await verifiedChannelContext(body,'fleet-intent');let account=accounts.account(ctx.binding.accountId),entitlements=planEntitlements(account);
      const reportedVersion=String(ctx.payload.agentVersion||ctx.device.agentVersion||''),compatibility=clientCompatibility(VERSION,reportedVersion,{backwardReleases:CLIENT_BACKWARD_RELEASES,explicit:MIN_SUPPORTED_CLIENT_VERSION});
      const baseEligible=Boolean(entitlements.fleetWall&&entitlements.multiDeviceConsole&&account.mainDeviceId===ctx.device.deviceId&&ctx.device.state!=='revoked'),desired=Boolean(baseEligible&&compatibility.supported);
      const reason=desired?'main_device_eligible':!entitlements.fleetWall?'fleet_entitlement_required':!account.mainDeviceId?'main_device_not_selected':account.mainDeviceId!==ctx.device.deviceId?'not_main_device':!compatibility.supported?compatibility.status:'main_device_unavailable';
      if(!desired)fleetAuthority.invalidateDevice(ctx.device.deviceId,reason);
      const versionState={agentVersion:reportedVersion,minimumSupportedVersion:compatibility.minimumSupportedVersion,latestVersion:compatibility.latestVersion,updateRequired:compatibility.updateRequired};
      const observedFleetHealthy=ctx.payload.fleetHealthy===true&&Number(ctx.payload.fleetPort)===5492;
      if(desired&&observedFleetHealthy)account=accounts.setFleetProvisioning(account.accountId,{deviceId:ctx.device.deviceId,state:'online',reason:'fleet_runtime_observed',moduleVersion:ctx.payload.moduleVersion||null,...versionState,port:5492});
      else if(desired&&account.fleetProvisioning?.deviceId===ctx.device.deviceId&&account.fleetProvisioning?.state!=='online')account=accounts.setFleetProvisioning(account.accountId,{deviceId:ctx.device.deviceId,state:'configuring',reason,moduleVersion:ctx.payload.moduleVersion||null,...versionState,port:5492});
      else if(!desired&&account.mainDeviceId===ctx.device.deviceId)account=accounts.setFleetProvisioning(account.accountId,{deviceId:ctx.device.deviceId,state:compatibility.updateRequired?'update_required':'failed',reason,moduleVersion:ctx.payload.moduleVersion||null,...versionState,port:5492});
      return sendJson(res,200,{ok:true,fleet:{desired,port:5492,reason,compatibility,updateRequired:compatibility.updateRequired},account:{accountId:account.accountId,plan:account.plan,mainDeviceId:account.mainDeviceId,fleetProvisioning:account.fleetProvisioning||null},entitlements});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-authority') {
      const body=await readJson(req),ctx=await verifiedChannelContext(body,'fleet-authority');let {account,entitlements}=fleetEligibility(ctx);
      const issued=fleetAuthority.issue({accountId:account.accountId,mainDeviceId:account.mainDeviceId,deviceId:ctx.device.deviceId,publicKeySha256:ctx.binding.publicKeySha256,entitlementId:account.entitlement?.entitlementId||null,moduleVersion:ctx.payload.moduleVersion||null});
      if(account.fleetProvisioning?.deviceId===ctx.device.deviceId&&account.fleetProvisioning?.state!=='online')account=accounts.setFleetProvisioning(account.accountId,{deviceId:ctx.device.deviceId,state:'ready',reason:'fleet_authority_issued',moduleVersion:ctx.payload.moduleVersion||null,port:5492});
      return sendJson(res,200,{ok:true,fleet:{desired:true,port:5492},account:{accountId:account.accountId,plan:account.plan,mainDeviceId:account.mainDeviceId,fleetProvisioning:account.fleetProvisioning||null},entitlements,authority:issued});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-status') {
      const body=await readJson(req),ctx=verifiedFleetContext(await verifiedChannelContext(body,'fleet-status'));let {account,entitlements}=ctx;
      const status=String(ctx.payload.status||'').trim().toLowerCase(),port=Number(ctx.payload.port)||5492;if(status!=='online')throw new FleetAuthorityError('invalid_fleet_status');if(port!==5492)throw new FleetAuthorityError('invalid_fleet_status_port');
      account=accounts.setFleetProvisioning(account.accountId,{deviceId:ctx.device.deviceId,state:'online',reason:'fleet_runtime_online',moduleVersion:ctx.payload.moduleVersion||null,port});
      return sendJson(res,200,{ok:true,fleet:{desired:true,status:'online',port},account:{accountId:account.accountId,plan:account.plan,mainDeviceId:account.mainDeviceId,fleetProvisioning:account.fleetProvisioning||null},entitlements});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-devices') {
      const body=await readJson(req),ctx=verifiedFleetContext(await verifiedChannelContext(body,'fleet-devices'));
      const rows=allDeviceViews().filter(device=>device.accountId===ctx.account.accountId&&device.state!=='revoked');
      return sendJson(res,200,{ok:true,mainDeviceId:ctx.account.mainDeviceId,authority:ctx.lease,devices:rows});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-sessions') {
      const body=await readJson(req),ctx=verifiedFleetContext(await verifiedChannelContext(body,'fleet-sessions')),owned=new Set(allDeviceViews().filter(device=>device.accountId===ctx.account.accountId&&device.state!=='revoked').map(device=>device.deviceId));
      const rows=sessions.list().filter(row=>owned.has(row.deviceId));
      return sendJson(res,200,{ok:true,mainDeviceId:ctx.account.mainDeviceId,authority:ctx.lease,sessions:rows});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-jobs') {
      const body=await readJson(req),ctx=verifiedFleetContext(await verifiedChannelContext(body,'fleet-jobs'));
      const ownedViews=allDeviceViews().filter(d=>d.accountId===ctx.account.accountId&&d.state!=='revoked');
      const owned=new Set(ownedViews.map(d=>d.deviceId));
      const names=new Map(ownedViews.map(d=>[d.deviceId,String(d.displayName||d.deviceId)]));
      const limit=Math.max(1,Math.min(Number(ctx.payload.limit)||100,200));
      // PostgreSQL provides durable history; currently retained Operator rows
      // override matching records with live queue reasons and output bytes.
      const history=await goldJobs.listForOwner({accountId:ctx.account.accountId,deviceIds:[...owned],limit});
      const active=ownerFleetJobRows(jobs,{accountId:ctx.account.accountId,deviceIds:owned,limit});
      const merged=new Map(history.map(j=>[j.jobId,j]));
      for(const j of active)merged.set(j.jobId,j);
      const rows=[...merged.values()].sort((a,b)=>(Number(b.startedAt)||0)-(Number(a.startedAt)||0))
        .slice(0,limit).map(j=>({...j,deviceName:names.get(j.deviceId)||j.deviceId}));
      // A Stop control is shown ONLY if there is a real server-retained
      // launch and the canonical PostgreSQL worker lease still exists.
      if(rows.length){
        const ids=rows.map(j=>j.jobId);
        const claimed=await goldJobs.pool.query(
          "SELECT job_id FROM lr_gold_device_resource_claims WHERE account_id=$1 AND job_id=ANY($2::text[]) AND worker_state='running' AND process_id IS NOT NULL",
          [ctx.account.accountId,ids]);
        const leased=new Set(claimed.rows.map(r=>r.job_id));
        for(const row of rows){
          const launch=jobs.get(row.jobId);
          row.stopAvailable=Boolean(leased.has(row.jobId)&&launch?.managedExec&&
            launch.finishedAt&&launch.exitCode===0&&!launch.fleetStopRequested&&
            launch.accountId===ctx.account.accountId&&owned.has(launch.deviceId));
          row.stopRequested=Boolean(launch?.fleetStopRequested);
          if(row.stopRequested){
            const stop=jobs.get(String(launch.fleetStopJobId||''));
            const proc=stop?.resultData?.process;
            row.stopVerified=Boolean(stop?.finishedAt&&stop.exitCode===0&&
              !leased.has(row.jobId)&&
              ['finished','stopped','timeout','error'].includes(String(proc?.state||''))&&
              String(proc?.processId||'')===String(launch.fleetStopProcessId||'')&&
              Number(proc?.finishedAt)>0);
            row.stopFailed=Boolean(stop?.finishedAt&&!row.stopVerified&&
              (stop.exitCode!==0||stop.timedOut));
          }
        }
      }
      // These are owner-only claim observations. Age/UNKNOWN is an audit
      // signal, NOT proof that a worker stopped or a lease may be deleted.
      const resources=await ownerDeviceResourceMetrics({pool:goldJobs.pool,
        accountId:ctx.account.accountId,deviceIds:[...owned],
        workerBudget:deviceResourceLocks?.capacity??null});
      for(const resource of resources){
        resource.deviceName=names.get(resource.deviceId)||resource.deviceId;
        const m=deviceResourceSampleCache.get(ctx.account.accountId,resource.deviceId);
        resource.metricsState=m.state;
        resource.metrics=m.state==='fresh'?m.sample:null;
        resource.metricsLastSeenAt=m.sample?.receivedAt||null;
      }
      // Owner-authenticated and restricted to registered devices. Read-only;
      // the detector NEVER changes OS-effect claims or signed ACKs.
      const monitored=staleClaimMonitor?.snapshotForOwner(ctx.account.accountId,[...owned]);
      const ageMs=Date.now()-(Number(monitored?.observedAt)||0);
      // A deliberately scoped monitor cannot suppress diagnostic observations
      // for the other devices the owner is authorized to inspect.
      const completeMonitorScope=Boolean(staleClaimMonitor&&
        [...owned].every(id=>staleClaimMonitor.allowed.has(id)));
      let observations=null,diagnosticAvailable=true;
      try{
        observations=completeMonitorScope&&monitored&&monitored.error===null&&ageMs<=90000
          ? monitored : [...owned].length===0?{staleClaims:[],mode:'diagnostic_only'}:
            await scanOwnerStaleClaims({pool:goldJobs.pool,accountId:ctx.account.accountId,
              deviceIds:[...owned],minimumAgeMs:3600000,maxRows:1000});
      }catch{
        // Preserve the existing Fleet Jobs view but NEVER render a successful
        // empty stale-claim result when the bounded PG diagnostic failed.
        diagnosticAvailable=false;
      }
      const staleClaims=(observations?.items||observations?.staleClaims||[]).map(item=>({
        deviceId:item.deviceId,deviceName:names.get(item.deviceId)||item.deviceId,
        jobId:item.jobId,ageMinutes:Math.floor(item.ageMs/60000),
        processIdentityKnown:item.processIdentityKnown,workerState:item.workerState,
        classification:item.classification,releaseAllowed:false,nextAction:item.nextAction}));
      return sendJson(res,200,{ok:true,mainDeviceId:ctx.account.mainDeviceId,jobs:rows,resources,
        staleClaimStatus:{mode:'diagnostic_only',available:diagnosticAvailable,releaseAllowed:false,
          scanSource:observations===monitored?'periodic_monitor':'owner_read_only'},staleClaims});
    }
    // P1-D owner recovery is deliberately separate from stale diagnostics.
  // This is a signed Main/Fleet channel + owner password step-up + exact
  // typed confirmation. Never turns an aged/UNKNOWN claim into a signed ACK.
  if(req.method==='POST'&&url.pathname==='/v1/device-channel/fleet-orphan-recovery'){
    const envelope=await readJson(req);
    const ctx=verifiedFleetContext(await verifiedChannelContext(envelope,'fleet-orphan-recovery'));
    const payload=ctx.payload||{};
    const accountId=ctx.account.accountId,deviceId=String(payload.deviceId||'');
    const jobId=String(payload.jobId||'');
    if(!/^[A-Za-z0-9._:-]{1,160}$/.test(deviceId)||
       !/^[a-f0-9-]{36}$/i.test(jobId)||deviceId===ctx.device.deviceId||
       !['inspect','abandon'].includes(payload.mode))
      throw new AccountError('owner_recovery_invalid_target',400);
    accounts.assertOperational(accountId);
    let device;
    try{device=devices.get(deviceId)}catch(error){
      if(error?.message!=='device_not_found')throw error;
      const historical=await deviceResourceLocks?.inspectOwnerOrphanDevice(goldJobs.pool,
        {accountId,deviceId,jobId});
      if(!historical||historical.state!=='revoked'||
         historical.policyProfile!=='__gold_removed_v1__')
        throw new AccountError('owner_recovery_historical_unverified',403);
      device=historical;
    }
    if(device.accountId!==accountId)throw new AccountError('owner_recovery_account_mismatch',403);
    let channelFresh=false,connected=false;
    try{channelFresh=fleet.view(device.nodeId||device.deviceId).channelFresh===true}
    catch(e){if(e?.message!=='target_node_channel_not_found')throw e}
    try{connected=connections.get(deviceId).state==='connected'}
    catch(e){if(e?.message!=='device_connection_not_found')throw e}
    if(connected||channelFresh)throw new AccountError('owner_recovery_channel_active',409);
    const candidate=(await goldJobs.pool.query(`
      SELECT c.claimed_at,c.worker_state,c.process_id,j.status AS launch_status,
        EXISTS(SELECT 1 FROM lr_gold_terminal_receipt_acks a
          WHERE a.account_id=c.account_id AND a.device_id=c.device_id
            AND (a.job_id=c.job_id OR (c.process_id IS NOT NULL AND a.process_id=c.process_id))) AS has_terminal_ack
      FROM lr_gold_device_resource_claims c
      JOIN lr_gold_job_records j ON j.job_id=c.job_id
       AND j.account_id=c.account_id AND j.device_id=c.device_id
      WHERE c.account_id=$1 AND c.device_id=$2 AND c.job_id=$3
      LIMIT 1`,[accountId,deviceId,jobId])).rows[0];
    const eligible=Boolean(candidate&&!candidate.has_terminal_ack&&(
      (candidate.worker_state==='running'&&candidate.launch_status==='ok'&&
       /^lp_[A-Za-z0-9_-]{20,80}$/.test(String(candidate.process_id||'')))||
      (candidate.worker_state==='terminal_unknown'&&candidate.launch_status==='interrupted'&&
       candidate.process_id==null)));
    if(!eligible)throw new AccountError('owner_recovery_claim_not_eligible',409);
    if(payload.mode==='inspect'){
      return sendJson(res,200,{ok:true,mode:'review',accountScoped:true,deviceId,jobId,
        claimedAt:new Date(candidate.claimed_at).toISOString(),
        workerState:candidate.worker_state,processIdentityKnown:Boolean(candidate.process_id),
        requiresOwnerPassword:true,requiresPostClaimBootAttestation:true,
        terminalReceiptCreated:false,processOutcome:'unknown',releasePerformed:false});
    }
    if(payload.confirm!=='ABANDON_UNKNOWN_RESULT'||
       !['gold_agent_uninstalled','gold_agent_reinstalled'].includes(payload.reason))
      throw new AccountError('owner_recovery_confirmation_required',403);
    const password=String(payload.password||'');
    if(!password||password.length>512)throw new AccountError('owner_recovery_owner_password_required',401);
    const owner=accounts.verifyCredentials({email:ctx.account.email,password},
      {recordLogin:true,eventType:'m6_wall_owner_recovery'});
    if(owner.accountId!==accountId)throw new AccountError('owner_recovery_stepup_mismatch',403);
    const observedBootAtMs=Number(payload.observedBootAtMs);
    const outcome=await deviceResourceLocks.abandonOwnerAttestedOrphan(goldJobs.pool,
      {accountId,deviceId,jobId,observedBootAtMs,reason:payload.reason,channelFresh});
    return sendJson(res,200,{ok:true,...outcome});
  }
  if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-job-cancel') {
      const body=await readJson(req);
      const ctx=verifiedFleetContext(await verifiedChannelContext(body,'fleet-job-cancel'));
      const devices=allDeviceViews().filter(v=>v.accountId===ctx.account.accountId&&v.state!=='revoked');
      const allowed=new Set(devices.map(v=>v.deviceId));
      const jobId=String(ctx.payload.jobId||'');
      const cancelled=await cancelQueuedPersonalJob({jobId,accountId:ctx.account.accountId,deviceIds:allowed});
      return sendJson(res,200,cancelled);
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-process-stop') {
      const body=await readJson(req);
      const ctx=verifiedFleetContext(await verifiedChannelContext(body,'fleet-process-stop'));
      const enrolled=allDeviceViews().filter(x=>x.accountId===ctx.account.accountId&&x.state!=='revoked');
      const owned=new Set(enrolled.map(x=>x.deviceId));
      const result=await requestFleetProcessStop({
        jobId:String(ctx.payload.jobId||''),accountId:ctx.account.accountId,deviceIds:owned});
      return sendJson(res,202,result);
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-activity') {
      const body=await readJson(req),ctx=verifiedFleetContext(await verifiedChannelContext(body,'fleet-activity')),owned=new Set(allDeviceViews().filter(device=>device.accountId===ctx.account.accountId&&device.state!=='revoked').map(device=>device.deviceId)),limit=Math.max(1,Math.min(Number(ctx.payload.limit)||500,5000));
      const rows=recentEvents(MAX_RING_EVENTS).filter(event=>event.accountId===ctx.account.accountId||owned.has(String(event.deviceId||''))).slice(-limit);
      return sendJson(res,200,{ok:true,mainDeviceId:ctx.account.mainDeviceId,authority:ctx.lease,events:rows});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-device-policy') {
      const body=await readJson(req),ctx=verifiedFleetContext(await verifiedChannelContext(body,'fleet-device-policy')),target=fleetTarget(ctx,ctx.payload.deviceId);
      const policy=enrollments.updatePolicy({deviceId:target.deviceId,accountId:ctx.account.accountId,approvedCapabilities:ctx.payload.approvedCapabilities,policyProfile:ctx.payload.policyProfile});
      if(target.nodeId!==NODE_ID){try{fleet.wake(target.nodeId);}catch{}}
      pushEvent({type:'device_policy_updated',accountId:policy.accountId,deviceId:policy.deviceId,nodeId:target.nodeId,status:'updated',policyProfile:policy.policyProfile,policyRevision:policy.policyRevision,capabilities:policy.approvedCapabilities,source:'fleet_wall'});
      return sendJson(res,200,{ok:true,mainDeviceId:ctx.account.mainDeviceId,policy,device:deviceView(target)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-device-update') {
      const body=await readJson(req),ctx=verifiedFleetContext(await verifiedChannelContext(body,'fleet-device-update')),target=fleetTarget(ctx,ctx.payload.deviceId);
      return sendJson(res,200,{ok:true,mainDeviceId:ctx.account.mainDeviceId,maintenance:queueHelperUpdate(target.deviceId,{source:'fleet-wall'})});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/pairing-code') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'pairing-code');
      const connection=connections.assertConnected(ctx.device.deviceId);
      const spec={accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt};
      const pairing=ctx.payload.rotate===true?pairingCodes.rotate(spec):pairingCodes.currentOrRotate(spec);
      return sendJson(res,200,{ok:true,pairing});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/account-owner-proof') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'account-owner-proof');
      connections.assertConnected(ctx.device.deviceId);
      const proof=accounts.issueOwnerProof({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId});
      return sendJson(res,200,{ok:true,proof});
    }
    // Wall B-code lookup has its own signed control-lane budget. A busy
    // observer/status dashboard must not prevent an owner approval.
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/access-lookup') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'access-lookup');
      requireDeviceConnection(ctx.device.deviceId);
      return sendJson(res,200,{ok:true,device:{displayName:ctx.device.displayName||ctx.device.deviceId},access:{pending:accessGrants.pendingForDevice(ctx.device.deviceId)}});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/access-approve') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'access-approve');
      const connection=connections.assertConnected(ctx.device.deviceId);
      const grant=accessGrants.approve(ctx.payload.requestId,{deviceId:ctx.device.deviceId,connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt,idleGraceMs:connection.reconnectGraceMs});
      return sendJson(res,200,{ok:true,grant});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/access-deny') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'access-deny');
      const result=accessGrants.deny(ctx.payload.requestId,ctx.payload.reason||'owner_denied',{deviceId:ctx.device.deviceId});
      return sendJson(res,200,{ok:true,authorization:result});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/status') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'status');
      const connection=requireDeviceConnection(ctx.device.deviceId);
      const liveSessions=sessions.list({deviceId:ctx.device.deviceId}).filter(item=>item.state==='active'||item.state==='hold');
      return sendJson(res,200,{ok:true,device:deviceView(ctx.device),connection:{...connections.get(ctx.device.deviceId),enforced:CONNECTION_LEASE_ENFORCE},sessions:liveSessions,access:{pending:accessGrants.pendingForDevice(ctx.device.deviceId),activeGrant:accessGrants.activeForDevice(ctx.device.deviceId,connection.connectionId),activeGrants:accessGrants.activeGrantsForDevice(ctx.device.deviceId,connection.connectionId).map(g=>({agentId:g.agentId||null,label:String(g.label||'Agent').slice(0,120),purpose:g.purpose||'device',approvedAt:g.approvedAt,expiresAt:g.expiresAt,absoluteExpiresAt:g.absoluteExpiresAt}))}});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/session-close') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'session-close');
      requireDeviceConnection(ctx.device.deviceId);
      const sessionId=String(ctx.payload.sessionId||'').trim(), agentId=String(ctx.payload.agentId||'').trim();
      const current=sessions.get(sessionId,agentId);
      if(current.deviceId!==ctx.device.deviceId)throw new EnrollmentError('session_device_mismatch',409);
      const session=sessions.close(sessionId,agentId,String(ctx.payload.reason||'owner_closed_from_wall').slice(0,80));
      return sendJson(res,200,{ok:true,session});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/update-report') {
      const body=await readJson(req),ctx=await verifiedChannelContext(body,'update-report');
      requireDeviceConnection(ctx.device.deviceId);
      if(ctx.payload.nodeId!=null&&String(ctx.payload.nodeId)!==ctx.device.nodeId)throw new EnrollmentError('device_node_mismatch',409);
      const report=normalizeUpdateReport(ctx.payload);
      pushEvent({type:'device_update_report',accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,nodeId:ctx.device.nodeId,status:report.outcome==='success'?'ok':'error',...report});
      return sendJson(res,200,{ok:true,accepted:true,reportId:report.reportId});
    }
    if(req.method==='POST'&&url.pathname==='/v1/device-channel/job-cancel'){
      const body=await readJson(req),ctx=await verifiedChannelContext(body,'job-cancel');
      // The signed enrollment binds this control to one owner-device only.
      // No global Fleet lease and no client-supplied account/device/agent.
      const value=await cancelControlJob({
        jobId:String(ctx.payload.jobId||''),
        accountId:ctx.binding.accountId,deviceId:ctx.binding.deviceId
      });
      return sendJson(res,200,value);
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/activity') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'activity');
      requireDeviceConnection(ctx.device.deviceId);
      const limit=Math.max(1,Math.min(Number(ctx.payload.limit)||500,5000));
      return sendJson(res,200,{ok:true,deviceId:ctx.device.deviceId,events:recentEvents(limit,ctx.device.deviceId)});
    }
    // Signed enrolled-device messages, independent of A/B Agent-client grants.
    // Epoch changes serialize with M4 and GC under the SAME PG advisory lock.
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/execution-epoch') {
      const body=await readJson(req),ctx=await verifiedChannelContext(body,'execution-epoch');
      if(!requiresExecutionEpoch(ctx.device.deviceId))throw new FleetError('execution_epoch_not_enabled',409);
      const connection=connections.assertConnected(ctx.device.deviceId);
      const grant=await executionEpochs.issue({accountId:ctx.binding.accountId,
        deviceId:ctx.device.deviceId,connectionId:connection.connectionId,
        instanceId:ctx.payload.instanceId});
      return sendJson(res,200,{ok:true,...grant});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/execution-start') {
      const body=await readJson(req),ctx=await verifiedChannelContext(body,'execution-start');
      if(!requiresExecutionEpoch(ctx.device.deviceId))throw new FleetError('execution_epoch_not_enabled',409);
      const connection=connections.assertConnected(ctx.device.deviceId);
      const start=await executionEpochs.validateStart({accountId:ctx.binding.accountId,
        deviceId:ctx.device.deviceId,connectionId:connection.connectionId,
        instanceId:ctx.payload.instanceId,authorization:ctx.payload.executionAuthorization});
      return sendJson(res,200,{ok:true,start});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/execution-inventory') {
      const body=await readJson(req),ctx=await verifiedChannelContext(body,'execution-inventory');
      if(!requiresExecutionEpoch(ctx.device.deviceId))throw new FleetError('execution_epoch_not_enabled',409);
      const connection=connections.assertConnected(ctx.device.deviceId);
      const key=crypto.createPublicKey({key:Buffer.from(ctx.binding.publicIdentityKey,'base64'),format:'der',type:'spki'});
      const inventory=await executionEpochs.recordInventory({accountId:ctx.binding.accountId,
        deviceId:ctx.device.deviceId,connectionId:connection.connectionId,
        statement:ctx.payload.statement,devicePublicKey:key});
      return sendJson(res,200,{ok:true,inventory});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/stream') {
      return handleDeviceDuplexSession(req,res,{
        authorizeHello:async body=>{
          const ctx=await verifiedChannelContext(body,'stream'),payload=ctx.payload;
          if(String(payload.protocol||'')!==DEVICE_DUPLEX_PROTOCOL)throw new FleetError('duplex_protocol_mismatch',409);
          if(payload.nodeId!=null&&String(payload.nodeId)!==ctx.device.nodeId)throw new EnrollmentError('device_node_mismatch',409);
          const reportedRevision=Math.max(0,Number(payload.policyRevision)||0);
          const capabilities=verifiedLeafCapabilities(payload.capabilities,ctx.binding,reportedRevision);
          const connection=connections.assertConnected(ctx.device.deviceId);
          if(requiresExecutionEpoch(ctx.device.deviceId))await executionEpochs.assertReady({accountId:ctx.binding.accountId,
            deviceId:ctx.device.deviceId,connectionId:connection.connectionId,instanceId:payload.executionInstanceId});
          devices.heartbeat(ctx.device.deviceId,{capabilities,agentVersion:payload.agentVersion,updateStatus:payload.updateStatus});
          const touchInput={accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,nodeId:ctx.device.nodeId,sessionCeiling:payload.sessionCeiling,draining:Boolean(payload.draining),executorReady:payload.executorReady,capabilities,policyRevision:reportedRevision};
          fleet.touch(touchInput);
          const policy=reportedRevision===Math.max(1,Number(ctx.binding.policyRevision)||1)?null:enrollments.policyEnvelope(ctx.device.deviceId);
          const transportEpoch=String(payload.transportEpoch||'').trim();
          if(!transportEpoch||transportEpoch.length>128)throw new FleetError('invalid_duplex_transport_epoch',400);
          return {
            deviceId:ctx.device.deviceId,nodeId:ctx.device.nodeId,transportEpoch,
            context:{ctx,touchInput,reportedRevision,capabilities,executionInstanceId:payload.executionInstanceId||null},
            helloAck:{node:fleet.view(ctx.device.nodeId),policy,access:{pending:accessGrants.pendingForDevice(ctx.device.deviceId),activeGrant:accessGrants.activeForDevice(ctx.device.deviceId,connections.get(ctx.device.deviceId)?.connectionId)}}
          };
        },
        resume:async authorized=>{fleet.resume(authorized.nodeId);},
        poll:async(authorized,wait,shouldStop)=>{
          const result=await fleet.waitPoll(()=>({...authorized.context.touchInput,transport:'device-duplex-v1'}),wait,shouldStop);
          const ctx=authorized.context.ctx;
          if(requiresExecutionEpoch(ctx.device.deviceId)&&result.command){
            const conn=connections.assertConnected(ctx.device.deviceId);
            result.command=await executionEpochs.authorizeCommand({accountId:ctx.binding.accountId,
              deviceId:ctx.device.deviceId,connectionId:conn.connectionId,
              instanceId:authorized.context.executionInstanceId,command:result.command});
          }
          return result;
        },
        onResult:async(authorized,result)=>acceptDeviceResult(authorized.context.ctx,result,{resultTransport:'device-duplex-v1'}),
        onLive:async(authorized,payload)=>acceptDesktopLivePush(authorized.context.ctx,payload),
        onHeartbeat:async(authorized,payload)=>{
          const state=authorized.context,ctx=state.ctx;
          if(requiresExecutionEpoch(ctx.device.deviceId))await executionEpochs.assertReady({accountId:ctx.binding.accountId,
            deviceId:ctx.device.deviceId,connectionId:connections.assertConnected(ctx.device.deviceId).connectionId,
            instanceId:state.executionInstanceId});
          const reportedRevision=Math.max(0,Number(payload.policyRevision??state.reportedRevision)||0);
          const capabilities=verifiedLeafCapabilities(Array.isArray(payload.capabilities)?payload.capabilities:state.capabilities,ctx.binding,reportedRevision);
          state.reportedRevision=reportedRevision;state.capabilities=capabilities;
          state.touchInput={...state.touchInput,sessionCeiling:payload.sessionCeiling??state.touchInput.sessionCeiling,draining:payload.draining==null?state.touchInput.draining:Boolean(payload.draining),executorReady:payload.executorReady,capabilities,policyRevision:reportedRevision};
          devices.heartbeat(ctx.device.deviceId,{capabilities,agentVersion:payload.agentVersion||ctx.device.agentVersion,updateStatus:payload.updateStatus});
          const node=fleet.touch(state.touchInput);
          deviceResourceSampleCache.record({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,value:payload.resourceSample});
          await persistBoot(ctx,payload.bootEvidence,payload.agentVersion);
          const terminalReceiptsAck=await reconcileSignedTerminalProcessReceipts(ctx,payload.processTerminalReceipts);
          const policy=reportedRevision===Math.max(1,Number(ctx.binding.policyRevision)||1)?null:enrollments.policyEnvelope(ctx.device.deviceId);
          return {node,policy,terminalReceiptsAck,stopRequests:deviceStopRequests(ctx.binding.accountId,ctx.binding.deviceId)};
        },
        onEvent:event=>pushEvent({accountId:(()=>{try{return devices.get(event.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)}).accountId;}catch{return ACCOUNT_ID;}})(),nodeId:(()=>{try{return devices.get(event.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)}).nodeId;}catch{return null;}})(),status:event.type==='device_duplex_error'?'error':'ok',...event})
      });
    }
    // A signed liveness-only refresh while a poll-executed command is active.
    // Never pull/claim/redeliver queued commands here: the caller is busy and
    // cannot consume another command. 'running' is not an owner drain.
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/pulse') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'pulse');
      if (ctx.payload.nodeId!=null && String(ctx.payload.nodeId)!==ctx.device.nodeId) throw new EnrollmentError('device_node_mismatch',409);
      const reportedRevision=Math.max(0,Number(ctx.payload.policyRevision)||0);
      const capabilities=verifiedLeafCapabilities(ctx.payload.capabilities,ctx.binding,reportedRevision);
      requireDeviceConnection(ctx.device.deviceId);
      devices.heartbeat(ctx.device.deviceId,{capabilities,agentVersion:ctx.payload.agentVersion,updateStatus:ctx.payload.updateStatus});
      const node=fleet.touch({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,nodeId:ctx.device.nodeId,sessionCeiling:ctx.payload.sessionCeiling,draining:Boolean(ctx.payload.draining),executorReady:ctx.payload.executorReady,capabilities,policyRevision:reportedRevision});
      deviceResourceSampleCache.record({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,value:ctx.payload.resourceSample});
      await persistBoot(ctx,ctx.payload.bootEvidence,ctx.payload.agentVersion);
      const terminalReceiptsAck=await reconcileSignedTerminalProcessReceipts(ctx,ctx.payload.processTerminalReceipts);
      const policy=reportedRevision===Math.max(1,Number(ctx.binding.policyRevision)||1)?null:enrollments.policyEnvelope(ctx.device.deviceId);
      return sendJson(res,200,{ok:true,node,policy,pulseOnly:true,terminalReceiptsAck,stopRequests:deviceStopRequests(ctx.binding.accountId,ctx.binding.deviceId)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/poll') {
      const body=await readJson(req), ctx=await verifiedChannelContext(body,'poll');
      if (ctx.payload.nodeId!=null && String(ctx.payload.nodeId)!==ctx.device.nodeId) throw new EnrollmentError('device_node_mismatch',409);
      const reportedRevision=Math.max(0,Number(ctx.payload.policyRevision)||0);
      const capabilities=verifiedLeafCapabilities(ctx.payload.capabilities,ctx.binding,reportedRevision);
      requireDeviceConnection(ctx.device.deviceId);
      devices.heartbeat(ctx.device.deviceId,{capabilities,agentVersion:ctx.payload.agentVersion,updateStatus:ctx.payload.updateStatus});
      deviceResourceSampleCache.record({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,value:ctx.payload.resourceSample});
      await persistBoot(ctx,ctx.payload.bootEvidence,ctx.payload.agentVersion);
      const terminalReceiptsAck=await reconcileSignedTerminalProcessReceipts(ctx,ctx.payload.processTerminalReceipts);
      const waitMs=Math.max(0,Math.min(Number(ctx.payload.waitMs)||8000,15000));
      if(requiresExecutionEpoch(ctx.device.deviceId))await executionEpochs.assertReady({accountId:ctx.binding.accountId,
        deviceId:ctx.device.deviceId,connectionId:connections.assertConnected(ctx.device.deviceId).connectionId,
        instanceId:ctx.payload.executionInstanceId});
      const channel=await fleet.waitPoll({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,nodeId:ctx.device.nodeId,sessionCeiling:ctx.payload.sessionCeiling,draining:Boolean(ctx.payload.draining),executorReady:ctx.payload.executorReady,capabilities,policyRevision:reportedRevision,transport:'signed-poll-v1'},waitMs);
      if(requiresExecutionEpoch(ctx.device.deviceId)&&channel.command){
        const connection=connections.assertConnected(ctx.device.deviceId);
        channel.command=await executionEpochs.authorizeCommand({accountId:ctx.binding.accountId,
          deviceId:ctx.device.deviceId,connectionId:connection.connectionId,
          instanceId:ctx.payload.executionInstanceId,command:channel.command});
      }
      const policy=reportedRevision===Math.max(1,Number(ctx.binding.policyRevision)||1)?null:enrollments.policyEnvelope(ctx.device.deviceId);
      return sendJson(res,200,{ok:true,channel,policy,terminalReceiptsAck,stopRequests:deviceStopRequests(ctx.binding.accountId,ctx.binding.deviceId),access:{pending:accessGrants.pendingForDevice(ctx.device.deviceId),activeGrant:accessGrants.activeForDevice(ctx.device.deviceId,connections.get(ctx.device.deviceId)?.connectionId)}});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/result') {
      const body=await readJson(req),ctx=await verifiedChannelContext(body,'result');
      return sendJson(res,200,await acceptDeviceResult(ctx,ctx.payload,{resultTransport:'signed-poll-v1'}));
    }

}
