import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGoldCoreHttpHandler} from '../src/http/gold-core-http.mjs';

async function server({authorized=false,backendError=null}={}){
 const calls=[],agentClients={
  attach:async args=>{calls.push({kind:'attach',args});if(backendError)throw backendError;
   return{client:{clientSessionId:'lrc_verified',agentId:args.agentId},
    device:{deviceId:'dev_shared'},purpose:'team-member'}},
  resolve:async args=>{calls.push({kind:'resolve',args});if(backendError)throw backendError;
   return{binding:{clientSessionId:args.clientSessionId,
    accountId:'acct_member',deviceId:'dev_shared',purpose:'team-member'}}}
 };
 const noop=async()=>null;
 const handler=createGoldCoreHttpHandler({core:{},team:{},agentClients,
  approveWallRequest:noop,verifyOAuthClient:noop,verifyBillingIngress:noop,
  verifyUsageIngress:noop,
  verifyAgentIngress:async()=>authorized?
   {agentId:'agent_verified',agentProof:'signed_host_assertion'}:null});
 const app=http.createServer(async(req,res)=>{
  if(!await handler(req,res)){res.writeHead(404);res.end()}
 });
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const request=async(route,body={})=>{
  const response=await fetch('http://127.0.0.1:'+app.address().port+route,{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  return{status:response.status,body:await response.json()};
 };
 return{request,calls,close:()=>new Promise(resolve=>app.close(resolve))};
}
test('Untrusted Agent cannot attach or resolve grant using body-controlled identity',async()=>{
 const s=await server();
 try{
  for(const route of ['/v1/agent-client/attach','/v1/agent-client/resolve']){
   const r=await s.request(route,{agentId:'forged',agentProof:'forged',grantId:'grant_test'});
   assert.equal(r.status,401);assert.equal(r.body.error,'gold_agent_ingress_unverified');
  }
  assert.equal(s.calls.length,0);
 }finally{await s.close()}
});
test('Agent attach/resolve binds verified ingress and never body actor or grant authority',async()=>{
 const s=await server({authorized:true});
 try{
  const r=await s.request('/v1/agent-client/attach',{
   grantId:'grant_team_1',pairingRequestId:'ab_approved',
   agentId:'forged',agentProof:'fake',accountId:'acct_attacker'});
  assert.equal(r.status,200);
  assert.equal(r.body.client.clientSessionId,'lrc_verified');
  assert.equal(s.calls[0].args.agentId,'agent_verified');
  assert.equal(s.calls[0].args.agentProof,'signed_host_assertion');
  assert.equal(s.calls[0].args.accountId,undefined);
  const x=await s.request('/v1/agent-client/resolve',{
   clientSessionId:'lrc_verified',deviceId:'dev_shared',agentId:'forged'});
  assert.equal(x.status,200);
  assert.equal(x.body.binding.accountId,'acct_member');
  assert.equal(s.calls[1].args.agentId,'agent_verified');
  assert.equal(s.calls[1].args.agentProof,'signed_host_assertion');
 }finally{await s.close()}
});
test('Gold Agent Core propagates revoked binding as denial with no stale fallback',async()=>{
 const error=Object.assign(new Error('gold_agent_binding_expired_or_revoked'),
  {code:'gold_agent_binding_expired_or_revoked',status:403});
 const s=await server({authorized:true,backendError:error});
 try{
  const x=await s.request('/v1/agent-client/resolve',{
   clientSessionId:'lrc_revoked',deviceId:'dev_shared'});
  assert.equal(x.status,403);
  assert.equal(x.body.error,'gold_agent_binding_expired_or_revoked');
 }finally{await s.close()}
});
