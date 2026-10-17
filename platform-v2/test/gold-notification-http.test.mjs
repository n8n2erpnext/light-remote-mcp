import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGoldCoreHttpHandler} from '../src/http/gold-core-http.mjs';

const TOKEN='A'.repeat(48);
const ID='sys_123e4567-e89b-42d3-a456-426614174000';
async function fixture({admin=true,adminConfigured=true,pgError=null}={}){
 const events=[];
 const core={authenticate:async value=>{
  events.push(['auth',value]);
  if(value!==TOKEN)throw Object.assign(Error('gold_login_invalid'),{status:401,code:'gold_login_invalid'});
  return {accountId:'acct_member',plan:'free',groupId:'grp_public'};
 }};
 const notifications={
  inbox:async(accountId,account)=>{
   events.push(['inbox',accountId,account]);
   if(pgError)throw pgError;
   return {notifications:[{notificationId:ID,title:'Hello'}],unreadCount:1};
  },
  markRead:async(accountId,notificationId,account)=>{
   events.push(['read',accountId,notificationId,account]);
   if(pgError)throw pgError;
   return {ok:true};
  },
  list:async()=>{events.push(['list']);return {notifications:[{notificationId:ID}]}},
  publish:async data=>{events.push(['publish',data]);return {notificationId:ID,publishedBy:data.publishedBy}},
  cancel:async(notificationId,options)=>{
   events.push(['cancel',notificationId,options]);return {notificationId,status:'canceled'};
  }
 };
 const base=async()=>null;
 const route=createGoldCoreHttpHandler({core,team:{},notifications,
  approveWallRequest:base,verifyAgentIngress:base,verifyOAuthClient:base,
  verifyBillingIngress:base,verifyUsageIngress:base,
  ...(adminConfigured?{verifyNotificationAdmin:async()=>
   admin?{authorized:true,adminAccountId:'acct_trusted_admin'}:null}:{})});
 const server=http.createServer(async(req,res)=>{
  if(!await route(req,res)){res.writeHead(404);res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const send=async(path,{method='GET',body=null,bearer=null}={})=>{
  const response=await fetch(url+path,{method,
   headers:{...(bearer?{authorization:'Bearer '+bearer}:{}),
    ...(body?{'content-type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json().catch(()=>null)};
 };
 return {events,send,close:()=>new Promise(resolve=>server.close(resolve))};
}
test('Account Notification inbox derives member identity and audience from verified session only',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.send('/v1/accounts/notifications')).status,401);
  const r=await f.send('/v1/accounts/notifications?accountId=acct_victim',{bearer:TOKEN});
  assert.equal(r.status,200);
  assert.equal(r.body.unreadCount,1);
  const call=f.events.find(x=>x[0]==='inbox');
  assert.equal(call[1],'acct_member');
  assert.deepEqual(call[2],{accountId:'acct_member',plan:'free',groupId:'grp_public'});
 }finally{await f.close()}
});
test('Mark notification read uses authenticated actor and payload only for notification ID',async()=>{
 const f=await fixture();
 try{
  const deny=await f.send('/v1/accounts/notifications/read',{method:'POST',
   body:{notificationId:ID,accountId:'acct_victim'}});
  assert.equal(deny.status,401);
  const allowed=await f.send('/v1/accounts/notifications/read',{method:'POST',
   bearer:TOKEN,body:{notificationId:ID,accountId:'acct_victim',readAt:0}});
  assert.equal(allowed.status,200);
  assert.equal(allowed.body.ok,true);
  const call=f.events.find(x=>x[0]==='read');
  assert.equal(call[1],'acct_member');
  assert.equal(call[2],ID);
  assert.equal(call[3].accountId,'acct_member');
 }finally{await f.close()}
});
test('Admin notification routes require independent trusted admin ingress, never body-admin flags',async()=>{
 const no=await fixture({admin:false});
 try{
  for(const [url,method,body] of [
   ['/v1/admin/notifications','GET',null],
   ['/v1/admin/notifications/publish','POST',{authorized:true,title:'Forged'}],
   ['/v1/admin/notifications/'+ID+'/cancel','POST',{authorized:true}]]){
   const denied=await no.send(url,{method,body});
   assert.equal(denied.status,401,url);
  }
  assert(!no.events.some(x=>['list','publish','cancel'].includes(x[0])));
 }finally{await no.close()}
 const yes=await fixture();
 try{
  assert.equal((await yes.send('/v1/admin/notifications')).status,200);
  const published=await yes.send('/v1/admin/notifications/publish',{method:'POST',
   body:{type:'update',title:'Status',body:'Hello everyone',publishedBy:'acct_attacker'}});
  assert.equal(published.status,201);
  assert.equal(published.body.notification.publishedBy,'acct_trusted_admin');
  const approved=await yes.send('/v1/admin/notifications/'+ID+'/cancel',{method:'POST'});
  assert.equal(approved.status,200);
  assert.deepEqual(yes.events.find(x=>x[0]==='cancel'),
   ['cancel',ID,{by:'acct_trusted_admin'}]);
  const badMethod=await yes.send('/v1/admin/notifications/'+ID+'/cancel');
  assert.equal(badMethod.status,405);
 }finally{await yes.close()}
});
test('Gold notifications fail-closed on PG error; no stale JSON fallback',async()=>{
 const f=await fixture({pgError:Error('pg_down')});
 try{
  const denied=await f.send('/v1/accounts/notifications',{bearer:TOKEN});
  assert.equal(denied.status,503);
  assert.equal(denied.body.error,'gold_http_backend_unavailable');
 }finally{await f.close()}
});
test('Gold HTTP denies incomplete notification repository before serving',()=>{
 const b=async()=>null;
 assert.throws(()=>createGoldCoreHttpHandler({core:{},team:{},
  notifications:{inbox:b},approveWallRequest:b,verifyAgentIngress:b,
  verifyOAuthClient:b,verifyBillingIngress:b,verifyUsageIngress:b}),
  /gold_http_pg_notification_authority_invalid/);
});

test('Gold admin notification routes without owner-provisioned verifier reject before PG mutation',async()=>{
 const f=await fixture({adminConfigured:false});
 try{
  const denied=await f.send('/v1/admin/notifications/publish',{
   method:'POST',body:{authorized:true,publishedBy:'root',type:'security',
    title:'Forged admin',body:'Self-declared privilege'}});
  assert.equal(denied.status,503);
  assert.equal(denied.body.error,'gold_http_backend_unavailable');
  assert(!f.events.some(x=>x[0]==='publish'));
  // The absence of admin verifier never disables authenticated member inbox.
  const inbox=await f.send('/v1/accounts/notifications',{bearer:TOKEN});
  assert.equal(inbox.status,200);
 }finally{await f.close()}
});
