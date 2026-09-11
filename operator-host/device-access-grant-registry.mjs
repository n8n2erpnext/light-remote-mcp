import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REQUEST_TTL_MS = 10 * 60 * 1000;
const DEFAULT_IDLE_GRACE_MS = 30 * 60 * 1000;
const MIN_IDLE_GRACE_MS = 15 * 60 * 1000;
const MAX_IDLE_GRACE_MS = 60 * 60 * 1000;

export class DeviceAccessGrantError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}

function validId(value,name){
  const text=String(value||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,160}$/.test(text)) throw new DeviceAccessGrantError(name);
  return text;
}
function digest(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function equalDigest(value,expected){
  const a=Buffer.from(digest(value),'hex'),b=Buffer.from(String(expected||''),'hex');
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function userCode(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.randomBytes(8);let out='';
  for(let i=0;i<8;i++)out+=alphabet[bytes[i]%alphabet.length];
  return `${out.slice(0,4)}-${out.slice(4)}`;
}
export class DeviceAccessGrantRegistry {
  constructor({stateFile=null,emit=()=>{},now=()=>Date.now(),defaultIdleGraceMs=DEFAULT_IDLE_GRACE_MS}={}){
    this.stateFile=stateFile;this.emit=emit;this.now=now;this.defaultIdleGraceMs=Number(defaultIdleGraceMs);
    if(!Number.isFinite(this.defaultIdleGraceMs)||this.defaultIdleGraceMs<MIN_IDLE_GRACE_MS||this.defaultIdleGraceMs>MAX_IDLE_GRACE_MS)throw new DeviceAccessGrantError('invalid_default_access_idle_grace');
    this.requests=new Map();this.grants=new Map();this.loadError=null;
    this._load();
  }
  _persist(){
    if(!this.stateFile)return;
    const dir=path.dirname(this.stateFile);fs.mkdirSync(dir,{recursive:true,mode:0o750});
    const tmp=`${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp,`${JSON.stringify({schemaVersion:1,requests:[...this.requests.values()],grants:[...this.grants.values()]},null,2)}\n`,{mode:0o600});
    fs.chmodSync(tmp,0o600);fs.renameSync(tmp,this.stateFile);
  }
  _load(){
    if(!this.stateFile||!fs.existsSync(this.stateFile))return;
    try{
      const parsed=JSON.parse(fs.readFileSync(this.stateFile,'utf8'));
      for(const row of Array.isArray(parsed.requests)?parsed.requests:[])if(row?.requestId)this.requests.set(String(row.requestId),row);
      for(const row of Array.isArray(parsed.grants)?parsed.grants:[])if(row?.grantId){
        if(!Number.isFinite(Number(row.idleGraceMs)))row.idleGraceMs=this.defaultIdleGraceMs;
        if(!Number.isFinite(Number(row.lastActivityAt)))row.lastActivityAt=Number(row.approvedAt)||this.now();
        this.grants.set(String(row.grantId),row);
      }
    }catch(error){this.requests.clear();this.grants.clear();this.loadError=error?.message||'invalid_device_access_state';}
  }
  _grace(value){
    const grace=value==null?this.defaultIdleGraceMs:Number(value);
    if(!Number.isFinite(grace)||grace<MIN_IDLE_GRACE_MS||grace>MAX_IDLE_GRACE_MS)throw new DeviceAccessGrantError('invalid_access_idle_grace');
    return Math.round(grace);
  }
  _activeGrant(deviceId,connectionId,now=this.now()){
    for(const row of this.grants.values())if(row.deviceId===deviceId&&row.connectionId===connectionId&&!row.closedAt&&now<row.expiresAt)return row;
    return null;
  }
  request({accountId,deviceId,connectionId,connectionExpiresAt,agentId=null,label='ChatGPT Plus'}={}){
    const aid=validId(accountId,'invalid_access_account_id'),did=validId(deviceId,'invalid_access_device_id'),cid=validId(connectionId,'invalid_access_connection_id');
    const now=this.now(),expiresAt=Number(connectionExpiresAt);
    if(!Number.isFinite(expiresAt)||expiresAt<=now)throw new DeviceAccessGrantError('device_connection_expired',410);
    const active=this._activeGrant(did,cid,now);
    if(active){active.lastActivityAt=now;this._persist();return {state:'approved',grant:{...active},request:null,pollToken:null};}
    const requestId=`pa_${crypto.randomBytes(18).toString('base64url')}`,pollToken=crypto.randomBytes(32).toString('base64url');
    const row={requestId,accountId:aid,deviceId:did,connectionId:cid,agentId:agentId?validId(agentId,'invalid_plus_agent_id'):null,label:String(label||'ChatGPT Plus').slice(0,120),userCode:userCode(),pollHash:digest(pollToken),createdAt:now,expiresAt:Math.min(expiresAt,now+REQUEST_TTL_MS),state:'pending',consumedAt:null,deniedAt:null};
    this.requests.set(requestId,row);this._persist();
    this.emit({type:'device_access_requested',accountId:aid,deviceId:did,connectionId:cid,requestId,status:'pending',label:row.label,agentId:row.agentId});
    return {state:'pending',request:{...row,pollHash:undefined},pollToken,grant:null};
  }
  poll({requestId,pollToken}={}){
    const id=validId(requestId,'invalid_plus_request_id'),row=this.requests.get(id),now=this.now();
    if(!row||row.consumedAt||!equalDigest(pollToken,row.pollHash))throw new DeviceAccessGrantError('plus_authorization_not_found',404);
    const active=this._activeGrant(row.deviceId,row.connectionId,now);
    if(active){row.state='approved';row.consumedAt=now;this._persist();return {state:'approved',grant:{...active}};}
    if(row.state==='denied')throw new DeviceAccessGrantError('plus_authorization_denied',403);
    if(row.expiresAt<=now){row.state='expired';row.consumedAt=now;this._persist();throw new DeviceAccessGrantError('plus_authorization_expired',410);}
    return {state:'pending',request:{requestId:row.requestId,deviceId:row.deviceId,connectionId:row.connectionId,label:row.label,userCode:row.userCode,expiresAt:row.expiresAt}};
  }
  approve(requestId,{deviceId=null,connectionId,connectionExpiresAt,idleGraceMs=null}={}){
    const id=validId(requestId,'invalid_plus_request_id'),row=this.requests.get(id),now=this.now();
    if(!row||row.consumedAt)throw new DeviceAccessGrantError('plus_authorization_not_found',404);
    if(row.state!=='pending')throw new DeviceAccessGrantError(`plus_authorization_${row.state}`,409);
    if(deviceId!=null&&row.deviceId!==String(deviceId))throw new DeviceAccessGrantError('device_access_request_device_mismatch',403);
    if(row.expiresAt<=now)throw new DeviceAccessGrantError('plus_authorization_expired',410);
    const cid=validId(connectionId,'invalid_access_connection_id'),expiresAt=Number(connectionExpiresAt);
    if(cid!==row.connectionId)throw new DeviceAccessGrantError('device_connection_changed',409);
    if(!Number.isFinite(expiresAt)||expiresAt<=now)throw new DeviceAccessGrantError('device_connection_expired',410);
    const prior=this._activeGrant(row.deviceId,cid,now);
    const grant=prior||{grantId:`dag_${crypto.randomUUID()}`,accountId:row.accountId,deviceId:row.deviceId,connectionId:cid,approvedAt:now,lastActivityAt:now,idleGraceMs:this._grace(idleGraceMs),expiresAt,closedAt:null,closeReason:null};
    if(prior){grant.lastActivityAt=now;if(idleGraceMs!=null)grant.idleGraceMs=this._grace(idleGraceMs);}
    this.grants.set(grant.grantId,grant);
    for(const pending of this.requests.values())if(pending.deviceId===row.deviceId&&pending.connectionId===cid&&!pending.consumedAt&&pending.state==='pending')pending.state='approved';
    this._persist();
    this.emit({type:'device_access_approved',accountId:row.accountId,deviceId:row.deviceId,connectionId:cid,requestId:row.requestId,grantId:grant.grantId,status:'approved'});
    return {...grant};
  }
  deny(requestId,reason='owner_denied',{deviceId=null}={}){
    const id=validId(requestId,'invalid_plus_request_id'),row=this.requests.get(id);
    if(!row||row.consumedAt)throw new DeviceAccessGrantError('plus_authorization_not_found',404);
    if(row.state!=='pending')throw new DeviceAccessGrantError(`plus_authorization_${row.state}`,409);
    if(deviceId!=null&&row.deviceId!==String(deviceId))throw new DeviceAccessGrantError('device_access_request_device_mismatch',403);
    const deniedAt=this.now(),denyReason=String(reason||'owner_denied').slice(0,80);
    for(const pending of this.requests.values())if(pending.deviceId===row.deviceId&&pending.connectionId===row.connectionId&&!pending.consumedAt&&pending.state==='pending'){pending.state='denied';pending.deniedAt=deniedAt;pending.denyReason=denyReason;}
    this._persist();
    this.emit({type:'device_access_denied',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,requestId:row.requestId,status:'denied'});
    return {requestId:row.requestId,state:row.state};
  }
  assert(grantId,{deviceId=null,connectionId=null,touch=true}={}){
    const id=validId(grantId,'invalid_access_grant_id'),row=this.grants.get(id),now=this.now();
    if(!row||row.closedAt)throw new DeviceAccessGrantError('device_access_grant_required',401);
    if(now>=row.expiresAt){this.close(row.grantId,'device_connection_expired');throw new DeviceAccessGrantError('device_access_grant_expired',401);}
    if(deviceId!=null&&row.deviceId!==String(deviceId))throw new DeviceAccessGrantError('device_access_grant_device_mismatch',403);
    if(connectionId!=null&&row.connectionId!==String(connectionId))throw new DeviceAccessGrantError('device_access_grant_connection_mismatch',403);
    if(touch!==false){row.lastActivityAt=now;this._persist();}
    return {...row};
  }
  close(grantId,reason='closed'){
    const id=validId(grantId,'invalid_access_grant_id'),row=this.grants.get(id);
    if(!row)throw new DeviceAccessGrantError('device_access_grant_not_found',404);
    if(!row.closedAt){row.closedAt=this.now();row.closeReason=String(reason||'closed').slice(0,80);this._persist();this.emit({type:'device_access_closed',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,grantId:row.grantId,status:'closed',reason:row.closeReason});}
    return {...row};
  }
  closeByDevice(deviceId,reason='device_connection_closed'){
    const did=validId(deviceId,'invalid_access_device_id'),closed=[];
    for(const row of this.grants.values())if(row.deviceId===did&&!row.closedAt)closed.push(this.close(row.grantId,reason));
    return closed;
  }
  requestInfo(requestId){
    const id=validId(requestId,'invalid_plus_request_id'),row=this.requests.get(id);
    if(!row)throw new DeviceAccessGrantError('plus_authorization_not_found',404);
    return {requestId:row.requestId,accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,agentId:row.agentId,label:row.label,userCode:row.userCode,createdAt:row.createdAt,expiresAt:row.expiresAt,state:row.state,consumedAt:row.consumedAt||null};
  }
  pendingAll(){
    const now=this.now();
    return [...this.requests.values()].filter(row=>row.state==='pending'&&!row.consumedAt&&row.expiresAt>now).map(row=>({requestId:row.requestId,deviceId:row.deviceId,connectionId:row.connectionId,agentId:row.agentId,label:row.label,userCode:row.userCode,createdAt:row.createdAt,expiresAt:row.expiresAt}));
  }
  pendingForDevice(deviceId){
    const did=validId(deviceId,'invalid_access_device_id'),now=this.now();
    return [...this.requests.values()].filter(row=>row.deviceId===did&&row.state==='pending'&&!row.consumedAt&&row.expiresAt>now).map(row=>({requestId:row.requestId,deviceId:row.deviceId,connectionId:row.connectionId,agentId:row.agentId,label:row.label,userCode:row.userCode,createdAt:row.createdAt,expiresAt:row.expiresAt}));
  }
  activeForDevice(deviceId,connectionId=null){
    const did=validId(deviceId,'invalid_access_device_id'),now=this.now();
    for(const row of this.grants.values())if(row.deviceId===did&&!row.closedAt&&now<row.expiresAt&&(connectionId==null||row.connectionId===String(connectionId)))return {...row};
    return null;
  }
  reap({connectionForDevice=()=>null,liveSessionsForDevice=()=>0}={}){
    const now=this.now(),closed=[];let changed=false;
    for(const row of this.requests.values())if(!row.consumedAt&&row.state==='pending'&&row.expiresAt<=now){row.state='expired';row.consumedAt=now;changed=true;}
    for(const row of this.grants.values()){
      if(row.closedAt)continue;
      const connection=connectionForDevice(row.deviceId);
      let reason=null;
      if(now>=row.expiresAt)reason='device_connection_expired';
      else if(!connection||connection.state!=='connected')reason='device_connection_closed';
      else if(connection.connectionId!==row.connectionId)reason='device_connection_changed';
      else if(Number(liveSessionsForDevice(row.deviceId)||0)===0 && now-Number(row.lastActivityAt||row.approvedAt||0)>=Number(row.idleGraceMs||this.defaultIdleGraceMs))reason='device_access_idle_expired';
      if(reason){row.closedAt=now;row.closeReason=reason;closed.push({...row});changed=true;this.emit({type:'device_access_closed',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,grantId:row.grantId,status:'closed',reason});}
    }
    if(changed)this._persist();
    return closed;
  }
}
