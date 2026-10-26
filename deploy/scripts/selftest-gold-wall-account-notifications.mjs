import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';
const notificationId='sys_11111111-2222-3333-4444-555555555555';
const inviteId='tinv_'+'a'.repeat(24);
const accountId='acct_wall_owner_fixture';
const signedCtx={binding:{accountId,deviceId:'dev_own_enrolled'},payload:{}};
function backendDeps(ctx=signedCtx){
 let lookup=0;return {
  get lookup(){return lookup},
  readJson:async()=>({}),
  verifiedChannelContext:async(_body,action)=>{assert.equal(action,'account-notifications');return ctx;},
  accounts:{assertOperational:id=>{assert.equal(id,ctx.binding.accountId);},account:id=>{lookup++;assert.equal(id,ctx.binding.accountId);return {accountId:id,state:'active',plan:'pro',groupId:'group_owners'};}},
  accountNotifications:{inbox:async(id,account)=>{
   assert.equal(id,ctx.binding.accountId);assert.equal(account.plan,'pro');
   return {unreadCount:1,notifications:[{notificationId,type:'security',title:'Security update',
    body:'Please review your account',readAt:null,createdAt:2000,link:'https://evil.invalid/steal',inviteCode:'DO_NOT_LEAK'}]};}},
  proTeams:{inbox:({memberAccountId})=>{assert.equal(memberAccountId,ctx.binding.accountId);
    return {unreadCount:1,notifications:[{notificationId:inviteId,type:'team_invitation',ownerEmail:'owner@example.invalid',
      inviteCode:'PRIVATE_INVITE_SECRET',readAt:null,createdAt:3000}]};}},
  sendJson:(res,status,value)=>{res.status=status;res.value=value;return value}
 };
}
{
 const d=backendDeps(),res={};
 const value=await handleDeviceChannelRoutes({method:'POST'},res,
   new URL('http://localhost/v1/device-channel/account-notifications'),d);
 assert.equal(res.status,200);
 assert.equal(value.ok,true);assert.equal(value.unreadCount,2);
 assert.equal(value.notifications.length,2);
 assert.equal(value.notifications[0].type,'team_invitation');
 assert.equal(value.notifications[1].title,'Security update');
 assert(!JSON.stringify(value).includes('PRIVATE_INVITE_SECRET'));
 assert(!JSON.stringify(value).includes('DO_NOT_LEAK'));
 assert(!JSON.stringify(value).includes('evil.invalid'));
 assert.equal(d.lookup,1);
}
{
 const d=backendDeps({binding:{accountId:'acct_other',deviceId:'dev_not_mine'},payload:{accountId}});
 const value=await handleDeviceChannelRoutes({method:'POST'}, {},
   new URL('http://localhost/v1/device-channel/account-notifications'),d);
 assert.equal(value.notifications.length,2,'only signed identity can select scope');
}
{
 const d=backendDeps();d.accounts.account=()=>({state:'revoked'});
 await assert.rejects(()=>handleDeviceChannelRoutes({method:'POST'}, {},
  new URL('http://localhost/v1/device-channel/account-notifications'),d));
}
{
 const d=backendDeps();
 d.accounts.assertOperational=()=>{throw new Error('account_admin_disabled');};
 await assert.rejects(()=>handleDeviceChannelRoutes({method:'POST'}, {},
  new URL('http://localhost/v1/device-channel/account-notifications'),d),/account_admin_disabled/);
 assert.equal(d.lookup,0,'disabled account must not reach notification registry');
}
const auth={enabled:true,identity:req=>req.headers['x-test-owner']==='yes'?{username:'owner@example.invalid'}:null,
 csrfForRequest:()=> 'test-csrf',verifyRequestCsrf:()=>true};
let wall;const inbox='https://gold.light-remote.thaiduy.digital/account/inbox';
try{
 wall=startLocalWall({host:'127.0.0.1',port:0,auth,
  getLocalStatus:async()=>({cloudState:'connected',cloudDesiredConnected:true}),
  getAccountNotifications:async()=>({ok:true,accountInboxUrl:inbox,unreadCount:2,
   notifications:[{notificationId,readAt:null,title:'Security update',body:'Review your account'}]})});
 await new Promise((ok,bad)=>wall.server.listening?ok():wall.server.once('listening',ok).once('error',bad));
 const url='http://127.0.0.1:'+wall.server.address().port;
 assert.equal((await fetch(url+'/api/account-notifications')).status,401);
 const data=await fetch(url+'/api/account-notifications',{headers:{'x-test-owner':'yes'}});
 assert.equal(data.status,200);
 const json=await data.json();assert.equal(json.unreadCount,2);
 assert.equal(json.accountInboxUrl,inbox);
 const html=await (await fetch(url+'/',{headers:{'x-test-owner':'yes'}})).text();
 for(const frag of ['id="wallNotificationBell"','id="wallNotificationPanel"','id="wallNotificationBadge"',
  '/api/account-notifications','notificationId','rel=\'noopener noreferrer\'']){
  assert(html.includes(frag),'missing notification Wall contract: '+frag);
 }
 for(const block of html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g))
  if(block[1].trim())new vm.Script(block[1],{filename:'gold-wall-notifications.inline.js'});
 assert(!html.includes('PRIVATE_INVITE_SECRET'));
 await wall.close();wall=null;
 const denied=startLocalWall({host:'127.0.0.1',port:0,auth});
 wall=denied;await new Promise(ok=>wall.server.listening?ok():wall.server.once('listening',ok));
 const unavailable=await fetch('http://127.0.0.1:'+wall.server.address().port+'/api/account-notifications',
  {headers:{'x-test-owner':'yes'}});
 assert.equal(unavailable.status,503);
 // If the account session is missing, preserve the selected notification
// across the existing /account/login?next=... flow.
{
 const html=fs.readFileSync(new URL('../../plugin-server/account-portal/inbox.html',import.meta.url),'utf8');
 assert.match(html,/const back='\/account\/inbox'\+\(targetNotificationId/);
 assert.match(html,/location\.href='\/account\/login\?next='\+encodeURIComponent\(back\)/);
 assert.match(html,/target\.scrollIntoView/);
 const requested='/account/inbox?notificationId='+encodeURIComponent(notificationId);
 const login='/account/login?next='+encodeURIComponent(requested);
 assert.equal(new URL(login,'https://gold.light-remote.thaiduy.digital').searchParams.get('next'),requested);
}
console.log('GOLD_WALL_NOTIFICATIONS_SIGNED_ACCOUNT_SCOPE_PROTEAM_PREVIEW_AUTH_AND_LOGIN_DEEPLINK_PASS');
}finally{if(wall)await wall.close();}
