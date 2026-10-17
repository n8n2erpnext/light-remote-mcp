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
  verifyAgentIngress,verifyOAuthClient,verifyBillingIngress,verifyUsageIngress}={}){
 if(!core||!team)throw Error('gold_http_pg_core_and_team_required');
 for(const [name,fn] of Object.entries({approveWallRequest,verifyAgentIngress,
   verifyOAuthClient,verifyBillingIngress,verifyUsageIngress})){
   if(typeof fn!=='function')throw Error('gold_http_trusted_ingress_missing_'+name);
 }
 const routes={
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
   const sessionToken=getToken(req),body=await readJson(req);
   return{status:200,data:await core.connectDevice({sessionToken,deviceId:body.deviceId})};
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
  const key=String(req.method||'GET').toUpperCase()+' '+url.pathname;
  const route=routes[key];
  if(!route){
   if(Object.keys(routes).some(x=>x.endsWith(' '+url.pathname))){
    json(res,405,{ok:false,error:'method_not_allowed'});return true;
   }
   return false;
  }
  try{
   const response=await route(req);
   json(res,response.status,{ok:true,...response.data});
  }catch(error){
   json(res,jsonStatus(error),{ok:false,error:error?.code&&jsonStatus(error)<500?
    error.code:'gold_http_backend_unavailable'});
  }
  return true;
 }
}
