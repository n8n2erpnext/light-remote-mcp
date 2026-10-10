import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TYPES=new Set(['update','feature','promotion','maintenance','security','account']);
const ID=/^[A-Za-z0-9._:-]{1,128}$/;
const STORAGE_LIMIT=500;
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
      reads:[...this.reads.values()]},null,2)+'\n',{mode:0o600});
    fs.renameSync(target,this.stateFile);
  }
  publish({type,title,body,link='/account/inbox',targetAccountId=null,expiresAt=null}={}){
    const category=String(type||''),heading=String(title||'').trim(),
      content=String(body||'').trim(),url=String(link||'/account/inbox');
    if(!TYPES.has(category)||heading.length<2||heading.length>140||content.length<2||content.length>2000)
      throw new AccountNotificationError('invalid_notification_content');
    if(!url.startsWith('/')||url.startsWith('//')||url.includes('\\')||/[\r\n]/.test(url)||url.length>400)
      throw new AccountNotificationError('invalid_notification_link');
    if(targetAccountId!==null&&!ID.test(targetAccountId))
      throw new AccountNotificationError('invalid_notification_recipient');
    const expiry=expiresAt==null?null:Number(expiresAt);
    if(expiry!==null&&(!Number.isFinite(expiry)||expiry<=this.now()))
      throw new AccountNotificationError('invalid_notification_expiry');
    const row={notificationId:'sys_'+crypto.randomUUID(),type:category,title:heading,body:content,
      link:url,targetAccountId,createdAt:this.now(),expiresAt:expiry};
    this.messages.push(row);
    if(this.messages.length>STORAGE_LIMIT)this.messages=this.messages.slice(-STORAGE_LIMIT);
    const retained=new Set(this.messages.map(m=>m.notificationId));
    for(const [key,read] of this.reads)if(!retained.has(read.notificationId))this.reads.delete(key);
    this._save();return row;
  }
  inbox(accountId){
    const id=String(accountId||'');
    if(!ID.test(id))throw new AccountNotificationError('invalid_notification_account');
    const notifications=this.messages.filter(n=>(n.targetAccountId===null||n.targetAccountId===id)&&
      (n.expiresAt===null||n.expiresAt>this.now())).map(n=>({...n,
        readAt:this.reads.get(id+':'+n.notificationId)?.readAt||null}))
      .sort((a,b)=>b.createdAt-a.createdAt);
    return {notifications:notifications.slice(0,100),unreadCount:notifications.filter(n=>!n.readAt).length};
  }
  markRead(accountId,notificationId){
    const id=String(accountId||''),key=String(notificationId||'');
    const item=this.inbox(id).notifications.find(n=>n.notificationId===key);
    if(!item)throw new AccountNotificationError('notification_not_found',404);
    if(!item.readAt){
      this.reads.set(id+':'+key,{accountId:id,notificationId:key,readAt:this.now()});
      this._save();
    }
    return {ok:true};
  }
}
