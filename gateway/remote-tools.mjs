import { z } from 'zod';
import { callOperatorJson } from './operator-proxy.mjs';
import { sealOperatorPayload } from './operator-crypto.mjs';

const id = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const agentId = z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/);
const jobId = z.string().regex(/^[0-9a-f-]{20,}$/i);
const capability = z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/);

function annotations({ readOnly = false, destructive = false, idempotent = false } = {}) {
  return { readOnlyHint:readOnly, destructiveHint:destructive, idempotentHint:idempotent, openWorldHint:false };
}

export function registerRemoteTools(server, tracked, identity) {
  server.registerTool('light_remote_capabilities', {
    title:'Light Remote capabilities',
    description:'Read the execution capabilities exposed by this Light Remote Server.',
    annotations:annotations({ readOnly:true, idempotent:true })
  }, tracked('light_remote_capabilities', identity, async () => callOperatorJson('GET','/v1/capabilities')));

  server.registerTool('light_remote_devices', {
    title:'List Light Remote devices',
    description:'List enrolled devices, online state, node IDs and policy-bounded capabilities. Always inspect this before choosing a target.',
    annotations:annotations({ readOnly:true, idempotent:true })
  }, tracked('light_remote_devices', identity, async () => callOperatorJson('GET','/v1/devices')));

  server.registerTool('light_remote_fleet', {
    title:'Read Light Remote fleet',
    description:'Read fleet routing state, including online/offline/draining nodes and active session counts.',
    annotations:annotations({ readOnly:true, idempotent:true })
  }, tracked('light_remote_fleet', identity, async () => callOperatorJson('GET','/v1/fleet')));

  server.registerTool('light_remote_open_session', {
    title:'Open durable Light Remote session',
    description:'Open or reuse a durable target-bound Agent lane. Use one stable agentId per ChatGPT conversation. The same agentId may own a separate lane on another device. Reconnect grace is bounded to 15–60 minutes and is not the device connection lifetime.',
    inputSchema:{
      agentId, openId:agentId,
      label:z.string().max(160).optional(), workspace:z.string().max(240).optional(),
      nodeId:id.optional(), gracePreset:z.enum(['15m','30m','45m','60m']).optional(),
      graceMs:z.number().int().min(900000).max(3600000).optional()
    },
    annotations:annotations({ idempotent:true })
  }, tracked('light_remote_open_session', identity, async input => callOperatorJson('POST','/v1/sessions/open',{
    agentId:input.agentId, openId:input.openId, label:input.label || 'ChatGPT Light Remote',
    workspace:input.workspace || '', nodeId:input.nodeId, gracePreset:input.gracePreset, graceMs:input.graceMs
  })));

  server.registerTool('light_remote_session', {
    title:'Read Light Remote session',
    description:'Read one durable Agent session by ID. Activity renews only the bounded reconnect grace; it never extends the device hard connection lease.',
    inputSchema:{ sessionId:id, agentId },
    annotations:annotations({ readOnly:true, idempotent:true })
  }, tracked('light_remote_session', identity, async input => callOperatorJson('GET',
    `/v1/sessions/${encodeURIComponent(input.sessionId)}?agentId=${encodeURIComponent(input.agentId)}`)));

  server.registerTool('light_remote_resume_session', {
    title:'Resume Light Remote session',
    description:'Resume a durable session after transport or chat interruption. The same agentId must own the session.',
    inputSchema:{ sessionId:id, agentId },
    annotations:annotations({ idempotent:true })
  }, tracked('light_remote_resume_session', identity, async input => callOperatorJson('POST',
    `/v1/sessions/${encodeURIComponent(input.sessionId)}/resume`, { agentId:input.agentId })));

  server.registerTool('light_remote_hold_session', {
    title:'Hold Light Remote session',
    description:'Mark an Agent lane as temporarily disconnected/recoverable without closing it. It remains resumable only inside the configured reconnect grace.',
    inputSchema:{ sessionId:id, agentId, reason:z.enum(['transport_lost','chat_disconnected','client_temporarily_offline','user_idle']).optional() },
    annotations:annotations({ idempotent:true })
  }, tracked('light_remote_hold_session', identity, async input => callOperatorJson('POST',
    `/v1/sessions/${encodeURIComponent(input.sessionId)}/hold`, { agentId:input.agentId, reason:input.reason || 'transport_lost' })));

  server.registerTool('light_remote_exec', {
    title:'Execute on a Light Remote device',
    description:'Execute a script inside an already-open target-bound session. Execution is durable: if this call returns a running job, poll light_remote_job/read light_remote_output instead of re-running the script. Required capabilities are re-inferred on the device and local policy is authoritative.',
    inputSchema:{
      sessionId:id, agentId, operationId:agentId,
      script:z.string().min(1).max(1048576), cwd:z.string().max(4096).optional(),
      nodeId:id.optional(), timeoutMs:z.number().int().min(1000).max(7200000).optional(),
      waitMs:z.number().int().min(0).max(7000).optional(),
      requiredCapabilities:z.array(capability).max(64).optional(), note:z.string().max(400).optional()
    },
    annotations:annotations({ destructive:true })
  }, tracked('light_remote_exec', identity, async input => {
    const payload={ action:'exec_batch', operationId:input.operationId, script:input.script,
      cwd:input.cwd, timeoutMs:input.timeoutMs ?? 600000, waitMs:input.waitMs ?? 7000,
      sessionId:input.sessionId, agentId:input.agentId, nodeId:input.nodeId,
      requiredCapabilities:input.requiredCapabilities?.length ? input.requiredCapabilities : ['filesystem'],
      note:input.note || 'ChatGPT Light Remote MCP' };
    return callOperatorJson('POST','/v1/execute',sealOperatorPayload(payload));
  }));

  server.registerTool('light_remote_job', {
    title:'Read Light Remote job',
    description:'Read durable job state after light_remote_exec. Use this to wait for completion without repeating the command.',
    inputSchema:{ jobId, agentId },
    annotations:annotations({ readOnly:true, idempotent:true })
  }, tracked('light_remote_job', identity, async input => callOperatorJson('GET',
    `/v1/jobs/${encodeURIComponent(input.jobId)}?agentId=${encodeURIComponent(input.agentId)}`)));

  server.registerTool('light_remote_output', {
    title:'Read Light Remote job output',
    description:'Read bounded stdout or stderr from a durable job. Continue with offset for large output.',
    inputSchema:{
      jobId, agentId, stream:z.enum(['stdout','stderr']).optional(),
      full:z.boolean().optional(), offset:z.number().int().min(0).optional(),
      limit:z.number().int().min(1).max(8388608).optional()
    },
    annotations:annotations({ readOnly:true, idempotent:true })
  }, tracked('light_remote_output', identity, async input => {
    const q=new URLSearchParams({ agentId:input.agentId, stream:input.stream || 'stdout',
      full:input.full ? '1':'0', offset:String(input.offset || 0), limit:String(input.limit || 4194304) });
    return callOperatorJson('GET',`/v1/output/${encodeURIComponent(input.jobId)}?${q}`);
  }));

  server.registerTool('light_remote_close_session', {
    title:'Close Light Remote session',
    description:'Close a durable session when the current task is finished. Closing never terminates an already-running job; job lifetime is independent.',
    inputSchema:{ sessionId:id, agentId },
    annotations:annotations({ idempotent:true })
  }, tracked('light_remote_close_session', identity, async input => callOperatorJson('POST',
    `/v1/sessions/${encodeURIComponent(input.sessionId)}/close`, { agentId:input.agentId })));

  server.registerTool('light_remote_operating_contract', {
    title:'Light Remote operating contract',
    description:'Explain how an AI agent should safely operate Light Remote without relying on prior chat history.',
    annotations:annotations({ readOnly:true, idempotent:true })
  }, tracked('light_remote_operating_contract', identity, async () => ({
    role:'governed_remote_execution_control_plane',
    workflow:['inspect devices','choose explicit target','open durable session','execute','poll job/read output','close session'],
    durability:'jobs outlive a model turn or transport interruption; resume the same session/job instead of rerunning',
    targeting:'leaf targets are explicit and never silently fall back to another device',
    privilege:'normal user by default; privileged commands require policy-granted capabilities such as sudo-on-demand or Windows admin lanes',
    safetyBoundary:'server policy + signed device policy + device-side capability inference + platform hard-deny are authoritative',
    remoteSurfaces:['filesystem','Git','build/test','process/network','services/systemd','Docker/LXD','package managers','PowerShell','logs'],
    genericExecutor:'light_remote_exec is the full shell/PowerShell lane; adapt commands to the target platform returned by light_remote_devices'
  })));

  server.registerTool('light_remote_device', {
    title:'Read one Light Remote device',
    description:'Read detailed platform, routing, policy and capability state for one enrolled device.',
    inputSchema:{ deviceId:id },
    annotations:annotations({ readOnly:true, idempotent:true })
  }, tracked('light_remote_device', identity, async input => callOperatorJson('GET',`/v1/devices/${encodeURIComponent(input.deviceId)}`)));

  server.registerTool('light_remote_sessions', {
    title:'List Light Remote sessions',
    description:'List durable session state for recovery and cleanup. Use this before opening a new lane when reconnecting after interruption.',
    annotations:annotations({ readOnly:true, idempotent:true })
  }, tracked('light_remote_sessions', identity, async () => callOperatorJson('GET','/v1/sessions')));


  server.registerTool('light_remote_set_node_drain', {
    title:'Drain or undrain a Light Remote leaf',
    description:'Prevent or allow new sessions on an outbound leaf. Existing jobs/sessions are not silently moved. Hub drain is unsupported.',
    inputSchema:{ nodeId:id, draining:z.boolean() },
    annotations:annotations({ destructive:true, idempotent:true })
  }, tracked('light_remote_set_node_drain', identity, async input => callOperatorJson('POST',
    `/v1/fleet/${encodeURIComponent(input.nodeId)}/drain`, { draining:input.draining })));

  server.registerTool('light_remote_set_device_policy', {
    title:'Set Light Remote device policy',
    description:'Set the owner-approved capability subset for one enrolled device. Cannot grant capabilities the device did not advertise; device-local deny remains authoritative.',
    inputSchema:{ deviceId:id, policyProfile:z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/), approvedCapabilities:z.array(capability).min(1).max(64) },
    annotations:annotations({ destructive:true, idempotent:true })
  }, tracked('light_remote_set_device_policy', identity, async input => {
    const current=await callOperatorJson('GET',`/v1/devices/${encodeURIComponent(input.deviceId)}`);
    const accountId=current?.device?.accountId;
    if(!accountId) throw new Error('device_account_missing');
    return callOperatorJson('POST',`/v1/devices/${encodeURIComponent(input.deviceId)}/policy`,{
      deviceId:input.deviceId,accountId,policyProfile:input.policyProfile,approvedCapabilities:input.approvedCapabilities
    });
  }));

  server.registerTool('light_remote_run_signed_update', {
    title:'Run signed client update',
    description:'Queue the governed signed-update maintenance action on a Linux leaf. The device must grant sudo-on-demand and systemctl; signature/hash/health gates and rollback remain mandatory.',
    inputSchema:{ deviceId:id },
    annotations:annotations({ destructive:true })
  }, tracked('light_remote_run_signed_update', identity, async input => callOperatorJson('POST',
    `/v1/devices/${encodeURIComponent(input.deviceId)}/maintenance/update`, {})));

}
