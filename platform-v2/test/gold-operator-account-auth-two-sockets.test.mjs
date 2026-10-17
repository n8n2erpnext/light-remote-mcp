import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import {GoldPgCoreAuthority} from '../src/storage/gold-core-authority.mjs';
import {startGoldCoreApi} from '../src/http/gold-core-server.mjs';
import {createGoldOperatorNotificationBridge,notificationCoreSocket,
 isUnmigratedGoldAccountAuthorityRoute}
 from '../../operator-host/gold-notification-core-bridge.mjs';

const verifiers=Object.fromEntries([
 'verifyIdentityProof','verifyDeviceProof','verifyAgentPrincipal','verifyWallApproval',
 'verifyPaddleSignature','verifyOwnerProof','verifyUsageEvidence',
 'approveWallRequest','verifyAgentIngress','verifyOAuthClient','verifyBillingIngress',
 'verifyUsageIngress','verifyDeviceChannelIngress','verifyChannelEnvelope'
].map(name=>[name,async()=>null]));
const BASE=Date.parse('2026-10-17T15:00:00Z');

test('Gold Account auth canary denies unported Plugin/Admin JSON writers but not Gold notifications',()=>{
 const blocked=[
  '/v1/plugin/accounts/register','/v1/plugin/accounts/registration/verify',
  '/v1/plugin/accounts/password-reset/consume','/v1/plugin/auth/google',
  '/v1/plugin/team/access/request','/v1/admin/overview','/v1/admin/accounts',
  '/v1/admin/accounts/acct_member/status','/v1/admin/groups',
  '/v1/admin/licenses/issue','/v1/admin/dormancy/scan'
 ];
 for(const path of blocked)
  assert.equal(isUnmigratedGoldAccountAuthorityRoute(path),true,path);
 for(const path of ['/healthz','/v1/accounts/login','/v1/accounts/me',
  '/v1/accounts/logout','/v1/accounts/notifications',
  '/v1/admin/notifications','/v1/device-channel/connect'])
  assert.equal(isUnmigratedGoldAccountAuthorityRoute(path),false,path);
});

test('Gold opt-in canonical Operator Account login/me/logout use one PG session and fail closed for unported routes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-gold-account-bridge-'));
 fs.chmodSync(root,0o700);
 const run=path.join(root,'run');fs.mkdirSync(run,{mode:0o700});
 const socketPath=path.join(run,'core.sock');
 const accounts=new Map(),sessions=new Map(),sqlLog=[];
 let alive=true,redisAlive=true,coreService,front;
 const query=async(sql,params=[])=>{
  sqlLog.push({sql,params});
  if(!alive)throw Error('pg_unavailable');
  if(sql==='SELECT 1 AS gold_ready')return{rows:[{gold_ready:1}]};
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};
  if(sql.includes('INSERT INTO lr_accounts(')){
   const [id,email,hash]=params;
   const row={account_id:id,email,password_hash:hash,email_verified:true,
    password_enabled:true,status:'active',plan:'free',group_id:'grp_default'};
   accounts.set(id,row);
   return{rows:[{account_id:id,email,plan:'free',status:'active'}]};
  }
  if(sql.includes('FROM lr_accounts WHERE lower(email)=lower($1)')){
   return{rows:[...accounts.values()].filter(a=>a.email===params[0])};
  }
  if(sql.includes('INSERT INTO lr_sessions(')){
   const [sessionId,accountId,tokenHash,expiresAt]=params;
   sessions.set(tokenHash,{session_id:sessionId,account_id:accountId,
    expires_at:new Date(expiresAt),revoked:false});
   return{rows:[]};
  }
  if(sql.startsWith('UPDATE lr_accounts SET last_login_at'))return{rows:[]};
  if(sql.includes('FROM lr_sessions s JOIN lr_accounts a')){
   const session=sessions.get(params[0]),account=accounts.get(session?.account_id);
   if(!session||session.revoked||account?.status!=='active')return{rows:[]};
   return{rows:[{...session,email:account.email,plan:account.plan,
    group_id:account.group_id}]};
  }
  if(sql.startsWith('UPDATE lr_sessions SET revoked_at=now()')){
   const session=sessions.get(params[0]);
   if(!session||session.revoked)return{rows:[]};
   session.revoked=true;return{rows:[{session_id:session.session_id}]};
  }
  throw Error('unexpected_account_pg_sql:'+sql.slice(0,100));
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const authority=new GoldPgCoreAuthority({pool,pairingEncryptionKey:crypto.randomBytes(32),
  verifyIdentityProof:async({purpose,email})=>purpose==='verified_email'&&email==='demo@local.invalid',
  verifyDeviceProof:async()=>false,verifyAgentPrincipal:async()=>null,
  verifyWallApproval:async()=>false,verifyPaddleSignature:async()=>null});
 const env={LIGHT_REMOTE_GOLD_INDEPENDENT:'1',LIGHT_REMOTE_GOLD_ROOT:root};
 let oldRoutesCalled=0;
 try{
  // An actual Gold Core Authority inserts one verified relational account.
  await authority.registerVerifiedAccount({accountId:'acct_gold_demo',
   email:'demo@local.invalid',password:'StrongPassword#2026',proof:'signed-test-fixture'});
  coreService=await startGoldCoreApi({env,verifiers,socketPath,openCore:()=>authority,
   openTeam:()=>({}),openPlane:async()=>({pool,
    redis:{ping:async()=>redisAlive?'PONG':'NO'},
    cache:{prefix:'lr:gold:account-bridge:'},
    postgres:{database:'light_remote_gold_dev',schemaVersion:20},close:async()=>{}})});
  const bridge=createGoldOperatorNotificationBridge({accountRoutes:true,
   notificationRoutes:true,socketPath:notificationCoreSocket({
    ...env,LR_GOLD_CORE_SOCKET:socketPath})});
  front=http.createServer(async(req,res)=>{
   if(await bridge(req,res,new URL(req.url,'http://operator.local')))return;
   oldRoutesCalled++;
   res.writeHead(500,{'content-type':'application/json'});
   res.end(JSON.stringify({ok:false,error:'legacy_json_route_executed'}));
  });
  await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+front.address().port;
  const request=async(route,{method='GET',body=null,bearer=null,legacy=null}={})=>{
   const response=await fetch(base+route,{method,headers:{
    ...(body?{'content-type':'application/json'}:{}),
    ...(bearer?{authorization:'Bearer '+bearer}:{}),
    ...(legacy?{'x-light-account-session':legacy}:{})
   },...(body?{body:JSON.stringify(body)}:{})});
   const ct=response.headers.get('content-type')||'';
   return{status:response.status,data:ct.startsWith('application/json')
    ?await response.json():await response.text()};
  };
  const wrong=await request('/v1/accounts/login',{method:'POST',body:{
   email:'demo@local.invalid',password:'wrong-password'}});
  assert.equal(wrong.status,401);
  const login=await request('/v1/accounts/login',{method:'POST',body:{
   email:'demo@local.invalid',password:'StrongPassword#2026'}});
  assert.equal(login.status,200);
  assert.equal(login.data.ok,true);
  assert.equal(login.data.account.accountId,'acct_gold_demo');
  assert.match(login.data.token,/^[A-Za-z0-9_-]{20,}$/);
  assert.match(login.data.session.sessionId,/^as_/);
  const oldIdentity=await request('/v1/accounts/me',{legacy:'fake_legacy_json_session'});
  assert.equal(oldIdentity.status,401);
  const me=await request('/v1/accounts/me',{legacy:login.data.token});
  assert.equal(me.status,200);
  assert.equal(me.data.account.accountId,'acct_gold_demo');
  assert.equal(me.data.account.groupId,'grp_default');
  assert.equal(me.data.session.sessionId,login.data.session.sessionId);
  const meBearer=await request('/v1/accounts/me',{bearer:login.data.token});
  assert.equal(meBearer.status,200);
  const unsupported=await request('/v1/accounts/password',{method:'POST',legacy:login.data.token,
   body:{password:'DoNotWriteLegacy'}});
  assert.equal(unsupported.status,503);
  assert.equal(unsupported.data.error,'gold_account_route_not_migrated');
  const signup=await request('/v1/accounts/register',{method:'POST',
   body:{ownerProofVerified:true,email:'attacker@local.invalid'}});
  assert.equal(signup.status,503);
  assert.equal(accounts.size,1,'unverified legacy registration must never write PG or JSON');
  const logout=await request('/v1/accounts/logout',{method:'POST',legacy:login.data.token});
  assert.equal(logout.status,200);
  assert.equal(logout.data.loggedOut,true);
  const after=await request('/v1/accounts/me',{legacy:login.data.token});
  assert.equal(after.status,401,'revoked PostgreSQL bearer must never authenticate');
  assert.equal(oldRoutesCalled,0,'no JSON account fallback');
  assert.equal(sessions.size,1);
  assert(!sessions.has(login.data.token),'raw bearer never stored as a session map key');
  redisAlive=false;
  assert.equal((await request('/v1/accounts/me',{legacy:login.data.token})).status,503);
  redisAlive=true;alive=false;
  assert.equal((await request('/v1/accounts/login',{method:'POST',
   body:{email:'demo@local.invalid',password:'StrongPassword#2026'}})).status,503);
  assert.equal(oldRoutesCalled,0);
  assert(sqlLog.some(x=>x.sql.includes('FROM lr_sessions s JOIN lr_accounts a')));
  assert(sqlLog.some(x=>x.sql.includes("revoked_reason='logout'")));
 }finally{
  if(front)await new Promise(resolve=>front.close(resolve));
  await coreService?.close();
  fs.rmSync(root,{recursive:true,force:true});
 }
});
