import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_PLAN_CONNECTION_CAPS = Object.freeze({
  free: 4 * 60 * 60 * 1000,
  pro: 24 * 60 * 60 * 1000,
  vip: 72 * 60 * 60 * 1000
});
export const MIN_RECONNECT_GRACE_MS = 15 * 60 * 1000;
export const MAX_RECONNECT_GRACE_MS = 60 * 60 * 1000;
export const DEFAULT_RECONNECT_GRACE_MS = 30 * 60 * 1000;

export class DeviceConnectionError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}

function validId(value,name){
  const text=String(value||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(text)) throw new DeviceConnectionError(name);
  return text;
}

export class DeviceConnectionRegistry {
  constructor({stateFile=null,planCaps=DEFAULT_PLAN_CONNECTION_CAPS,defaultGraceMs=DEFAULT_RECONNECT_GRACE_MS,emit=()=>{},now=()=>Date.now()}={}){
    this.stateFile=stateFile; this.planCaps={...planCaps}; this.defaultGraceMs=Number(defaultGraceMs); this.emit=emit; this.now=now;
    this.connections=new Map(); this.loadError=null;
    if(this.defaultGraceMs<MIN_RECONNECT_GRACE_MS||this.defaultGraceMs>MAX_RECONNECT_GRACE_MS) throw new DeviceConnectionError('invalid_default_reconnect_grace');
    this._load();
  }
  _persist(){
    if(!this.stateFile)return;
    const dir=path.dirname(this.stateFile); fs.mkdirSync(dir,{recursive:true,mode:0o750});
    const tmp=`${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp,`${JSON.stringify({schemaVersion:1,connections:[...this.connections.values()]},null,2)}\n`,{mode:0o600});
    fs.chmodSync(tmp,0o600); fs.renameSync(tmp,this.stateFile);
  }
  _load(){
    if(!this.stateFile||!fs.existsSync(this.stateFile))return;
    try{
      const parsed=JSON.parse(fs.readFileSync(this.stateFile,'utf8'));
      for(const row of Array.isArray(parsed.connections)?parsed.connections:[]){
        if(!row?.deviceId||!row?.accountId)continue;
        this.connections.set(String(row.deviceId),row);
      }
    }catch(error){this.connections.clear();this.loadError=error?.message||'invalid_connection_state';}
  }
  _cap(plan){
    const key=String(plan||'free').trim().toLowerCase();
    const cap=Number(this.planCaps[key]);
    if(!Number.isFinite(cap)||cap<60*60*1000) throw new DeviceConnectionError('invalid_connection_plan');
    return {plan:key,capMs:cap};
  }
  _grace(value){
    const grace=value==null?this.defaultGraceMs:Number(value);
    if(!Number.isFinite(grace)||grace<MIN_RECONNECT_GRACE_MS||grace>MAX_RECONNECT_GRACE_MS) throw new DeviceConnectionError('invalid_reconnect_grace');
    return Math.round(grace);
  }
  _view(row,now=this.now()){
    const live=row&&!row.closedAt&&now<row.hardExpiresAt;
    return row?{...row,state:live?'connected':'dormant',remainingMs:live?Math.max(0,row.hardExpiresAt-now):0}:null;
  }
  connect({accountId,deviceId,plan='free',requestedLeaseMs=null,reconnectGraceMs=null}={}){
    const aid=validId(accountId,'invalid_connection_account_id'), did=validId(deviceId,'invalid_connection_device_id');
    const {plan:planName,capMs}=this._cap(plan), now=this.now();
    const prior=this.connections.get(did);
    if(prior&&!prior.closedAt&&now<prior.hardExpiresAt){
      if(prior.accountId!==aid) throw new DeviceConnectionError('device_connection_account_mismatch',403);
      return this._view(prior,now);
    }
    const requested=requestedLeaseMs==null?capMs:Number(requestedLeaseMs);
    if(!Number.isFinite(requested)||requested<=0||requested>capMs) throw new DeviceConnectionError('invalid_device_connection_lease');
    const row={connectionId:`dc_${crypto.randomUUID()}`,accountId:aid,deviceId:did,plan:planName,planCapMs:capMs,
      connectedAt:now,hardExpiresAt:now+Math.round(requested),reconnectGraceMs:this._grace(reconnectGraceMs),lastActivityAt:now,
      closedAt:null,closeReason:null};
    this.connections.set(did,row); this._persist();
    this.emit({type:'device_connection_opened',accountId:aid,deviceId:did,connectionId:row.connectionId,status:'connected',plan:planName,hardExpiresAt:row.hardExpiresAt,reconnectGraceMs:row.reconnectGraceMs});
    return this._view(row,now);
  }
  disconnect(deviceId,reason='user_disconnect'){
    const did=validId(deviceId,'invalid_connection_device_id'),row=this.connections.get(did);
    if(!row) throw new DeviceConnectionError('device_connection_not_found',404);
    if(!row.closedAt){row.closedAt=this.now();row.closeReason=String(reason||'user_disconnect').slice(0,80);this._persist();
      this.emit({type:'device_connection_closed',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,status:'dormant',reason:row.closeReason});}
    return this._view(row);
  }
  touch(deviceId,reason='activity'){
    const row=this.assertConnected(deviceId); row.lastActivityAt=this.now(); this._persist();
    this.emit({type:'device_connection_activity',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,status:'connected',reason:String(reason).slice(0,80)});
    return this._view(row);
  }
  assertConnected(deviceId){
    const did=validId(deviceId,'invalid_connection_device_id'),row=this.connections.get(did),now=this.now();
    if(!row||row.closedAt) throw new DeviceConnectionError('device_connection_required',409);
    if(now>=row.hardExpiresAt){this.disconnect(did,'hard_lease_expired');throw new DeviceConnectionError('device_connection_expired',410);}
    return row;
  }
  get(deviceId){
    const did=validId(deviceId,'invalid_connection_device_id'),row=this.connections.get(did);
    return row?this._view(row):{deviceId:did,state:'dormant',remainingMs:0};
  }
  list(){return [...this.connections.values()].map(row=>this._view(row)).sort((a,b)=>(b.connectedAt||0)-(a.connectedAt||0));}
  setGrace(deviceId,value){
    const row=this.assertConnected(deviceId); row.reconnectGraceMs=this._grace(value); this._persist();
    this.emit({type:'device_connection_grace_updated',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,status:'connected',reconnectGraceMs:row.reconnectGraceMs});
    return this._view(row);
  }
  reap(){
    const now=this.now(),closed=[];
    for(const row of this.connections.values()){
      if(row.closedAt||now<row.hardExpiresAt)continue;
      const reason='hard_lease_expired';
      row.closedAt=now;row.closeReason=reason;closed.push({deviceId:row.deviceId,connectionId:row.connectionId,reason});
      this.emit({type:'device_connection_closed',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,status:'dormant',reason});
    }
    if(closed.length)this._persist();
    return closed;
  }
}
