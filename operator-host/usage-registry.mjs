import fs from 'node:fs';
import path from 'node:path';

const ID_RE=/^[A-Za-z0-9._:-]{1,128}$/;
function atMs(value,fallback=Date.now()){const n=typeof value==='number'?value:Date.parse(String(value||''));return Number.isFinite(n)?n:fallback;}
function monthKey(ms){const d=new Date(ms);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;}
function monthStart(key){const [y,m]=String(key).split('-').map(Number);return Date.UTC(y,m-1,1);}
function nextMonth(key){const [y,m]=String(key).split('-').map(Number);return Date.UTC(y,m,1);}
function emptyBucket(){return {toolCalls:0,onlineMs:0,devices:{}};}
function emptyDevice(){return {toolCalls:0,onlineMs:0};}

export class UsageRegistry{
  constructor({stateFile=null,now=()=>Date.now()}={}){
    this.stateFile=stateFile;this.now=now;this.accounts={};this.openConnections=new Map();this.trackingSince=this.now();this.loadError=null;this._load();
  }
  _load(){
    if(!this.stateFile||!fs.existsSync(this.stateFile))return;
    try{
      const d=JSON.parse(fs.readFileSync(this.stateFile,'utf8'));
      if(d?.schemaVersion!==1||typeof d.accounts!=='object'||!Array.isArray(d.openConnections))throw new Error('invalid_usage_schema');
      this.accounts=d.accounts||{};this.trackingSince=Number(d.trackingSince)||this.trackingSince;
      for(const row of d.openConnections)if(row?.connectionId&&row?.accountId&&row?.deviceId)this.openConnections.set(String(row.connectionId),row);
    }catch(error){this.accounts={};this.openConnections.clear();this.loadError=error?.message||'invalid_usage_state';}
  }
  _persist(){
    if(!this.stateFile)return;
    const dir=path.dirname(this.stateFile);fs.mkdirSync(dir,{recursive:true,mode:0o750});
    const data={schemaVersion:1,trackingSince:this.trackingSince,accounts:this.accounts,openConnections:[...this.openConnections.values()]};
    const tmp=`${this.stateFile}.${process.pid}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(data,null,2)}\n`,{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,this.stateFile);
  }
  isEmpty(){return !Object.keys(this.accounts).length&&!this.openConnections.size;}
  _account(accountId){const id=String(accountId||'');if(!ID_RE.test(id))return null;return this.accounts[id]||(this.accounts[id]={months:{}});}
  _bucket(accountId,key){const a=this._account(accountId);if(!a)return null;return a.months[key]||(a.months[key]=emptyBucket());}
  _device(bucket,deviceId){const id=String(deviceId||'unknown');return bucket.devices[id]||(bucket.devices[id]=emptyDevice());}
  _addOnline(accountId,deviceId,start,end){
    let cursor=Math.max(0,Number(start)||0),stop=Math.max(cursor,Number(end)||0);if(stop<=cursor)return false;
    while(cursor<stop){const key=monthKey(cursor),boundary=nextMonth(key),sliceEnd=Math.min(stop,boundary),ms=sliceEnd-cursor,b=this._bucket(accountId,key);if(!b)break;b.onlineMs+=ms;this._device(b,deviceId).onlineMs+=ms;cursor=sliceEnd;}
    return true;
  }
  _accrue(row,to){const limit=Math.min(Number(to)||this.now(),Number(row.hardExpiresAt)||Infinity),from=Number(row.lastAccruedAt)||Number(row.openedAt)||limit;if(limit<=from)return false;this._addOnline(row.accountId,row.deviceId,from,limit);row.lastAccruedAt=limit;return true;}
  ingest(event,{persist=true}={}){
    const e=event||{},at=atMs(e.at,this.now());let changed=false;
    if(e.type==='session_activity'&&e.action==='toolCalls'&&e.accountId){const b=this._bucket(e.accountId,monthKey(at));if(b){b.toolCalls++;this._device(b,e.deviceId).toolCalls++;changed=true;}}
    else if(e.type==='device_connection_opened'&&e.accountId&&e.connectionId&&e.deviceId){
      for(const [id,row] of this.openConnections)if(row.deviceId===e.deviceId&&id!==e.connectionId){this._accrue(row,at);this.openConnections.delete(id);changed=true;}
      this.openConnections.set(String(e.connectionId),{connectionId:String(e.connectionId),accountId:String(e.accountId),deviceId:String(e.deviceId),openedAt:at,lastAccruedAt:at,hardExpiresAt:Number(e.hardExpiresAt)||null});changed=true;
    } else if(e.type==='device_connection_closed'&&e.connectionId){const row=this.openConnections.get(String(e.connectionId));if(row){this._accrue(row,at);this.openConnections.delete(String(e.connectionId));changed=true;}}
    if(changed&&persist)this._persist();return changed;
  }
  backfill(events=[]){if(!this.isEmpty())return {backfilled:false,events:0};let count=0,first=null;for(const e of events){const t=atMs(e?.at,NaN);if(!Number.isFinite(t))continue;first=first==null?t:Math.min(first,t);if(this.ingest(e,{persist:false}))count++;}if(first!=null)this.trackingSince=first;this._persist();return {backfilled:true,events:count,trackingSince:this.trackingSince};}
  reconcileConnections(rows=[]){let changed=false;for(const c of rows){if(!c||c.state!=='connected'||!c.connectionId||!c.accountId||!c.deviceId)continue;if(this.openConnections.has(String(c.connectionId)))continue;const openedAt=Number(c.connectedAt)||this.now();this.openConnections.set(String(c.connectionId),{connectionId:String(c.connectionId),accountId:String(c.accountId),deviceId:String(c.deviceId),openedAt,lastAccruedAt:openedAt,hardExpiresAt:Number(c.hardExpiresAt)||null});changed=true;}if(changed)this._persist();return changed;}
  _accrueOpen(now=this.now()){let changed=false;for(const [id,row] of this.openConnections){if(this._accrue(row,now))changed=true;if(row.hardExpiresAt&&Number(row.lastAccruedAt)>=Number(row.hardExpiresAt)){this.openConnections.delete(id);changed=true;}}if(changed)this._persist();}
  summary(accountId,{months=6}={}){
    this._accrueOpen();const aid=String(accountId||''),a=this.accounts[aid]||{months:{}},now=this.now(),count=Math.max(1,Math.min(Number(months)||6,24)),current=monthKey(now),keys=[];let y=new Date(now).getUTCFullYear(),m=new Date(now).getUTCMonth();for(let i=0;i<count;i++){keys.unshift(`${y}-${String(m+1).padStart(2,'0')}`);m--;if(m<0){m=11;y--;}}
    const series=keys.map(key=>{const b=a.months?.[key]||emptyBucket();return {month:key,toolCalls:Number(b.toolCalls)||0,onlineMs:Number(b.onlineMs)||0,onlineHours:(Number(b.onlineMs)||0)/3600000};});
    const b=a.months?.[current]||emptyBucket(),daysElapsed=Math.max(1,new Date(now).getUTCDate()),devices=Object.entries(b.devices||{}).map(([deviceId,row])=>({deviceId,toolCalls:Number(row.toolCalls)||0,onlineMs:Number(row.onlineMs)||0,onlineHours:(Number(row.onlineMs)||0)/3600000})).sort((x,y)=>y.toolCalls-x.toolCalls||y.onlineMs-x.onlineMs);
    return {accountId:aid,trackingSince:this.trackingSince,currentMonth:current,daysElapsed,toolCallsThisMonth:Number(b.toolCalls)||0,onlineMsThisMonth:Number(b.onlineMs)||0,onlineHoursThisMonth:(Number(b.onlineMs)||0)/3600000,dailyAverageCalls:(Number(b.toolCalls)||0)/daysElapsed,dailyAverageOnlineHours:((Number(b.onlineMs)||0)/3600000)/daysElapsed,series,devices};
  }
}
