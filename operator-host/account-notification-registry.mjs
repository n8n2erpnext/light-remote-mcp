import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TYPES=new Set(['update','feature','promotion','maintenance','security','account']);
const AUDIENCES=new Set(['all','account','plan','group']);
const ID=/^[A-Za-z0-9._:-]{1,128}$/;
const STORAGE_LIMIT=500;
const RETENTION_READS=5000;
export class AccountNotificationError extends Error{
  constructor(message,status=400){super(message);this.status=status;}
}
export class AccountNotificationRegistry{
  constructor({stateFile=null,now=()=>Date.now()}={}){
    this.stateFile=stateFile;this.now=now;this.messages=[];this.reads=new Map();
    if(stateFile&&fs.existsSync(stateFile)){
      const parsed=JSON.parse(fs.readFileSync(stateFile,'utf8'));
      if(parsed.schemaVersion!==1)throw new AccountNotificationError('notification_state_invalid',500);
      this.messages=Array.isArray(parsed.messages)?parsed.messages:[];
      for(const row of parsed.reads||[])if(row.accountId&&row.notificationId)
        this.reads.set(row.accountId+':'+row.notificationId,row);
    }
  }
  _save(){
    if(!this.stateFile)return;
    fs.mkdirSync(path.dirname(this.stateFile),{recursive:true,mode:0o750});
    const target=this.stateFile+'.'+process.pid+'.tmp';
    fs.writeFileSync(target,JSON.stringify({schemaVersion:1,messages:this.messages,
      reads:[...this.reads.values()].slice(-RETENTION_READS)},null,2)+'\n',{mode:0o600});
    fs.chmodSync(target,0o600);
    fs.renameSync(target,this.stateFile);
  }
  publish({type,title,body,link='/account/inbox',targetAccountId=null,
    audienceType=null,audienceValue=null,scheduledAt=null,expiresAt=null,publishedBy='admin'}={}){
    const category=String(type||''),heading=String(title||'').trim(),
      content=String(body||'').trim(),url=String(link||'/account/inbox');
    if(!TYPES.has(category)||heading.length<2||heading.length>140||content.length<2||content.length>2000)
      throw new AccountNotificationError('invalid_notification_content');
    if(!url.startsWith('/')||url.startsWith('//')||url.includes('\\')||/[\r\n]/.test(url)||url.length>400)
      throw new AccountNotificationError('invalid_notification_link');
    // Legacy targetAccountId remains supported; new audience scopes are explicit.
    const scope=String(audienceType|| (targetAccountId?'account':'all'));
    const selector=String(audienceValue??targetAccountId??'').trim();
    if(!AUDIENCES.has(scope))throw new AccountNotificationError('invalid_notification_audience');
    if(scope==='all'&&selector||scope!=='all'&&!ID.test(selector))
      throw new AccountNotificationError('invalid_notification_audience');
    if(scope==='plan'&&!['free','pro','vip'].includes(selector))
      throw new AccountNotificationError('invalid_notification_audience');
    const start=scheduledAt==null?this.now():Number(scheduledAt);
    if(!Number.isFinite(start)||start<this.now()-60_000||start>this.now()+365*86400000)
      throw new AccountNotificationError('invalid_notification_schedule');
    const expiry=expiresAt==null?null:Number(expiresAt);
    if(expiry!==null&&(!Number.isFinite(expiry)||expiry<=Math.max(start,this.now())||expiry>start+365*86400000))
      throw new AccountNotificationError('invalid_notification_expiry');
    const row={notificationId:'sys_'+crypto.randomUUID(),type:category,title:heading,body:content,
      link:url,targetAccountId:scope==='account'?selector:null,audienceType:scope,audienceValue:selector||null,
      createdAt:this.now(),scheduledAt:start,expiresAt:expiry,publishedBy:String(publishedBy||'admin').slice(0,128),
      canceledAt:null,canceledBy:null};
    this.messages.push(row);
    if(this.messages.length>STORAGE_LIMIT)this.messages=this.messages.slice(-STORAGE_LIMIT);
    const retained=new Set(this.messages.map(m=>m.notificationId));
    for(const [key,read] of this.reads)if(!retained.has(read.notificationId))this.reads.delete(key);
    this._save();return row;
  }
  status(n){
    if(n.canceledAt)return 'canceled';
    if(n.expiresAt!==null&&n.expiresAt<=this.now())return 'expired';
    if(Number(n.scheduledAt||n.createdAt)>this.now())return 'scheduled';
    return 'active';
  }
  list(){
    return {notifications:[...this.messages].reverse().map(n=>({...n,
      status:this.status(n),readCount:[...this.reads.values()].filter(x=>x.notificationId===n.notificationId).length}))};
  }
  cancel(notificationId,{by='admin'}={}){
    const row=this.messages.find(n=>n.notificationId===notificationId);
    if(!row)throw new AccountNotificationError('notification_not_found',404);
    if(row.canceledAt)return {...row,status:'canceled'};
    row.canceledAt=this.now();row.canceledBy=String(by).slice(0,128);
    this._save();return {...row,status:'canceled'};
  }
  _visibleTo(n,id,account){
    const scope=n.audienceType|| (n.targetAccountId?'account':'all');
    const value=n.audienceValue??n.targetAccountId;
    if(scope==='all')return true;
    if(scope==='account')return value===id;
    if(scope==='plan')return account?.plan===value;
    if(scope==='group')return account?.groupId===value;
    return false;
  }
  inbox(accountId,account=null){
    const id=String(accountId||'');
    if(!ID.test(id))throw new AccountNotificationError('invalid_notification_account');
    const notifications=this.messages.filter(n=>this.status(n)==='active'&&this._visibleTo(n,id,account))
      .map(n=>({...n,readAt:this.reads.get(id+':'+n.notificationId)?.readAt||null}))
      .sort((a,b)=>b.scheduledAt-a.scheduledAt||b.createdAt-a.createdAt);
    return {notifications:notifications.slice(0,100),unreadCount:notifications.filter(n=>!n.readAt).length};
  }
  markRead(accountId,notificationId,account=null){
    const id=String(accountId||''),key=String(notificationId||'');
    const item=this.inbox(id,account).notifications.find(n=>n.notificationId===key);
    if(!item)throw new AccountNotificationError('notification_not_found',404);
    if(!item.readAt){
      this.reads.set(id+':'+key,{accountId:id,notificationId:key,readAt:this.now()});
      this._save();
    }
    return {ok:true};
  }
}
