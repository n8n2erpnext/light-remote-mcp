import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REQUEST_TTL_MS = 10 * 60 * 1000;
const DEFAULT_IDLE_GRACE_MS = 30 * 60 * 1000;
const MIN_IDLE_GRACE_MS = 15 * 60 * 1000;
const MAX_IDLE_GRACE_MS = 24 * 60 * 60 * 1000;
export const AB_GRANT_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

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
        if(!Number.isFinite(Number(row.absoluteExpiresAt)))row.absoluteExpiresAt=Number(row.approvedAt)+AB_GRANT_MAX_LIFETIME_MS;
        this.grants.set(String(row.grantId),row);
      }
    }catch(error){this.requests.clear();this.grants.clear();this.loadError=error?.message||'invalid_device_access_state';}
  }
  _grace(value){
    const grace=value==null?this.defaultIdleGraceMs:Number(value);
    if(!Number.isFinite(grace)||grace<MIN_IDLE_GRACE_MS||grace>MAX_IDLE_GRACE_MS)throw new DeviceAccessGrantError('invalid_access_idle_grace');
    return Math.round(grace);
  }
  _expiry(row){return Math.min(Number(row.expiresAt)||0,Number(row.absoluteExpiresAt)||Number(row.approvedAt)+AB_GRANT_MAX_LIFETIME_MS);}
  _activeGrant(deviceId,connectionId,now=this.now(),agentId=null,accountId=null,purpose=null){
    for(const row of this.grants.values())if(row.deviceId===deviceId&&row.connectionId===connectionId&&!row.closedAt&&now<this._expiry(row)&&(agentId==null||row.agentId===String(agentId))&&(accountId==null||row.accountId===String(accountId))&&(purpose==null||String(row.purpose||'device')===purpose))return row;
    return null;
  }
  request({accountId,deviceId,connectionId,connectionExpiresAt,agentId=null,label='ChatGPT Plus',forceApproval=false,requestTtlMs=REQUEST_TTL_MS,pairingId=null,purpose='device'}={}){
    const aid=validId(accountId,'invalid_access_account_id'),did=validId(deviceId,'invalid_access_device_id'),cid=validId(connectionId,'invalid_access_connection_id');
    const kind=String(purpose||'device');
    if(!['device','team-member'].includes(kind)||(kind==='team-member'&&(!forceApproval||!agentId)))
      throw new DeviceAccessGrantError('invalid_access_grant_purpose',400);
    const now=this.now(),expiresAt=Number(connectionExpiresAt);
    if(!Number.isFinite(expiresAt)||expiresAt<=now)throw new DeviceAccessGrantError('device_connection_expired',410);
    const active=this._activeGrant(did,cid,now,agentId,aid,kind);
    if(active&&!forceApproval){active.lastActivityAt=now;this._persist();return {state:'approved',grant:{...active},request:null,pollToken:null};}
    const ttl=Math.max(30*1000,Math.min(Number(requestTtlMs)||REQUEST_TTL_MS,REQUEST_TTL_MS));
    const requestId=`pa_${crypto.randomBytes(18).toString('base64url')}`,pollToken=crypto.randomBytes(32).toString('base64url');
    const row={requestId,accountId:aid,deviceId:did,connectionId:cid,purpose:kind,agentId:agentId?validId(agentId,'invalid_plus_agent_id'):null,label:String(label||'ChatGPT Plus').slice(0,120),userCode:userCode(),pollHash:digest(pollToken),createdAt:now,expiresAt:Math.min(expiresAt,now+ttl),state:'pending',consumedAt:null,deniedAt:null,pairingRequired:Boolean(forceApproval),pairingId:pairingId?validId(pairingId,'invalid_pairing_id'):null};
    this.requests.set(requestId,row);this._persist();
    this.emit({type:'device_access_requested',accountId:aid,deviceId:did,connectionId:cid,requestId,status:'pending',label:row.label,agentId:row.agentId,pairingRequired:row.pairingRequired});
    return {state:'pending',request:{...row,pollHash:undefined},pollToken,grant:null};
  }
  poll({requestId,pollToken}={}){
    const id=validId(requestId,'invalid_plus_request_id'),row=this.requests.get(id),now=this.now();
    if(!row||!equalDigest(pollToken,row.pollHash))throw new DeviceAccessGrantError('plus_authorization_not_found',404);
    const active=this._activeGrant(row.deviceId,row.connectionId,now,row.agentId,row.accountId,row.purpose||'device');
    if(row.consumedAt){
      if(row.state==='approved'&&active)return {state:'approved',grant:{...active}};
      if(row.state==='denied')throw new DeviceAccessGrantError('plus_authorization_denied',403);
      if(row.state==='expired'||row.expiresAt<=now)throw new DeviceAccessGrantError('plus_authorization_expired',410);
      throw new DeviceAccessGrantError('plus_authorization_not_found',404);
    }
    if(row.pairingRequired){
      if(row.state==='approved'){if(!active)throw new DeviceAccessGrantError('device_access_grant_required',401);row.consumedAt=now;this._persist();return {state:'approved',grant:{...active}};}
      if(row.state==='denied')throw new DeviceAccessGrantError('plus_authorization_denied',403);
      if(row.expiresAt<=now){row.state='expired';row.consumedAt=now;this._persist();throw new DeviceAccessGrantError('plus_authorization_expired',410);}
      return {state:'pending',request:{requestId:row.requestId,deviceId:row.deviceId,connectionId:row.connectionId,label:row.label,userCode:row.userCode,expiresAt:row.expiresAt}};
    }
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
    const prior=this._activeGrant(row.deviceId,cid,now,row.agentId,row.accountId,row.purpose||'device');
    // Replace only THIS Agent's old grant, in the SAME persisted snapshot
    // as the new one. Never close another Agent while refreshing 24h.
    if(prior&&row.pairingRequired){prior.closedAt=now;prior.closeReason='owner_reapproved';}
    const grant=prior&&!row.pairingRequired?prior:{grantId:`dag_${crypto.randomUUID()}`,accountId:row.accountId,agentId:row.agentId,label:row.label,purpose:row.purpose||'device',deviceId:row.deviceId,connectionId:cid,approvedAt:now,lastActivityAt:now,idleGraceMs:row.pairingRequired?AB_GRANT_MAX_LIFETIME_MS:this._grace(idleGraceMs),absoluteExpiresAt:now+AB_GRANT_MAX_LIFETIME_MS,expiresAt:Math.min(expiresAt,now+AB_GRANT_MAX_LIFETIME_MS),closedAt:null,closeReason:null};
    if(prior&&!row.pairingRequired){grant.lastActivityAt=now;if(idleGraceMs!=null)grant.idleGraceMs=this._grace(idleGraceMs);}
    this.grants.set(grant.grantId,grant);
    row.state='approved';
    this._persist();
    if(prior&&row.pairingRequired)this.emit({type:'device_access_closed',accountId:prior.accountId,deviceId:prior.deviceId,connectionId:cid,grantId:prior.grantId,status:'closed',reason:'owner_reapproved'});
    this.emit({type:'device_access_approved',accountId:row.accountId,deviceId:row.deviceId,connectionId:cid,requestId:row.requestId,grantId:grant.grantId,status:'approved'});
    return {...grant};
  }
  /**
   * P2-I2h2: ONLY caller with a Redis-verified, owner-authenticated B receipt
   * may invoke this method. Deterministic grantId binds one V2 request to
   * exactly one durable Agent grant, across PostgreSQL flush/restart/retry.
   * This method does NOT validate B; the trusted bridge must do that first.
   */
  approveVerifiedV2({requestId,ownerAccountId,agentId,deviceId,connectionId,
    connectionExpiresAt,verifiedAt,label='Light Remote Agent'}={}){
    const rid=String(requestId||'');
    if(!/^av2_[a-f0-9]{32}$/.test(rid))
      throw new DeviceAccessGrantError('abv2_verified_request_invalid',400);
    const owner=validId(ownerAccountId,'abv2_owner_invalid'),
      agent=validId(agentId,'abv2_agent_invalid'),
      device=validId(deviceId,'abv2_device_invalid'),
      connection=validId(connectionId,'abv2_connection_invalid');
    const now=this.now(),approvedAt=Number(verifiedAt),connExpiry=Number(connectionExpiresAt);
    if(!Number.isSafeInteger(approvedAt)||approvedAt<=0||approvedAt>now+30000||
       now>=approvedAt+AB_GRANT_MAX_LIFETIME_MS)
      throw new DeviceAccessGrantError('abv2_verified_time_invalid',409);
    if(!Number.isFinite(connExpiry)||connExpiry<=now)
      throw new DeviceAccessGrantError('abv2_connection_expired',409);
    const grantId='dag_v2_'+rid.slice(4),priorRecord=this.grants.get(grantId);
    if(priorRecord){
      if(priorRecord.accountId!==owner||priorRecord.agentId!==agent||
         priorRecord.deviceId!==device||priorRecord.connectionId!==connection||
         priorRecord.approvedAt!==approvedAt||
         priorRecord.absoluteExpiresAt!==approvedAt+AB_GRANT_MAX_LIFETIME_MS)
        throw new DeviceAccessGrantError('abv2_grant_scope_conflict',409);
      const staged=priorRecord.closeReason==='abv2_uncommitted';
      if((priorRecord.closedAt&&!staged)||now>=Number(priorRecord.absoluteExpiresAt))
        throw new DeviceAccessGrantError('abv2_grant_closed_or_expired',409);
      return {...priorRecord,reused:true};
    }
    // P2-I2h2c: STAGE AS INACTIVE. This native PostgreSQL snapshot
    // must not authorize an Agent while its asynchronous write is pending.
    // Persisted closeReason survives a crashed process/reloaded registry.
    // Previous same-Agent grant remains valid until activation succeeds.
    const grant={grantId,accountId:owner,agentId:agent,deviceId:device,
      connectionId:connection,label:String(label||'Light Remote Agent').slice(0,120),
      purpose:'device',approvedAt,lastActivityAt:now,
      idleGraceMs:AB_GRANT_MAX_LIFETIME_MS,
      absoluteExpiresAt:approvedAt+AB_GRANT_MAX_LIFETIME_MS,
      expiresAt:Math.min(connExpiry,approvedAt+AB_GRANT_MAX_LIFETIME_MS),
      closedAt:approvedAt,closeReason:'abv2_uncommitted'};
    this.grants.set(grantId,grant);
    try{this._persist();}
    catch(error){this.grants.delete(grantId);throw error;}
    return {...grant,reused:false};
  }
  activateVerifiedV2(grantId){
    const id=validId(grantId,'abv2_grant_id_invalid'),row=this.grants.get(id);
    if(!row||!/^dag_v2_[a-f0-9]{32}$/.test(id))
      throw new DeviceAccessGrantError('abv2_grant_not_found',404);
    if(row.activationPending)return {...row,reused:true};
    if(!row.closedAt)return {...row,reused:true};
    if(row.closeReason!=='abv2_uncommitted')
      throw new DeviceAccessGrantError('abv2_grant_closed_or_expired',409);
    if(this.now()>=this._expiry(row))
      throw new DeviceAccessGrantError('abv2_grant_expired',409);
    // Reject a delayed old request trying to supersede a newer B approval
    // for the SAME Agent. The Agent's 24h clock must never move backward.
    for(const old of this.grants.values()){
      if(old.grantId!==id&&old.accountId===row.accountId&&
         old.deviceId===row.deviceId&&old.agentId===row.agentId&&
         String(old.purpose||'device')==='device'&&!old.closedAt&&
         Number(old.approvedAt)>=Number(row.approvedAt))
        throw new DeviceAccessGrantError('abv2_grant_superseded',409);
    }
    // Prevent use during second PostgreSQL flush as well. The activation
    // is safe after Redis granted + PG readback of this activation snapshot.
    const changed=[];
    for(const old of this.grants.values()){
      if(old.grantId!==id&&old.accountId===row.accountId&&
         old.deviceId===row.deviceId&&old.agentId===row.agentId&&
         String(old.purpose||'device')==='device'&&!old.closedAt){
        changed.push({row:old,closedAt:old.closedAt,closeReason:old.closeReason});
        old.closedAt=this.now();old.closeReason='owner_reapproved';
      }
    }
    row.closedAt=null;row.closeReason=null;row.activationPending=true;
    try{this._persist();}
    catch(error){
      row.closedAt=row.approvedAt;row.closeReason='abv2_uncommitted';
      row.activationPending=false;
      for(const x of changed){x.row.closedAt=x.closedAt;x.row.closeReason=x.closeReason;}
      throw error;
    }
    return {...row};
  }
  finalizeVerifiedV2(grantId){
    const id=validId(grantId,'abv2_grant_id_invalid'),row=this.grants.get(id);
    if(!row||row.closedAt||!/^dag_v2_[a-f0-9]{32}$/.test(id))
      throw new DeviceAccessGrantError('abv2_activation_required',409);
    if(row.activationPending){
      row.activationPending=false;
      this._persist();
      this.emit({type:'device_access_approved',accountId:row.accountId,
        deviceId:row.deviceId,connectionId:row.connectionId,
        grantId:id,status:'approved'});
    }
    return {...row};
  }
  deny(requestId,reason='owner_denied',{deviceId=null}={}){
    const id=validId(requestId,'invalid_plus_request_id'),row=this.requests.get(id);
    if(!row||row.consumedAt)throw new DeviceAccessGrantError('plus_authorization_not_found',404);
    if(row.state!=='pending')throw new DeviceAccessGrantError(`plus_authorization_${row.state}`,409);
    if(deviceId!=null&&row.deviceId!==String(deviceId))throw new DeviceAccessGrantError('device_access_request_device_mismatch',403);
    const deniedAt=this.now(),denyReason=String(reason||'owner_denied').slice(0,80);
    if(row.pairingRequired){row.state='denied';row.deniedAt=deniedAt;row.denyReason=denyReason;}
    else for(const pending of this.requests.values())if(!pending.pairingRequired&&pending.deviceId===row.deviceId&&pending.connectionId===row.connectionId&&!pending.consumedAt&&pending.state==='pending'){pending.state='denied';pending.deniedAt=deniedAt;pending.denyReason=denyReason;}
    this._persist();
    this.emit({type:'device_access_denied',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,requestId:row.requestId,status:'denied'});
    return {requestId:row.requestId,state:row.state};
  }
  assert(grantId,{deviceId=null,connectionId=null,agentId=null,accountId=null,touch=true}={}){
    const id=validId(grantId,'invalid_access_grant_id'),row=this.grants.get(id),now=this.now();
    if(!row||row.closedAt||row.activationPending)
      throw new DeviceAccessGrantError('device_access_grant_required',401);
    if(now>=this._expiry(row)){this.close(row.grantId,'device_access_grant_expired');throw new DeviceAccessGrantError('device_access_grant_expired',401);}
    if(deviceId!=null&&row.deviceId!==String(deviceId))throw new DeviceAccessGrantError('device_access_grant_device_mismatch',403);
    if(connectionId!=null&&row.connectionId!==String(connectionId))throw new DeviceAccessGrantError('device_access_grant_connection_mismatch',403);
    if(accountId!=null&&row.accountId!==String(accountId))throw new DeviceAccessGrantError('device_access_grant_account_mismatch',403);
    if(agentId!=null&&row.agentId!=null&&row.agentId!==String(agentId))throw new DeviceAccessGrantError('device_access_grant_agent_mismatch',403);
    if(touch!==false){row.lastActivityAt=now;this._persist();}
    return {...row};
  }
  renewConnection(deviceId,{connectionId,connectionExpiresAt}={}){
    const did=validId(deviceId,'invalid_access_device_id'),cid=validId(connectionId,'invalid_access_connection_id'),expiresAt=Number(connectionExpiresAt),now=this.now();
    if(!Number.isFinite(expiresAt)||expiresAt<=now)throw new DeviceAccessGrantError('device_connection_expired',410);
    let count=0;
    for(const row of this.grants.values()){
      if(row.closedAt||row.deviceId!==did||row.connectionId!==cid||now>=this._expiry(row))continue;
      row.expiresAt=Math.min(expiresAt,Number(row.absoluteExpiresAt)||Number(row.approvedAt)+AB_GRANT_MAX_LIFETIME_MS);count++;
      this.emit({type:'device_access_renewed',accountId:row.accountId,deviceId:did,connectionId:cid,grantId:row.grantId,status:'approved',expiresAt});
    }
    if(count)this._persist();
    return count;
  }
  close(grantId,reason='closed'){
    const id=validId(grantId,'invalid_access_grant_id'),row=this.grants.get(id);
    if(!row)throw new DeviceAccessGrantError('device_access_grant_not_found',404);
    if(!row.closedAt){row.closedAt=this.now();row.closeReason=String(reason||'closed').slice(0,80);this._persist();this.emit({type:'device_access_closed',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,grantId:row.grantId,status:'closed',reason:row.closeReason});}
    return {...row};
  }
  revokeTeamMember({accountId,deviceId,reason='team_member_removed'}={}){
    // Revoke only this member's approval for this shared device. Never close
    // the owner's grant or another teammate's independently approved A/B.
    const aid=validId(accountId,'invalid_access_account_id');
    const did=validId(deviceId,'invalid_access_device_id');
    const now=this.now(),why=String(reason||'team_member_removed').slice(0,80);
    let grants=0,requests=0;
    for(const row of this.grants.values()){
      if(row.accountId!==aid||row.deviceId!==did||String(row.purpose||'device')!=='team-member'||row.closedAt)continue;
      row.closedAt=now;row.closeReason=why;grants++;
      this.emit({type:'device_access_closed',accountId:aid,deviceId:did,
        connectionId:row.connectionId,grantId:row.grantId,status:'closed',reason:why});
    }
    for(const row of this.requests.values()){
      if(row.accountId!==aid||row.deviceId!==did||String(row.purpose||'device')!=='team-member'||row.consumedAt||row.state!=='pending')continue;
      row.state='denied';row.deniedAt=now;row.denyReason=why;requests++;
    }
    if(grants||requests)this._persist();
    return {accountId:aid,deviceId:did,grants,requests};
  }
  closeByDevice(deviceId,reason='device_connection_closed'){
    const did=validId(deviceId,'invalid_access_device_id'),closed=[];
    for(const row of this.grants.values())if(row.deviceId===did&&!row.closedAt)closed.push(this.close(row.grantId,reason));
    return closed;
  }
  purgeDevice(deviceId,reason='owner_removed'){
    const did=validId(deviceId,'invalid_access_device_id');let grants=0,requests=0;
    for(const [id,row] of this.grants)if(row.deviceId===did){this.grants.delete(id);grants++;}
    for(const [id,row] of this.requests)if(row.deviceId===did){this.requests.delete(id);requests++;}
    if(grants||requests)this._persist();
    this.emit({type:'device_access_purged',deviceId:did,status:'removed',reason:String(reason||'owner_removed').slice(0,80),grants,requests});
    return {deviceId:did,grants,requests};
  }
  recoverPairing({accountId,agentId}={}){
    const aid=validId(accountId,'invalid_access_account_id'),agent=validId(agentId,'invalid_plus_agent_id'),now=this.now();
    const candidates=[...this.requests.values()]
      .filter(row=>row.pairingRequired&&row.accountId===aid&&row.agentId===agent)
      .sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
    const row=candidates[0];
    if(!row||row.consumedAt||!['pending','approved'].includes(row.state))return null;
    if(row.state==='pending'){
      if(row.expiresAt<=now){row.state='expired';row.consumedAt=now;this._persist();return null;}
      return {state:'pending',request:{requestId:row.requestId,deviceId:row.deviceId,connectionId:row.connectionId,label:row.label,userCode:row.userCode,expiresAt:row.expiresAt},grant:null};
    }
    const active=this._activeGrant(row.deviceId,row.connectionId,now,row.agentId,row.accountId,row.purpose||'device');
    if(!active)return null;
    return {state:'approved',request:{requestId:row.requestId,deviceId:row.deviceId,connectionId:row.connectionId,label:row.label,expiresAt:row.expiresAt},grant:{...active}};
  }
  consumeRecoveredPairing({requestId,accountId,agentId}={}){
    const id=validId(requestId,'invalid_plus_request_id'),aid=validId(accountId,'invalid_access_account_id'),agent=validId(agentId,'invalid_plus_agent_id'),row=this.requests.get(id),now=this.now();
    if(!row||!row.pairingRequired||row.accountId!==aid||row.agentId!==agent)throw new DeviceAccessGrantError('plus_authorization_not_found',404);
    const active=this._activeGrant(row.deviceId,row.connectionId,now,row.agentId,row.accountId,row.purpose||'device');
    if(row.state!=='approved'||!active)throw new DeviceAccessGrantError('device_access_grant_required',401);
    if(!row.consumedAt){row.consumedAt=now;this._persist();}
    return {state:'approved',requestId:row.requestId,grant:{...active}};
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
  activeGrantsForDevice(deviceId,connectionId=null){
    const did=validId(deviceId,'invalid_access_device_id'),now=this.now();
    // Each approved Agent has its OWN 24h deadline. Do not collapse or
    // revoke grants belonging to other Agents when one owner reapproves.
    const rows=[...this.grants.values()].filter(row=>
      row.deviceId===did&&!row.closedAt&&!row.activationPending&&now<this._expiry(row)&&
      (connectionId==null||row.connectionId===String(connectionId)));
    rows.sort((a,b)=>Number(b.approvedAt||0)-Number(a.approvedAt||0)||
      String(b.grantId).localeCompare(String(a.grantId)));
    return rows.map(row=>({...row}));
  }
  activeForDevice(deviceId,connectionId=null){
    // Backward compatibility for older clients: one most-recent A/B grant.
    // Gold Wall now uses activeGrantsForDevice (all independent Agent timers).
    return this.activeGrantsForDevice(deviceId,connectionId)
      .find(row=>String(row.purpose||'device')==='device')||null;
  }
  reap({connectionForDevice=()=>null,liveSessionsForDevice=()=>0}={}){
    const now=this.now(),closed=[];let changed=false;
    for(const row of this.requests.values())if(!row.consumedAt&&row.state==='pending'&&row.expiresAt<=now){row.state='expired';row.consumedAt=now;changed=true;}
    for(const row of this.grants.values()){
      if(row.closedAt)continue;
      const connection=connectionForDevice(row.deviceId);
      let reason=null;
      if(now>=this._expiry(row))reason='device_access_grant_expired';
      else if(!connection||connection.state!=='connected')reason='device_connection_closed';
      else if(connection.connectionId!==row.connectionId)reason='device_connection_changed';
      else if(Number(liveSessionsForDevice(row.deviceId)||0)===0 && now-Number(row.lastActivityAt||row.approvedAt||0)>=Number(row.idleGraceMs||this.defaultIdleGraceMs))reason='device_access_idle_expired';
      if(reason){row.closedAt=now;row.closeReason=reason;closed.push({...row});changed=true;this.emit({type:'device_access_closed',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,grantId:row.grantId,status:'closed',reason});}
    }
    if(changed)this._persist();
    return closed;
  }
}
