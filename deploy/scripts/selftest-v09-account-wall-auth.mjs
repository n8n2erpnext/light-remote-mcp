import fs from 'node:fs';
import crypto from 'node:crypto';
import { createWallAuth, createAccountWallAuth, hashWallPassword } from '../../gateway/wall-auth.mjs';

const file=`/tmp/light-remote-account-wall-${process.pid}.json`,legacyPassword='legacy-wall-password';
fs.writeFileSync(file,JSON.stringify({mode:'local',username:'operator',passwordHash:hashWallPassword(legacyPassword),cookieSecret:crypto.randomBytes(32).toString('base64url'),sessionTtlSeconds:900}),{mode:0o600});
function req(body={},cookie='',query={}){return {body,query,originalUrl:'/',url:'/',headers:{cookie},ip:'127.0.0.1',socket:{remoteAddress:'127.0.0.1'}};}
function response(){return {statusCode:200,headers:{},body:null,redirected:null,status(n){this.statusCode=n;return this;},set(k,v){this.headers[String(k).toLowerCase()]=v;return this;},type(){return this;},send(v){this.body=v;return this;},json(v){this.body=v;return this;},redirect(n,p){this.statusCode=n;this.redirected=p;return this;}};}
function cookieFrom(setCookie,name){const rows=Array.isArray(setCookie)?setCookie:[setCookie];const row=rows.find(x=>String(x).startsWith(name+'='));return row?String(row).split(';',1)[0]:'';}
const sessions=new Map();let seq=0,logouts=0;
const account={accountId:'self-hosted-local',email:'owner@example.com',plan:'free',status:'active'};
const loginAccount=async ({email,password})=>{if(email!=='owner@example.com'||password!=='account-password')throw Object.assign(new Error('invalid_account_credentials'),{status:401});const token=`acct-token-${++seq}-${crypto.randomBytes(8).toString('hex')}`;const session={sessionId:`s-${seq}`,expiresAt:Date.now()+3600000};sessions.set(token,{account,session});return {ok:true,account,session,token};};
const authenticateAccount=async token=>{const value=sessions.get(token);if(!value)throw Object.assign(new Error('account_session_required'),{status:401});return value;};
const logoutAccount=async token=>{const existed=sessions.delete(token);logouts++;return {ok:true,loggedOut:existed};};
try{
  const legacy=createWallAuth({configFile:file}),auth=createAccountWallAuth(legacy,{accountId:'self-hosted-local',loginAccount,authenticateAccount,logoutAccount});
  let r=response();await auth.loginPage(req({},'',{}),r);if(r.statusCode!==200||!r.body.includes('Light Remote account authentication')||!r.body.includes('name="email"')||!r.body.includes('legacy operator login'))throw new Error('account_wall_login_page_failed');
  r=response();await auth.login(req({authMode:'account',email:'owner@example.com',password:'wrong'}),r);if(r.statusCode!==401)throw new Error('account_wall_bad_login_not_rejected');
  r=response();await auth.login(req({authMode:'account',email:'owner@example.com',password:'account-password'}),r);if(r.statusCode!==303||r.redirected!=='/')throw new Error('account_wall_login_failed');
  const setCookie=r.headers['set-cookie'],cookie=cookieFrom(setCookie,'__Host-light_remote_wall_account');if(!cookie||!String(Array.isArray(setCookie)?setCookie[0]:setCookie).includes('HttpOnly')||!String(Array.isArray(setCookie)?setCookie[0]:setCookie).includes('Secure')||!String(Array.isArray(setCookie)?setCookie[0]:setCookie).includes('SameSite=Strict'))throw new Error('account_wall_cookie_security_failed');
  let next=false,apiReq=req({},cookie);r=response();await auth.requireApi(apiReq,r,()=>{next=true;});if(!next||apiReq.wallIdentity?.account?.email!=='owner@example.com'||apiReq.wallIdentity?.authType!=='account')throw new Error('account_wall_session_rejected');
  next=false;r=response();await auth.requireApi(req({},cookie+'x'),r,()=>{next=true;});if(next||r.statusCode!==401)throw new Error('account_wall_tamper_accepted');
  r=response();await auth.logout(req({},cookie),r);if(r.statusCode!==303||logouts!==1||sessions.size!==0||!JSON.stringify(r.headers['set-cookie']).includes('Max-Age=0'))throw new Error('account_wall_logout_failed');
  r=response();await auth.login(req({authMode:'legacy',username:'operator',password:legacyPassword}),r);const legacyCookie=cookieFrom(r.headers['set-cookie'],'__Host-gpt_operator_wall');if(r.statusCode!==303||!legacyCookie)throw new Error('legacy_wall_fallback_login_failed');
  next=false;r=response();await auth.requireApi(req({},legacyCookie),r,()=>{next=true;});if(!next)throw new Error('legacy_wall_fallback_session_failed');
  r=response();await auth.loginPage(req({},'',{legacy:'1'}),r);if(r.statusCode!==200||!r.body.includes('Independent operator authentication'))throw new Error('legacy_wall_recovery_page_failed');
  const server=fs.readFileSync(new URL('../../gateway/server.mjs',import.meta.url),'utf8');
  for(const marker of ["wallApp.get('/login', accountWallAuth.loginPage)","wallApp.post('/auth/login', accountWallAuth.login)","wallApp.get('/', accountWallAuth.requirePage","wallApp.get('/api/devices', accountWallAuth.requireApi"])if(!server.includes(marker))throw new Error(`account_wall_server_wiring_missing:${marker}`);
  console.log('account-wall-login=PASS');console.log('account-wall-cookie-security=PASS');console.log('account-wall-session-authority=PASS');console.log('account-wall-logout=PASS');console.log('account-wall-legacy-fallback=PASS');console.log('account-wall-server-wiring=PASS');
} finally {try{fs.unlinkSync(file);}catch{}}
