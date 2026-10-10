import fs from 'node:fs';
import path from 'node:path';

export class ClientAnnouncementError extends Error {
  constructor(message,status=500){super(message);this.status=status;}
}
const PLATFORMS=new Set(['windows','macos','linux']);
const safeUrl=value=>{
  const v=String(value||'').trim();
  if(v.startsWith('/')&&!v.startsWith('//')&&!v.includes('\\'))return v;
  try{const u=new URL(v);return u.protocol==='https:'?u.href:'';}catch{return '';}
};
export class ClientAnnouncementInbox {
  constructor({hub,platform,storeFile=null,fetchImpl=fetch,now=()=>Date.now(),onNew=()=>{}}={}){
    if(!PLATFORMS.has(String(platform)))throw new ClientAnnouncementError('invalid_client_platform',400);
    this.hub=String(hub||'').replace(/\/$/,'');
    if(!/^https:\/\//.test(this.hub))throw new ClientAnnouncementError('invalid_announcement_hub',400);
    this.platform=platform;this.storeFile=storeFile;this.fetchImpl=fetchImpl;this.now=now;this.onNew=onNew;
    this.state={schemaVersion:1,seen:{},items:[],checkedAt:null};
    if(storeFile&&fs.existsSync(storeFile)){
      const prior=JSON.parse(fs.readFileSync(storeFile,'utf8'));
      if(prior.schemaVersion===1)this.state={...this.state,...prior};
    }
  }
  _save(){
    if(!this.storeFile)return;
    fs.mkdirSync(path.dirname(this.storeFile),{recursive:true,mode:0o700});
    const file=this.storeFile+'.'+process.pid+'.tmp';
    fs.writeFileSync(file,JSON.stringify(this.state)+'\n',{mode:0o600});
    fs.renameSync(file,this.storeFile);
  }
  async poll(){
    const url=new URL('/api/client-announcements',this.hub);
    url.searchParams.set('platform',this.platform);
    const response=await this.fetchImpl(url.href,{method:'GET',cache:'no-store',headers:{'accept':'application/json'},signal:AbortSignal.timeout(10_000)});
    if(!response.ok)throw new ClientAnnouncementError('announcement_feed_unavailable',response.status);
    const data=await response.json();
    if(data?.schemaVersion!==1||!Array.isArray(data.items)||data.items.length>25)throw new ClientAnnouncementError('announcement_feed_invalid',502);
    const items=data.items.map(x=>({
      id:String(x.id||'').slice(0,90),kind:['feature','update','maintenance','service'].includes(x.kind)?x.kind:'service',
      title:String(x.title||'').slice(0,110),message:String(x.message||'').slice(0,400),
      linkLabel:String(x.linkLabel||'').slice(0,50),linkUrl:safeUrl(x.linkUrl),updatedAt:String(x.updatedAt||'').slice(0,40),
      endAt:String(x.endAt||'').slice(0,40),dismissible:Boolean(x.dismissible)
    })).filter(x=>/^[a-zA-Z0-9-]{8,90}$/.test(x.id));
    const previous=this.state.seen||{},seen={...previous},fresh=[];
    for(const item of items){const key=item.id+'|'+item.updatedAt;if(!previous[key])fresh.push(item);seen[key]=this.now();}
    this.state={schemaVersion:1,seen:Object.fromEntries(Object.entries(seen).sort((a,b)=>b[1]-a[1]).slice(0,256)),items,checkedAt:this.now()};
    this._save();
    for(const item of fresh)await this.onNew(item);
    return {ok:true,platform:this.platform,received:items.length,newItems:fresh.length,items};
  }
  snapshot(){return {platform:this.platform,items:[...this.state.items],checkedAt:this.state.checkedAt};}
}
