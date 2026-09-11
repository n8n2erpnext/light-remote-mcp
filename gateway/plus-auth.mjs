import crypto from 'node:crypto';

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

export function createPlusAuth(wallAuth, options = {}) {
  const requestAccess = options.requestAccess || (async () => { throw new Error('plus_access_request_unavailable'); });
  const pollAccess = options.pollAccess || (async () => { throw new Error('plus_access_poll_unavailable'); });
  const getAccessRequest = options.getAccessRequest || (async () => { throw new Error('plus_access_request_unavailable'); });
  const listAccessRequests = options.listAccessRequests || (async () => ({ pending:[] }));
  const assertGrant = options.assertGrant || (async () => { throw new Error('plus_access_grant_unavailable'); });

  function sessionFor(grant) {
    if (!grant?.grantId || !grant?.deviceId || !grant?.connectionId || !Number.isFinite(Number(grant?.expiresAt))) throw new Error('invalid_device_access_grant');
    const payload={sub:'owner',scope:'device-operator',grantId:grant.grantId,deviceId:grant.deviceId,connectionId:grant.connectionId,iat:Date.now(),exp:Number(grant.expiresAt),jti:crypto.randomUUID()};
    return {token:wallAuth.signOAuthToken('plus',payload),expiresAt:payload.exp,expiresInSeconds:Math.max(0,Math.ceil((payload.exp-Date.now())/1000)),scope:payload.scope,grantId:payload.grantId,deviceId:payload.deviceId,connectionId:payload.connectionId};
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
      if(!row)return res.status(404).type('html').send('<!doctype html><title>Light Remote MCP</title><p>Authorization request not found or expired.</p>');
      res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      return res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize ChatGPT Plus</title><style>:root{color-scheme:dark;font-family:system-ui;background:#080a0c;color:#e5e7eb}body{margin:0;padding:24px}.card{max-width:620px;margin:auto;border:1px solid #29313a;border-radius:14px;padding:22px;background:#0b0f13}.muted{color:#8b98a8}.code{font:700 24px ui-monospace,monospace;letter-spacing:.12em;color:#ffcc00}</style></head><body><main class="card"><h1>Approve on the selected device Wall</h1><p class="muted">Open that device's Light Remote Wall, go to <b>/approve</b>, enter this code, then choose Approve or Deny.</p><p>Request code</p><div class="code">${esc(row.userCode)}</div><p><b>Device:</b> ${esc(row.deviceId)}<br><b>Agent:</b> ${esc(row.agentId||'ChatGPT')}<br><b>Label:</b> ${esc(row.label||'ChatGPT Plus')}</p><p class="muted">Approval does not create or extend the device connection and does not set a session duration.</p></main></body></html>`);
    } catch(error){ return res.status(Number(error.status)||404).type('html').send('<!doctype html><title>Light Remote MCP</title><p>Authorization request not found or expired.</p>'); }
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

  return {begin,poll,list,page,requireSession,requireAgent,requireGrantedNode};
}
