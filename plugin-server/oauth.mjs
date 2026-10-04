import crypto from 'node:crypto';
import fs from 'node:fs';
import { SignJWT, jwtVerify } from 'jose';
import { MCP_RESOURCE, OAUTH_LEGACY_CLIENTS_FILE, OAUTH_SECRET_FILE, PUBLIC_ORIGIN } from './config.mjs';
import { callOperatorJson } from './operator-client.mjs';

const ACCESS_TTL=3600,CODE_TTL=120,REFRESH_TTL=30*24*3600;
const ALLOWED_SCOPES=new Set(['remote:read','remote:write','remote:execute','remote:terminal','offline_access','openid','email']);
const usedCodes=new Map(),usedRefresh=new Map(),failures=new Map();
const now=()=>Math.floor(Date.now()/1000);
function prune(map){const t=now();for(const [k,v] of map)if(Number(v)<=t)map.delete(k);}
function parseScopes(raw=''){const v=[...new Set(String(raw).split(/\s+/).map(x=>x.trim()).filter(Boolean))];if(!v.length||v.some(x=>!ALLOWED_SCOPES.has(x)))throw new Error('invalid_scope');return v;}
function validRedirect(value){try{const u=new URL(String(value||''));return u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','::1'].includes(u.hostname));}catch{return false;}}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function secret(){if(process.env.LIGHT_REMOTE_PLUGIN_OAUTH_SECRET)return Buffer.from(process.env.LIGHT_REMOTE_PLUGIN_OAUTH_SECRET);const raw=fs.readFileSync(OAUTH_SECRET_FILE);if(raw.length<32)throw new Error('oauth_secret_too_short');return raw;}
async function mint(type,claims,ttl,audience=MCP_RESOURCE){return new SignJWT({...claims,token_use:type}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuer(PUBLIC_ORIGIN).setAudience(audience).setIssuedAt().setExpirationTime(now()+ttl).setJti(crypto.randomUUID()).sign(secret());}
async function verify(token,type,audience=MCP_RESOURCE){const {payload}=await jwtVerify(String(token||''),secret(),{issuer:PUBLIC_ORIGIN,audience});if(payload.token_use!==type)throw new Error('invalid_token_use');return payload;}
async function mintClient(claims){return new SignJWT({...claims,token_use:'client'}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuer(PUBLIC_ORIGIN).setAudience(`${PUBLIC_ORIGIN}/oauth/register`).setIssuedAt().setJti(crypto.randomUUID()).sign(secret());}
function legacyClientFromId(id){
  try{
    if(!fs.existsSync(OAUTH_LEGACY_CLIENTS_FILE))return null;
    const registry=JSON.parse(fs.readFileSync(OAUTH_LEGACY_CLIENTS_FILE,'utf8'));
    if(registry?.schemaVersion!==1||!Array.isArray(registry.clients))return null;
    const raw=String(id||''),digest=crypto.createHash('sha256').update(raw).digest('hex');
    const row=registry.clients.find(item=>item?.disabled!==true&&String(item?.clientIdSha256||'')===digest);
    if(!row)return null;
    const parts=raw.split('.');if(parts.length!==3)return null;
    const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
    const redirects=Array.isArray(row.redirect_uris)?row.redirect_uris.map(String):[];
    if(payload?.token_use!=='client'||payload?.iss!==PUBLIC_ORIGIN||payload?.aud!==`${PUBLIC_ORIGIN}/oauth/register`)return null;
    if(!redirects.length||redirects.some(x=>!validRedirect(x))||!Array.isArray(payload.redirect_uris)||payload.redirect_uris.length!==redirects.length)return null;
    if(payload.redirect_uris.some((value,index)=>String(value)!==redirects[index]))return null;
    if(row.client_name&&String(payload.client_name||'')!==String(row.client_name))return null;
    return {...payload,redirect_uris:redirects,legacyClient:true};
  }catch{return null;}
}
export async function clientFromId(id){try{const {payload}=await jwtVerify(String(id||''),secret(),{issuer:PUBLIC_ORIGIN,audience:`${PUBLIC_ORIGIN}/oauth/register`});return payload.token_use==='client'&&Array.isArray(payload.redirect_uris)?payload:null;}catch{return legacyClientFromId(id);}}
const pkce=v=>crypto.createHash('sha256').update(String(v||'')).digest('base64url');
const requesterKey=req=>String(req.ip||req.socket?.remoteAddress||'unknown');
function tooMany(req){const k=requesterKey(req),t=Date.now(),rows=(failures.get(k)||[]).filter(x=>t-x<600000);failures.set(k,rows);return rows.length>=12;}
function recordFailure(req){const k=requesterKey(req),rows=failures.get(k)||[];rows.push(Date.now());failures.set(k,rows.slice(-20));}
function authHtml(p,msg=''){
  const hidden=Object.entries(p).map(([k,v])=>`<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Light Remote authorization</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#080a0c;color:#edf2f7}
*{box-sizing:border-box}body{margin:0;background:#080a0c;color:#edf2f7}.auth-shell{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 20% 10%,#17170a 0,#080a0c 34%)}.auth-card{width:min(430px,100%);border:1px solid #2b323a;border-radius:16px;background:#0c1014;padding:28px}.auth-brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}.auth-brand img{width:48px;height:48px}.auth-brand strong{display:block;font-size:18px}.muted{color:#8995a4}.auth-card h1{margin:0 0 8px;font-size:28px}.auth-card p{margin:0 0 22px;color:#8d98a7}.permissions{border:1px solid #293038;border-radius:10px;background:#0a0e12;padding:12px 13px;color:#9aa7b6;font-size:13px;line-height:1.5;margin-bottom:18px}.field{display:block;margin:14px 0}.field span{display:block;font-size:13px;margin-bottom:7px}.field input{width:100%;border:1px solid #34404b;border-radius:9px;background:#0a0e12;color:#edf2f7;padding:11px 12px;font:inherit}.auth-actions{margin-top:18px}.btn{width:100%;border:1px solid #ffcc00;background:#ffcc00;color:#0a0b0c;border-radius:9px;padding:11px 14px;cursor:pointer;font:inherit;font-weight:700}.btn:hover{filter:brightness(1.04)}.error{color:#ff9ca5;font-size:13px;margin:0 0 14px}.auth-switch{margin-top:18px;text-align:center;color:#8d98a7;font-size:13px}
</style></head><body><main class="auth-shell"><section class="auth-card"><div class="auth-brand"><img src="/account/assets/light-remote-mark.svg" alt=""><div><strong>Light Remote</strong><div class="muted">Remote MCP</div></div></div><h1>Authorize ChatGPT</h1><p>Sign in to allow ChatGPT to use your explicitly authorized Light Remote devices.</p>${msg?`<div class="error">${esc(msg)}</div>`:''}<div class="permissions"><strong>Requested permissions:</strong> ${esc(p.scope||'')}</div><form method="post" action="/oauth/authorize">${hidden}<label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required autofocus></label><label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label><div class="auth-actions"><button class="btn" type="submit">Authorize</button></div></form><div class="auth-switch">Account access is provisioned by Light Remote.</div></section></main></body></html>`;
}
async function validateAuthorize(src){const clientId=String(src.client_id||''),client=await clientFromId(clientId),redirect=String(src.redirect_uri||''),resource=String(src.resource||'');if(!client||!client.redirect_uris.includes(redirect))throw new Error('invalid_client');if(String(src.response_type||'')!=='code')throw new Error('unsupported_response_type');if(resource!==MCP_RESOURCE)throw new Error('invalid_resource');const challenge=String(src.code_challenge||'');if(src.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43,128}$/.test(challenge))throw new Error('pkce_s256_required');return {clientId,redirect,resource,challenge,scope:parseScopes(src.scope).join(' '),state:String(src.state||'').slice(0,2048)};}
export function oauthMetadata(){return {issuer:PUBLIC_ORIGIN,authorization_endpoint:`${PUBLIC_ORIGIN}/oauth/authorize`,token_endpoint:`${PUBLIC_ORIGIN}/oauth/token`,registration_endpoint:`${PUBLIC_ORIGIN}/oauth/register`,userinfo_endpoint:`${PUBLIC_ORIGIN}/userinfo`,scopes_supported:[...ALLOWED_SCOPES],response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true,client_id_metadata_document_supported:false};}
export function protectedResourceMetadata(){return {resource:MCP_RESOURCE,authorization_servers:[PUBLIC_ORIGIN],scopes_supported:[...ALLOWED_SCOPES].filter(x=>x!=='offline_access'),resource_documentation:`${PUBLIC_ORIGIN}/support`};}
export function challengeValue(scopes,error='invalid_token',description='Authentication required'){return `Bearer resource_metadata="${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="${scopes.join(' ')}", error="${error}", error_description="${String(description).replace(/["\\]/g,'')}"`;}
export function authErrorResult(scopes,error='invalid_token',description='Connect Light Remote to continue.'){return {content:[{type:'text',text:description}],_meta:{'mcp/www_authenticate':[challengeValue(scopes,error,description)]},isError:true};}
export async function authenticateAccess(req){const raw=String(req.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();if(!raw)return {identity:null,error:'invalid_token'};try{const p=await verify(raw,'access'),scopes=parseScopes(p.scope);if(p.resource!==MCP_RESOURCE||!p.sub||!p.client_id)throw new Error('invalid_token');return {identity:{accountId:String(p.sub),clientId:String(p.client_id),scopes},error:null};}catch(error){return {identity:null,error:error.message==='invalid_scope'?'insufficient_scope':'invalid_token'};}}
export function requireScopes(identity,required){if(!identity)return authErrorResult(required);const have=new Set(identity.scopes||[]),missing=required.filter(s=>!have.has(s));return missing.length?authErrorResult(required,'insufficient_scope',`Additional permission required: ${missing.join(', ')}`):null;}
function setAuthCsp(res){res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");}
function oauthAudit(event,detail={}){console.log(JSON.stringify({event,...detail}));}
export function registerOAuth(app){
  app.get('/.well-known/oauth-authorization-server',(_q,r)=>r.json(oauthMetadata()));
  app.get('/.well-known/oauth-protected-resource',(_q,r)=>r.json(protectedResourceMetadata()));
  app.get('/.well-known/oauth-protected-resource/mcp',(_q,r)=>r.json(protectedResourceMetadata()));
  app.post('/oauth/register',async(req,res)=>{try{const b=req.body||{},redirects=Array.isArray(b.redirect_uris)?[...new Set(b.redirect_uris.map(String))]:[];if(!redirects.length||redirects.length>10||redirects.some(x=>!validRedirect(x)))throw new Error('invalid_redirect_uris');if(b.token_endpoint_auth_method&&b.token_endpoint_auth_method!=='none')throw new Error('invalid_client_metadata');const grant_types=Array.isArray(b.grant_types)&&b.grant_types.length?b.grant_types.map(String):['authorization_code','refresh_token'],response_types=Array.isArray(b.response_types)&&b.response_types.length?b.response_types.map(String):['code'];if(grant_types.some(x=>!['authorization_code','refresh_token'].includes(x))||response_types.some(x=>x!=='code'))throw new Error('invalid_client_metadata');const client_name=String(b.client_name||'MCP client').slice(0,160),scope=b.scope?parseScopes(b.scope).join(' '):undefined;const client_id=await mintClient({redirect_uris:redirects,client_name,scope});return res.status(201).json({client_id,client_id_issued_at:now(),redirect_uris:redirects,client_name,grant_types,response_types,token_endpoint_auth_method:'none',...(scope?{scope}:{})});}catch(error){return res.status(400).json({error:error.message});}});
  app.get('/oauth/authorize',async(req,res)=>{
    try{
      const p=await validateAuthorize(req.query||{});
      setAuthCsp(res);
      oauthAudit('oauth_authorize_get',{status:'ok'});
      return res.type('html').send(authHtml({client_id:p.clientId,redirect_uri:p.redirect,response_type:'code',code_challenge:p.challenge,code_challenge_method:'S256',resource:p.resource,scope:p.scope,state:p.state}));
    }catch(error){
      oauthAudit('oauth_authorize_get',{status:'error',error:String(error?.message||'invalid_request').slice(0,80)});
      return res.status(400).type('text').send(error.message);
    }
  });
  app.post('/oauth/authorize',async(req,res)=>{
    let p;
    try{p=await validateAuthorize(req.body||{});}
    catch(error){
      oauthAudit('oauth_authorize_post',{status:'validation_error',error:String(error?.message||'invalid_request').slice(0,80)});
      return res.status(400).type('text').send(error.message);
    }
    if(tooMany(req)){
      oauthAudit('oauth_authorize_post',{status:'rate_limited'});
      return res.status(429).type('text').send('Too many failed authorization attempts.');
    }
    let verified;
    try{
      verified=await callOperatorJson('POST','/v1/plugin/auth/verify',{email:req.body.email,password:req.body.password});
    }catch(error){
      recordFailure(req);
      setAuthCsp(res);
      oauthAudit('oauth_authorize_post',{status:'credentials_error',error:String(error?.payload?.error||error?.message||'invalid_account_credentials').slice(0,80)});
      return res.status(401).type('html').send(authHtml({client_id:p.clientId,redirect_uri:p.redirect,response_type:'code',code_challenge:p.challenge,code_challenge_method:'S256',resource:p.resource,scope:p.scope,state:p.state},'Invalid email or password.'));
    }
    try{
      const account=verified.account;
      const code=await mint('code',{sub:account.accountId,email:account.email,client_id:p.clientId,redirect_uri:p.redirect,code_challenge:p.challenge,resource:MCP_RESOURCE,scope:p.scope},CODE_TTL);
      const out=new URL(p.redirect);
      out.searchParams.set('code',code);
      if(p.state)out.searchParams.set('state',p.state);
      out.searchParams.set('iss',PUBLIC_ORIGIN);
      oauthAudit('oauth_authorize_post',{status:'success'});
      return res.redirect(303,out.toString());
    }catch(error){
      oauthAudit('oauth_authorize_post',{status:'server_error',error:String(error?.message||'authorization_failed').slice(0,80)});
      return res.status(500).type('text').send('Authorization failed. Please retry.');
    }
  });
  app.get('/userinfo',async(req,res)=>{res.set('Cache-Control','no-store');const raw=String(req.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();try{const p=await verify(raw,'access'),scopes=new Set(parseScopes(p.scope));if(p.resource!==MCP_RESOURCE||!p.sub||!p.email)throw new Error('invalid_token');if(!scopes.has('openid')||!scopes.has('email'))return res.status(403).json({error:'insufficient_scope'});return res.json({sub:String(p.sub),email:String(p.email),email_verified:true});}catch{return res.status(401).set('WWW-Authenticate','Bearer error="invalid_token"').json({error:'invalid_token'});}});
  app.post('/oauth/token',async(req,res)=>{
    res.set('Cache-Control','no-store');
    res.set('Pragma','no-cache');
    prune(usedCodes);prune(usedRefresh);
    const clientId=String(req.body.client_id||''),resource=String(req.body.resource||''),grantType=String(req.body.grant_type||'');
    if(!await clientFromId(clientId)){
      oauthAudit('oauth_token',{status:'invalid_client',grant_type:grantType||'unknown'});
      return res.status(401).json({error:'invalid_client'});
    }
    if(resource!==MCP_RESOURCE){
      oauthAudit('oauth_token',{status:'invalid_target',grant_type:grantType||'unknown'});
      return res.status(400).json({error:'invalid_target'});
    }
    try{
      if(grantType==='authorization_code'){
        const code=await verify(req.body.code,'code');
        if(code.client_id!==clientId||code.redirect_uri!==String(req.body.redirect_uri||'')||code.resource!==resource||pkce(req.body.code_verifier)!==code.code_challenge||usedCodes.has(code.jti))throw new Error('authorization_code_mismatch');
        usedCodes.set(code.jti,Number(code.exp));
        const common={sub:code.sub,email:code.email,client_id:clientId,resource,scope:code.scope};
        oauthAudit('oauth_token',{status:'success',grant_type:'authorization_code'});
        return res.json({access_token:await mint('access',common,ACCESS_TTL),token_type:'Bearer',expires_in:ACCESS_TTL,refresh_token:await mint('refresh',common,REFRESH_TTL),scope:code.scope,resource});
      }
      if(grantType==='refresh_token'){
        const prior=await verify(req.body.refresh_token,'refresh');
        if(prior.client_id!==clientId||prior.resource!==resource||!prior.jti||usedRefresh.has(prior.jti))throw new Error('refresh_token_mismatch');
        usedRefresh.set(prior.jti,Number(prior.exp));
        const common={sub:prior.sub,email:prior.email,client_id:clientId,resource,scope:prior.scope};
        oauthAudit('oauth_token',{status:'success',grant_type:'refresh_token'});
        return res.json({access_token:await mint('access',common,ACCESS_TTL),token_type:'Bearer',expires_in:ACCESS_TTL,refresh_token:await mint('refresh',common,REFRESH_TTL),scope:prior.scope,resource});
      }
      oauthAudit('oauth_token',{status:'unsupported_grant_type',grant_type:grantType||'unknown'});
      return res.status(400).json({error:'unsupported_grant_type'});
    }catch(error){
      oauthAudit('oauth_token',{status:'invalid_grant',grant_type:grantType||'unknown',error:String(error?.message||'invalid_grant').slice(0,80)});
      return res.status(400).json({error:'invalid_grant'});
    }
  });
}
