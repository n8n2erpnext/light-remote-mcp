import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {assertNotificationOwnerEmail,notificationBellScript,notificationBellStyles} from '../../device-agent/wall-account-notifications.mjs';
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
  accounts:{assertOperational:id=>{assert.equal(id,ctx.binding.accountId);},account:id=>{lookup++;assert.equal(id,ctx.binding.accountId);return {accountId:id,email:'owner@example.invalid',state:'active',plan:'pro',groupId:'group_owners'};}},
  accountNotifications:{inbox:async(id,account)=>{
   assert.equal(id,ctx.binding.accountId);assert.equal(account.plan,'pro');
   return {unreadCount:1,notifications:[{notificationId,type:'security',title:'Security update',
    body:'Please review your account',readAt:null,createdAt:2000,link:'https://evil.invalid/steal',inviteCode:'DO_NOT_LEAK'},
    {notificationId:'sys_22222222-2222-3333-4444-555555555555',type:'feature',
     title:'Previously read',body:'Keep in account history',readAt:1900,createdAt:9000}]};}},
  proTeams:{inbox:({memberAccountId})=>{assert.equal(memberAccountId,ctx.binding.accountId);
    return {unreadCount:1,notifications:[{notificationId:inviteId,type:'team_invitation',ownerEmail:'owner@example.invalid',
      inviteCode:'PRIVATE_INVITE_SECRET',readAt:null,createdAt:3000},
      {notificationId:'tinv_'+('b'.repeat(24)),ownerEmail:'old@example.invalid',readAt:2100,createdAt:8000}]};}},
  sendJson:(res,status,value)=>{res.status=status;res.value=value;return value}
 };
}
{
 const d=backendDeps(),res={};
 const value=await handleDeviceChannelRoutes({method:'POST'},res,
   new URL('http://localhost/v1/device-channel/account-notifications'),d);
 assert.equal(res.status,200);
 assert.equal(value.ok,true);assert.equal(value.unreadCount,2);
 assert.equal(value.accountEmail,'owner@example.invalid');
 assert.equal(assertNotificationOwnerEmail(value.accountEmail,'OWNER@example.invalid'),true);
 assert.throws(()=>assertNotificationOwnerEmail(value.accountEmail,'old-owner@example.invalid'),/account_notification_session_mismatch/);
 assert.equal(value.notifications.length,2);
 assert.equal(value.notifications[0].type,'team_invitation');
 assert.equal(value.notifications[1].title,'Security update');
 assert(!value.notifications.some(n=>n.readAt),'read notifications must disappear from Bell preview');
 assert(!value.notifications.some(n=>n.title==='Previously read'));
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
  getAccountNotifications:async({wallUsername})=>{assert.equal(wallUsername,'owner@example.invalid');return {ok:true,accountInboxUrl:inbox,unreadCount:2,
   notifications:[{notificationId,readAt:null,title:'Security update',body:'Review your account'}]};}});
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
 assert.match(html,/deepLinkReadAttempted/);
 assert.match(html,/await api\(focused\.type==='team_invitation'\?'team-inbox-read':'notifications-read','POST'/);
 assert.match(notificationBellScript,/filter\(n=>valid\(n.notificationId\)&&!n.readAt\)/);
 assert.match(notificationBellScript,/window.addEventListener\('focus'/);
 const requested='/account/inbox?notificationId='+encodeURIComponent(notificationId);
 const login='/account/login?next='+encodeURIComponent(requested);
 assert.equal(new URL(login,'https://gold.light-remote.thaiduy.digital').searchParams.get('next'),requested);
}
console.log('GOLD_WALL_NOTIFICATIONS_SIGNED_ACCOUNT_SCOPE_PROTEAM_PREVIEW_AUTH_AND_LOGIN_DEEPLINK_PASS');
}finally{if(wall)await wall.close();}

// Regression for screenshot where first toolbar bell at x≈107 opened the
// 360px panel to its LEFT, clipping it beyond the viewport's left edge.
// Exercise actual injected controller with minimal DOM geometry fixtures.
assert.match(notificationBellStyles,/\.wall-notification-panel\{position:fixed;/);
function assertPanelFits(viewWidth,viewHeight,buttonLeft,buttonBottom){
 const callbacks={bell:{},window:{},document:{}};
 const elements={
  wallNotificationHost:{contains:()=>true},
  wallNotificationBell:{
   addEventListener:(key,fn)=>{callbacks.bell[key]=fn;},
   setAttribute:()=>{},
   getBoundingClientRect:()=>({left:buttonLeft,bottom:buttonBottom})
  },
  wallNotificationPanel:{
   hidden:true,style:{},
   getBoundingClientRect:()=>({width:Math.min(360,viewWidth-20)})
  },
  wallNotificationItems:{},
  wallNotificationBadge:{},
  wallNotificationAll:{}
 };
 const doc={
  hidden:true,
  getElementById:id=>elements[id]||null,
  addEventListener:(key,fn)=>{callbacks.document[key]=fn;}
 };
 const win={
  innerWidth:viewWidth,innerHeight:viewHeight,
  addEventListener:(key,fn)=>{callbacks.window[key]=fn;}
 };
 vm.runInNewContext(notificationBellScript,{
  document:doc,window:win,URL,setInterval:()=>0,fetch:()=>{throw Error('should_not_fetch_hidden_tab');}
 },{filename:'notification-panel-layout-regression.js'});
 callbacks.bell.click();
 const panel=elements.wallNotificationPanel;
 assert.equal(panel.hidden,false);
 const left=Number.parseFloat(panel.style.left);
 const top=Number.parseFloat(panel.style.top);
 const panelWidth=Math.min(360,viewWidth-20);
 assert(left>=9, 'notification dropdown clipped past viewport left');
 assert(left+panelWidth<=viewWidth-9,'notification dropdown clipped past viewport right');
 assert(top>=9,'notification dropdown clipped past viewport top');
 assert(top+Number.parseFloat(panel.style.maxHeight)<=viewHeight+1,
  'notification dropdown clipped past viewport bottom');
 assert.equal(elements.wallNotificationBell.getBoundingClientRect().left,buttonLeft);
 assert(typeof callbacks.window.resize==='function');
 callbacks.window.resize();
 assert.equal(Number.parseFloat(panel.style.left),left);
 callbacks.bell.click();
 assert.equal(panel.hidden,true);
}
assertPanelFits(1594,950,107,212);  // Actual Gold Wall screenshot
assertPanelFits(375,667,340,75);    // Narrow/mobile, bell near right edge
assertPanelFits(1280,720,1200,90);  // Desktop toolbar bell near right edge
assertPanelFits(400,260,5,210);     // Very short viewport, cap vertical size
console.log('GOLD_WALL_NOTIFICATION_PANEL_VIEWPORT_CLAMP_DESKTOP_MOBILE_PASS');
