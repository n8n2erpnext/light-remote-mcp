// PostgreSQL-only notification repository. No file-based state or fallback.
import {AccountNotificationRegistry,AccountNotificationError} from '../../../operator-host/account-notification-registry.mjs';
const ID=/^[A-Za-z0-9._:-]{1,128}$/;
const fail=(code,status=400)=>{throw new AccountNotificationError(code,status)};
const ms=x=>x==null?null:(x instanceof Date?x:new Date(x)).getTime();
const row=r=>({
  notificationId:r.notification_id,type:r.category,title:r.title,body:r.body,
  link:r.link,audienceType:r.audience_type,audienceValue:r.audience_value,
  targetAccountId:r.audience_type==='account'?r.audience_value:null,
  publishedBy:r.published_by,createdAt:ms(r.created_at),scheduledAt:ms(r.scheduled_at),
  expiresAt:ms(r.expires_at),canceledAt:ms(r.canceled_at)
});
const status=(r,now)=>r.canceled_at?'canceled':r.expires_at&&ms(r.expires_at)<=now?'expired':ms(r.scheduled_at)>now?'scheduled':'active';
export class GoldPgNotificationRepository{
  constructor({pool,now=()=>Date.now()}={}){
    if(!pool||typeof pool.query!=='function')throw Error('gold_pg_pool_required');
    this.pool=pool;this.now=now;
  }
  async publish(input={}){
    // Existing validation is reused with stateFile=null. It cannot write files.
    const n=new AccountNotificationRegistry({stateFile:null,now:this.now}).publish(input);
    // Mirror the canonical Operator's assertOperational(target) behavior.
    // The admin may select a target, but cannot publish to an unknown or
    // disabled/dormant account by merely supplying a syntactically valid ID.
    if(n.audienceType==='account'){
      const target=await this.pool.query(
        "SELECT account_id FROM lr_accounts WHERE account_id=$1 "+
        "AND status='active'",[n.audienceValue]);
      if(target.rows?.length!==1)
        fail('notification_target_account_not_found',404);
    }
    const sql=[
      "INSERT INTO lr_notifications(notification_id,category,title,body,link,",
      "audience_type,audience_value,published_by,created_at,scheduled_at,expires_at)",
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0),",
      "to_timestamp($10/1000.0),CASE WHEN $11::bigint IS NULL",
      "THEN NULL ELSE to_timestamp($11/1000.0) END) RETURNING *"
    ].join(' ');
    const r=await this.pool.query(sql,[n.notificationId,n.type,n.title,n.body,n.link,
      n.audienceType,n.audienceValue,n.publishedBy,n.createdAt,n.scheduledAt,n.expiresAt]);
    if(r.rows?.length!==1)throw Error('gold_pg_notification_insert_missing');
    return row(r.rows[0]);
  }
  async list(){
    const r=await this.pool.query([
      "SELECT n.*,(SELECT COUNT(*)::int FROM lr_notification_reads rd",
      "WHERE rd.notification_id=n.notification_id) AS read_count",
      "FROM lr_notifications n ORDER BY n.created_at DESC,n.notification_id DESC LIMIT 500"
    ].join(' '));
    return {notifications:(r.rows||[]).map(n=>({...row(n),
      readCount:Number(n.read_count),status:status(n,this.now())}))};
  }
  async cancel(notificationId,{by='admin'}={}){
    if(!/^sys_[a-f0-9-]{36}$/.test(String(notificationId||'')))fail('invalid_notification_id');
    const r=await this.pool.query(
      "UPDATE lr_notifications SET canceled_at=COALESCE(canceled_at,now()) WHERE notification_id=$1 RETURNING *",
      [notificationId]);
    if(!r.rows?.length)fail('notification_not_found',404);
    return {...row(r.rows[0]),status:'canceled'};
  }
  async inbox(accountId,account=null){
    const id=String(accountId||'');
    if(!ID.test(id))fail('invalid_notification_account');
    const sql=[
      "SELECT n.*,rd.read_at FROM lr_notifications n LEFT JOIN lr_notification_reads rd",
      "ON rd.notification_id=n.notification_id AND rd.account_id=$1",
      "WHERE n.canceled_at IS NULL AND n.scheduled_at<=now()",
      "AND (n.expires_at IS NULL OR n.expires_at>now())",
      "AND (n.audience_type='all'",
      "OR (n.audience_type='account' AND n.audience_value=$1)",
      "OR (n.audience_type='plan' AND n.audience_value=$2)",
      "OR (n.audience_type='group' AND n.audience_value=$3))",
      "ORDER BY n.scheduled_at DESC,n.created_at DESC LIMIT 100"
    ].join(' ');
    const r=await this.pool.query(sql,[id,String(account?.plan||''),String(account?.groupId||'')]);
    const notifications=(r.rows||[]).map(n=>({...row(n),readAt:ms(n.read_at)}));
    return {notifications,unreadCount:notifications.filter(n=>n.readAt===null).length};
  }
  async markRead(accountId,notificationId,account=null){
    const id=String(accountId||''),nid=String(notificationId||'');
    if(!ID.test(id))fail('invalid_notification_account');
    if(!/^sys_[a-f0-9-]{36}$/.test(nid))fail('invalid_notification_id');
    const sql=[
      "INSERT INTO lr_notification_reads(notification_id,account_id)",
      "SELECT n.notification_id,$1 FROM lr_notifications n",
      "WHERE n.notification_id=$2 AND n.canceled_at IS NULL AND n.scheduled_at<=now()",
      "AND (n.expires_at IS NULL OR n.expires_at>now())",
      "AND (n.audience_type='all'",
      "OR (n.audience_type='account' AND n.audience_value=$1)",
      "OR (n.audience_type='plan' AND n.audience_value=$3)",
      "OR (n.audience_type='group' AND n.audience_value=$4))",
      "ON CONFLICT(notification_id,account_id) DO UPDATE",
      "SET read_at=lr_notification_reads.read_at RETURNING notification_id"
    ].join(' ');
    const r=await this.pool.query(sql,[id,nid,String(account?.plan||''),String(account?.groupId||'')]);
    if(r.rows?.length)return {ok:true};
    fail('notification_not_found',404);
  }
}
