import crypto from 'node:crypto';

export class FleetAuthorityError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}

const ID_RE=/^[A-Za-z0-9._:-]{1,160}$/;
function sha256(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex');}
function bounded(value,max=160){return String(value||'').trim().slice(0,max);}

export class FleetAuthorityRegistry {
  constructor({ttlMs=10*60*1000,now=()=>Date.now(),emit=()=>{}}={}){
    this.ttlMs=Math.max(60_000,Math.min(Number(ttlMs)||10*60*1000,15*60*1000));
    this.now=now;this.emit=emit;this.rows=new Map();this.byDevice=new Map();
  }
  _view(row){return {leaseId:row.leaseId,accountId:row.accountId,mainDeviceId:row.mainDeviceId,deviceId:row.deviceId,publicKeySha256:row.publicKeySha256,entitlementId:row.entitlementId||null,moduleVersion:row.moduleVersion||null,issuedAt:row.issuedAt,expiresAt:row.expiresAt};}
  reap(){const now=this.now(),closed=[];for(const [hash,row] of this.rows){if(row.expiresAt<=now){this.rows.delete(hash);if(this.byDevice.get(row.deviceId)===hash)this.byDevice.delete(row.deviceId);closed.push(this._view(row));this.emit({type:'fleet_authority_expired',accountId:row.accountId,deviceId:row.deviceId,leaseId:row.leaseId,status:'expired'});}}return closed;}
  issue(input={}){
    this.reap();
    const accountId=bounded(input.accountId),mainDeviceId=bounded(input.mainDeviceId),deviceId=bounded(input.deviceId),publicKeySha256=bounded(input.publicKeySha256,128);
    if(!ID_RE.test(accountId)||!ID_RE.test(mainDeviceId)||!ID_RE.test(deviceId)||!/^[a-f0-9]{64}$/i.test(publicKeySha256))throw new FleetAuthorityError('invalid_fleet_authority_binding');
    if(mainDeviceId!==deviceId)throw new FleetAuthorityError('fleet_main_device_mismatch',403);
    const priorHash=this.byDevice.get(deviceId),prior=priorHash?this.rows.get(priorHash):null;
    if(prior){this.rows.delete(priorHash);this.byDevice.delete(deviceId);this.emit({type:'fleet_authority_rotated',accountId:prior.accountId,deviceId,leaseId:prior.leaseId,status:'replaced'});}
    const now=this.now(),leaseId=`fl_${crypto.randomUUID()}`,token=crypto.randomBytes(32).toString('base64url'),tokenHash=sha256(token);
    const row={leaseId,tokenHash,accountId,mainDeviceId,deviceId,publicKeySha256,entitlementId:input.entitlementId?bounded(input.entitlementId):null,moduleVersion:input.moduleVersion?bounded(input.moduleVersion,80):null,issuedAt:now,expiresAt:now+this.ttlMs};
    this.rows.set(tokenHash,row);this.byDevice.set(deviceId,tokenHash);
    this.emit({type:'fleet_authority_issued',accountId,deviceId,leaseId,status:'active',expiresAt:row.expiresAt});
    return {token,lease:this._view(row)};
  }
  verify(token,input={}){
    this.reap();const hash=sha256(token),row=this.rows.get(hash);if(!row)throw new FleetAuthorityError('fleet_authority_required',401);
    const accountId=bounded(input.accountId),deviceId=bounded(input.deviceId),publicKeySha256=bounded(input.publicKeySha256,128);
    if(row.accountId!==accountId||row.deviceId!==deviceId||row.mainDeviceId!==deviceId||row.publicKeySha256!==publicKeySha256)throw new FleetAuthorityError('fleet_authority_binding_mismatch',403);
    return this._view(row);
  }
  invalidateDevice(deviceId,reason='fleet_device_invalidated'){
    const did=bounded(deviceId),hash=this.byDevice.get(did),row=hash?this.rows.get(hash):null;if(!row)return null;
    this.rows.delete(hash);this.byDevice.delete(did);this.emit({type:'fleet_authority_revoked',accountId:row.accountId,deviceId:row.deviceId,leaseId:row.leaseId,status:'revoked',reason:bounded(reason,80)});return this._view(row);
  }
  invalidateAccount(accountId,reason='fleet_account_invalidated'){
    const aid=bounded(accountId),closed=[];for(const row of [...this.rows.values()])if(row.accountId===aid){const value=this.invalidateDevice(row.deviceId,reason);if(value)closed.push(value);}return closed;
  }
  activeForDevice(deviceId){this.reap();const hash=this.byDevice.get(bounded(deviceId)),row=hash?this.rows.get(hash):null;return row?this._view(row):null;}
}
