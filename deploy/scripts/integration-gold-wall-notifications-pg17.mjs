#!/usr/bin/env node
// Deliberately opt-in. This integration must use a disposable PostgreSQL
// cluster via an isolated private Unix socket; never live Gold account data.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {AccountNotificationRegistry} from '../../operator-host/account-notification-registry.mjs';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';

const socket=process.env.GOLD_NOTI_SCRATCH_SOCKET;
const database=process.env.GOLD_NOTI_SCRATCH_DATABASE;
assert(/^\/tmp\/gold-noti-pg-[a-zA-Z0-9]{6,}$/.test(socket||'') &&
  database==='gold_noti_scratch_acceptance','disposable_pg_socket_required');
assert(!process.env.PGHOST&&!process.env.DATABASE_URL,'shared_postgresql_configuration_denied');
const pool=new pg.Pool({host:socket,port:55997,user:'postgres',database,max:3,connectionTimeoutMillis:5000});
const account='acct_noti_owner',other='acct_noti_other';
const fixture=async(sql,params=[])=>pool.query(sql,params);
try{
 const origin=await fixture('SELECT current_database() AS db,inet_server_addr() AS ip');
 assert.equal(origin.rows[0].db,database);assert.equal(origin.rows[0].ip,null);
 await fixture(`CREATE TABLE lr_accounts(account_id text PRIMARY KEY);
 CREATE TABLE lr_notifications(
 notification_id text PRIMARY KEY,category text NOT NULL,title text NOT NULL,body text NOT NULL,
 link text NOT NULL,audience_type text NOT NULL,audience_value text,published_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),scheduled_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz,canceled_at timestamptz,canceled_by text);
 CREATE TABLE lr_notification_reads(notification_id text NOT NULL REFERENCES lr_notifications(notification_id),
 account_id text NOT NULL REFERENCES lr_accounts(account_id),
 read_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(notification_id,account_id));`);
 await fixture('INSERT INTO lr_accounts(account_id) VALUES($1),($2)',[account,other]);
 const registry=new AccountNotificationRegistry({pool});
 const own=await registry.publish({type:'feature',title:'Gold notifications test',body:'Only owner should see this',
   targetAccountId:account,publishedBy:'uat-fixture'});
 const everyone=await registry.publish({type:'security',title:'Global security notice',body:'All accounts can read',
   audienceType:'all',publishedBy:'uat-fixture'});
 await registry.publish({type:'account',title:'Other account notice',body:'Should not be visible',
   targetAccountId:other,publishedBy:'uat-fixture'});
 const before=await registry.inbox(account,{plan:'pro'});
 assert.equal(before.notifications.length,2);assert.equal(before.unreadCount,2);
 assert(!before.notifications.some(n=>n.title==='Other account notice'));
 assert.equal((await registry.inbox(other,{plan:'free'})).notifications.length,2);
 const deps={
   readJson:async()=>({payload:{accountId:other}}),
   verifiedChannelContext:async(_p,action)=>{
     assert.equal(action,'account-notifications');
     return {binding:{accountId:account,deviceId:'dev_owner'},payload:{accountId:other}};},
   accounts:{
     assertOperational:id=>assert.equal(id,account),
     account:id=>{assert.equal(id,account);return {accountId:id,status:'active',plan:'pro'};}
   },
   accountNotifications:registry,
   proTeams:{inbox:()=>({notifications:[],unreadCount:0})},
   sendJson:(res,status,value)=>{res.status=status;res.result=value;return value}
 };
 const res={};const endpoint=new URL('http://localhost/v1/device-channel/account-notifications');
 const preview=await handleDeviceChannelRoutes({method:'POST'},res,endpoint,deps);
 assert.equal(res.status,200);
 assert.equal(preview.unreadCount,2);
 assert(preview.notifications.find(n=>n.notificationId===own.notificationId));
 assert(preview.notifications.find(n=>n.notificationId===everyone.notificationId));
 assert(!preview.notifications.some(n=>n.title==='Other account notice'));
 for(const n of preview.notifications)assert.deepEqual(Object.keys(n).sort(),
   ['notificationId','type','title','body','readAt','createdAt'].sort());
 await registry.markRead(account,own.notificationId,{plan:'pro'});
 const updated=await handleDeviceChannelRoutes({method:'POST'}, {}, endpoint,deps);
 assert.equal(updated.unreadCount,1);
 assert(updated.notifications.find(n=>n.notificationId===own.notificationId).readAt);
 assert.equal((await registry.inbox(other,{plan:'free'})).unreadCount,2,'read states isolated by account');
 console.log('GOLD_NOTIFICATIONS_PG17_REAL_REGISTRY_SIGNED_ROUTE_OWNER_SCOPE_READ_STATE_PASS');
}finally{await pool.end();}
