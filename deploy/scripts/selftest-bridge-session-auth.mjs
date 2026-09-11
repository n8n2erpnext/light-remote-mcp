import fs from 'node:fs';
import crypto from 'node:crypto';
import { createWallAuth, hashWallPassword } from '../../gateway/wall-auth.mjs';

const file=`/tmp/gpt-bridge-session-${process.pid}.json`;
const password='selftest-bridge-password';
fs.writeFileSync(file, JSON.stringify({mode:'local',username:'operator',passwordHash:hashWallPassword(password),cookieSecret:crypto.randomBytes(32).toString('base64url'),sessionTtlSeconds:900}), {mode:0o600});
function req(body={},headers={}){return {body,headers,ip:'127.0.0.1',socket:{remoteAddress:'127.0.0.1'}};}
function response(){return {statusCode:200,headers:{},body:null,redirected:null,status(n){this.statusCode=n;return this;},set(k,v){this.headers[String(k).toLowerCase()]=v;return this;},type(){return this;},send(v){this.body=v;return this;},json(v){this.body=v;return this;},redirect(n,p){this.statusCode=n;this.redirected=p;return this;}};}
try {
  const auth=createWallAuth({configFile:file,bridgeTtlSeconds:300});
  let r=response(); auth.bridgeLogin(req({username:'operator',password:'wrong'}),r); if(r.statusCode!==401) throw new Error('bad_bridge_password_not_rejected');
  const fresh=createWallAuth({configFile:file,bridgeTtlSeconds:300});
  r=response(); fresh.bridgeLogin(req({username:'operator',password}),r);
  if(r.statusCode!==200||!r.body?.session?.token?.startsWith('b1.')||r.body.session.expiresInSeconds!==300) throw new Error('bridge_login_failed');
  const token=r.body.session.token;
  r=response(); let next=false; fresh.requireBridgeSession(req(),r,()=>{next=true;}); if(next||r.statusCode!==401) throw new Error('missing_bridge_session_accepted');
  r=response(); next=false; fresh.requireBridgeSession(req({}, {'x-bridge-session':token}),r,()=>{next=true;}); if(!next) throw new Error('valid_bridge_session_rejected');
  r=response(); next=false; fresh.requireBridgeSession(req({}, {'x-bridge-session':token+'x'}),r,()=>{next=true;}); if(next||r.statusCode!==401) throw new Error('tampered_bridge_session_accepted');
  r=response(); fresh.login(req({username:'operator',password},{cookie:''}),r); const wallCookie=(r.headers['set-cookie']||'').split(';',1)[0];
  const wallToken=wallCookie.split('=',2)[1]||''; r=response(); next=false; fresh.requireBridgeSession(req({}, {'x-bridge-session':wallToken}),r,()=>{next=true;}); if(next||r.statusCode!==401) throw new Error('wall_cookie_cross_use_accepted');
  r=response(); next=false; fresh.requireApi(req({}, {cookie:`__Host-gpt_operator_wall=${token}`}),r,()=>{next=true;}); if(next||r.statusCode!==401) throw new Error('bridge_token_cross_use_accepted');
  const server=fs.readFileSync(new URL('../../gateway/server.mjs',import.meta.url),'utf8');
  if(!server.includes("app.post('/operator/auth/login', softRateLimit, requireVercelIdentity, wallAuth.bridgeLogin)")) throw new Error('bridge_login_not_vercel_oidc_gated');
  if(!server.includes("app.post('/mcp', softRateLimit, requireMcpIdentity")) throw new Error('mcp_identity_guard_missing');
  if(!server.includes('async function requireMcpIdentity')||!server.includes('authenticateVercel(req)')||!server.includes('wallAuth.bridgeIdentity(req)')) throw new Error('mcp_vercel_bridge_guard_regressed');
  console.log('bridge-session-login=PASS');
  console.log('bridge-session-required=PASS');
  console.log('bridge-session-tamper=PASS');
  console.log('bridge-wall-domain-separation=PASS');
  console.log('bridge-gateway-guards=PASS');
} finally { try{fs.unlinkSync(file);}catch{} }
