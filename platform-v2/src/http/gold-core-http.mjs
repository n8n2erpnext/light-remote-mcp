/**
 * HTTP adapter for the independent Gold PostgreSQL Core.
 * Zero JSON/SQLite or legacy registry dependency. No automatic mounting into
 * the old Operator. The entire authenticated API must move together.
 *
 * Externally privileged actions require verified database-backed sessions,
 * and private jobs/Paddle/Wall actions require trusted ingress callbacks.
 */
const json=(res,status,body)=>{
  if(res.headersSent)return;
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff'});
  res.end(JSON.stringify(body));
};
const fail=(code,status=403)=>Object.assign(new Error(code),{code,status});
const MAX_BYTES=32768;
const readJson=async req=>{
  const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(type!=='application/json')throw fail('gold_http_json_required',415);
  let bytes=0,chunks=[];
  for await(const chunk of req){
    bytes+=chunk.length;if(bytes>MAX_BYTES)throw fail('gold_http_body_too_large',413);
    chunks.push(chunk);
  }
  const data=Buffer.concat(chunks).toString('utf8');
  try{
    const value=JSON.parse(data);
    if(!value||typeof value!=='object'||Array.isArray(value))
      throw new Error('not-object');
    return value;
  }catch{throw fail('gold_http_json_invalid',400)}
};
const getToken=req=>{
  const h=String(req.headers.authorization||'');
  const match=/^Bearer ([A-Za-z0-9_-]{20,256})$/.exec(h);
  if(!match)throw fail('gold_http_bearer_required',401);
  return match[1];
};
const jsonStatus=e=>Number.isInteger(e?.status)&&e.status>=400&&e.status<500?e.status:503;

export function createGoldCoreHttpHandler({core,team,approveWallRequest,
  verifyAgentIngress,verifyOAuthClient,verifyBillingIngress,verifyUsageIngress,verifyDeviceChannelIngress,verifyNotificationAdmin,agentClients,remoteSessions,deviceChannel,notifications,accountEntitlements}={}){
 if(!core||!team)throw Error('gold_http_pg_core_and_team_required');
 if(accountEntitlements&&typeof accountEntitlements.view!=='function')
  throw Error('gold_http_account_entitlement_authority_invalid');
 if(notifications&&['inbox','markRead','list','publish','cancel'].some(name=>
  typeof notifications[name]!=='function'))
  throw Error('gold_http_pg_notification_authority_invalid');
 if(deviceChannel&&(['connect','renew','disconnect','setGrace'].some(
  action=>typeof deviceChannel[action]!=='function')||
  typeof verifyDeviceChannelIngress!=='function'))
  throw Error('gold_http_signed_device_channel_required');
 if(remoteSessions&&typeof remoteSessions.context!=='function')
  throw Error('gold_http_remote_session_authority_invalid');
 if(agentClients&&['attach','resolve','findActive','listDevices'].some(
  name=>typeof agentClients[name]!=='function'))
  throw Error('gold_http_agent_authority_invalid');
 for(const [name,fn] of Object.entries({approveWallRequest,verifyAgentIngress,
   verifyOAuthClient,verifyBillingIngress,verifyUsageIngress})){
   if(typeof fn!=='function')throw Error('gold_http_trusted_ingress_missing_'+name);
 }
 const notificationAdmin=async req=>{
  if(typeof verifyNotificationAdmin!=='function')
   throw fail('gold_notification_admin_verifier_not_configured',503);
  const principal=await verifyNotificationAdmin(req);
  if(principal?.authorized!==true||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(String(principal.adminAccountId||'')))
   throw fail('gold_notification_admin_unverified',401);
  return principal.adminAccountId;
 };
 const routes={
  ...(accountEntitlements?{
   'GET /v1/accounts/entitlements':async req=>({status:200,
    data:await accountEntitlements.view({sessionToken:getToken(req)})})
  }:{}),
  ...(notifications?{
   'GET /v1/accounts/notifications':async req=>{
    const account=await core.authenticate(getToken(req));
    return {status:200,data:await notifications.inbox(account.accountId,account)};
   },
   'POST /v1/accounts/notifications/read':async req=>{
    const account=await core.authenticate(getToken(req));
    const body=await readJson(req);
    return {status:200,data:await notifications.markRead(
     account.accountId,body.notificationId,account)};
   },
   'GET /v1/admin/notifications':async req=>{
    await notificationAdmin(req);
    return {status:200,data:await notifications.list()};
   },
   'POST /v1/admin/notifications/publish':async req=>{
    const adminAccountId=await notificationAdmin(req);
    const body=await readJson(req);
    return {status:201,data:{notification:await notifications.publish({
     ...body,publishedBy:adminAccountId})}};
   },
   'POST /v1/admin/notifications/:id/cancel':async(req,notificationId)=>{
    const adminAccountId=await notificationAdmin(req);
    return {status:200,data:{notification:await notifications.cancel(notificationId,
     {by:adminAccountId})}};
   }
  }:{}),
  ...(deviceChannel?Object.fromEntries([
   ['connect','connect'],['renew','renew'],['disconnect','disconnect'],
   ['grace','setGrace']].map(([action,fn])=>[
    'POST /v1/device-channel/'+action,async req=>{
     const body=await readJson(req);
     // The only accepted device/channel identity is issued by the private
     // host verifier and independently validated by the channel authority.
     // Body-provided owner/account/device/lease fields never reach SQL.
     const principal=await verifyDeviceChannelIngress({req,body,purpose:action});
     if(principal?.authorized!==true||!principal.signedEnvelope)
      throw fail('gold_channel_trusted_ingress_required',401);
     return{status:200,data:{connection:await deviceChannel[fn]({
      signedEnvelope:principal.signedEnvelope})}};
    }
   ])):{}),
  'POST /v1/accounts/register':async(req)=>{
   const body=await readJson(req);
   const account=await core.registerVerifiedAccount({
    accountId:body.accountId,email:body.email,password:body.password,
    proof:body.emailChallenge
   });
   return {status:201,data:{account}};
  },
  'POST /v1/accounts/login':async(req)=>{
   const body=await readJson(req);
   const data=await core.login({email:body.email,password:body.password});
   return{status:200,data};
  },
  'GET /v1/accounts/me':async(req)=>{
   return{status:200,data:{account:await core.authenticate(getToken(req))}};
  },
  'POST /v1/accounts/logout':async(req)=>{
   return{status:200,data:await core.logout(getToken(req))};
  },
  'POST /v1/devices/register':async(req)=>{
   const sessionToken=getToken(req),body=await readJson(req);
   return{status:201,data:{device:await core.registerDevice({
    sessionToken,deviceId:body.deviceId,nodeId:body.nodeId,
    publicIdentityKey:body.publicIdentityKey,displayName:body.displayName,
    platform:body.platform,architecture:body.architecture,
    agentVersion:body.agentVersion,proof:body.deviceIdentityProof
   })}};
  },
  'POST /v1/devices/connect':async(req)=>{
   // Reject legacy account-bearer connection minting. Owning an account is
   // NOT proof that the physical device is online or has signed a channel
   // challenge. Only /v1/device-channel/connect may create a live lease.
   await core.authenticate(getToken(req));
   throw fail('gold_signed_device_channel_required',403);
  },
  'POST /v1/team/create':async(req)=>{
   const sessionToken=getToken(req),body=await readJson(req);
   return{status:201,data:await team.createTeam({sessionToken,proof:body.ownerChallenge})};
  },
  'POST /v1/team/invite':async(req)=>{
   const sessionToken=getToken(req),body=await readJson(req);
   return{status:201,data:await team.inviteMember({sessionToken,teamId:body.teamId,
    recipientEmail:body.recipientEmail,proof:body.ownerChallenge})};
  },
  'POST /v1/team/accept':async(req)=>{
   const sessionToken=getToken(req),body=await readJson(req);
   return{status:200,data:await team.acceptInvite({sessionToken,inviteCode:body.inviteCode})};
  },
  'POST /v1/team/share-device':async(req)=>{
   const sessionToken=getToken(req),body=await readJson(req);
   return{status:200,data:await team.shareDevice({sessionToken,teamId:body.teamId,
    deviceId:body.deviceId,proof:body.ownerChallenge})};
  },
  'POST /v1/team/remove-member':async(req)=>{
   const sessionToken=getToken(req),body=await readJson(req);
   return{status:200,data:await team.removeMember({sessionToken,teamId:body.teamId,
    memberAccountId:body.memberAccountId,proof:body.ownerChallenge})};
  },
  ...(remoteSessions?{
   'POST /v1/agent-client/context':async(req)=>{
    const principal=await verifyAgentIngress(req);
    if(!principal||typeof principal.agentId!=='string'||!principal.agentProof)
     throw fail('gold_agent_ingress_unverified',401);
    const body=await readJson(req);
    return{status:200,data:await remoteSessions.context({
     clientSessionId:body.clientSessionId,deviceId:body.deviceId||null,
     workspace:body.workspace??null,gracePreset:body.gracePreset??null,
     agentId:principal.agentId,agentProof:principal.agentProof})};
   }
  }:{}),
  ...(agentClients?{
   // The legacy Plugin looks up its durable Agent session before requesting
   // another A/B pairing. Identity is never accepted from query parameters.
   'GET /v1/agent-client/by-agent':async(req)=>{
    const principal=await verifyAgentIngress(req);
    if(!principal||typeof principal.agentId!=='string'||!principal.agentProof)
     throw fail('gold_agent_ingress_unverified',401);
    return{status:200,data:await agentClients.findActive({
     agentId:principal.agentId,agentProof:principal.agentProof})};
   },
   'GET /v1/agent-client/:session/devices':async(req,session)=>{
    const principal=await verifyAgentIngress(req);
    if(!principal||typeof principal.agentId!=='string'||!principal.agentProof)
     throw fail('gold_agent_ingress_unverified',401);
    return{status:200,data:await agentClients.listDevices({
     clientSessionId:session,agentId:principal.agentId,
     agentProof:principal.agentProof})};
   },
   'POST /v1/agent-client/attach':async(req)=>{
    const principal=await verifyAgentIngress(req);
    if(!principal||typeof principal.agentId!=='string'||!principal.agentProof)
     throw fail('gold_agent_ingress_unverified',401);
    const body=await readJson(req);
    return{status:200,data:await agentClients.attach({
     grantId:body.grantId,clientSessionId:body.clientSessionId||null,
     pairingRequestId:body.pairingRequestId||null,
     agentId:principal.agentId,agentProof:principal.agentProof})};
   },
   'POST /v1/agent-client/resolve':async(req)=>{
    const principal=await verifyAgentIngress(req);
    if(!principal||typeof principal.agentId!=='string'||!principal.agentProof)
     throw fail('gold_agent_ingress_unverified',401);
    const body=await readJson(req);
    return{status:200,data:await agentClients.resolve({
     clientSessionId:body.clientSessionId,deviceId:body.deviceId||null,
     agentId:principal.agentId,agentProof:principal.agentProof})};
   }
  }:{}),
  'POST /v1/pairing/request':async(req)=>{
   const principal=await verifyAgentIngress(req);
   if(!principal||typeof principal.agentId!=='string'||!principal.agentProof)
    throw fail('gold_agent_ingress_unverified',401);
   const body=await readJson(req);
   return{status:201,data:await core.requestPairing({
    connectionId:body.connectionId,purpose:body.purpose,
    agentId:principal.agentId,agentProof:principal.agentProof})};
  },
  'POST /v1/pairing/poll':async(req)=>{
   const principal=await verifyAgentIngress(req);
   if(!principal||typeof principal.agentId!=='string'||!principal.agentProof)
    throw fail('gold_agent_ingress_unverified',401);
   const body=await readJson(req);
   return{status:200,data:await core.pollPairing({
    pollToken:body.pollToken,agentId:principal.agentId,
    agentProof:principal.agentProof})};
  },
  'POST /v1/pairing/approve':async(req)=>{
   const wallContext=await approveWallRequest(req);
   if(!wallContext||wallContext.authorized!==true)
    throw fail('gold_wall_approval_unverified',401);
   const body=await readJson(req);
   return{status:200,data:await core.approvePairing({
    requestId:body.requestId,approvalCode:body.approvalCode,wallContext})};
  },
  'POST /v1/oauth/token/consume':async(req)=>{
   const client=await verifyOAuthClient(req);
   if(!client||client.authorized!==true)
    throw fail('gold_oauth_client_unverified',401);
   const body=await readJson(req);
   return{status:200,data:await core.consumeOAuth({
    purpose:body.purpose,token:body.token,clientId:client.clientId})};
  },
  'POST /v1/billing/paddle/webhook':async(req)=>{
   const ingress=await verifyBillingIngress(req);
   if(!ingress||ingress.authorized!==true||!ingress.payload||!ingress.signature)
    throw fail('gold_paddle_ingress_unverified',401);
   return{status:200,data:await core.ingestPaddle({
    payload:ingress.payload,signature:ingress.signature})};
  },
  'POST /v1/internal/usage/charge':async(req)=>{
   const ingress=await verifyUsageIngress(req);
   if(!ingress||ingress.authorized!==true||!ingress.signedEvent)
    throw fail('gold_usage_ingress_unverified',401);
   return{status:200,data:await team.chargeToolCall({signedEvent:ingress.signedEvent})};
  }
 };
 // Privileged paths MUST be mounted only on the trusted local Operator socket;
 // verifier callbacks authenticate the caller/channel and never accept a
 // self-asserted `approved:true` from a public HTTP request body.
 return async function handleGoldCoreHttp(req,res){
  const url=new URL(req.url||'/', 'http://gold.operator.local');
  if(!url.pathname.startsWith('/v1/'))return false;
  const method=String(req.method||'GET').toUpperCase();
  const deviceMatch=/^\/v1\/agent-client\/(lrc_[A-Za-z0-9_-]+)\/devices$/.exec(url.pathname);
  const notificationMatch=/^\/v1\/admin\/notifications\/(sys_[0-9a-f-]{36})\/cancel$/.exec(url.pathname);
  const key=deviceMatch
   ?method+' /v1/agent-client/:session/devices'
   :notificationMatch
   ?method+' /v1/admin/notifications/:id/cancel'
   :method+' '+url.pathname;
  const route=routes[key];
  if(!route){
   if((deviceMatch&&agentClients)||(notificationMatch&&notifications)||
    Object.keys(routes).some(x=>x.endsWith(' '+url.pathname))){
    json(res,405,{ok:false,error:'method_not_allowed'});return true;
   }
   return false;
  }
  try{
   const response=await route(req,deviceMatch?.[1]||notificationMatch?.[1]||null);
   json(res,response.status,{ok:true,...response.data});
  }catch(error){
   json(res,jsonStatus(error),{ok:false,error:error?.code&&jsonStatus(error)<500?
    error.code:'gold_http_backend_unavailable'});
  }
  return true;
 }
}
