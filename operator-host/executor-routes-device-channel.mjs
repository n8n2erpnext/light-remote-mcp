export async function handleDeviceChannelRoutes(req,res,url,deps){
  const {ACCOUNT_ID,AccountError,AgentClientRegistryError,CLIENT_BACKWARD_RELEASES,CONNECTION_LEASE_ENFORCE,DeviceAccessGrantError,DevicePairingRegistryError,EnrollmentError,FleetAuthorityError,FleetError,MAX_MEMORY_OUTPUT,MAX_RING_EVENTS,MIN_SUPPORTED_CLIENT_VERSION,NODE_ID,VERSION,accessGrants,accounts,agentClients,allDeviceViews,applyDeviceTelemetry,capabilities,clientCompatibility,connectionSpec,connections,deviceView,devices,emitStream,enrollments,finishJob,fleet,fleetAuthority,fleetEligibility,fleetTarget,jobView,jobs,normalizeUpdateReport,pairingCodes,planEntitlements,pushEvent,queueHelperUpdate,readJson,reapAccessGrants,recentEvents,requireDeviceConnection,sendJson,sessions,targetRoute,terminalResultSummary,verifiedChannelContext,verifiedFleetContext,verifiedLeafCapabilities}=deps;
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
      const connection=connections.assertConnected(paired.deviceId);
      if(connection.connectionId!==paired.connectionId) throw new DevicePairingRegistryError('device_connection_changed',409);
      const access=accessGrants.request({accountId:paired.accountId,deviceId:paired.deviceId,connectionId:paired.connectionId,connectionExpiresAt:connection.hardExpiresAt,agentId:body.agentId,label:body.label,forceApproval:true,requestTtlMs:5*60*1000,pairingId:paired.pairingId});
      return sendJson(res,201,{ok:true,access,pairing:{pairingId:paired.pairingId,deviceId:paired.deviceId}});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-access/request') {
      const body=await readJson(req), deviceId=String(body.deviceId||'');
      const device=devices.get(deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
      if(device.accountId!==ACCOUNT_ID) throw new DeviceAccessGrantError('device_access_account_mismatch',403);
      const connection=connections.assertConnected(deviceId);
      reapAccessGrants();
      const access=accessGrants.request({accountId:ACCOUNT_ID,deviceId,connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt,agentId:body.agentId,label:body.label});
      return sendJson(res,access.state==='approved'?200:201,{ok:true,access});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-access/poll') {
      const body=await readJson(req);
      return sendJson(res,200,{ok:true,access:accessGrants.poll(body)});
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
      const connection=connections.assertConnected(grant.deviceId);
      accessGrants.assert(grant.grantId,{deviceId:grant.deviceId,connectionId:connection.connectionId});
      const device=devices.get(grant.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
      return sendJson(res,200,{ok:true,grant,device:{deviceId:device.deviceId,nodeId:device.nodeId,displayName:device.displayName,platform:device.platform,architecture:device.architecture},connection:connections.get(grant.deviceId)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/agent-client/attach') {
      const body=await readJson(req), grant=accessGrants.assert(body.grantId,{touch:false});
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
        try{
          const grant=accessGrants.assert(binding.grantId,{deviceId:binding.deviceId,connectionId:binding.connectionId,touch:false}),connection=connections.assertConnected(binding.deviceId);
          if(connection.connectionId!==binding.connectionId)throw new AgentClientRegistryError('agent_client_device_connection_mismatch',409);
          const device=devices.get(binding.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
          authorized.push({deviceId:device.deviceId,nodeId:device.nodeId,name:device.displayName,state:device.state,platform:device.platform,architecture:device.architecture,connection:{state:connection.state,remainingMs:connection.remainingMs||Math.max(0,connection.hardExpiresAt-Date.now())}});
        }catch{agentClients.removeDevice(binding.deviceId,'binding_invalid');}
      }
      return sendJson(res,200,{ok:true,client:{clientSessionId:client.clientSessionId,agentId:client.agentId,expiresAt:client.expiresAt},devices:authorized});
    }
    if (req.method === 'POST' && url.pathname === '/v1/agent-client/resolve') {
      const body=await readJson(req),binding=agentClients.resolve(body.clientSessionId,{agentId:body.agentId,deviceId:body.deviceId||null,touch:true});
      try{
        const grant=accessGrants.assert(binding.grantId,{deviceId:binding.deviceId,connectionId:binding.connectionId}),connection=connections.assertConnected(binding.deviceId);
        if(connection.connectionId!==binding.connectionId)throw new AgentClientRegistryError('agent_client_device_connection_mismatch',409);
        const device=devices.get(binding.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
        return sendJson(res,200,{ok:true,binding,grant,device:{deviceId:device.deviceId,nodeId:device.nodeId,displayName:device.displayName,state:device.state,platform:device.platform,architecture:device.architecture},connection});
      }catch(error){agentClients.removeDevice(binding.deviceId,'binding_invalid');throw error;}
    }
    if (req.method === 'POST' && url.pathname === '/v1/agent-client/context') {
      const body=await readJson(req),binding=agentClients.resolve(body.clientSessionId,{agentId:body.agentId,deviceId:body.deviceId||null,touch:true});
      try{
        const grant=accessGrants.assert(binding.grantId,{deviceId:binding.deviceId,connectionId:binding.connectionId}),connection=connections.assertConnected(binding.deviceId);
        if(connection.connectionId!==binding.connectionId)throw new AgentClientRegistryError('agent_client_device_connection_mismatch',409);
        const device=devices.get(binding.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)}),route=targetRoute(device.nodeId,binding.accountId);
        const workspace=body.workspace==null?String(binding.workingContext?.workspace||''):String(body.workspace||'').slice(0,512);
        const gracePreset=String(body.gracePreset||binding.workingContext?.gracePreset||'60m');
        let session=null;
        if(binding.workingContext?.sessionId){try{const prior=sessions.get(binding.workingContext.sessionId,binding.agentId);if(['active','hold'].includes(prior.state))session=prior;}catch{}}
        if(!session)session=sessions.open({agentId:binding.agentId,label:'ChatGPT Light Remote',workspace,gracePreset,nodeId:device.nodeId,deviceId:device.deviceId,accountId:binding.accountId,maxActiveForNode:route.sessionCeiling});
        if(workspace!==session.workspace)session=sessions.setWorkspace(session.sessionId,binding.agentId,workspace);
        const context=agentClients.setWorkingContext(binding.clientSessionId,{agentId:binding.agentId,deviceId:device.deviceId,sessionId:session.sessionId,workspace:session.workspace,gracePreset:session.gracePreset});
        return sendJson(res,200,{ok:true,context:{...context,nodeId:device.nodeId,displayName:device.displayName,platform:device.platform,architecture:device.architecture,deviceState:device.state,connectionState:connection.state},session});
      }catch(error){if(['agent_client_device_connection_mismatch','device_connection_closed','device_connection_expired'].includes(error.message))agentClients.removeDevice(binding.deviceId,'binding_invalid');throw error;}
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/connect') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'connect');
      const spec=connectionSpec(ctx.binding.accountId,ctx.payload.requestedLeaseMs),connection=connections.connect({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,plan:spec.plan,requestedLeaseMs:spec.requestedLeaseMs,reconnectGraceMs:ctx.payload.reconnectGraceMs});
      devices.heartbeat(ctx.device.deviceId,{agentVersion:ctx.payload.agentVersion});
      return sendJson(res,200,{ok:true,connection});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/disconnect') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'disconnect');
      const connection=connections.disconnect(ctx.device.deviceId,ctx.payload.reason||'client_disconnect');
      sessions.closeByDevice(ctx.device.deviceId,connection.closeReason||'device_connection_closed',{force:true});
      accessGrants.closeByDevice(ctx.device.deviceId,connection.closeReason||'device_connection_closed');
      pairingCodes.invalidateDevice(ctx.device.deviceId,connection.closeReason||'device_connection_closed');
      agentClients.removeDevice(ctx.device.deviceId,connection.closeReason||'device_connection_closed');
      try { devices.markOffline(ctx.device.deviceId,connection.closeReason||'client_disconnect'); } catch {}
      return sendJson(res,200,{ok:true,connection});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/grace') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'grace');
      return sendJson(res,200,{ok:true,connection:connections.setGrace(ctx.device.deviceId,ctx.payload.reconnectGraceMs)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/account-auth') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'account-auth');
      const account=accounts.verifyCredentials({email:ctx.payload.email,password:ctx.payload.password},{recordLogin:true,eventType:'account_wall_login'});
      if(account.accountId!==ctx.binding.accountId)throw new AccountError('device_account_mismatch',403);
      return sendJson(res,200,{ok:true,account,entitlements:planEntitlements(account)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-intent') {
      const body=await readJson(req),ctx=verifiedChannelContext(body,'fleet-intent');let account=accounts.account(ctx.binding.accountId),entitlements=planEntitlements(account);
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
      const body=await readJson(req),ctx=verifiedChannelContext(body,'fleet-authority');let {account,entitlements}=fleetEligibility(ctx);
      const issued=fleetAuthority.issue({accountId:account.accountId,mainDeviceId:account.mainDeviceId,deviceId:ctx.device.deviceId,publicKeySha256:ctx.binding.publicKeySha256,entitlementId:account.entitlement?.entitlementId||null,moduleVersion:ctx.payload.moduleVersion||null});
      if(account.fleetProvisioning?.deviceId===ctx.device.deviceId&&account.fleetProvisioning?.state!=='online')account=accounts.setFleetProvisioning(account.accountId,{deviceId:ctx.device.deviceId,state:'ready',reason:'fleet_authority_issued',moduleVersion:ctx.payload.moduleVersion||null,port:5492});
      return sendJson(res,200,{ok:true,fleet:{desired:true,port:5492},account:{accountId:account.accountId,plan:account.plan,mainDeviceId:account.mainDeviceId,fleetProvisioning:account.fleetProvisioning||null},entitlements,authority:issued});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-status') {
      const body=await readJson(req),ctx=verifiedFleetContext(verifiedChannelContext(body,'fleet-status'));let {account,entitlements}=ctx;
      const status=String(ctx.payload.status||'').trim().toLowerCase(),port=Number(ctx.payload.port)||5492;if(status!=='online')throw new FleetAuthorityError('invalid_fleet_status');if(port!==5492)throw new FleetAuthorityError('invalid_fleet_status_port');
      account=accounts.setFleetProvisioning(account.accountId,{deviceId:ctx.device.deviceId,state:'online',reason:'fleet_runtime_online',moduleVersion:ctx.payload.moduleVersion||null,port});
      return sendJson(res,200,{ok:true,fleet:{desired:true,status:'online',port},account:{accountId:account.accountId,plan:account.plan,mainDeviceId:account.mainDeviceId,fleetProvisioning:account.fleetProvisioning||null},entitlements});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-devices') {
      const body=await readJson(req),ctx=verifiedFleetContext(verifiedChannelContext(body,'fleet-devices'));
      const rows=allDeviceViews().filter(device=>device.accountId===ctx.account.accountId&&device.state!=='revoked');
      return sendJson(res,200,{ok:true,mainDeviceId:ctx.account.mainDeviceId,authority:ctx.lease,devices:rows});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-sessions') {
      const body=await readJson(req),ctx=verifiedFleetContext(verifiedChannelContext(body,'fleet-sessions')),owned=new Set(allDeviceViews().filter(device=>device.accountId===ctx.account.accountId&&device.state!=='revoked').map(device=>device.deviceId));
      const rows=sessions.list().filter(row=>owned.has(row.deviceId));
      return sendJson(res,200,{ok:true,mainDeviceId:ctx.account.mainDeviceId,authority:ctx.lease,sessions:rows});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-activity') {
      const body=await readJson(req),ctx=verifiedFleetContext(verifiedChannelContext(body,'fleet-activity')),owned=new Set(allDeviceViews().filter(device=>device.accountId===ctx.account.accountId&&device.state!=='revoked').map(device=>device.deviceId)),limit=Math.max(1,Math.min(Number(ctx.payload.limit)||500,5000));
      const rows=recentEvents(MAX_RING_EVENTS).filter(event=>event.accountId===ctx.account.accountId||owned.has(String(event.deviceId||''))).slice(-limit);
      return sendJson(res,200,{ok:true,mainDeviceId:ctx.account.mainDeviceId,authority:ctx.lease,events:rows});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-device-policy') {
      const body=await readJson(req),ctx=verifiedFleetContext(verifiedChannelContext(body,'fleet-device-policy')),target=fleetTarget(ctx,ctx.payload.deviceId);
      const policy=enrollments.updatePolicy({deviceId:target.deviceId,accountId:ctx.account.accountId,approvedCapabilities:ctx.payload.approvedCapabilities,policyProfile:ctx.payload.policyProfile});
      if(target.nodeId!==NODE_ID){try{fleet.wake(target.nodeId);}catch{}}
      pushEvent({type:'device_policy_updated',accountId:policy.accountId,deviceId:policy.deviceId,nodeId:target.nodeId,status:'updated',policyProfile:policy.policyProfile,policyRevision:policy.policyRevision,capabilities:policy.approvedCapabilities,source:'fleet_wall'});
      return sendJson(res,200,{ok:true,mainDeviceId:ctx.account.mainDeviceId,policy,device:deviceView(target)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/fleet-device-update') {
      const body=await readJson(req),ctx=verifiedFleetContext(verifiedChannelContext(body,'fleet-device-update')),target=fleetTarget(ctx,ctx.payload.deviceId);
      return sendJson(res,200,{ok:true,mainDeviceId:ctx.account.mainDeviceId,maintenance:queueHelperUpdate(target.deviceId,{source:'fleet-wall'})});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/pairing-code') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'pairing-code');
      const connection=connections.assertConnected(ctx.device.deviceId);
      const spec={accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt};
      const pairing=ctx.payload.rotate===true?pairingCodes.rotate(spec):pairingCodes.currentOrRotate(spec);
      return sendJson(res,200,{ok:true,pairing});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/account-owner-proof') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'account-owner-proof');
      connections.assertConnected(ctx.device.deviceId);
      const proof=accounts.issueOwnerProof({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId});
      return sendJson(res,200,{ok:true,proof});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/access-approve') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'access-approve');
      const connection=connections.assertConnected(ctx.device.deviceId);
      const grant=accessGrants.approve(ctx.payload.requestId,{deviceId:ctx.device.deviceId,connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt,idleGraceMs:connection.reconnectGraceMs});
      return sendJson(res,200,{ok:true,grant});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/access-deny') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'access-deny');
      const result=accessGrants.deny(ctx.payload.requestId,ctx.payload.reason||'owner_denied',{deviceId:ctx.device.deviceId});
      return sendJson(res,200,{ok:true,authorization:result});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/status') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'status');
      const connection=requireDeviceConnection(ctx.device.deviceId);
      const liveSessions=sessions.list({deviceId:ctx.device.deviceId}).filter(item=>item.state==='active'||item.state==='hold');
      return sendJson(res,200,{ok:true,device:deviceView(ctx.device),connection:{...connections.get(ctx.device.deviceId),enforced:CONNECTION_LEASE_ENFORCE},sessions:liveSessions,access:{pending:accessGrants.pendingForDevice(ctx.device.deviceId),activeGrant:accessGrants.activeForDevice(ctx.device.deviceId,connection.connectionId)}});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/session-close') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'session-close');
      requireDeviceConnection(ctx.device.deviceId);
      const sessionId=String(ctx.payload.sessionId||'').trim(), agentId=String(ctx.payload.agentId||'').trim();
      const current=sessions.get(sessionId,agentId);
      if(current.deviceId!==ctx.device.deviceId)throw new EnrollmentError('session_device_mismatch',409);
      const session=sessions.close(sessionId,agentId,String(ctx.payload.reason||'owner_closed_from_wall').slice(0,80));
      return sendJson(res,200,{ok:true,session});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/update-report') {
      const body=await readJson(req),ctx=verifiedChannelContext(body,'update-report');
      requireDeviceConnection(ctx.device.deviceId);
      if(ctx.payload.nodeId!=null&&String(ctx.payload.nodeId)!==ctx.device.nodeId)throw new EnrollmentError('device_node_mismatch',409);
      const report=normalizeUpdateReport(ctx.payload);
      pushEvent({type:'device_update_report',accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,nodeId:ctx.device.nodeId,status:report.outcome==='success'?'ok':'error',...report});
      return sendJson(res,200,{ok:true,accepted:true,reportId:report.reportId});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/activity') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'activity');
      requireDeviceConnection(ctx.device.deviceId);
      const limit=Math.max(1,Math.min(Number(ctx.payload.limit)||500,5000));
      return sendJson(res,200,{ok:true,deviceId:ctx.device.deviceId,events:recentEvents(limit,ctx.device.deviceId)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/poll') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'poll');
      if (ctx.payload.nodeId!=null && String(ctx.payload.nodeId)!==ctx.device.nodeId) throw new EnrollmentError('device_node_mismatch',409);
      const reportedRevision=Math.max(0,Number(ctx.payload.policyRevision)||0);
      const capabilities=verifiedLeafCapabilities(ctx.payload.capabilities,ctx.binding,reportedRevision);
      requireDeviceConnection(ctx.device.deviceId);
      devices.heartbeat(ctx.device.deviceId,{capabilities,agentVersion:ctx.payload.agentVersion,updateStatus:ctx.payload.updateStatus});
      const waitMs=Math.max(0,Math.min(Number(ctx.payload.waitMs)||8000,15000));
      const channel=await fleet.waitPoll({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,nodeId:ctx.device.nodeId,sessionCeiling:ctx.payload.sessionCeiling,draining:Boolean(ctx.payload.draining),capabilities},waitMs);
      const policy=reportedRevision===Math.max(1,Number(ctx.binding.policyRevision)||1)?null:enrollments.policyEnvelope(ctx.device.deviceId);
      return sendJson(res,200,{ok:true,channel,policy,access:{pending:accessGrants.pendingForDevice(ctx.device.deviceId),activeGrant:accessGrants.activeForDevice(ctx.device.deviceId,connections.get(ctx.device.deviceId)?.connectionId)}});
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-channel/result') {
      const body=await readJson(req), ctx=verifiedChannelContext(body,'result'), result=ctx.payload;
      let command;
      try { command=fleet.command(result.commandId); }
      catch(error) {
        if(error?.message!=='command_not_found')throw error;
        const receipt=fleet.receipt(result.commandId);
        if(!receipt)throw error;
        if(receipt.accountId!==ctx.binding.accountId || receipt.deviceId!==ctx.device.deviceId || receipt.nodeId!==ctx.device.nodeId)throw new FleetError('command_device_mismatch',403);
        const prior=jobs.get(receipt.jobId);
        return sendJson(res,200,{ok:true,accepted:true,duplicate:true,job:prior?jobView(prior):null});
      }
      if (command.accountId!==ctx.binding.accountId || command.deviceId!==ctx.device.deviceId || command.nodeId!==ctx.device.nodeId) throw new FleetError('command_device_mismatch',403);
      const job=jobs.get(command.jobId);
      if (!job || job.commandId!==command.commandId) throw new FleetError('remote_job_not_found',404);
      const stdout=String(result.stdout||''), stderr=String(result.stderr||'');
      if (Buffer.byteLength(stdout)>MAX_MEMORY_OUTPUT || Buffer.byteLength(stderr)>MAX_MEMORY_OUTPUT) throw new FleetError('remote_result_too_large',413);
      if(result.data!==undefined&&Buffer.byteLength(JSON.stringify(result.data))>MAX_MEMORY_OUTPUT)throw new FleetError('remote_result_data_too_large',413);
      if(result.data!==undefined){job.resultData=result.data;if(job.toolMeta?.kind==='terminal')job.resultSummary=terminalResultSummary(result.data);}
      applyDeviceTelemetry(job,result.telemetry);
      const exitCode=Number(result.exitCode);
      if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new FleetError('invalid_remote_exit_code');
      if (stdout) emitStream(job,'stdout',Buffer.from(stdout));
      if (stderr) emitStream(job,'stderr',Buffer.from(stderr));
      job.timedOut=String(result.status||'')==='timeout';
      fleet.complete({accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,nodeId:ctx.device.nodeId,commandId:command.commandId});
      finishJob(job,exitCode,null);
      return sendJson(res,200,{ok:true,accepted:true,duplicate:false,job:jobView(job)});
    }

}
