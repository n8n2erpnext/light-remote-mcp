import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {startGoldCoreApi} from '../src/http/gold-core-server.mjs';
import {notificationCoreSocket,createGoldOperatorNotificationBridge}
 from '../../operator-host/gold-notification-core-bridge.mjs';

const TOKEN='P'.repeat(48);
const required=['verifyIdentityProof','verifyDeviceProof','verifyAgentPrincipal',
 'verifyWallApproval','verifyPaddleSignature','verifyOwnerProof',
 'verifyUsageEvidence','approveWallRequest','verifyAgentIngress',
 'verifyOAuthClient','verifyBillingIngress','verifyUsageIngress',
 'verifyDeviceChannelIngress','verifyChannelEnvelope'];
test('Gold Account Portal /me is PostgreSQL verified profile, not stale a.plan or JSON session',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-profile-socket-'));
 fs.chmodSync(root,0o700);
 const dir=path.join(root,'run');fs.mkdirSync(dir,{mode:0o700});
 const coreSocket=path.join(dir,'gold-core.sock');
 const env={LIGHT_REMOTE_GOLD_INDEPENDENT:'1',LIGHT_REMOTE_GOLD_ROOT:root};
 const core={authenticate:async token=>{
  if(token!==TOKEN)throw Object.assign(Error('gold_auth_invalid_session'),
   {code:'gold_auth_invalid_session',status:401});
  return{accountId:'acct_verified',sessionId:'as_verified',
   email:'verified@local.invalid',groupId:'grp_quality',
   plan:'pro',expiresAt:Date.parse('2026-11-17T00:00:00Z')};
 }};
 let ledger=true,backend=true,redis=true,oldRoutes=0,goldCore,operator;
 const recorded=[];
 const pool={query:async(sql,params=[])=>{
  if(!backend)throw Error('pg_down');
  if(sql==='SELECT 1 AS gold_ready')return{rows:[{gold_ready:1}]};
  recorded.push({sql,params});
  assert(sql.includes('FROM lr_accounts a LEFT JOIN LATERAL'));
  assert(sql.includes("a.status='active'"));
  assert(sql.includes("revoked_at IS NULL"));
  assert.deepEqual(params,['acct_verified']);
  return{rows:[{account_id:'acct_verified',plan:'pro',status:'active',
   email_verified:true,password_enabled:true,google_sub:null,
   created_at:new Date('2026-09-10T00:00:00Z'),
   last_login_at:new Date('2026-10-17T00:00:00Z'),
   entitlement_id:ledger?'ent_pro_active':null,
   kind:ledger?'personal_pro':null,
   source:ledger?'paddle':null,source_ref:ledger?'trusted_event':null,
   effective_at:ledger?new Date('2026-10-01T00:00:00Z'):null,
   valid_until:ledger?new Date('2026-11-01T00:00:00Z'):null}]};
 },connect:async()=>({query:async()=>({rows:[]}),release(){}})};
 const verifiers=Object.fromEntries(required.map(key=>[key,async()=>null]));
 try{
  goldCore=await startGoldCoreApi({env,socketPath:coreSocket,verifiers,
   openPlane:async()=>({pool,redis:{ping:async()=>redis?'PONG':'NO'},
    postgres:{database:'light_remote_gold_dev',schemaVersion:20},
    cache:{prefix:'gold:profile:test:'},close:async()=>{}}),
   openCore:()=>core,openTeam:()=>({})});
  const bridge=createGoldOperatorNotificationBridge({
   socketPath:notificationCoreSocket({...env,LR_GOLD_CORE_SOCKET:coreSocket}),
   accountRoutes:true,accountProfileRoutes:true,notificationRoutes:true});
  operator=http.createServer(async(req,res)=>{
   if(await bridge(req,res,new URL(req.url,'http://operator.local')))return;
   oldRoutes++;
   res.writeHead(500,{'content-type':'application/json'});
   res.end(JSON.stringify({error:'legacy_account_registry_must_not_run'}));
  });
  await new Promise(resolve=>operator.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+operator.address().port;
  const request=async(token,route='/v1/accounts/me')=>{
   const res=await fetch(base+route,{
    headers:token?{'x-light-account-session':token}:{}});
   const text=await res.text();
   return{status:res.status,data:text.startsWith('{')?JSON.parse(text):text};
  };
  assert.equal((await request(null)).status,401);
  assert.equal((await request('json_registry_session')).status,401);
  const paid=await request(TOKEN,'/v1/accounts/me?accountId=acct_attacker&plan=vip');
  assert.equal(paid.status,200);
  assert.equal(paid.data.ok,true);
  assert.equal(paid.data.account.accountId,'acct_verified');
  assert.equal(paid.data.account.email,'verified@local.invalid');
  assert.equal(paid.data.account.groupId,'grp_quality');
  assert.equal(paid.data.account.plan,'pro');
  assert.equal(paid.data.account.entitlement.plan,'pro');
  assert.equal(paid.data.account.entitlement.kind,'personal_pro');
  assert.equal(paid.data.account.teamEligible,true);
  assert.equal(paid.data.account.policyAccepted,false);
  assert.deepEqual(paid.data.account.authProviders,['password']);
  assert.equal(paid.data.session.sessionId,'as_verified');
  ledger=false;
  const free=await request(TOKEN);
  assert.equal(free.status,200);
  assert.equal(free.data.account.plan,'free',
   'Expired/revoked paid ledger must not be inferred from a.plan');
  assert.equal(free.data.account.entitlement.plan,'free');
  assert.equal(free.data.account.teamEligible,false);
  assert.equal(free.data.account.paid,false);
  assert.deepEqual(recorded.map(x=>x.params),
   [['acct_verified'],['acct_verified']]);
  redis=false;
  assert.equal((await request(TOKEN)).status,503);
  redis=true;backend=false;
  assert.equal((await request(TOKEN)).status,503);
  assert.equal(oldRoutes,0);
 }finally{
  if(operator)await new Promise(resolve=>operator.close(resolve));
  await goldCore?.close();
  fs.rmSync(root,{force:true,recursive:true});
 }
});
