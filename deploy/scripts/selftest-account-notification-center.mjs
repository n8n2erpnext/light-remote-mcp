import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AccountNotificationRegistry} from '../../operator-host/account-notification-registry.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-notification-test-'));
const file=path.join(dir,'notifications.json'),accounts=new Map([['alice',{accountId:'alice',email:'alice@example.com'}],['bob',{accountId:'bob',email:'bob@example.com'}]]);
let now=Date.now();
const reg=new AccountNotificationRegistry({stateFile:file,now:()=>now});
const deps={AccountError:class AccountError extends Error{},accountNotifications:reg,
  requireAccount:req=>{const a=accounts.get(req.headers?.authorization);if(!a)throw Error('account_session_required');return {account:a}},
  accounts:{assertOperational:id=>{if(!accounts.has(id))throw Error('account_not_found');return accounts.get(id)}},
  readJson:async req=>req.body||{},sendJson:(res,status,data)=>{res.status=status;res.result=data;return true}};
async function api(actor,method,url,body={}){
 const res={};await handleAccountRoutes({method,headers:{authorization:actor},body},res,new URL('http://local'+url),deps);return res;
}
try{
 assert.throws(()=>reg.publish({type:'promotion',title:'Okay',body:'Hello',link:'https://example.com'}),/invalid_notification_link/);
 assert.throws(()=>reg.publish({type:'promotion',title:'Okay',body:'Hello',link:'//evil.com'}),/invalid_notification_link/);
 assert.throws(()=>reg.publish({type:'promotion',title:'Okay',body:'Hello',link:'/x\\evil'}),/invalid_notification_link/);
 assert.throws(()=>reg.publish({type:'unsupported',title:'Okay',body:'Hello'}),/invalid_notification_content/);
 const broadcast=(await api('alice','POST','/v1/admin/notifications/publish',{type:'feature',title:'A useful update',body:'Now available',link:'/account/inbox'})).result.notification;
 const targeted=(await api('alice','POST','/v1/admin/notifications/publish',{type:'account',title:'Personal alert',body:'For Alice only',targetAccountId:'alice'})).result.notification;
 let alice=(await api('alice','GET','/v1/accounts/notifications')).result;
 let bob=(await api('bob','GET','/v1/accounts/notifications')).result;
 assert.equal(alice.notifications.length,2);
 assert.equal(alice.unreadCount,2);
 assert.equal(bob.notifications.length,1,'Bob must not see Alice targeted notification');
 assert.equal(bob.notifications[0].notificationId,broadcast.notificationId);
 await api('alice','POST','/v1/accounts/notifications/read',{notificationId:targeted.notificationId});
 alice=(await api('alice','GET','/v1/accounts/notifications')).result;
 assert.equal(alice.unreadCount,1);
 assert.throws(()=>reg.markRead('bob',targeted.notificationId),/notification_not_found/);
 assert.equal(reg.inbox('bob').unreadCount,1);
 const restored=new AccountNotificationRegistry({stateFile:file,now:()=>now});
 assert.equal(restored.inbox('alice').unreadCount,1,'Read state durable through restart');
 assert.equal(restored.inbox('bob').unreadCount,1);
 reg.publish({type:'maintenance',title:'Maintenance notice',body:'Planned maintenance',expiresAt:now+1000});
 now+=1001;
 assert.equal(reg.inbox('alice').notifications.filter(x=>x.type==='maintenance').length,0);
 console.log('system_notification_broadcast_and_targeted_isolation=PASS');
 console.log('system_notification_cross_account_read_denied=PASS');
 console.log('system_notification_read_state_persistent=PASS');
 console.log('system_notification_safe_links_and_expiry=PASS');
 console.log('system_notification_authenticated_route=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
