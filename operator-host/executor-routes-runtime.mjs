export async function handleRuntimeRoutes(req,res,url,deps){
  const {ACCOUNT_ID,DEVICE_ID,DeviceAccessGrantError,DeviceConnectionError,EnrollmentError,FleetError,MAX_ACTIVE_SESSIONS,MAX_MEMORY_OUTPUT,NODE_ID,SESSION_GRACE_PRESETS,SESSION_IDLE_MS,SESSION_MAX_IDLE_MS,SESSION_MIN_IDLE_MS,VERSION,accessGrants,agentClients,allDeviceViews,assertDiskJobOwner,capabilities,clearMainIfMatches,connectionSpec,connectionViewForDevice,connections,decryptEnvelope,deviceView,devices,enrollments,fleet,flushDiskRecords,fs,fullOutputFromDisk,ingressTelemetry,jobView,jobs,pairingCodes,pruneRing,pushEvent,queueSignedUpdate,readJson,recentEvents,redact,revokeRuntimeForDevice,ring,ringBytes,sendJson,sessionStatsFromDisk,sessions,sseClients,startDesktopOperation,startFsOperation,startJob,startProcessOperation,startScpOperation,startSearchOperation,startTerminalOperation,targetRoute,waitForJob}=deps;
    if (req.method === 'GET' && url.pathname === '/v1/devices') {
      return sendJson(res, 200, { ok:true, currentDeviceId:DEVICE_ID, devices:allDeviceViews() });
    }
    if (req.method === 'GET' && url.pathname === '/v1/fleet') {
      return sendJson(res, 200, { ok:true, hubNodeId:NODE_ID, nodes:[{accountId:ACCOUNT_ID,deviceId:DEVICE_ID,nodeId:NODE_ID,mode:'local',state:'online',draining:false,sessionCeiling:MAX_ACTIVE_SESSIONS,activeSessions:sessions.activeCountByNode(NODE_ID)}, ...fleet.list().map(node=>({...node,mode:'outbound-leaf',activeSessions:sessions.activeCountByNode(node.nodeId)}))] });
    }
    const drainMatch=url.pathname.match(/^\/v1\/fleet\/([A-Za-z0-9._:-]+)\/drain$/);
    if (req.method === 'POST' && drainMatch) {
      if (drainMatch[1]===NODE_ID) throw new FleetError('hub_node_drain_not_supported',409);
      const body=await readJson(req);
      if (typeof body.draining!=='boolean') throw new FleetError('invalid_node_drain_state');
      return sendJson(res,200,{ok:true,node:fleet.setOwnerDrain(drainMatch[1],body.draining)});
    }
    const deviceMatch = url.pathname.match(/^\/v1\/devices\/([A-Za-z0-9._:-]+)$/);
    if (req.method === 'GET' && deviceMatch) {
      return sendJson(res, 200, { ok:true, device:deviceView(devices.get(deviceMatch[1], { activeSessionsForNode:nodeId => sessions.activeCountByNode(nodeId) })) });
    }
    const maintenanceUpdateMatch = url.pathname.match(/^\/v1\/devices\/([A-Za-z0-9._:-]+)\/maintenance\/update$/);
    if (req.method === 'POST' && maintenanceUpdateMatch) {
      const maintenance=queueSignedUpdate(maintenanceUpdateMatch[1]);
      await flushDiskRecords();
      return sendJson(res,200,{ok:true,maintenance});
    }
    const policyMatch = url.pathname.match(/^\/v1\/devices\/([A-Za-z0-9._:-]+)\/policy$/);
    if (req.method === 'POST' && policyMatch) {
      const body=await readJson(req);
      if (String(body.deviceId || policyMatch[1]) !== policyMatch[1]) throw new EnrollmentError('device_id_mismatch',409);
      const policy=enrollments.updatePolicy({deviceId:policyMatch[1],accountId:body.accountId,approvedCapabilities:body.approvedCapabilities,policyProfile:body.policyProfile});
      const device=devices.get(policyMatch[1],{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
      if(device.nodeId!==NODE_ID){try{fleet.wake(device.nodeId);}catch{}}
      pushEvent({type:'device_policy_updated',accountId:policy.accountId,deviceId:policy.deviceId,nodeId:device.nodeId,status:'updated',policyProfile:policy.policyProfile,policyRevision:policy.policyRevision,capabilities:policy.approvedCapabilities});
      return sendJson(res,200,{ok:true,policy,device:deviceView(device)});
    }
    const heartbeatMatch = url.pathname.match(/^\/v1\/devices\/([A-Za-z0-9._:-]+)\/heartbeat$/);
    if (req.method === 'POST' && heartbeatMatch) {
      const body = await readJson(req);
      if (String(body.deviceId || '') !== heartbeatMatch[1]) throw new EnrollmentError('device_id_mismatch', 409);
      const proof = enrollments.verifyHeartbeat(body);
      const device = devices.heartbeat(heartbeatMatch[1], { capabilities:proof.effectiveCapabilities });
      const currentRevision=Math.max(1,Number(proof.binding.policyRevision)||1), policy=proof.reportedPolicyRevision===currentRevision?null:enrollments.policyEnvelope(device.deviceId);
      pushEvent({ type:'device_heartbeat_verified', accountId:device.accountId, deviceId:device.deviceId, nodeId:device.nodeId, status:'online', capabilities:proof.effectiveCapabilities });
      return sendJson(res, 200, { ok:true, device, policy });
    }
    const revokeMatch = url.pathname.match(/^\/v1\/devices\/([A-Za-z0-9._:-]+)\/revoke$/);
    if (req.method === 'POST' && revokeMatch) {
      const body = await readJson(req);
      if (String(body.deviceId || revokeMatch[1]) !== revokeMatch[1]) throw new EnrollmentError('device_id_mismatch', 409);
      if(revokeMatch[1]===DEVICE_ID)throw new EnrollmentError('integrated_hub_device_not_revocable',409);
      const binding = enrollments.revoke({ deviceId:revokeMatch[1], accountId:body.accountId, reason:body.reason });
      const device = devices.revoke(revokeMatch[1], body.reason || 'owner_revoked');
      revokeRuntimeForDevice(revokeMatch[1],body.reason||'owner_revoked');
      clearMainIfMatches(device.accountId,device.deviceId,'main_device_revoked');
      return sendJson(res, 200, { ok:true, binding, device });
    }
    const connectionMatch = url.pathname.match(/^\/v1\/devices\/([A-Za-z0-9._:-]+)\/connection(?:\/(connect|disconnect|grace|activity))?$/);
    if (connectionMatch) {
      const deviceId=connectionMatch[1], action=connectionMatch[2] || 'get';
      const device=devices.get(deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
      if (device.accountId!==ACCOUNT_ID) throw new DeviceConnectionError('device_connection_account_mismatch',403);
      if (req.method==='GET' && action==='get') return sendJson(res,200,{ok:true,connection:connectionViewForDevice(deviceId)});
      if (req.method==='POST' && action==='connect') {
        const body=await readJson(req);
        const spec=connectionSpec(ACCOUNT_ID,body.requestedLeaseMs),connection=connections.connect({accountId:ACCOUNT_ID,deviceId,plan:spec.plan,requestedLeaseMs:spec.requestedLeaseMs,reconnectGraceMs:body.reconnectGraceMs});
        return sendJson(res,200,{ok:true,connection});
      }
      if (req.method==='POST' && action==='disconnect') {
        const body=await readJson(req), connection=connections.disconnect(deviceId,body.reason||'user_disconnect');
        accessGrants.closeByDevice(deviceId,connection.closeReason||'device_connection_closed');
        pairingCodes.invalidateDevice(deviceId,connection.closeReason||'device_connection_closed');
        agentClients.removeDevice(deviceId,connection.closeReason||'device_connection_closed');
        sessions.closeByDevice(deviceId,connection.closeReason||'device_connection_closed',{force:true});
        return sendJson(res,200,{ok:true,connection});
      }
      if (req.method==='POST' && action==='grace') {
        const body=await readJson(req);
        return sendJson(res,200,{ok:true,connection:connections.setGrace(deviceId,body.reconnectGraceMs)});
      }
      if (req.method==='POST' && action==='activity') {
        const body=await readJson(req);
        return sendJson(res,200,{ok:true,connection:connections.touch(deviceId,body.reason||'activity')});
      }
    }
    if (req.method === 'POST' && url.pathname === '/v1/sessions/open') {
      const body = await readJson(req), route=targetRoute(body.nodeId);
      return sendJson(res, 200, { ok:true, route, session:sessions.open({ openId:body.openId, agentId:body.agentId, label:body.label, workspace:body.workspace, graceMs:body.graceMs, gracePreset:body.gracePreset, leaseMs:body.leaseMs, leasePreset:body.leasePreset, nodeId:route.nodeId, deviceId:route.deviceId, maxActiveForNode:route.sessionCeiling }) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/sessions') {
      return sendJson(res, 200, { ok:true, active:sessions.activeCount(), maxActive:MAX_ACTIVE_SESSIONS, defaultGraceMs:SESSION_IDLE_MS, minGraceMs:SESSION_MIN_IDLE_MS, maxGraceMs:SESSION_MAX_IDLE_MS, gracePresets:SESSION_GRACE_PRESETS, sessions:sessions.list() });
    }
    if (req.method === 'GET' && url.pathname === '/v1/session-stats') {
      return sendJson(res, 200, { ok:true, ...sessionStatsFromDisk(url.searchParams.get('hours')) });
    }
    const sessionAction = url.pathname.match(/^\/v1\/sessions\/([A-Za-z0-9._:-]+)(?:\/(resume|close|touch|hold))?$/);
    if (sessionAction) {
      const sid=sessionAction[1], action=sessionAction[2] || 'get';
      const body = req.method === 'POST' ? await readJson(req) : null;
      const aid = body?.agentId || url.searchParams.get('agentId');
      if (req.method === 'GET' && action === 'get') return sendJson(res, 200, { ok:true, session:sessions.get(sid, aid) });
      if (req.method === 'POST' && action === 'resume') return sendJson(res, 200, { ok:true, session:sessions.resume(sid, aid) });
      if (req.method === 'POST' && action === 'hold') return sendJson(res, 200, { ok:true, session:sessions.hold(sid, aid, body?.reason || 'transport_lost') });
      if (req.method === 'POST' && action === 'close') return sendJson(res, 200, { ok:true, session:sessions.close(sid, aid) });
      if (req.method === 'POST' && action === 'touch') return sendJson(res, 200, { ok:true, session:sessions.touch(sid, aid, body?.action || 'tool') });
    }
    if (req.method === 'POST' && url.pathname === '/v1/device-access/execute') {
      const operatorAcceptedAt=Date.now();
      const body=await readJson(req), grant=accessGrants.assert(body.grantId);
      const connection=connections.assertConnected(grant.deviceId);
      accessGrants.assert(grant.grantId,{deviceId:grant.deviceId,connectionId:connection.connectionId});
      const {payload,requestId,aad,kid}=decryptEnvelope(body.envelope||{});
      if(!['exec_batch','fs','process','terminal','search','scp','desktop'].includes(payload.action))throw new Error('unsupported_action');
      const session=sessions.ensure(String(payload.sessionId||''),{agentId:String(payload.agentId||'')});
      if(session.deviceId!==grant.deviceId)throw new DeviceAccessGrantError('device_access_grant_session_mismatch',403);
      const job=payload.action==='desktop'?await startDesktopOperation(payload,requestId):payload.action==='fs'?await startFsOperation(payload,requestId):payload.action==='process'?await startProcessOperation(payload,requestId):payload.action==='terminal'?await startTerminalOperation(payload,requestId):payload.action==='search'?await startSearchOperation(payload,requestId):payload.action==='scp'?await startScpOperation(payload,requestId):startJob(payload,requestId);
      if(!job.telemetry?.operatorAcceptedAt){job.telemetry={...(job.telemetry||{}),...ingressTelemetry(body.telemetry,operatorAcceptedAt),dispatchAt:job.startedAt};if(!job.remote)job.telemetry.deviceReceivedAt=job.startedAt;}
      const waitMs=Math.max(0,Math.min(Number(payload.waitMs)||0,8000));
      await waitForJob(job,waitMs);
      return sendJson(res,200,{ok:job.finishedAt?job.exitCode===0:true,encryptedByKid:kid,aad,job:jobView(job),data:job.resultData});
    }
    if (req.method === 'POST' && url.pathname === '/v1/scp') {
      const envelope=await readJson(req);
      const {payload,requestId,aad,kid}=decryptEnvelope(envelope);
      if(payload.action!=='scp')throw new Error('unsupported_action');
      const job=await startScpOperation(payload,requestId);
      const waitMs=Math.max(0,Math.min(Number(payload.waitMs)||7000,8000));
      await waitForJob(job,waitMs);
      return sendJson(res,200,{ok:job.finishedAt?job.exitCode===0:true,encryptedByKid:kid,aad,job:jobView(job),data:job.resultData});
    }
    if (req.method === 'POST' && url.pathname === '/v1/process') {
      const envelope=await readJson(req);
      const {payload,requestId,aad,kid}=decryptEnvelope(envelope);
      if(payload.action!=='process')throw new Error('unsupported_action');
      const job=await startProcessOperation(payload,requestId);
      const waitMs=Math.max(0,Math.min(Number(payload.waitMs)||7000,8000));
      await waitForJob(job,waitMs);
      return sendJson(res,200,{ok:job.finishedAt?job.exitCode===0:true,encryptedByKid:kid,aad,job:jobView(job),data:job.resultData});
    }
    if (req.method === 'POST' && url.pathname === '/v1/search') {
      const envelope=await readJson(req);
      const {payload,requestId,aad,kid}=decryptEnvelope(envelope);
      if(payload.action!=='search')throw new Error('unsupported_action');
      const job=await startSearchOperation(payload,requestId);
      const waitMs=Math.max(0,Math.min(Number(payload.waitMs)||7000,8000));
      await waitForJob(job,waitMs);
      return sendJson(res,200,{ok:job.finishedAt?job.exitCode===0:true,encryptedByKid:kid,aad,job:jobView(job),data:job.resultData});
    }
    if (req.method === 'POST' && url.pathname === '/v1/fs') {
      const envelope=await readJson(req);
      const {payload,requestId,aad,kid}=decryptEnvelope(envelope);
      if(payload.action!=='fs')throw new Error('unsupported_action');
      const job=await startFsOperation(payload,requestId);
      const waitMs=Math.max(0,Math.min(Number(payload.waitMs)||7000,8000));
      await waitForJob(job,waitMs);
      return sendJson(res,200,{ok:job.finishedAt?job.exitCode===0:true,encryptedByKid:kid,aad,job:jobView(job),data:job.resultData});
    }
    if (req.method === 'POST' && url.pathname === '/v1/execute') {
      const envelope = await readJson(req);
      const { payload, requestId, aad, kid } = decryptEnvelope(envelope);
      if (payload.action !== 'exec_batch') throw new Error('unsupported_action');
      const job = startJob(payload, requestId);
      const waitMs = Math.max(0, Math.min(Number(payload.waitMs) || 0, 8000));
      await waitForJob(job, waitMs);
      return sendJson(res, 200, { ok: true, encryptedByKid: kid, aad, job: jobView(job) });
    }
    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([0-9a-f-]+)$/i);
    if (req.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      const aid = url.searchParams.get('agentId');
      if (job) { sessions.ensure(job.sessionId, { agentId:aid }); sessions.record(job.sessionId, 'toolCalls'); sessions.record(job.sessionId, 'jobReads'); }
      return job ? sendJson(res, 200, { ok: true, job: jobView(job) }) : sendJson(res, 404, { ok: false, error: 'job_not_found' });
    }
    const outputMatch = url.pathname.match(/^\/v1\/output\/([0-9a-f-]+)$/i);
    if (req.method === 'GET' && outputMatch) {
      const stream = url.searchParams.get('stream') === 'stderr' ? 'stderr' : 'stdout';
      const full = url.searchParams.get('full') === '1';
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || MAX_MEMORY_OUTPUT, 8 * 1024 * 1024));
      const job = jobs.get(outputMatch[1]);
      const aid = url.searchParams.get('agentId');
      if (job) { sessions.ensure(job.sessionId, { agentId:aid }); sessions.record(job.sessionId, 'toolCalls'); sessions.record(job.sessionId, 'outputReads'); }
      else assertDiskJobOwner(outputMatch[1], aid);
      let text;
      if (full) { await flushDiskRecords(); text = fullOutputFromDisk(outputMatch[1], stream); }
      else if (job) text = job[stream].snapshot().text;
      else text = fullOutputFromDisk(outputMatch[1], stream);
      const totalBytes = Buffer.byteLength(text);
      const slice = Buffer.from(text).subarray(offset, offset + limit).toString('utf8');
      return sendJson(res, 200, { ok: true, jobId: outputMatch[1], stream, offset, returnedBytes: Buffer.byteLength(slice),
        totalBytes, hasMore: offset + Buffer.byteLength(slice) < totalBytes, output: redact(slice) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/activity') {
      const deviceId=url.searchParams.get('deviceId');
    return sendJson(res, 200, { ok: true, version: VERSION, ringBytes, deviceId:deviceId||null, events: recentEvents(url.searchParams.get('limit'),deviceId) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      sseClients.add(res);
      pruneRing();
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, now: new Date().toISOString(), version: VERSION })}\n\n`);
      for (const item of ring.slice(-100)) res.write(`id: ${item.event.id}\nevent: activity\ndata: ${JSON.stringify(item.event)}\n\n`);
      const timer = setInterval(() => res.write(`: keepalive ${Date.now()}\n\n`), 20000);
      req.on('close', () => { clearInterval(timer); sseClients.delete(res); });
      return;
    }

}
