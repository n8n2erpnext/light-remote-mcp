import test from 'node:test';
import assert from 'node:assert/strict';
import {GoldPgNotificationRepository} from '../src/storage/notifications-pg.mjs';

const NOW=Date.parse('2026-10-17T16:00:00.000Z');
const N1='sys_123e4567-e89b-42d3-a456-426614174000';
function database(){
 const trace=[],rows=new Map(),reads=new Map();
 const accounts=new Map([['acct_one','active'],['acct_two','active']]);
 const pool={query:async(sql,params=[])=>{
  trace.push({sql,params});
  if(sql.startsWith('SELECT account_id FROM lr_accounts WHERE account_id=$1')){
   return{rows:accounts.get(params[0])==='active'?[{account_id:params[0]}]:[]};
  }
  if(sql.startsWith('INSERT INTO lr_notifications(')){
   const [notification_id,category,title,body,link,audience_type,audience_value,
    published_by,created_at,scheduled_at,expires_at]=params;
   const row={notification_id,category,title,body,link,audience_type,audience_value,
    published_by,created_at:new Date(created_at),scheduled_at:new Date(scheduled_at),
    expires_at:expires_at==null?null:new Date(expires_at),canceled_at:null};
   rows.set(notification_id,row);
   return {rows:[row]};
  }
  if(sql.startsWith('SELECT n.*,(SELECT COUNT(*)')){
   return{rows:[...rows.values()].map(row=>({...row,
    read_count:[...reads.values()].filter(item=>item.notificationId===row.notification_id).length}))};
  }
  if(sql.startsWith('SELECT n.*,rd.read_at FROM lr_notifications n')){
   assert(sql.includes("n.canceled_at IS NULL"));
   assert(sql.includes("n.scheduled_at<=now()"));
   assert(sql.includes("n.expires_at>now()"));
   assert(sql.includes("n.audience_type='account' AND n.audience_value=$1"));
   assert(sql.includes("n.audience_type='plan' AND n.audience_value=$2"));
   return{rows:[...rows.values()].filter(row=>
    !row.canceled_at&&row.scheduled_at.getTime()<=NOW&&
    (!row.expires_at||row.expires_at.getTime()>NOW)&&(
     row.audience_type==='all'||
     (row.audience_type==='account'&&row.audience_value===params[0])||
     (row.audience_type==='plan'&&row.audience_value===params[1])||
     (row.audience_type==='group'&&row.audience_value===params[2])
    )).map(row=>({...row,read_at:reads.get(row.notification_id+':'+params[0])?.readAt||null}))};
  }
  if(sql.startsWith('INSERT INTO lr_notification_reads(')){
   assert(sql.includes("n.audience_type='account' AND n.audience_value=$1"));
   assert(sql.includes('ON CONFLICT(notification_id,account_id)'));
   const item=rows.get(params[1]);
   if(!item||item.canceled_at||item.scheduled_at.getTime()>NOW||
    item.expires_at&&item.expires_at.getTime()<=NOW||
    !(item.audience_type==='all'||
      (item.audience_type==='account'&&item.audience_value===params[0])||
      (item.audience_type==='plan'&&item.audience_value===params[2])||
      (item.audience_type==='group'&&item.audience_value===params[3])))
    return{rows:[]};
   const key=item.notification_id+':'+params[0];
   if(!reads.has(key))reads.set(key,{notificationId:item.notification_id,
    accountId:params[0],readAt:new Date(NOW)});
   return{rows:[{notification_id:item.notification_id}]};
  }
  if(sql.startsWith('UPDATE lr_notifications SET canceled_at=')){
   const row=rows.get(params[0]);
   if(!row)return{rows:[]};
   row.canceled_at=new Date(NOW);return{rows:[row]};
  }
  throw Error('unexpected_pg_notification_sql '+sql.slice(0,110));
 }};
 return {pool,trace,rows,reads,accounts};
}
test('Gold PG notifications store admin-published content and per-account inbox solely in SQL',async()=>{
 const db=database(),repo=new GoldPgNotificationRepository({pool:db.pool,now:()=>NOW});
 const item=await repo.publish({type:'security',title:'Security update',body:'Signed devices only',
  targetAccountId:'acct_one',publishedBy:'acct_trusted_admin'});
 assert.match(item.notificationId,/^sys_/);
 assert.equal(item.publishedBy,'acct_trusted_admin');
 assert.equal((await repo.inbox('acct_one',{plan:'free'})).unreadCount,1);
 assert.equal((await repo.inbox('acct_two',{plan:'free'})).unreadCount,0);
 const forbidden=await repo.markRead('acct_two',item.notificationId,{plan:'free'})
  .then(()=>false,()=>true);
 assert.equal(forbidden,true);
 assert.equal(db.reads.size,0);
 assert.equal(db.trace.find(x=>x.sql.startsWith('INSERT INTO lr_notifications(')).params[6],'acct_one');
});
test('Mark-read is actor-scoped and repeatable; read count and cancellation survive repository instances',async()=>{
 const db=database();
 const repo=new GoldPgNotificationRepository({pool:db.pool,now:()=>NOW});
 const item=await repo.publish({type:'feature',title:'New feature',body:'Fleet changes'});
 assert.deepEqual(await repo.markRead('acct_one',item.notificationId,{plan:'free'}),{ok:true});
 assert.deepEqual(await repo.markRead('acct_one',item.notificationId,{plan:'free'}),{ok:true});
 const reopened=new GoldPgNotificationRepository({pool:db.pool,now:()=>NOW});
 const inbox=await reopened.inbox('acct_one',{plan:'free'});
 assert.equal(inbox.unreadCount,0);
 assert.equal(inbox.notifications[0].readAt,NOW);
 assert.equal((await reopened.list()).notifications[0].readCount,1);
 assert.equal(db.reads.size,1);
 const canceled=await reopened.cancel(item.notificationId,{by:'acct_admin'});
 assert.equal(canceled.status,'canceled');
 assert.equal((await repo.inbox('acct_two',{plan:'pro'})).notifications.length,0);
});
test('Gold PG notification repository rejects invalid payloads before any SQL write and fails closed on PG outages',async()=>{
 const db=database(),repo=new GoldPgNotificationRepository({pool:db.pool,now:()=>NOW});
 await assert.rejects(()=>repo.publish({type:'security',title:'A',body:'B'}),/invalid_notification_content/);
 await assert.rejects(()=>repo.markRead('acct_1','../../forged'),/invalid_notification_id/);
 assert.equal(db.trace.length,0);
 const off=new GoldPgNotificationRepository({pool:{query:async()=>{throw Error('pg_down')}},now:()=>NOW});
 await assert.rejects(()=>off.inbox('acct_one',{plan:'free'}),/pg_down/);
});

test('Gold PG publication rejects dormant, disabled, or nonexistent target account',async()=>{
 const db=database(),repo=new GoldPgNotificationRepository({pool:db.pool,now:()=>NOW});
 for(const [accountId,state] of [
  ['acct_one','admin_disabled'],['acct_one','dormant'],
  ['acct_missing',undefined]]){
  if(state)db.accounts.set(accountId,state);
  await assert.rejects(()=>repo.publish({type:'security',title:'Targeted notice',
   body:'Operational account required',targetAccountId:accountId}),
   /notification_target_account_not_found/);
 }
 assert.equal(db.rows.size,0);
 assert.equal(db.trace.filter(x=>x.sql.startsWith('INSERT INTO lr_notifications(')).length,0);
 db.accounts.set('acct_one','active');
 const ok=await repo.publish({type:'security',title:'Valid notice',
  body:'Only a real operational account',targetAccountId:'acct_one'});
 assert.match(ok.notificationId,/^sys_/);
 const lookup=db.trace.find(x=>x.sql.startsWith('SELECT account_id FROM lr_accounts'));
 assert.deepEqual(lookup.params,['acct_one']);
});

test('Gold PG inbox audience group and plan read current authenticated attributes only',async()=>{
 const db=database(),repo=new GoldPgNotificationRepository({pool:db.pool,now:()=>NOW});
 await repo.publish({type:'feature',title:'QA Group',body:'QA-only notice',
  audienceType:'group',audienceValue:'grp_quality'});
 await repo.publish({type:'feature',title:'Pro Plan',body:'Pro-only notice',
  audienceType:'plan',audienceValue:'pro'});
 const qa=await repo.inbox('acct_one',{plan:'free',groupId:'grp_quality'});
 assert.equal(qa.notifications.length,1);
 assert.equal(qa.notifications[0].title,'QA Group');
 const pro=await repo.inbox('acct_two',{plan:'pro',groupId:'grp_other'});
 assert.equal(pro.notifications.length,1);
 assert.equal(pro.notifications[0].title,'Pro Plan');
 const wrong=await repo.inbox('acct_two',{plan:'free',groupId:'grp_other'});
 assert.equal(wrong.notifications.length,0);
});
