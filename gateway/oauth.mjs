import crypto from 'node:crypto';
import express from 'express';

const ACCESS_TTL_SECONDS = 3600;
const CODE_TTL_MS = 2 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function publicOrigin() {
  const raw=String(process.env.MCP_PUBLIC_ORIGIN || 'https://mcp.dashboard.thaiduy.store').replace(/\/$/,'');
  const url=new URL(raw);
  if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('mcp_public_origin_must_be_https');
  return url.origin;
}
function redirectAllowed(uri) {
  try {
    const u=new URL(uri);
    return u.protocol==='https:' || (u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname));
  } catch { return false; }
}
function parseScope(value) {
  const allowed=new Set(['mcp:operator','offline_access']);
  const out=String(value||'mcp:operator offline_access').split(/\s+/).filter(Boolean);
  return [...new Set(out.filter(v=>allowed.has(v)))];
}
function pkceS256(verifier) {
  return crypto.createHash('sha256').update(String(verifier||'')).digest('base64url');
}
function consentHtml(params,message='') {
  const hidden=Object.entries(params).map(([k,v])=>`<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('');
  const error=message?`<div class="err">${escapeHtml(message)}</div>`:'';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Light Remote MCP authorization</title><style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui;background:#090b0e;color:#e5e7eb}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center}.card{width:min(460px,calc(100vw - 32px));border:1px solid #2b3139;border-radius:16px;background:#10141a;padding:24px}.muted{color:#98a2b3}.err{color:#ffaaaa;margin:12px 0}label{display:block;margin:14px 0}input,button{width:100%;padding:11px;border-radius:8px;border:1px solid #303844;background:#0b0f14;color:#e5e7eb;font:inherit}button{cursor:pointer;background:#1d4ed8;border-color:#1d4ed8;margin-top:8px}</style></head><body><main class="card"><h1>Authorize Light Remote MCP</h1><p class="muted">ChatGPT is requesting access to your policy-bounded remote devices. Device policy and local capability checks remain authoritative.</p>${error}<form method="post" action="/oauth/authorize">${hidden}<label>Username<input name="username" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Authorize</button></form></main></body></html>`;
}
function clientFromId(wallAuth,clientId) {
  const payload=wallAuth.verifyOAuthToken('client',clientId);
  if(!payload || !Array.isArray(payload.redirect_uris)) return null;
  return payload;
}
function validateAuthorize(wallAuth,source) {
  const clientId=String(source.client_id||''), redirectUri=String(source.redirect_uri||'');
  const client=clientFromId(wallAuth,clientId);
  if(!client || !client.redirect_uris.includes(redirectUri)) throw new Error('invalid_client_or_redirect_uri');
  if(String(source.response_type||'')!=='code') throw new Error('unsupported_response_type');
  const challenge=String(source.code_challenge||'');
  if(String(source.code_challenge_method||'')!=='S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) throw new Error('pkce_s256_required');
  const resource=String(source.resource||`${publicOrigin()}/mcp`);
  if(resource!==`${publicOrigin()}/mcp`) throw new Error('invalid_resource');
  const scope=parseScope(source.scope);
  if(!scope.includes('mcp:operator')) scope.unshift('mcp:operator');
  return { clientId, redirectUri, challenge, resource, scope:scope.join(' '), state:String(source.state||'').slice(0,2048) };
}
function redirectWithError(params,error) {
  const u=new URL(params.redirectUri);
  u.searchParams.set('error',error);
  if(params.state) u.searchParams.set('state',params.state);
  return u.toString();
}

export function oauthResourceMetadata() {
  const origin=publicOrigin();
  return { resource:`${origin}/mcp`, authorization_servers:[origin], scopes_supported:['mcp:operator','offline_access'], resource_name:'Light Remote MCP' };
}
export function oauthAuthorizationMetadata() {
  const origin=publicOrigin();
  return { issuer:origin, authorization_endpoint:`${origin}/oauth/authorize`, token_endpoint:`${origin}/oauth/token`, registration_endpoint:`${origin}/oauth/register`,
    scopes_supported:['mcp:operator','offline_access'], response_types_supported:['code'], response_modes_supported:['query'],
    grant_types_supported:['authorization_code','refresh_token'], token_endpoint_auth_methods_supported:['none'],
    code_challenge_methods_supported:['S256'], client_id_metadata_document_supported:false,
    authorization_response_iss_parameter_supported:true };
}

export function mcpAuthChallenge(res) {
  const origin=publicOrigin();
  res.set('WWW-Authenticate',`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="mcp:operator"`);
}
export function registerMcpOAuth(app, wallAuth) {
  const usedCodes=new Map(), failures=new Map();
  const form=express.urlencoded({ extended:false, limit:'16kb' });
  const json=express.json({ limit:'32kb' });
  const prune=()=>{const now=Date.now();for(const [k,v] of usedCodes)if(v<=now)usedCodes.delete(k);for(const [k,rows] of failures){const keep=rows.filter(t=>now-t<LOGIN_WINDOW_MS);keep.length?failures.set(k,keep):failures.delete(k);}};
  const failKey=req=>String(req.ip||req.socket.remoteAddress||'unknown');
  const recordFailure=req=>{prune();const k=failKey(req),rows=failures.get(k)||[];rows.push(Date.now());failures.set(k,rows);return rows.length;};
  const tooMany=req=>{prune();return (failures.get(failKey(req))||[]).length>=LOGIN_MAX_ATTEMPTS;};

  app.get('/.well-known/oauth-protected-resource', (_req,res)=>res.json(oauthResourceMetadata()));
  app.get('/.well-known/oauth-protected-resource/mcp', (_req,res)=>res.json(oauthResourceMetadata()));
  app.get('/.well-known/oauth-authorization-server', (_req,res)=>res.json(oauthAuthorizationMetadata()));

  app.post('/oauth/register', json, (req,res)=>{
    const redirects=Array.isArray(req.body?.redirect_uris)?req.body.redirect_uris.map(String):[];
    if(!redirects.length || redirects.length>10 || redirects.some(uri=>!redirectAllowed(uri))) return res.status(400).json({error:'invalid_redirect_uris'});
    const now=Date.now();
    const payload={ redirect_uris:[...new Set(redirects)], client_name:String(req.body?.client_name||'MCP client').slice(0,160), iat:now };
    const clientId=wallAuth.signOAuthToken('client',payload);
    return res.status(201).json({ client_id:clientId, client_id_issued_at:Math.floor(now/1000), redirect_uris:payload.redirect_uris,
      grant_types:['authorization_code','refresh_token'], response_types:['code'], token_endpoint_auth_method:'none' });
  });

  app.get('/oauth/authorize', (req,res)=>{
    let params;
    try { params=validateAuthorize(wallAuth,req.query||{}); }
    catch(error) { return res.status(400).type('text').send(error.message); }
    res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    return res.status(200).type('html').send(consentHtml({
      client_id:params.clientId, redirect_uri:params.redirectUri, response_type:'code',
      code_challenge:params.challenge, code_challenge_method:'S256', scope:params.scope,
      resource:params.resource, state:params.state
    }));
  });

  app.post('/oauth/authorize', form, (req,res)=>{
    let params;
    try { params=validateAuthorize(wallAuth,req.body||{}); }
    catch(error) { return res.status(400).type('text').send(error.message); }
    if(tooMany(req)) return res.status(429).type('text').send('Too many failed authorization attempts. Try again later.');
    const username=String(req.body?.username||''), password=String(req.body?.password||'');
    if(!wallAuth.verifyCredentials(username,password)) {
      recordFailure(req);
      res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      return res.status(401).type('html').send(consentHtml({client_id:params.clientId,redirect_uri:params.redirectUri,response_type:'code',code_challenge:params.challenge,code_challenge_method:'S256',scope:params.scope,resource:params.resource,state:params.state},'Invalid username or password.'));
    }
    failures.delete(failKey(req));
    const now=Date.now(), jti=crypto.randomUUID();
    const code=wallAuth.signOAuthToken('code',{
      client_id:params.clientId, redirect_uri:params.redirectUri, code_challenge:params.challenge,
      scope:params.scope, resource:params.resource, sub:username, iat:now, exp:now+CODE_TTL_MS, jti
    });
    const redirect=new URL(params.redirectUri);
    redirect.searchParams.set('code',code);
    if(params.state) redirect.searchParams.set('state',params.state);
    redirect.searchParams.set('iss',publicOrigin());
    return res.redirect(303,redirect.toString());
  });

  app.post('/oauth/token', form, (req,res)=>{
    res.set('Cache-Control','no-store');
    res.set('Pragma','no-cache');
    const grant=String(req.body?.grant_type||'');
    const clientId=String(req.body?.client_id||'');
    if(!clientFromId(wallAuth,clientId)) return res.status(401).json({error:'invalid_client'});
    if(grant==='authorization_code') {
      const code=wallAuth.verifyOAuthToken('code',String(req.body?.code||''));
      if(!code || code.client_id!==clientId || code.redirect_uri!==String(req.body?.redirect_uri||'')) return res.status(400).json({error:'invalid_grant'});
      prune();
      if(usedCodes.has(code.jti)) return res.status(400).json({error:'invalid_grant'});
      const verifier=String(req.body?.code_verifier||'');
      if(verifier.length<43 || verifier.length>128 || pkceS256(verifier)!==code.code_challenge) return res.status(400).json({error:'invalid_grant'});
      usedCodes.set(code.jti,Number(code.exp)||Date.now()+CODE_TTL_MS);
      const access=wallAuth.mintBridgeSession(ACCESS_TTL_SECONDS);
      const now=Date.now();
      const refresh=wallAuth.signOAuthToken('refresh',{
        client_id:clientId, scope:code.scope, resource:code.resource, sub:code.sub,
        iat:now, exp:now+REFRESH_TTL_MS, jti:crypto.randomUUID()
      });
      return res.status(200).json({ access_token:access.token, token_type:'Bearer', expires_in:access.expiresInSeconds,
        refresh_token:refresh, scope:code.scope, resource:code.resource });
    }
    if(grant==='refresh_token') {
      const refresh=wallAuth.verifyOAuthToken('refresh',String(req.body?.refresh_token||''));
      if(!refresh || refresh.client_id!==clientId) return res.status(400).json({error:'invalid_grant'});
      const access=wallAuth.mintBridgeSession(ACCESS_TTL_SECONDS);
      const now=Date.now();
      const next=wallAuth.signOAuthToken('refresh',{
        client_id:clientId, scope:refresh.scope, resource:refresh.resource, sub:refresh.sub,
        iat:now, exp:now+REFRESH_TTL_MS, jti:crypto.randomUUID()
      });
      return res.status(200).json({ access_token:access.token, token_type:'Bearer', expires_in:access.expiresInSeconds,
        refresh_token:next, scope:refresh.scope, resource:refresh.resource });
    }
    return res.status(400).json({error:'unsupported_grant_type'});
  });
}
