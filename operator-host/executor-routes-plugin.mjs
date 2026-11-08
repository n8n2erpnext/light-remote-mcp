function cleanId(value,name='account_id'){
  const out=String(value||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(out)) throw new Error(`invalid_${name}`);
  return out;
}
function pluginAccount(deps,raw){
  const accountId=cleanId(raw,'account_id');
  return deps.accounts.account(accountId);
}
function ownedSession(deps,{accountId,sessionId,agentId}){
  const account=pluginAccount(deps,accountId);
  const session=deps.sessions.get(cleanId(sessionId,'session_id'),agentId);
  if(session.accountId!==account.accountId) throw new deps.AccountError('plugin_session_account_mismatch',403);
  return {account,session};
}
export async function handlePluginRoutes(req,res,url,deps){
  // Diagnostic-only owner/Agent read. Resolve the exact active A/B grant
  // server-side: the plugin cannot select another account's device. No
  // command or resource claim is dispatched and this can NEVER release M4.
  const boot=url.pathname.match(/^\/v1\/plugin\/accounts\/([A-Za-z0-9._:-]+)\/devices\/([A-Za-z0-9._:-]+)\/boot-evidence$/);
  if(req.method==='GET'&&boot){
    const account=pluginAccount(deps,boot[1]);
    const agentId=cleanId(url.searchParams.get('agentId'),'agent_id');
    const clientSessionId=cleanId(url.searchParams.get('clientSessionId'),'client_session_id');
    const binding=deps.agentClients.resolve(clientSessionId,{agentId,deviceId:boot[2],touch:false});
    if(binding.accountId!==account.accountId||binding.deviceId!==boot[2])
      throw new deps.AccountError('plugin_boot_device_scope_denied',403);
    const device=deps.devices.get(boot[2]);
    if(device.accountId!==account.accountId||device.state==='revoked')
      throw new deps.AccountError('plugin_boot_device_scope_denied',403);
    if(!deps.deviceBootObservations)
      throw new deps.AccountError('boot_observation_store_unavailable',503);
    const diagnostic=await deps.deviceBootObservations.inspect({
      accountId:account.accountId,deviceId:device.deviceId});
    return deps.sendJson(res,200,{ok:true,deviceId:device.deviceId,
      ...diagnostic,recoveryAuthorization:'not_authorized_by_boot_telemetry'});
  }
  if(req.method==='POST'&&url.pathname==='/v1/plugin/sessions/open'){
    const body=await deps.readJson(req),account=pluginAccount(deps,body.accountId),route=deps.targetRoute(body.nodeId,{accountId:account.accountId});
    const session=deps.sessions.open({accountId:account.accountId,openId:body.openId,agentId:body.agentId,label:body.label,workspace:body.workspace,graceMs:body.graceMs,gracePreset:body.gracePreset,leaseMs:body.leaseMs,leasePreset:body.leasePreset,nodeId:route.nodeId,deviceId:route.deviceId,maxActiveForNode:route.sessionCeiling,maxActiveForAccount:deps.planEntitlements(account).sessionLimit??null});
    return deps.sendJson(res,200,{ok:true,route,session});
  }
  if(req.method==='GET'&&url.pathname==='/v1/plugin/sessions'){
    const account=pluginAccount(deps,url.searchParams.get('accountId'));
    const rows=deps.sessions.list().filter(row=>row.accountId===account.accountId);
    return deps.sendJson(res,200,{ok:true,accountId:account.accountId,sessions:rows});
  }
  const match=url.pathname.match(/^\/v1\/plugin\/sessions\/([A-Za-z0-9._:-]+)(?:\/(resume|hold|close|touch))?$/);
  if(!match) return false;
  const sessionId=match[1],action=match[2]||'get';
  const body=req.method==='POST'?await deps.readJson(req):{};
  const accountId=body.accountId||url.searchParams.get('accountId');
  const agentId=body.agentId||url.searchParams.get('agentId');
  const ctx=ownedSession(deps,{accountId,sessionId,agentId});
  if(req.method==='GET'&&action==='get') return deps.sendJson(res,200,{ok:true,session:ctx.session});
  if(req.method==='POST'&&action==='resume') return deps.sendJson(res,200,{ok:true,session:deps.sessions.resume(sessionId,agentId)});
  if(req.method==='POST'&&action==='hold') return deps.sendJson(res,200,{ok:true,session:deps.sessions.hold(sessionId,agentId,body.reason||'transport_lost')});
  if(req.method==='POST'&&action==='close') return deps.sendJson(res,200,{ok:true,session:deps.sessions.close(sessionId,agentId)});
  if(req.method==='POST'&&action==='touch') return deps.sendJson(res,200,{ok:true,session:deps.sessions.touch(sessionId,agentId,body.action||'tool')});
  return false;
}
