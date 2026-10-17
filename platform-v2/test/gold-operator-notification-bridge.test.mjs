import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {notificationCoreSocket,createGoldOperatorNotificationBridge}
 from '../../operator-host/gold-notification-core-bridge.mjs';

const ID='sys_123e4567-e89b-42d3-a456-426614174000';
const TOKEN='T'.repeat(48);
const setup=async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-operator-bridge-'));
 fs.chmodSync(root,0o700);
 const runtime=path.join(root,'run');fs.mkdirSync(runtime,{mode:0o700});
 const socket=path.join(runtime,'gold-core.sock'),received=[];
 const core=http.createServer(async(req,res)=>{
  let body='';
  for await(const chunk of req)body+=chunk.toString('utf8');
  received.push({path:req.url,method:req.method,headers:req.headers,body});
  const valid=req.headers.authorization==='Bearer '+TOKEN;
  const admin=req.headers['x-light-operator-admin-proof']==='signed-candidate';
  let status=200,result={ok:true};
  if(req.url.startsWith('/v1/admin/')){
   if(!admin){status=401;result={ok:false,error:'gold_notification_admin_unverified'}}
   else result={ok:true,notification:{notificationId:ID,publishedBy:'acct_server_verified'}};
  }else if(!valid){status=401;result={ok:false,error:'gold_http_bearer_required'}}
  else result={ok:true,notifications:[{notificationId:ID}],unreadCount:1};
  res.writeHead(status,{'content-type':'application/json'});
  res.end(JSON.stringify(result));
 });
 await new Promise(resolve=>core.listen(socket,resolve));
 fs.chmodSync(socket,0o600);
 const route=createGoldOperatorNotificationBridge({socketPath:notificationCoreSocket({
  LIGHT_REMOTE_GOLD_INDEPENDENT:'1',LIGHT_REMOTE_GOLD_ROOT:root,
  LR_GOLD_CORE_SOCKET:socket
 })});
 const fallbacks=[];
 const operator=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://operator.local');
  if(await route(req,res,url))return;
  fallbacks.push(url.pathname);
  res.writeHead(404,{'content-type':'application/json'});
  res.end(JSON.stringify({ok:false,error:'legacy_route_not_executed'}));
 });
 await new Promise(resolve=>operator.listen(0,'127.0.0.1',resolve));
 const addr='http://127.0.0.1:'+operator.address().port;
 const send=async(url,{method='GET',body=null,token=null,extra={}}={})=>{
  const response=await fetch(addr+url,{method,
   headers:{...(token?{authorization:'Bearer '+token}:{}),
    'x-light-account-session':'LEGACY-JSON-SESSION-MUST-NOT-LEAK',
    ...extra,...(body?{'content-type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
 };
 const close=async()=>{
  await new Promise(resolve=>operator.close(resolve));
  await new Promise(resolve=>core.close(resolve));
  fs.rmSync(root,{force:true,recursive:true});
 };
 return {root,runtime,socket,core,operator,send,received,fallbacks,close};
};
test('Operator Gold notification bridge forwards bearer to Core, not JSON identity or query',async()=>{
 const f=await setup();
 try{
  const get=await f.send('/v1/accounts/notifications?accountId=acct_victim&groupId=grp_fake',
   {token:TOKEN});
  assert.equal(get.status,200);
  assert.equal(get.data.unreadCount,1);
  assert.equal(f.received[0].path,'/v1/accounts/notifications');
  assert.equal(f.received[0].headers.authorization,'Bearer '+TOKEN);
  assert.equal(f.received[0].headers['x-light-account-session'],undefined);
  assert.deepEqual(f.fallbacks,[]);
  const noBearer=await f.send('/v1/accounts/notifications');
  assert.equal(noBearer.status,401);
  const read=await f.send('/v1/accounts/notifications/read',{
   method:'POST',token:TOKEN,body:{notificationId:ID,accountId:'acct_victim'}});
  assert.equal(read.status,200);
  assert.deepEqual(JSON.parse(f.received.at(-1).body),{
   notificationId:ID,accountId:'acct_victim'});
  assert.deepEqual(f.fallbacks,[]);
 }finally{await f.close()}
});
test('Owner admin proof is transported but not fabricated from body or legacy admin session',async()=>{
 const f=await setup();
 try{
  const rejected=await f.send('/v1/admin/notifications/publish',{
   method:'POST',body:{authorized:true,publishedBy:'superuser'}});
  assert.equal(rejected.status,401);
  const approved=await f.send('/v1/admin/notifications/publish',{
   method:'POST',body:{publishedBy:'fake'},
   extra:{'x-light-operator-admin-proof':'signed-candidate'}});
  assert.equal(approved.status,200);
  assert.equal(approved.data.notification.publishedBy,'acct_server_verified');
  assert.equal(f.received.at(-1).headers['x-light-operator-admin-proof'],'signed-candidate');
  const canceled=await f.send('/v1/admin/notifications/'+ID+'/cancel',{
   method:'POST',extra:{'x-light-operator-admin-proof':'signed-candidate'}});
  assert.equal(canceled.status,200);
  assert.deepEqual(f.fallbacks,[]);
 }finally{await f.close()}
});
test('Unsupported Operator paths continue unchanged; core outage never falls back to JSON writer',async()=>{
 const f=await setup();
 try{
  assert.equal((await f.send('/v1/non-notification-path')).status,404);
  assert.deepEqual(f.fallbacks,['/v1/non-notification-path']);
  await new Promise(resolve=>f.core.close(resolve));
  const unavailable=await f.send('/v1/accounts/notifications',{token:TOKEN});
  assert.equal(unavailable.status,503);
  assert.equal(unavailable.data.error,'gold_notification_core_unavailable');
  assert.deepEqual(f.fallbacks,['/v1/non-notification-path']);
 }finally{
  await new Promise(resolve=>f.operator.close(resolve));
  fs.rmSync(f.root,{force:true,recursive:true});
 }
});
test('Bridge enforces bounded request size and refuses untrusted Core socket paths',async()=>{
 const f=await setup();
 try{
  const big=await f.send('/v1/accounts/notifications/read',{method:'POST',
   token:TOKEN,body:{notificationId:ID,fill:'X'.repeat(33000)}});
  assert.equal(big.status,413);
  assert(!f.received.some(x=>x.body.includes('X'.repeat(200))));
  const env={LIGHT_REMOTE_GOLD_INDEPENDENT:'1',
   LIGHT_REMOTE_GOLD_ROOT:f.root,LR_GOLD_CORE_SOCKET:f.socket};
  assert.equal(notificationCoreSocket(env),f.socket);
  assert.throws(()=>notificationCoreSocket({...env,LIGHT_REMOTE_GOLD_INDEPENDENT:'0'}),
   /gold_notification_bridge_independent_mode_required/);
  assert.throws(()=>notificationCoreSocket({...env,LR_GOLD_CORE_SOCKET:'/run/gpt-vps-operator/operator.sock'}),
   /gold_notification_core_socket_outside_root/);
  fs.chmodSync(f.socket,0o666);
  assert.throws(()=>notificationCoreSocket(env),/gold_notification_core_socket_not_private/);
 }finally{await f.close()}
});
