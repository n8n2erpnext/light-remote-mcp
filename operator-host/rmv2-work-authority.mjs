// Called only after the enrolled signed channel and nonce have been verified.
// Short authorization snapshots never extend a grant's absolute expiry.
function authorizeRm(ctx,{sessions,accounts,requireDeviceConnection,targetRoute,accessGrants},now=Date.now(),requiredCapabilities=['desktop','desktop-input']){
  const {sessionId,agentId}=ctx.payload??{};
  if(typeof sessionId!=='string'||typeof agentId!=='string'||!agentId)throw Error('desktop_work_actor_required');
  const session=sessions.get(sessionId,agentId);
  if(!['active','hold'].includes(session.state)||session.deviceId!==ctx.device.deviceId||session.accountId!==ctx.binding.accountId)
    throw Error('desktop_work_session_denied');
  accounts.assertOperational(session.accountId);
  const connection=requireDeviceConnection(session.deviceId),route=targetRoute(session.nodeId,{accountId:session.accountId});
  if(route.deviceId!==session.deviceId||!requiredCapabilities.every(cap=>route.capabilities.includes(cap)))throw Error('desktop_work_capability_denied');
  const grant=accessGrants.activeGrantsForDevice(session.deviceId,connection.connectionId)
    .find(g=>g.agentId===agentId&&g.accountId===session.accountId&&String(g.purpose||'device')==='device');
  if(!grant)throw Error('desktop_work_grant_required');
  accessGrants.assert(grant.grantId,{deviceId:session.deviceId,connectionId:connection.connectionId,accountId:session.accountId,agentId,touch:false});
  const expiry=Math.min(Number(grant.expiresAt),Number(grant.absoluteExpiresAt??grant.expiresAt),Number(connection.hardExpiresAt));
  const validForMs=Math.min(1000,expiry-now);
  if(!(validForMs>0))throw Error('desktop_work_authority_expired');
  return {ok:true,authorized:true,sessionId,agentId,validForMs};
}

export function authorizeRmWork(ctx,deps,now=Date.now()){return authorizeRm(ctx,deps,now,['desktop','desktop-input']);}
export function authorizeRmVideo(ctx,deps,now=Date.now()){return authorizeRm(ctx,deps,now,['desktop']);}
