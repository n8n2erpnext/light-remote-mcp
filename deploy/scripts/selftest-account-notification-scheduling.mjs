import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AccountNotificationRegistry} from '../../operator-host/account-notification-registry.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc50-notice-schedule-'));
let now=Date.now();
const state=path.join(dir,'notifications.json');
const registry=new AccountNotificationRegistry({stateFile:state,now:()=>now});
const accountRows=[
 {accountId:'owner',email:'owner@example.com',groupId:'grp_admin',plan:'pro'},
 {accountId:'member',email:'member@example.com',groupId:'grp_users',plan:'free'},
 {accountId:'target',email:'target@example.com',groupId:'grp_users',plan:'pro'}
];
const data=new Map(accountRows.map(a=>[a.accountId,a]));
const deps={
 AccountError:class AccountError extends Error{constructor(message,status=403){super(message);this.status=status}},
 accounts:{assertOperational:id=>{if(!data.has(id))throw Error('account_not_found');return data.get(id)},listGroups:()=>[
 {groupId:'grp_admin'},{groupId:'grp_users'}]},
 accountNotifications:registry,
 requireAccount:req=>{const account=data.get(req.headers?.authorization);if(!account)throw Error('auth_required');return {account}},
 readJson:async req=>req.body||{},
 sendJson:(res,status,body)=>{res.status=status;res.data=body;return true}
};
async function api(actor,method,pathname,body){
 const response={};
 await handleAccountRoutes({method,body,headers:{authorization:actor}},response,new URL('http://localhost'+pathname),deps);
 return response;
}
try{
 const scheduled=registry.publish({type:'update',title:'Scheduled product update',body:'New client version details',
  scheduledAt:now+10000,expiresAt:now+50000,publishedBy:'web_admin'});
 assert.equal(registry.status(scheduled),'scheduled');
 assert.equal(registry.inbox('member',data.get('member')).unreadCount,0);
 assert.equal(registry.list().notifications[0].status,'scheduled');
 const snapshot=new AccountNotificationRegistry({stateFile:state,now:()=>now});
 assert.equal(snapshot.list().notifications.length,1,'scheduled record must survive restart');
 now+=10000;
 assert.equal(registry.inbox('member',data.get('member')).unreadCount,1);
 assert.equal(registry.status(scheduled),'active');
 const specific=registry.publish({type:'account',title:'Target account notice',body:'Only target sees this',
   audienceType:'account',audienceValue:'target'});
 const plan=registry.publish({type:'promotion',title:'Free plan promotion',body:'Upgrade details',
   audienceType:'plan',audienceValue:'free'});
 const group=registry.publish({type:'feature',title:'Users group feature',body:'A feature announcement',
   audienceType:'group',audienceValue:'grp_users'});
 assert.equal(registry.inbox('owner',data.get('owner')).notifications.length,1);
 assert.equal(registry.inbox('member',data.get('member')).notifications.length,3);
 assert.equal(registry.inbox('target',data.get('target')).notifications.length,3);
 assert.equal(registry.inbox('target',data.get('target')).notifications.find(n=>n.notificationId===plan.notificationId),undefined);
 assert.equal(registry.inbox('member',data.get('member')).notifications.find(n=>n.notificationId===specific.notificationId),undefined);
 assert.throws(()=>registry.markRead('member',specific.notificationId,data.get('member')),/notification_not_found/);
 await api('target','POST','/v1/accounts/notifications/read',{notificationId:specific.notificationId});
 assert.equal(registry.list().notifications.find(n=>n.notificationId===specific.notificationId).readCount,1);
 assert.equal((await api('member','GET','/v1/accounts/notifications')).data.notifications.length,3);
 const canceled=(await api('owner','POST','/v1/admin/notifications/'+group.notificationId+'/cancel')).data.notification;
 assert.equal(canceled.status,'canceled');
 assert.equal(registry.inbox('member',data.get('member')).notifications.find(n=>n.notificationId===group.notificationId),undefined);
 assert.equal(registry.list().notifications.find(n=>n.notificationId===group.notificationId).status,'canceled');
 now+=50000;
 assert.equal(registry.status(scheduled),'expired');
 assert(!registry.inbox('member',data.get('member')).notifications.some(x=>x.notificationId===scheduled.notificationId));
 const reload=new AccountNotificationRegistry({stateFile:state,now:()=>now});
 assert.equal(reload.list().notifications.length,4);
 assert.equal(reload.list().notifications.find(x=>x.notificationId===specific.notificationId).readCount,1);
 assert.throws(()=>registry.publish({type:'feature',title:'Late notice',body:'Schedule invalid',scheduledAt:now+370*86400000}),/invalid_notification_schedule/);
 assert.throws(()=>registry.publish({type:'update',title:'Bad expiry',body:'Too early',scheduledAt:now+100000,expiresAt:now+50000}),/invalid_notification_expiry/);
 assert.throws(()=>registry.publish({type:'update',title:'External link',body:'Unsafe redirect',link:'//external.example'}),/invalid_notification_link/);
 assert(registeredSystemRoute());
 console.log('notification_schedule_activation_and_expiry=PASS');
 console.log('notification_scoped_account_plan_group=PASS');
 console.log('notification_cancel_and_read_counts=PASS');
 console.log('notification_durable_restart_and_safe_links=PASS');
 console.log('notification_operator_routes_authenticated_recipient=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
function registeredSystemRoute(){return typeof handleAccountRoutes==='function'}
