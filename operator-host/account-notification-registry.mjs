/** Canonical Light Remote notification authority: PostgreSQL only. No JSON file state. */
import crypto from 'node:crypto';

const TYPES=new Set(['update','feature','promotion','maintenance','security','account']);
const AUDIENCES=new Set(['all','account','plan','group']);
const ID=/^[A-Za-z0-9._:-]{1,128}$/;
const STORAGE_LIMIT=500;
export class AccountNotificationError extends Error{
 constructor(message,status=400){super(message);this.status=status}
}
const stamp=v=>v==null?null:new Date(v).getTime();
const mapRow=r=>({
 notificationId:r.notification_id,type:r.category,title:r.title,body:r.body,
 link:r.link,targetAccountId:r.audience_type==='account'?r.audience_value:null,
 audienceType:r.audience_type,audienceValue:r.audience_value,
 createdAt:stamp(r.created_at),scheduledAt:stamp(r.scheduled_at),
 expiresAt:stamp(r.expires_at),publishedBy:r.published_by,
 canceledAt:stamp(r.canceled_at),canceledBy:r.canceled_by||null
});
export class AccountNotificationRegistry{
 constructor({pool,now=()=>Date.now()}={}){
  if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')
   throw Error('gold_notifications_postgres_required');
  this.pool=pool;this.now=now;
 }
 status(n){
  if(n.canceledAt)return 'canceled';
  if(n.expiresAt!==null&&n.expiresAt<=this.now())return 'expired';
  if(Number(n.scheduledAt||n.createdAt)>this.now())return 'scheduled';
  return 'active';
 }
 async publish({type,title,body,link='/account/inbox',targetAccountId=null,
   audienceType=null,audienceValue=null,scheduledAt=null,expiresAt=null,publishedBy='admin'}={}){
  const category=String(type||''),heading=String(title||'').trim(),
   content=String(body||'').trim(),url=String(link||'/account/inbox');
  if(!TYPES.has(category)||heading.length<2||heading.length>140||content.length<2||content.length>2000)
   throw new AccountNotificationError('invalid_notification_content');
  if(!url.startsWith('/')||url.startsWith('//')||url.includes('\\')||/[\r\n]/.test(url)||url.length>400)
   throw new AccountNotificationError('invalid_notification_link');
  const scope=String(audienceType||(targetAccountId?'account':'all'));
  const selector=String(audienceValue??targetAccountId??'').trim();
  if(!AUDIENCES.has(scope)||(scope==='all'&&selector)||(scope!=='all'&&!ID.test(selector))||
    (scope==='plan'&&!['free','pro','vip'].includes(selector)))
   throw new AccountNotificationError('invalid_notification_audience');
  const start=scheduledAt==null?this.now():Number(scheduledAt);
  if(!Number.isFinite(start)||start<this.now()-60_000||start>this.now()+365*86400000)
   throw new AccountNotificationError('invalid_notification_schedule');
  const expiry=expiresAt==null?null:Number(expiresAt);
  if(expiry!==null&&(!Number.isFinite(expiry)||expiry<=Math.max(start,this.now())||expiry>start+365*86400000))
   throw new AccountNotificationError('invalid_notification_expiry');
  const row={notificationId:'sys_'+crypto.randomUUID(),type:category,title:heading,body:content,
   link:url,targetAccountId:scope==='account'?selector:null,
   audienceType:scope,audienceValue:selector||null,createdAt:this.now(),
   scheduledAt:start,expiresAt:expiry,publishedBy:String(publishedBy||'admin').slice(0,128),
   canceledAt:null,canceledBy:null};
  const client=await this.pool.connect();let begun=false;
  try{
   await client.query('BEGIN');begun=true;
   await client.query("SELECT pg_advisory_xact_lock(hashtext('gold_notifications_publish'))");
   await client.query(
    'INSERT INTO lr_notifications(notification_id,category,title,body,link,audience_type,audience_value,published_by,created_at,scheduled_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [row.notificationId,row.type,row.title,row.body,row.link,row.audienceType,row.audienceValue,
     row.publishedBy,new Date(row.createdAt),new Date(row.scheduledAt),row.expiresAt===null?null:new Date(row.expiresAt)]);
   await client.query('DELETE FROM lr_notifications WHERE notification_id IN (SELECT notification_id FROM lr_notifications ORDER BY created_at DESC,notification_id DESC OFFSET $1)',[STORAGE_LIMIT]);
   await client.query('COMMIT');begun=false;return row;
  }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
 async list(){
  const {rows}=await this.pool.query(
   'SELECT n.*, (SELECT COUNT(*)::int FROM lr_notification_reads r WHERE r.notification_id=n.notification_id) AS read_count FROM lr_notifications n ORDER BY n.created_at DESC,n.notification_id DESC LIMIT $1',
   [STORAGE_LIMIT]);
  return {notifications:rows.map(r=>{const n=mapRow(r);return {...n,status:this.status(n),readCount:Number(r.read_count)}})};
 }
 async cancel(notificationId,{by='admin'}={}){
  if(!/^sys_[a-f0-9-]{36}$/.test(String(notificationId||'')))
   throw new AccountNotificationError('notification_not_found',404);
  const {rows}=await this.pool.query(
   'UPDATE lr_notifications SET canceled_at=COALESCE(canceled_at,now()),canceled_by=COALESCE(canceled_by,$2) WHERE notification_id=$1 RETURNING *',
   [notificationId,String(by).slice(0,128)]);
  if(!rows.length)throw new AccountNotificationError('notification_not_found',404);
  const row=mapRow(rows[0]);return {...row,status:'canceled'};
 }
 async inbox(accountId,account=null){
  const id=String(accountId||'');
  if(!ID.test(id))throw new AccountNotificationError('invalid_notification_account');
  const {rows}=await this.pool.query(
   "SELECT n.*,r.read_at FROM lr_notifications n LEFT JOIN lr_notification_reads r ON r.notification_id=n.notification_id AND r.account_id=$1 WHERE n.canceled_at IS NULL AND n.scheduled_at<=now() AND (n.expires_at IS NULL OR n.expires_at>now()) AND (n.audience_type='all' OR (n.audience_type='account' AND n.audience_value=$1) OR (n.audience_type='plan' AND n.audience_value=$2) OR (n.audience_type='group' AND n.audience_value=$3)) ORDER BY n.scheduled_at DESC,n.created_at DESC LIMIT $4",
   [id,String(account?.plan||''),String(account?.groupId||''),STORAGE_LIMIT]);
  const notifications=rows.map(r=>({...mapRow(r),readAt:stamp(r.read_at)}));
  return {notifications:notifications.slice(0,100),unreadCount:notifications.filter(n=>!n.readAt).length};
 }
 async markRead(accountId,notificationId,account=null){
  const id=String(accountId||''),key=String(notificationId||'');
  const item=(await this.inbox(id,account)).notifications.find(n=>n.notificationId===key);
  if(!item)throw new AccountNotificationError('notification_not_found',404);
  await this.pool.query(
   'INSERT INTO lr_notification_reads(notification_id,account_id) VALUES($1,$2) ON CONFLICT(notification_id,account_id) DO NOTHING',
   [key,id]);
  return {ok:true};
 }
}
