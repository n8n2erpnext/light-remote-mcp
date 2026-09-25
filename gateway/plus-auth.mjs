import crypto from 'node:crypto';
import { brandFaviconSvg, brandTitleSvg } from './brand.mjs';

function safeId(value, pattern, name) {
  const text = String(value || '').trim();
  if (!pattern.test(text)) throw new Error(name);
  return text;
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function accessOf(value) { return value?.access || value; }
function grantOf(value) { return value?.grant || accessOf(value)?.grant || null; }
function pairingCode(value){const raw=String(value||'').trim().toUpperCase().replace(/-/g,'');if(!/^[A-Z2-9]{8}$/.test(raw))throw new Error('invalid_pairing_code');return `${raw.slice(0,4)}-${raw.slice(4)}`;}

function clientTokenFromRequest(req){
  const header=String(req.get?.('x-light-client')||req.headers?.['x-light-client']||'').trim();
  if(header)return {token:header,transport:'header'};
  const cookie=String(req.headers?.cookie||'');
  for(const part of cookie.split(';')){
    const i=part.indexOf('=');
    if(i<1)continue;
    const name=part.slice(0,i).trim();
    if(name!=='light_remote_client')continue;
    let value=part.slice(i+1).trim();
    try{value=decodeURIComponent(value);}catch{}
    if(value)return {token:value,transport:'cookie'};
  }
  return {token:'',transport:'missing'};
}

function brandedErrorPage(message){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${brandFaviconSvg()}<title>Light Remote MCP</title><style>:root{color-scheme:dark;font-family:system-ui;background:#080a0c;color:#e5e7eb}body{margin:0;min-height:100vh;display:grid;place-items:center}.card{width:min(520px,calc(100vw - 32px));border:1px solid #29313a;border-radius:14px;padding:22px;background:#0b0f13}.brand-title{display:flex;align-items:center;gap:12px;margin-bottom:12px}.brand-title>span{display:flex;align-items:baseline;gap:7px}.brand-title small{color:#8b98a8}.muted{color:#8b98a8}</style></head><body><main class="card">${brandTitleSvg(44)}<p class="muted">${esc(message)}</p></main></body></html>`;}

export function createPlusAuth(wallAuth, options = {}) {
  const requestAccess = options.requestAccess || (async () => { throw new Error('plus_access_request_unavailable'); });
  const pairAccess = options.pairAccess || (async () => { throw new Error('plus_pairing_unavailable'); });
  const attachClient = options.attachClient || (async () => { throw new Error('agent_client_unavailable'); });
  const listClientDevices = options.listClientDevices || (async () => { throw new Error('agent_client_unavailable'); });
  const resolveClientDevice = options.resolveClientDevice || (async () => { throw new Error('agent_client_unavailable'); });
  const ensureClientContext = options.ensureClientContext || (async () => { throw new Error('agent_client_context_unavailable'); });
  const pollAccess = options.pollAccess || (async () => { throw new Error('plus_access_poll_unavailable'); });
  const getAccessRequest = options.getAccessRequest || (async () => { throw new Error('plus_access_request_unavailable'); });
  const listAccessRequests = options.listAccessRequests || (async () => ({ pending:[] }));
  const assertGrant = options.assertGrant || (async () => { throw new Error('plus_access_grant_unavailable'); });

  function sessionFor(grant) {
    if (!grant?.grantId || !grant?.deviceId || !grant?.connectionId || !Number.isFinite(Number(grant?.expiresAt))) throw new Error('invalid_device_access_grant');
    const payload={sub:'owner',scope:'device-operator',grantId:grant.grantId,deviceId:grant.deviceId,connectionId:grant.connectionId,iat:Date.now(),exp:Number(grant.expiresAt),jti:crypto.randomUUID()};
    return {token:wallAuth.signOAuthToken('plus',payload),expiresAt:payload.exp,expiresInSeconds:Math.max(0,Math.ceil((payload.exp-Date.now())/1000)),scope:payload.scope,grantId:payload.grantId,deviceId:payload.deviceId,connectionId:payload.connectionId};
  }
  function clientTokenFor(client) {
    if(!client?.clientSessionId||!client?.agentId||!Number.isFinite(Number(client?.expiresAt)))throw new Error('invalid_agent_client');
    const payload={scope:'agent-client',clientSessionId:client.clientSessionId,agentId:client.agentId,iat:Date.now(),exp:Number(client.expiresAt),jti:crypto.randomUUID()};
    return wallAuth.signOAuthToken('client',payload);
  }
  function clientRefFor(client) {
    if(!client?.clientSessionId||!client?.agentId)throw new Error('invalid_agent_client');
    return typeof wallAuth.mintClientRef==='function'?wallAuth.mintClientRef({clientSessionId:client.clientSessionId,agentId:client.agentId}):clientTokenFor(client);
  }
  function inspectClientContext(token){
    const raw=String(token||'');
    if(!raw)return {context:null,reason:'missing'};
    if(raw.startsWith('lr1.')&&typeof wallAuth.inspectClientRef==='function'){
      const inspected=wallAuth.inspectClientRef(raw);
      if(!inspected?.ok)return {context:null,reason:`ref_${inspected?.reason||'invalid'}`};
      return {context:{scope:'agent-client',clientSessionId:inspected.clientSessionId,agentId:inspected.agentId},reason:'valid_ref'};
    }
    const inspected=typeof wallAuth.inspectOAuthToken==='function'?wallAuth.inspectOAuthToken('client',raw):null;
    const value=inspected?(inspected.ok?inspected.payload:null):wallAuth.verifyOAuthToken('client',raw);
    if(!value)return {context:null,reason:inspected?.reason||'invalid'};
    if(value.scope!=='agent-client')return {context:null,reason:'scope'};
    if(!value.clientSessionId)return {context:null,reason:'missing_client_id'};
    if(!value.agentId)return {context:null,reason:'missing_agent_id'};
    return {context:value,reason:'valid'};
  }
  function clientContext(token){return inspectClientContext(token).context;}
  async function connectBegin(req,res){
    try{
      const body=req.body||{},aCode=pairingCode(body.aCode),agentId=safeId(body.agentId,/^[A-Za-z0-9._:-]{16,128}$/,'invalid_plus_agent_id'),label=String(body.label||'ChatGPT').trim().slice(0,120);
      let existing=null;if(body.client){existing=clientContext(body.client);if(!existing)return res.status(401).json({ok:false,status:'need_a_code',error:'agent_client_invalid'});if(existing.agentId!==agentId)return res.status(403).json({ok:false,status:'need_a_code',error:'agent_client_agent_mismatch'});}
      const result=accessOf(await pairAccess({aCode,agentId,label})),row=result?.request;
      if(result?.state!=='pending'||!row?.requestId||!result?.pollToken)throw new Error('invalid_pairing_access_request');
      const exp=Number(row.expiresAt),payload={scope:'device-pairing-continuation',requestId:row.requestId,pollToken:result.pollToken,agentId,clientSessionId:existing?.clientSessionId||null,iat:Date.now(),exp,jti:crypto.randomUUID()};
      return res.status(201).json({ok:true,status:'approval_required',code:row.userCode,continuation:wallAuth.signOAuthToken('pair',payload),expiresInSeconds:Math.max(0,Math.ceil((exp-Date.now())/1000))});
    }catch(error){const missing=['pairing_code_not_found','pairing_code_expired','invalid_pairing_code'].includes(error.message);return res.status(Number(error.status)||400).json({ok:false,status:missing?'need_a_code':'error',error:error.message||'pairing_failed'});}
  }
  async function connectPoll(req,res){
    try{
      const ctx=wallAuth.verifyOAuthToken('pair',String(req.body?.continuation||''));
      if(!ctx||ctx.scope!=='device-pairing-continuation'||!ctx.requestId||!ctx.pollToken||!ctx.agentId)return res.status(401).json({ok:false,status:'approval_expired',error:'pairing_continuation_required'});
      const result=accessOf(await pollAccess({requestId:ctx.requestId,pollToken:ctx.pollToken}));
      if(result?.state!=='approved')return res.status(202).json({ok:true,status:'approval_required',expiresInSeconds:Math.max(0,Math.ceil(((result?.request?.expiresAt)||Date.now())-Date.now())/1000)});
      const grant=grantOf(result),attached=await attachClient({clientSessionId:ctx.clientSessionId||null,agentId:ctx.agentId,grantId:grant.grantId,pairingRequestId:ctx.requestId}),client=attached?.client,device=attached?.device||{};
      const contextValue=await ensureClientContext({clientSessionId:client.clientSessionId,agentId:client.agentId,deviceId:device.deviceId||grant.deviceId,workspace:'',gracePreset:'60m'});
      return res.status(200).json({ok:true,status:'ready',device:device.displayName||device.deviceId||grant.deviceId,client:clientRefFor(client),context:contextValue?.context||null});
    }catch(error){const denied=error.message==='plus_authorization_denied',expired=['plus_authorization_expired','agent_client_expired'].includes(error.message);return res.status(Number(error.status)||400).json({ok:false,status:expired?'approval_expired':denied?'access_revoked':'error',error:error.message||'pairing_failed'});}
  }
  async function connectRecover(req,res){
    try{
      const requestId=safeId(req.body?.requestId,/^pa_[A-Za-z0-9_-]{20,80}$/,'invalid_plus_request_id');
      const pollToken=safeId(req.body?.pollToken,/^[A-Za-z0-9_-]{32,128}$/,'invalid_plus_poll_token');
      const result=accessOf(await pollAccess({requestId,pollToken}));
      if(result?.state!=='approved')return res.status(202).json({ok:true,status:'approval_required',expiresInSeconds:Math.max(0,Math.ceil(((result?.request?.expiresAt)||Date.now())-Date.now())/1000)});
      const infoValue=await getAccessRequest(requestId),row=infoValue?.authorization||infoValue;
      if(!row?.agentId)throw new Error('pairing_recovery_agent_missing');
      const grant=grantOf(result),attached=await attachClient({clientSessionId:null,agentId:row.agentId,grantId:grant.grantId,pairingRequestId:requestId}),client=attached?.client,device=attached?.device||{};
      const contextValue=await ensureClientContext({clientSessionId:client.clientSessionId,agentId:client.agentId,deviceId:device.deviceId||grant.deviceId,workspace:'',gracePreset:'60m'});
      return res.status(200).json({ok:true,status:'ready',device:device.displayName||device.deviceId||grant.deviceId,client:clientRefFor(client),context:contextValue?.context||null,recovered:true});
    }catch(error){const denied=error.message==='plus_authorization_denied',expired=['plus_authorization_expired','agent_client_expired'].includes(error.message);return res.status(Number(error.status)||400).json({ok:false,status:expired?'approval_expired':denied?'access_revoked':'error',error:error.message||'pairing_recovery_failed'});}
  }
  async function requireClient(req,res,next){
    const credential=clientTokenFromRequest(req),inspection=inspectClientContext(credential.token),ctx=inspection.context;
    if(!ctx){
      const token=String(credential.token||''),traceId=String(req.get?.('x-light-trace')||req.headers?.['x-light-trace']||'').slice(0,80);
      console.warn(JSON.stringify({event:'agent_client_rejected',traceId:traceId||null,transport:credential.transport,clientFingerprint:token?crypto.createHash('sha256').update(token).digest('hex').slice(0,16):null,clientLength:token.length,reason:inspection.reason}));
      return res.status(401).json({ok:false,error:'agent_client_required',detail:credential.token?'invalid':'missing'});
    }
    req.plusClient=ctx;req.plusClientTransport=credential.transport;return next();
  }
  async function listDevices(req,res){
    try{const value=await listClientDevices(req.plusClient.clientSessionId,req.plusClient.agentId);return res.json({ok:true,devices:(value?.devices||[]).map(d=>({id:d.deviceId,name:d.name||d.deviceId,state:d.state||'unknown'}))});}
    catch(error){return res.status(Number(error.status)||401).json({ok:false,error:error.message||'agent_client_required'});}
  }
  async function workingContext(req,res){
    try{
      const body=req.body||{},deviceId=body.deviceId==null||body.deviceId===''?null:safeId(body.deviceId,/^[A-Za-z0-9._:-]{1,128}$/,'invalid_plus_device_id');
      const workspace=body.workspace==null?null:String(body.workspace||'').slice(0,512),gracePreset=String(body.gracePreset||'60m').toLowerCase();
      if(!['15m','30m','45m','60m'].includes(gracePreset))throw new Error('invalid_session_grace_preset');
      const value=await ensureClientContext({clientSessionId:req.plusClient.clientSessionId,agentId:req.plusClient.agentId,deviceId,workspace,gracePreset});
      return res.json(value);
    }catch(error){return res.status(Number(error.status)||400).json({ok:false,error:error.message||'agent_client_context_failed'});}
  }
  async function requireClientDevice(req,res,next){
    try{const deviceId=safeId(req.body?.deviceId??req.query?.deviceId,/^[A-Za-z0-9._:-]{1,128}$/,'invalid_plus_device_id');const value=await resolveClientDevice({clientSessionId:req.plusClient.clientSessionId,agentId:req.plusClient.agentId,deviceId});req.plusClientDevice=value;req.plusClientDeviceId=deviceId;return next();}
    catch(error){return res.status(Number(error.status)||403).json({ok:false,error:error.message||'agent_client_device_not_authorized'});}
  }

  async function begin(req, res) {
    try {
      const body=req.body||{};
      const agentId=safeId(body.agentId,/^[A-Za-z0-9._:-]{16,128}$/,'invalid_plus_agent_id');
      const deviceId=safeId(body.deviceId,/^[A-Za-z0-9._:-]{1,128}$/,'invalid_plus_device_id');
      const label=String(body.label||'ChatGPT Plus').trim().slice(0,120);
      const result=accessOf(await requestAccess({agentId,deviceId,label}));
      if(result?.state==='approved')return res.status(200).json({ok:true,status:'approved',session:sessionFor(grantOf(result))});
      const row=result?.request;
      if(!row?.requestId||!result?.pollToken)throw new Error('invalid_plus_access_request');
      return res.status(201).json({ok:true,status:'pending',authorization:{requestId:row.requestId,deviceId:row.deviceId,agentId,label,userCode:row.userCode,pollToken:result.pollToken,expiresInSeconds:Math.max(0,Math.ceil((row.expiresAt-Date.now())/1000)),approvalSurface:'device-wall-code',approvalPath:'/approve'}});
    } catch(error) { return res.status(Number(error.status)||400).json({ok:false,error:error.message||'plus_authorization_failed'}); }
  }

  async function poll(req, res) {
    try {
      const body=req.body||{};
      const requestId=safeId(body.requestId,/^pa_[A-Za-z0-9_-]{20,80}$/,'invalid_plus_request_id');
      const pollToken=safeId(body.pollToken,/^[A-Za-z0-9_-]{32,128}$/,'invalid_plus_poll_token');
      const result=accessOf(await pollAccess({requestId,pollToken}));
      if(result?.state!=='approved')return res.status(202).json({ok:true,status:'pending',expiresInSeconds:Math.max(0,Math.ceil(((result?.request?.expiresAt)||Date.now())-Date.now())/1000)});
      return res.status(200).json({ok:true,status:'approved',session:sessionFor(grantOf(result))});
    } catch(error) { return res.status(Number(error.status)||400).json({ok:false,error:error.message||'plus_authorization_failed'}); }
  }
  async function list(_req,res){
    try { const value=await listAccessRequests(); return res.json({ok:true,pending:value?.pending||[]}); }
    catch(error){ return res.status(Number(error.status)||400).json({ok:false,error:error.message||'plus_authorization_failed'}); }
  }

  async function page(req,res){
    try {
      const id=safeId(req.query.id,/^pa_[A-Za-z0-9_-]{20,80}$/,'invalid_plus_request_id');
      const value=await getAccessRequest(id),row=value?.authorization||value;
      if(!row)return res.status(404).type('html').send(brandedErrorPage('Authorization request not found or expired.'));
      res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      return res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${brandFaviconSvg()}<title>Authorize ChatGPT Plus</title><style>:root{color-scheme:dark;font-family:system-ui;background:#080a0c;color:#e5e7eb}body{margin:0;padding:24px}.card{max-width:620px;margin:auto;border:1px solid #29313a;border-radius:14px;padding:22px;background:#0b0f13}.brand-title{display:flex;align-items:center;gap:12px;margin-bottom:10px}.brand-title>span{display:flex;align-items:baseline;gap:7px}.brand-title strong{font-size:20px;color:#f3f4f6}.brand-title small{font-size:10px;letter-spacing:.16em;color:#8b98a8}.brand-mark{flex:0 0 auto}.muted{color:#8b98a8}.code{font:700 24px ui-monospace,monospace;letter-spacing:.12em;color:#ffcc00}</style></head><body><main class="card">${brandTitleSvg(44)}<h1>Approve on the selected device Wall</h1><p class="muted">Open that device's Light Remote Wall, go to <b>/approve</b>, enter this code, then choose Approve or Deny.</p><p>Request code</p><div class="code">${esc(row.userCode)}</div><p><b>Device:</b> ${esc(row.deviceId)}<br><b>Agent:</b> ${esc(row.agentId||'ChatGPT')}<br><b>Label:</b> ${esc(row.label||'ChatGPT Plus')}</p><p class="muted">Approval does not create or extend the device connection and does not set a session duration.</p></main></body></html>`);
    } catch(error){ return res.status(Number(error.status)||404).type('html').send(brandedErrorPage('Authorization request not found or expired.')); }
  }
  async function requireSession(req,res,next){
    try {
      const token=String(req.get('x-plus-session')||'');
      const value=token?wallAuth.verifyOAuthToken('plus',token):null;
      if(!value||value.scope!=='device-operator'||!value.grantId||!value.deviceId||!value.connectionId||value.exp<=Date.now())return res.status(401).json({ok:false,error:'plus_session_required'});
      const asserted=await assertGrant(value.grantId),grant=grantOf(asserted)||asserted?.grant||asserted;
      if(!grant||grant.grantId!==value.grantId||grant.deviceId!==value.deviceId||grant.connectionId!==value.connectionId)return res.status(401).json({ok:false,error:'plus_device_grant_invalid'});
      req.plusIdentity={...value,nodeId:asserted?.device?.nodeId||null,grant};
      return next();
    } catch(error){ return res.status(Number(error.status)||401).json({ok:false,error:error.message||'plus_session_required'}); }
  }

  function requireAgent(req,res,next){
    const actual=String(req.body?.agentId??req.query?.agentId??'').trim();
    if(!/^[A-Za-z0-9._:-]{16,128}$/.test(actual))return res.status(400).json({ok:false,error:'invalid_plus_agent_id'});
    req.plusAgentId=actual;
    return next();
  }

  function requireGrantedNode(req,res,next){
    const requested=String(req.body?.nodeId??req.query?.nodeId??'').trim();
    const expected=String(req.plusIdentity?.nodeId||'').trim();
    if(requested&&expected&&requested!==expected)return res.status(403).json({ok:false,error:'plus_device_grant_target_mismatch'});
    if(!requested&&expected&&req.body&&typeof req.body==='object')req.body={...req.body,nodeId:expected};
    return next();
  }

  return {connectBegin,connectPoll,connectRecover,requireClient,listDevices,workingContext,requireClientDevice,begin,poll,list,page,requireSession,requireAgent,requireGrantedNode};
}
