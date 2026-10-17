import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGoldCoreHttpHandler} from '../src/http/gold-core-http.mjs';

async function setup({wall=false,agent=false,oauth=false,billing=false,usage=false}={}){
 const called=[];
 const core={
  registerVerifiedAccount:async args=>{called.push(['signup',args]);return {account_id:'acct_1'}},
  login:async args=>{called.push(['login',args]);return {
   token:'T'.repeat(48),account:{accountId:'acct_1'},sessionId:'as_1'}},
  authenticate:async bearer=>{called.push(['authenticate',bearer]);return {accountId:'acct_1',email:'a@b.test'}},
  logout:async bearer=>{called.push(['logout',bearer]);return {loggedOut:true}},
  registerDevice:async args=>{called.push(['device',args]);return {device_id:'dev_1'}},
  connectDevice:async args=>{called.push(['connect',args]);return {connectionId:'conn_1'}},
  requestPairing:async args=>{called.push(['requestAB',args]);return {requestId:'ab_1'}},
  approvePairing:async args=>{called.push(['approveAB',args]);return {approved:true}},
  consumeOAuth:async args=>{called.push(['oauth',args]);return {accountId:'acct_1'}},
  ingestPaddle:async args=>{called.push(['paddle',args]);return {recorded:true}}
 };
 const team={
  createTeam:async args=>{called.push(['teamCreate',args]);return {teamId:'team_1'}},
  inviteMember:async args=>{called.push(['teamInvite',args]);return {inviteCode:'hash-not-plain'}},
  acceptInvite:async args=>{called.push(['teamAccept',args]);return {member:'acct_2'}},
  shareDevice:async args=>{called.push(['teamShare',args]);return {shared:true}},
  removeMember:async args=>{called.push(['teamRemove',args]);return {revoked:true}},
  chargeToolCall:async args=>{called.push(['usage',args]);return {recorded:true}}
 };
 const router=createGoldCoreHttpHandler({
  core,team,
  approveWallRequest:async()=>wall?{authorized:true,source:'trusted-wall-socket'}:null,
  verifyAgentIngress:async()=>agent?{agentId:'agent_verified',agentProof:'signed'}:null,
  verifyOAuthClient:async()=>oauth?{authorized:true,clientId:'oauth_verified'}:null,
  verifyBillingIngress:async()=>billing?{authorized:true,payload:'RAW_SIGNED_BYTES',signature:'verified-header'}:null,
  verifyUsageIngress:async()=>usage?{authorized:true,signedEvent:'immutable-signed-job'}:null
 });
 const server=http.createServer(async(req,res)=>{
  if(!(await router(req,res))){res.statusCode=404;res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(path,{method='POST',body={},bearer=null,headers={},rawBody=null}={})=>{
  const hdr={...(method!=='GET'&&body!==null?{'content-type':'application/json'}:{}),...headers};
  if(bearer)hdr.authorization='Bearer '+bearer;
  const response=await fetch(base+path,{method,headers:hdr,
   body:method==='GET'||body===null?undefined:(rawBody??JSON.stringify(body))});
  const text=await response.text();
  return {status:response.status,headers:response.headers,value:text?JSON.parse(text):null};
 };
 return {request,called,close:()=>new Promise(resolve=>server.close(resolve))};
}
const BEARER='B'.repeat(48);
test('Gold Core HTTP: register/login/me/logout map to PostgreSQL authority; no legacy registries',async()=>{
 const {request,called,close}=await setup();
 try{
  let r=await request('/v1/accounts/register',{body:{
   accountId:'acct_1',email:'a@b.test',password:'StrongPassword!',emailChallenge:'trusted-proof'}});
  assert.equal(r.status,201);
  assert.deepEqual(called.at(-1),['signup',{accountId:'acct_1',
   email:'a@b.test',password:'StrongPassword!',proof:'trusted-proof'}]);
  r=await request('/v1/accounts/login',{body:{email:'a@b.test',password:'StrongPassword!'}});
  assert.equal(r.status,200);
  assert.equal(r.value.token.length,48);
  r=await request('/v1/accounts/me',{method:'GET'});
  assert.equal(r.status,401);
  assert.equal(r.value.error,'gold_http_bearer_required');
  r=await request('/v1/accounts/me',{method:'GET',bearer:BEARER});
  assert.equal(r.status,200);assert.equal(r.value.account.accountId,'acct_1');
  r=await request('/v1/accounts/logout',{bearer:BEARER});
  assert.equal(r.status,200);assert.equal(called.at(-1)[0],'logout');
  assert.equal(r.headers.get('cache-control'),'no-store');
 }finally{await close()}
});
test('Gold Core HTTP: Device and Team accept bearer, do not accept account override from body',async()=>{
 const {request,called,close}=await setup();
 try{
  const req=await request('/v1/devices/register',{bearer:BEARER,body:{
   deviceId:'dev_1',nodeId:'node_1',publicIdentityKey:'PUB',
   deviceIdentityProof:'SIGNED',accountId:'acct_attacker'}});
  assert.equal(req.status,201);
  assert.equal(called.at(-1)[1].accountId,undefined);
  assert.equal(called.at(-1)[1].sessionToken,BEARER);
  let r=await request('/v1/devices/connect',{body:{deviceId:'dev_1'}});
  assert.equal(r.status,401);
  r=await request('/v1/devices/connect',{bearer:BEARER,body:{deviceId:'dev_1'}});
  assert.equal(r.status,200);
  for(const [path,body,name] of [
   ['/v1/team/create',{ownerChallenge:'verified'},'teamCreate'],
   ['/v1/team/invite',{teamId:'team_1',recipientEmail:'b@c.test',ownerChallenge:'verified'},'teamInvite'],
   ['/v1/team/accept',{inviteCode:'one-time'},'teamAccept'],
   ['/v1/team/share-device',{teamId:'team_1',deviceId:'dev_1',ownerChallenge:'verified'},'teamShare'],
   ['/v1/team/remove-member',{teamId:'team_1',memberAccountId:'acct_2',ownerChallenge:'verified'},'teamRemove']]){
    r=await request(path,{bearer:BEARER,body});
    assert.equal(r.status,path.endsWith('create')||path.endsWith('invite')?201:200);
    assert.equal(called.at(-1)[0],name);
  }
 }finally{await close()}
});
test('Gold Core HTTP: external ingress cannot forge Local Wall/Agent/OAuth/Paddle/Usage authority',async()=>{
 const {request,called,close}=await setup();
 try{
  for(const [path,body] of [
   ['/v1/pairing/request',{agentId:'forged',agentProof:'fake',connectionId:'conn_1'}],
   ['/v1/pairing/approve',{requestId:'ab_1',approvalCode:'ABCDE-12345',authorized:true}],
   ['/v1/oauth/token/consume',{purpose:'authorization_code',token:'fake',clientId:'forged',authorized:true}],
   ['/v1/billing/paddle/webhook',{event:'paid',signature:'fake',authorized:true}],
   ['/v1/internal/usage/charge',{ownerAccountId:'acct_1',calls:500,authorized:true}]
  ]){
   const r=await request(path,{body});assert.equal(r.status,401,path);
  }
  assert.equal(called.length,0);
 }finally{await close()}
});
test('Gold Core HTTP: trusted ingress binds identity; request body cannot replace verified principals',async()=>{
 const {request,called,close}=await setup({wall:true,agent:true,oauth:true,billing:true,usage:true});
 try{
  const cases=[
   ['/v1/pairing/request',{connectionId:'conn_1',agentId:'forged',agentProof:'FAKE'},'requestAB'],
   ['/v1/pairing/approve',{requestId:'ab_1',approvalCode:'ABCDE-12345',wallContext:{authorized:false}},'approveAB'],
   ['/v1/oauth/token/consume',{purpose:'authorization_code',token:'T'.repeat(32),clientId:'forged'},'oauth'],
   ['/v1/billing/paddle/webhook',{signature:'forged',payload:'incorrect'},'paddle'],
   ['/v1/internal/usage/charge',{signedEvent:'FAKE',ownerAccountId:'forged'},'usage']
  ];
  for(const [path,body,name] of cases){
   const r=await request(path,{body});
   assert([200,201].includes(r.status),path);
   assert.equal(called.at(-1)[0],name);
  }
  assert.equal(called[0][1].agentId,'agent_verified');
  assert.equal(called[0][1].agentProof,'signed');
  assert.equal(called[1][1].wallContext.source,'trusted-wall-socket');
  assert.equal(called[2][1].clientId,'oauth_verified');
  assert.equal(called[3][1].signature,'verified-header');
  assert.equal(called[4][1].signedEvent,'immutable-signed-job');
 }finally{await close()}
});
test('Gold Core HTTP rejects unsupported methods, malformed JSON, oversize and unknown paths',async()=>{
 const {request,close}=await setup();
 try{
  let r=await request('/v1/accounts/login',{method:'GET'});
  assert.equal(r.status,405);
  r=await request('/v1/accounts/register',{body:{accountId:1},headers:{'content-type':'text/plain'}});
  assert.equal(r.status,415);
  r=await request('/v1/accounts/register',{rawBody:'{not valid',body:{}});
  assert.equal(r.status,400);
  r=await request('/v1/accounts/register',{body:{oversize:'x'.repeat(40000)}});
  assert.equal(r.status,413);
  r=await request('/v1/unknown',{body:{}});
  assert.equal(r.status,404);
 }finally{await close()}
});
