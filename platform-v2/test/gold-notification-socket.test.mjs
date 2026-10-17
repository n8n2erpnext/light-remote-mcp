import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {startGoldCoreApi} from '../src/http/gold-core-server.mjs';

const ID='sys_123e4567-e89b-42d3-a456-426614174000';
const TOKEN='A'.repeat(48);
const required=[
 'verifyIdentityProof','verifyDeviceProof','verifyAgentPrincipal',
 'verifyWallApproval','verifyPaddleSignature','verifyOwnerProof',
 'verifyUsageEvidence','approveWallRequest','verifyAgentIngress',
 'verifyOAuthClient','verifyBillingIngress','verifyUsageIngress',
 'verifyDeviceChannelIngress','verifyChannelEnvelope'
];
const verifiers=Object.fromEntries(required.map(name=>[name,async()=>null]));
test('Independent Gold Unix socket Account inbox + SQL mark-read + privileged Admin notifications',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-gold-notifications-'));
 fs.chmodSync(root,0o700);
 const run=path.join(root,'run');fs.mkdirSync(run,{mode:0o700});
 const socketPath=path.join(run,'core.sock');
 const env={LIGHT_REMOTE_GOLD_INDEPENDENT:'1',LIGHT_REMOTE_GOLD_ROOT:root};
 const calls=[],reads=new Map(),now=new Date('2026-10-17T15:00:00.000Z');
 const notice={notification_id:ID,category:'security',
  title:'Gold security',body:'Device Channel signed only',
  link:'/account/inbox',audience_type:'account',audience_value:'acct_member',
  published_by:'acct_admin',created_at:now,scheduled_at:now,
  expires_at:null,canceled_at:null};
 let alive=true,closed=0,active;
 const query=async(sql,params=[])=>{
  calls.push({sql,params});
  if(!alive)throw Error('pg_down');
  if(sql==='SELECT 1 AS gold_ready')return{rows:[{gold_ready:1}]};
  if(sql.startsWith('SELECT n.*,rd.read_at FROM lr_notifications n')){
   return{rows:params[0]==='acct_member'&&!notice.canceled_at?
    [{...notice,read_at:reads.get(params[0])||null}]:[]};
  }
  if(sql.startsWith('INSERT INTO lr_notification_reads(')){
   assert(sql.includes('ON CONFLICT(notification_id,account_id)'));
   if(params[0]!=='acct_member'||params[1]!==ID)return{rows:[]};
   if(!reads.has(params[0]))reads.set(params[0],now);
   return{rows:[{notification_id:ID}]};
  }
  if(sql.startsWith('SELECT n.*,(SELECT COUNT(*)')){
   return{rows:[{...notice,read_count:reads.size}]};
  }
  if(sql.startsWith('UPDATE lr_notifications SET canceled_at=')){
   notice.canceled_at=now;return{rows:[notice]};
  }
  throw Error('unexpected_gold_notifications_sql '+sql.slice(0,100));
 };
 const openPlane=async()=>({
  pool:{query,connect:async()=>({query,release(){}})},
  redis:{ping:async()=>alive?'PONG':'NO'},postgres:{database:'light_remote_gold_dev',schemaVersion:20},
  cache:{prefix:'lr:gold:socket-notifications:'},
  close:async()=>{closed++}
 });
 const request=async(url,{method='GET',body=null,headers={}}={})=>
  new Promise((resolve,reject)=>{
   const data=body?JSON.stringify(body):null;
   const req=http.request({socketPath,path:url,method,
    headers:{...headers,...(data?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{})}},
    response=>{
     let output='';
     response.on('data',chunk=>output+=chunk);
     response.on('end',()=>resolve({
      status:response.statusCode,body:output.startsWith('{')?JSON.parse(output):output
     }));
    });
   req.on('error',reject);req.end(data||undefined);
  });
 try{
  active=await startGoldCoreApi({env,socketPath,openPlane,
   verifiers:{...verifiers,
    verifyNotificationAdmin:async req=>req.headers['x-private-admin-proof']==='signed-by-admin'?
     {authorized:true,adminAccountId:'acct_admin'}:null},
   openCore:()=>({authenticate:async token=>{
    if(token!==TOKEN)throw Object.assign(Error('bad_session'),{code:'bad_session',status:401});
    return {accountId:'acct_member',plan:'free'};
   }}),
   openTeam:()=>({})
  });
  const inbox=await request('/v1/accounts/notifications',
   {headers:{authorization:'Bearer '+TOKEN}});
  assert.equal(inbox.status,200);
  assert.equal(inbox.body.unreadCount,1);
  assert.equal(inbox.body.notifications[0].notificationId,ID);
  assert.equal((await request('/v1/accounts/notifications')).status,401);
  const wrongAdmin=await request('/v1/admin/notifications');
  assert.equal(wrongAdmin.status,401);
  const read=await request('/v1/accounts/notifications/read',{method:'POST',
   headers:{authorization:'Bearer '+TOKEN},
   body:{notificationId:ID,accountId:'acct_victim'}});
  assert.equal(read.status,200);
  assert.equal(read.body.ok,true);
  assert.equal(reads.size,1);
  assert.equal((await request('/v1/accounts/notifications',
   {headers:{authorization:'Bearer '+TOKEN}})).body.unreadCount,0);
  const approved=await request('/v1/admin/notifications',{headers:{
   'x-private-admin-proof':'signed-by-admin'}});
  assert.equal(approved.status,200);
  assert.equal(approved.body.notifications[0].readCount,1);
  const canceled=await request('/v1/admin/notifications/'+ID+'/cancel',{method:'POST',
   headers:{'x-private-admin-proof':'signed-by-admin'}});
  assert.equal(canceled.status,200);
  assert.equal((await request('/v1/accounts/notifications',{headers:{
   authorization:'Bearer '+TOKEN}})).body.notifications.length,0);
  assert(!calls.some(item=>item.params.includes('acct_victim')));
  alive=false;
  assert.equal((await request('/v1/accounts/notifications',{headers:{
   authorization:'Bearer '+TOKEN}})).status,503);
 }finally{
  if(active)await active.close();
  assert.equal(closed,active?1:0);
  fs.rmSync(root,{recursive:true,force:true});
 }
});
