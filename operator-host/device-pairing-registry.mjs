import crypto from 'node:crypto';

export const DEFAULT_PAIRING_CODE_TTL_MS = 3 * 60 * 1000;
const MIN_PAIRING_CODE_TTL_MS = 30 * 1000;
const MAX_PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class DevicePairingRegistryError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}

function validId(value,name){
  const text=String(value||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,160}$/.test(text))throw new DevicePairingRegistryError(name);
  return text;
}
function normalizeCode(value){
  const raw=String(value||'').trim().toUpperCase().replace(/-/g,'');
  if(!/^[A-Z2-9]{8}$/.test(raw))throw new DevicePairingRegistryError('invalid_pairing_code');
  return `${raw.slice(0,4)}-${raw.slice(4)}`;
}
function hashCode(value){return crypto.createHash('sha256').update(normalizeCode(value)).digest('hex');}
function makeCode(){
  const bytes=crypto.randomBytes(8);let out='';
  for(let i=0;i<8;i++)out+=CODE_ALPHABET[bytes[i]%CODE_ALPHABET.length];
  return `${out.slice(0,4)}-${out.slice(4)}`;
}

export class DevicePairingRegistry {
  constructor({emit=()=>{},now=()=>Date.now(),ttlMs=DEFAULT_PAIRING_CODE_TTL_MS}={}){
    this.emit=emit;this.now=now;this.ttlMs=Number(ttlMs);this.rows=new Map();this.currentByDevice=new Map();
    if(!Number.isFinite(this.ttlMs)||this.ttlMs<MIN_PAIRING_CODE_TTL_MS||this.ttlMs>MAX_PAIRING_CODE_TTL_MS)throw new DevicePairingRegistryError('invalid_pairing_code_ttl');
  }
  _invalidate(row,reason){
    if(!row||row.invalidatedAt||row.consumedAt)return;
    row.invalidatedAt=this.now();row.invalidateReason=String(reason||'invalidated').slice(0,80);
    if(this.currentByDevice.get(row.deviceId)===row.codeHash)this.currentByDevice.delete(row.deviceId);
    this.emit({type:'device_pairing_a_invalidated',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,pairingId:row.pairingId,status:'invalidated',reason:row.invalidateReason});
  }
  reap(){
    const now=this.now();let count=0;
    for(const row of this.rows.values())if(!row.consumedAt&&!row.invalidatedAt&&row.expiresAt<=now){this._invalidate(row,'expired');count++;}
    for(const [hash,row] of this.rows)if((row.consumedAt||row.invalidatedAt)&&now-Math.max(row.consumedAt||0,row.invalidatedAt||0)>10*60*1000)this.rows.delete(hash);
    return count;
  }
  rotate({accountId,deviceId,connectionId,connectionExpiresAt}={}){
    this.reap();const aid=validId(accountId,'invalid_pairing_account_id'),did=validId(deviceId,'invalid_pairing_device_id'),cid=validId(connectionId,'invalid_pairing_connection_id');
    const now=this.now(),hardExpiresAt=Number(connectionExpiresAt);
    if(!Number.isFinite(hardExpiresAt)||hardExpiresAt<=now)throw new DevicePairingRegistryError('device_connection_expired',410);
    const priorHash=this.currentByDevice.get(did);if(priorHash)this._invalidate(this.rows.get(priorHash),'rotated');
    let code,codeHash;do{code=makeCode();codeHash=hashCode(code);}while(this.rows.has(codeHash));
    const row={pairingId:`dpa_${crypto.randomBytes(18).toString('base64url')}`,accountId:aid,deviceId:did,connectionId:cid,codeHash,createdAt:now,expiresAt:Math.min(hardExpiresAt,now+this.ttlMs),consumedAt:null,invalidatedAt:null,invalidateReason:null};
    this.rows.set(codeHash,row);this.currentByDevice.set(did,codeHash);
    this.emit({type:'device_pairing_a_rotated',accountId:aid,deviceId:did,connectionId:cid,pairingId:row.pairingId,status:'ready',expiresAt:row.expiresAt});
    return {pairingId:row.pairingId,code,expiresAt:row.expiresAt,ttlMs:Math.max(0,row.expiresAt-now)};
  }
  redeem(code,{connectionForDevice=()=>null}={}){
    this.reap();const normalized=normalizeCode(code),hash=hashCode(normalized),row=this.rows.get(hash),now=this.now();
    if(!row||row.consumedAt||row.invalidatedAt)throw new DevicePairingRegistryError('pairing_code_not_found',404);
    if(row.expiresAt<=now){this._invalidate(row,'expired');throw new DevicePairingRegistryError('pairing_code_expired',410);}
    if(this.currentByDevice.get(row.deviceId)!==hash){this._invalidate(row,'rotated');throw new DevicePairingRegistryError('pairing_code_not_found',404);}
    const connection=connectionForDevice(row.deviceId);
    if(!connection||connection.state!=='connected'){this._invalidate(row,'device_connection_closed');throw new DevicePairingRegistryError('device_connection_required',409);}
    if(connection.connectionId!==row.connectionId){this._invalidate(row,'device_connection_changed');throw new DevicePairingRegistryError('device_connection_changed',409);}
    row.consumedAt=now;this.currentByDevice.delete(row.deviceId);
    this.emit({type:'device_pairing_a_redeemed',accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,pairingId:row.pairingId,status:'consumed'});
    return {pairingId:row.pairingId,accountId:row.accountId,deviceId:row.deviceId,connectionId:row.connectionId,createdAt:row.createdAt,expiresAt:row.expiresAt,consumedAt:row.consumedAt};
  }
  invalidateDevice(deviceId,reason='device_connection_closed'){
    const did=validId(deviceId,'invalid_pairing_device_id'),hash=this.currentByDevice.get(did),row=hash?this.rows.get(hash):null;
    if(row)this._invalidate(row,reason);
    return row?{pairingId:row.pairingId,deviceId:row.deviceId,reason:row.invalidateReason}:null;
  }
}
