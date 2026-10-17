import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGoldCoreHttpHandler} from '../src/http/gold-core-http.mjs';

async function harness({authorized=true,failure=null}={}){
 const calls=[],base=()=>null;
 const channel=Object.fromEntries(
  [['connect','connected'],['renew','renewed'],['disconnect','closed'],
   ['setGrace','graceSet']].map(([action,key])=>[
    action,async args=>{
     calls.push([action,args]);
     if(failure)throw failure;
     return {[key]:true,deviceId:'dev_verified',connectionId:'conn_verified'};
    }
   ]));
 const handler=createGoldCoreHttpHandler({core:{},team:{},deviceChannel:channel,
  approveWallRequest:base,verifyAgentIngress:base,verifyOAuthClient:base,
  verifyBillingIngress:base,verifyUsageIngress:base,
  verifyDeviceChannelIngress:async({body,purpose})=>
   authorized?{authorized:true,signedEnvelope:'sealed:'+purpose}:null});
 const srv=http.createServer(async(req,res)=>{
  if(!await handler(req,res)){res.writeHead(404);res.end()}
 });
 await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
 const baseUrl='http://127.0.0.1:'+srv.address().port;
 const request=async(path,body={},method='POST')=>{
  const response=await fetch(baseUrl+path,{method,
   headers:{'content-type':'application/json'},
   ...(method==='GET'?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json().catch(()=>null)};
 };
 return {calls,request,close:()=>new Promise(resolve=>srv.close(resolve))};
}

test('Gold signed Device Channel all four routes ignore caller identity and connection parameters',async()=>{
 const h=await harness();
 try{
  for(const [action,method] of [
   ['connect','connect'],['renew','renew'],['grace','setGrace'],
   ['disconnect','disconnect']]){
   const response=await h.request('/v1/device-channel/'+action,{
    deviceId:'dev_forged',accountId:'acct_forged',ownerAccountId:'attacker',
    nodeId:'node_forged',connectionId:'conn_forged',
    leaseMs:9999999999,reconnectGraceMs:9999999999,reason:'fake'
   });
   assert.equal(response.status,200,action);
   assert.equal(response.body.connection.deviceId,'dev_verified');
   assert.equal(h.calls.at(-1)[0],method);
   assert.deepEqual(h.calls.at(-1)[1],{signedEnvelope:'sealed:'+action},
    'No unsigned fields may escape HTTP adapter into PostgreSQL authority');
  }
 }finally{await h.close()}
});
test('Gold signed Device Channel rejects unsigned request before touching PG authority',async()=>{
 const h=await harness({authorized:false});
 try{
  for(const action of ['connect','renew','grace','disconnect']){
   const response=await h.request('/v1/device-channel/'+action,{
    signedEnvelope:'self-asserted',ownerAccountId:'acct_fake'});
   assert.equal(response.status,401);
   assert.equal(response.body.error,'gold_channel_trusted_ingress_required');
  }
  assert.equal(h.calls.length,0);
 }finally{await h.close()}
});
test('Gold Channel propagates revoked Device/connection as 403 and unsupported method as 405',async()=>{
 const revoked=Object.assign(new Error('gold_channel_connection_invalid_or_expired'),
  {code:'gold_channel_connection_invalid_or_expired',status:403});
 const h=await harness({failure:revoked});
 try{
  const denied=await h.request('/v1/device-channel/renew',{connectionId:'conn_old'});
  assert.equal(denied.status,403);
  assert.equal(denied.body.error,'gold_channel_connection_invalid_or_expired');
  const method=await h.request('/v1/device-channel/renew',{},'GET');
  assert.equal(method.status,405);
 }finally{await h.close()}
});
test('Gold Channel requires all four authority operations and a trusted HTTP verifier',()=>{
 const base=async()=>null;
 const core={},team={};
 const rest={core,team,approveWallRequest:base,verifyAgentIngress:base,
  verifyOAuthClient:base,verifyBillingIngress:base,verifyUsageIngress:base};
 assert.throws(()=>createGoldCoreHttpHandler({...rest,
  deviceChannel:{connect(){}}}),/gold_http_signed_device_channel_required/);
});
