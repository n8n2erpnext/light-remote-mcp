import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const express=createRequire(new URL('../../plugin-server/package.json',import.meta.url))('express');
import {createGoldSupportAccountResolver} from '../../plugin-server/gold-support-account.mjs';
import {registerSupportBackoffice} from '../../plugin-server/support-backoffice.mjs';

const ORIGIN_DATE='2026-10-17T00:00:00.000Z';
const fixtures={
 'live-pro':{accountId:'acct_pro',email:'pro@example.test',plan:'pro',
  entitlement:{entitlementId:'ent_pro',kind:'personal_pro'}},
 'team-pro':{accountId:'acct_team',email:'team@example.test',plan:'pro',
  entitlement:{entitlementId:'ent_team',kind:'pro_team'}},
 'trial':{accountId:'acct_trial',email:'trial@example.test',plan:'pro',
  entitlement:{entitlementId:'ent_trial',kind:'trial'}},
 'stale-pro':{accountId:'acct_stale',email:'stale@example.test',plan:'free',
  entitlement:{entitlementId:null,kind:null}},
 'live-vip':{accountId:'acct_vip',email:'vip@example.test',plan:'vip',
  entitlement:{entitlementId:'ent_vip',kind:'vip'}},
 'other-account':{accountId:'acct_other',email:'other@example.test',plan:'pro',
  entitlement:{entitlementId:'ent_other',kind:'personal_pro'}}
};
const cookie=token=>({cookie:'__Host-light_remote_account='+encodeURIComponent(token)});
async function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-support-auth-'));
 fs.chmodSync(root,0o700);
 const run=path.join(root,'run');fs.mkdirSync(run,{mode:0o700});
 const socketPath=path.join(run,'core.sock');
 const coreEvents=[];
 const core=http.createServer((req,res)=>{
  coreEvents.push({url:req.url,headers:req.headers});
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  const principal=fixtures[token];
  if(!principal){
   res.writeHead(token==='core-error'?503:401,{'content-type':'application/json'});
   return res.end(JSON.stringify({error:'gold_auth_invalid_session'}));
  }
  res.writeHead(200,{'content-type':'application/json'});
  return res.end(JSON.stringify({account:{...principal,status:'active',emailVerified:true,
   policyAccepted:false},session:{sessionId:'as_verified',
    expiresAt:Date.parse(ORIGIN_DATE)+86400000}}));
 });
 await new Promise(resolve=>core.listen(socketPath,resolve));
 fs.chmodSync(socketPath,0o600);
 const env={LIGHT_REMOTE_GOLD_INDEPENDENT:'1',
  LIGHT_REMOTE_GOLD_ROOT:root,LR_GOLD_CORE_SOCKET:socketPath};
 const resolveIdentity=createGoldSupportAccountResolver({env});
 const calls={get:[],enqueue:0,pump:0};
 const outbox={deliveryEnabled:false,
  pump:async()=>{calls.pump++;return{skipped:true}},
  get:async(eventId,accountId)=>{
   calls.get.push({eventId,accountId});
   return eventId==='lr.support.sample'&&accountId==='acct_pro'
    ?{eventId,status:'queued'}:null;
  },
  enqueue:async()=>{calls.enqueue++;throw Error('erpnext_delivery_must_remain_disabled')}
 };
 const oldMode=process.env.LR_GOLD_SUPPORT_OUTBOX_PG;
 process.env.LR_GOLD_SUPPORT_OUTBOX_PG='1';
 const app=express();app.use(express.json());
 const {timer,first}=registerSupportBackoffice(app,{outbox,resolveIdentity});
 const plugin=http.createServer(app);
 await new Promise(resolve=>plugin.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+plugin.address().port;
 const get=async(action,token,eventId=null)=>{
  const url=base+'/support/api?action='+encodeURIComponent(action)+
   (eventId?'&eventId='+encodeURIComponent(eventId):'');
  const res=await fetch(url,{
   headers:token?cookie(token):{}});
  return{status:res.status,data:await res.json()};
 };
 const post=async(token,body={})=>{
  const res=await fetch(base+'/support/api',{method:'POST',
   headers:{'content-type':'application/json',...cookie(token)},
   body:JSON.stringify(body)});
  return{status:res.status,data:await res.json()};
 };
 return {env,root,socketPath,core,coreEvents,plugin,calls,get,post,
  async close(){
   clearTimeout(first);clearInterval(timer);
   await new Promise(resolve=>plugin.close(resolve));
   if(core.listening)await new Promise(resolve=>core.close(resolve));
   if(oldMode===undefined)delete process.env.LR_GOLD_SUPPORT_OUTBOX_PG;
   else process.env.LR_GOLD_SUPPORT_OUTBOX_PG=oldMode;
   fs.rmSync(root,{force:true,recursive:true});
  }};
}
test('Gold Support Plugin eligibility resolves Pro/VIP from Core, never legacy JSON plan or trial',async()=>{
 const f=await fixture();
 try{
  assert.deepEqual(await f.get('eligibility'),{status:200,data:{
   ok:true,signedIn:false,eligible:false,account:null}});
  for(const [token,expected] of [
   ['live-pro',true],['team-pro',true],['live-vip',true],
   ['trial',false],['stale-pro',false],['json_account_fake',false]]){
   const r=await f.get('eligibility',token);
   assert.equal(r.status,200,token);
   assert.equal(r.data.eligible,expected,token);
   assert.equal(r.data.signedIn,token!=='json_account_fake',token);
  }
  assert(f.coreEvents.every(e=>e.url==='/v1/accounts/profile'));
  assert(f.coreEvents.every(e=>!e.headers['x-light-account-session']));
  assert.equal(f.calls.enqueue,0);
 }finally{await f.close()}
});
test('Gold Support ticket status is scoped to Core-verified PostgreSQL account',async()=>{
 const f=await fixture();
 try{
  const owned=await f.get('status','live-pro','lr.support.sample');
  assert.equal(owned.status,200);
  assert.equal(owned.data.event.eventId,'lr.support.sample');
  const other=await f.get('status','other-account','lr.support.sample');
  assert.equal(other.status,404);
  assert.deepEqual(f.calls.get,[
   {eventId:'lr.support.sample',accountId:'acct_pro'},
   {eventId:'lr.support.sample',accountId:'acct_other'}
  ]);
 }finally{await f.close()}
});
test('Gold Support never queues ERPNext delivery without owner approval and rejects Core outages',async()=>{
 const f=await fixture();
 try{
  const body={subject:'Help needed',description:'Non-sensitive test content'};
  assert.equal((await f.post('live-pro',body)).status,503);
  assert.equal((await f.post('trial',body)).status,403);
  assert.equal(f.calls.enqueue,0);
  const coreFailure=await f.get('eligibility','core-error');
  assert.equal(coreFailure.status,503);
  await new Promise(resolve=>f.core.close(resolve));
  assert.equal((await f.get('eligibility','live-pro')).status,503);
  assert.equal(f.calls.enqueue,0);
 }finally{await f.close()}
});
test('Gold Support initialization requires private in-root socket and explicit PG identity resolver',async()=>{
 const f=await fixture();
 try{
  assert.throws(()=>createGoldSupportAccountResolver({env:{
   ...f.env,LR_GOLD_CORE_SOCKET:'/run/gpt-vps-operator/operator.sock'
  }}),/gold_notification_core_socket_outside_root/);
  assert.throws(()=>registerSupportBackoffice(express(),{
   outbox:{pump:async()=>{}}
  }),/gold_support_postgres_identity_resolver_required/);
  const resolver=async()=>({signedIn:false});
  assert.throws(()=>registerSupportBackoffice(express(),{
   resolveIdentity:resolver
  }),/gold_support_postgres_outbox_required/);
  assert.throws(()=>registerSupportBackoffice(express(),{
   resolveIdentity:resolver,outbox:{deliveryEnabled:true,pump:async()=>{}}
  }),/gold_support_delivery_not_authorized/);
 }finally{await f.close()}
});
