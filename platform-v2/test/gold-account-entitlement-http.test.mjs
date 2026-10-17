import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {GoldPgAccountEntitlementAuthority}
 from '../src/storage/gold-account-entitlement-authority.mjs';
import {createGoldCoreHttpHandler} from '../src/http/gold-core-http.mjs';

const TOKEN='E'.repeat(48),NOW=Date.parse('2026-10-17T14:00:00Z');
const mk=(options={})=>{
 const log=[],state={
  accountId:'acct_real',plan:'pro',status:'active',
  emailVerified:true,kind:'personal_pro',validUntil:NOW+86400000,
  revoked:false,...options
 };
 const core={authenticate:async value=>{
  log.push({action:'authenticate',value});
  if(value!==TOKEN)throw Object.assign(Error('gold_auth_invalid_session'),
   {code:'gold_auth_invalid_session',status:401});
  return{accountId:state.accountId,sessionId:'as_real',
   email:'member@local.invalid',groupId:'grp_quality',expiresAt:NOW+3600000};
 }};
 const pool={query:async(sql,params)=>{
  log.push({action:'sql',sql,params});
  assert.equal(params.length,1);
  assert.equal(params[0],state.accountId);
  for(const snippet of ["a.status='active'","a.email_verified=true",
   "revoked_at IS NULL","effective_at<=now()",
   "valid_until>now()","owner_account_id=a.account_id",
   "(a.plan='pro'","a.plan='vip'"])
   assert(sql.includes(snippet),snippet);
  if(state.status!=='active'||!state.emailVerified)return{rows:[]};
  const entitled=!state.revoked&&state.validUntil>NOW&&
   ((state.plan==='pro'&&['personal_pro','pro_team','trial'].includes(state.kind))||
    (state.plan==='vip'&&state.kind==='vip'));
  return{rows:[{account_id:state.accountId,status:state.status,
   plan:state.plan,email_verified:state.emailVerified,password_enabled:true,
   google_sub:null,created_at:new Date(NOW-604800000),
   last_login_at:new Date(NOW-60000),
   entitlement_id:entitled?'ent_paid_1':null,
   kind:entitled?state.kind:null,source:entitled?'paddle':null,
   source_ref:entitled?'subscription_mock':null,
   effective_at:entitled?new Date(NOW-86400000):null,
   valid_until:entitled?new Date(state.validUntil):null}]};
 }};
 return{log,state,core,pool,
  authority:new GoldPgAccountEntitlementAuthority({pool,core})};
};
test('Entitlement read uses only authenticated account ID; Pro/VIP require matching live ledger',async()=>{
 const f=mk();
 const pro=await f.authority.view({sessionToken:TOKEN,accountId:'acct_attacker'});
 assert.equal(pro.accountId,'acct_real');
 assert.equal(pro.plan,'pro');
 assert.equal(pro.paid,true);
 assert.equal(pro.teamEligible,true);
 assert.equal(pro.policyAccepted,false);
 assert.equal(pro.entitlement.kind,'personal_pro');
 assert.equal(pro.entitlement.validUntil,NOW+86400000);
 assert.deepEqual(f.log.filter(x=>x.action==='sql').map(x=>x.params),
  [['acct_real']]);
 f.state.kind='trial';
 assert.equal((await f.authority.view({sessionToken:TOKEN})).teamEligible,false);
 f.state.plan='vip';f.state.kind='vip';
 const vip=await f.authority.view({sessionToken:TOKEN});
 assert.equal(vip.plan,'vip');
 assert.equal(vip.paid,true);
 assert.equal(vip.teamEligible,false);
});
test('Revoked, expired and mismatched entitlements never infer Pro from account.plan',async()=>{
 const f=mk();
 f.state.revoked=true;
 assert.deepEqual((await f.authority.view({sessionToken:TOKEN})).entitlement,null);
 f.state.revoked=false;f.state.validUntil=NOW-1;
 assert.equal((await f.authority.view({sessionToken:TOKEN})).plan,'free');
 f.state.validUntil=NOW+5000;f.state.kind='vip';
 assert.equal((await f.authority.view({sessionToken:TOKEN})).paid,false);
 f.state.kind='pro_team';
 assert.equal((await f.authority.view({sessionToken:TOKEN})).teamEligible,true);
 f.state.status='admin_disabled';
 await assert.rejects(()=>f.authority.view({sessionToken:TOKEN}),
  /gold_account_entitlement_account_inactive/);
 f.state.status='active';f.state.emailVerified=false;
 await assert.rejects(()=>f.authority.view({sessionToken:TOKEN}),
  /gold_account_entitlement_account_inactive/);
});
test('Verified Account profile projects paid ledger, group, session and provider without stale plan privileges',async()=>{
 const f=mk();
 const profile=await f.authority.profile({sessionToken:TOKEN,accountId:'acct_impostor'});
 assert.equal(profile.account.accountId,'acct_real');
 assert.equal(profile.account.email,'member@local.invalid');
 assert.equal(profile.account.groupId,'grp_quality');
 assert.equal(profile.account.emailVerified,true);
 assert.deepEqual(profile.account.authProviders,['password']);
 assert.equal(profile.account.plan,'pro');
 assert.equal(profile.account.entitlement.plan,'pro');
 assert.equal(profile.account.entitlement.kind,'personal_pro');
 assert.equal(profile.account.teamEligible,true);
 assert.equal(profile.account.policyAccepted,false);
 assert.equal(profile.session.sessionId,'as_real');
 assert.equal(profile.session.expiresAt,NOW+3600000);
 assert.equal(f.log.filter(x=>x.action==='authenticate').length,1,
  'Profile derives identity from only the same Gold PostgreSQL bearer');
 f.state.revoked=true;
 const downgraded=await f.authority.profile({sessionToken:TOKEN});
 assert.equal(downgraded.account.plan,'free');
 assert.equal(downgraded.account.entitlement.plan,'free');
 assert.equal(downgraded.account.teamEligible,false);
 assert.equal(downgraded.account.paid,false);
});
test('Entitlement read requires a valid bearer, fails closed on PostgreSQL outage',async()=>{
 const f=mk();
 await assert.rejects(()=>f.authority.view({sessionToken:'forged'}),
  /gold_auth_invalid_session/);
 assert.equal(f.log.filter(x=>x.action==='sql').length,0);
 f.pool.query=async()=>{throw Error('pg_down')};
 await assert.rejects(()=>f.authority.view({sessionToken:TOKEN}),/pg_down/);
 assert.throws(()=>new GoldPgAccountEntitlementAuthority({pool:{}}),
  /gold_account_entitlement_pool_required/);
});
test('Core authenticated entitlements HTTP route rejects body/query identity overrides',async()=>{
 const f=mk({kind:'pro_team'});
 const stub=async()=>null;
 const handler=createGoldCoreHttpHandler({core:f.core,team:{},
  accountEntitlements:f.authority,
  approveWallRequest:stub,verifyAgentIngress:stub,verifyOAuthClient:stub,
  verifyBillingIngress:stub,verifyUsageIngress:stub});
 const server=http.createServer(async(req,res)=>{
  if(!await handler(req,res)){res.writeHead(404);res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const unsigned=await fetch(base+'/v1/accounts/entitlements');
  assert.equal(unsigned.status,401);
  const permitted=await fetch(base+
   '/v1/accounts/entitlements?accountId=acct_attacker&plan=vip',{
    headers:{authorization:'Bearer '+TOKEN}});
  assert.equal(permitted.status,200);
  const record=await permitted.json();
  assert.equal(record.accountId,'acct_real');
  assert.equal(record.plan,'pro');
  assert.equal(record.teamEligible,true);
  assert.equal((await fetch(base+'/v1/accounts/entitlements',{
   method:'POST',headers:{authorization:'Bearer '+TOKEN}})).status,405);
  const profileResponse=await fetch(base+'/v1/accounts/profile?accountId=acct_attacker',{
   headers:{authorization:'Bearer '+TOKEN}});
  assert.equal(profileResponse.status,200);
  const profile=await profileResponse.json();
  assert.equal(profile.account.accountId,'acct_real');
  assert.equal(profile.account.plan,'pro');
  assert.equal(profile.account.entitlement.kind,'pro_team');
  assert.equal(profile.session.sessionId,'as_real');
 }finally{await new Promise(resolve=>server.close(resolve))}
});
