/*
 * Volatile Gold Memory rendezvous. This is public identity and signed
 * invitation metadata ONLY, never a checkpoint or an E2EE sync frame.
 * Every caller is authenticated independently by the signed device channel.
 * Process restart discards all entries; clients can re-advertise/re-offer.
 */
import crypto from 'node:crypto';

const PEER_TTL=10*60*1000,INVITE_TTL=20*60*1000;
const peers=new Map(),mailbox=new Map();
const idPattern=/^[A-Za-z0-9._:-]{1,160}$/;
const scopePattern=/^[a-f0-9-]{36}$/i;
const fault=(message,status=400)=>Object.assign(new Error(message),{status});
function identityKey(accountId,deviceId){return accountId+'\n'+deviceId;}
function key(base64,type){
  if(typeof base64!=='string'||base64.length>1800)throw fault('memory_peer_key_invalid');
  try{
    const parsed=crypto.createPublicKey({key:Buffer.from(base64,'base64'),format:'der',type:'spki'});
    if(parsed.asymmetricKeyType===type&&parsed.export({format:'der',type:'spki'}).toString('base64')===base64)return parsed;
  }catch{}
  throw fault('memory_peer_key_invalid');
}
function checkedIdentity(value,accountId,deviceId){
  if(!value||value.accountId!==accountId||value.deviceId!==deviceId)throw fault('memory_peer_identity_mismatch',403);
  key(value.signPublicKey,'ed25519');key(value.encPublicKey,'x25519');
  const fingerprint=crypto.createHash('sha256').update(value.signPublicKey+'\n'+value.encPublicKey).digest('hex').slice(0,32);
  if(value.fingerprint!==fingerprint)throw fault('memory_peer_fingerprint_invalid',403);
  return {accountId,deviceId,signPublicKey:value.signPublicKey,
    encPublicKey:value.encPublicKey,fingerprint};
}
function sweep(now=Date.now()){
  for(const [id,v] of peers)if(v.expiresAt<=now)peers.delete(id);
  for(const [id,v] of mailbox)if(v.expiresAt<=now)mailbox.delete(id);
}
function owned(devices,accountId,deviceId){
  return devices.some(d=>d.accountId===accountId&&d.deviceId===deviceId&&d.state!=='revoked');
}
export function memoryDirectory({accountId,deviceId,devices,identity=null,now=Date.now()}){
  sweep(now);
  if(!owned(devices,accountId,deviceId))throw fault('memory_peer_device_not_enrolled',403);
  if(identity!=null){
    const attested=checkedIdentity(identity,accountId,deviceId),id=identityKey(accountId,deviceId);
    const before=peers.get(id);
    // Enrollment proof authenticates THIS account device; re-advertised Memory
    // keys may change after local reinstall. Existing scope grants do not
    // auto-rotate: Home must explicitly select this device for synchronization.
    peers.set(id,{...attested,expiresAt:now+PEER_TTL});
  }
  return devices.filter(d=>d.accountId===accountId&&d.state!=='revoked').slice(0,100).map(d=>{
    const found=peers.get(identityKey(accountId,d.deviceId));
    return {deviceId:d.deviceId,displayName:d.displayName,state:d.state,
      platform:d.platform,architecture:d.architecture,agentVersion:d.agentVersion,
      memoryIdentity:found?{deviceId:found.deviceId,accountId:found.accountId,
        signPublicKey:found.signPublicKey,encPublicKey:found.encPublicKey,
        fingerprint:found.fingerprint}:null};
  });
}
export function memoryInvites({accountId,deviceId,devices,payload={},now=Date.now()}){
  sweep(now);
  if(!owned(devices,accountId,deviceId))throw fault('memory_invite_device_not_enrolled',403);
  if(payload.action==='list'){
    return [...mailbox.values()].filter(x=>x.accountId===accountId&&x.toDeviceId===deviceId)
      .slice(0,24).map(x=>({inviteId:x.inviteId,homeDeviceId:x.homeDeviceId,
        scopeId:x.scopeId,createdAt:x.createdAt,package:x.package}));
  }
  if(payload.action==='ack'){
    const x=mailbox.get(String(payload.inviteId||''));
    if(!x||x.accountId!==accountId||x.toDeviceId!==deviceId)
      throw fault('memory_invite_not_found',404);
    mailbox.delete(x.inviteId);
    return {acknowledged:true,inviteId:x.inviteId};
  }
  if(payload.action!=='offer')throw fault('memory_invite_action_invalid');
  const pkg=payload.package,inv=pkg?.invite;
  if(!inv||inv.accountId!==accountId||inv.homeDeviceId!==deviceId||
    !idPattern.test(inv.toDeviceId)||!scopePattern.test(inv.scopeId)||
    !owned(devices,accountId,inv.toDeviceId)||inv.toDeviceId===deviceId)
    throw fault('memory_invite_target_invalid',403);
  if(JSON.stringify(pkg).length>8000||typeof pkg.signature!=='string')
    throw fault('memory_invite_size_invalid');
  const home=peers.get(identityKey(accountId,deviceId)),
    replica=peers.get(identityKey(accountId,inv.toDeviceId));
  if(!home||!replica||home.signPublicKey!==inv.homeSignPublicKey||
    home.encPublicKey!==inv.homeEncPublicKey||
    replica.signPublicKey!==inv.peerSignPublicKey||
    replica.encPublicKey!==inv.peerEncPublicKey)
    throw fault('memory_invite_peer_identity_unavailable',409);
  if(!crypto.verify(null,Buffer.from(JSON.stringify(inv)),key(home.signPublicKey,'ed25519'),
    Buffer.from(pkg.signature,'base64')))
    throw fault('memory_invite_signature_invalid',403);
  if(!Number.isSafeInteger(inv.createdAt)||Math.abs(now-inv.createdAt)>INVITE_TTL)
    throw fault('memory_invite_expired',409);
  const inviteId=crypto.createHash('sha256').update(JSON.stringify(pkg)).digest('hex').slice(0,40);
  mailbox.set(inviteId,{accountId,toDeviceId:inv.toDeviceId,homeDeviceId:deviceId,
    scopeId:inv.scopeId,inviteId,package:pkg,createdAt:now,expiresAt:now+INVITE_TTL});
  if(mailbox.size>2000){
    const oldest=[...mailbox].sort((a,b)=>a[1].createdAt-b[1].createdAt);
    for(const [id] of oldest.slice(0,mailbox.size-1500))mailbox.delete(id);
  }
  return {offered:true,inviteId,toDeviceId:inv.toDeviceId,expiresAt:now+INVITE_TTL};
}

/*
 * Bounded in-RAM E2EE fallback transport. Not persisted to PG/Redis/logs.
 * Signed device-channel authenticates the sender; signed E2EE/ACK records
 * are independently verified by the receiving device before DB changes.
 */
const RELAY_TTL=120000,relay=new Map();
export function memoryRelay({accountId,deviceId,devices,payload={},now=Date.now()}){
  if(!owned(devices,accountId,deviceId))throw fault('memory_relay_device_not_enrolled',403);
  for(const [k,v] of relay)if(v.expiresAt<=now)relay.delete(k);
  const action=payload.action;
  if(action==='pull_frames'||action==='pull_acks'){
    const kind=action==='pull_frames'?'frame':'ack';
    const items=[...relay.values()].filter(x=>x.accountId===accountId&&
      x.recipient===deviceId&&x.kind===kind).sort((a,b)=>a.createdAt-b.createdAt)
      .slice(0,6).map(x=>x.value);
    return {items,transport:'volatile_e2ee_relay'};
  }
  if(!['push_frame','push_ack'].includes(action))
    throw fault('memory_relay_action_invalid',400);
  const kind=action==='push_frame'?'frame':'ack',value=payload[kind];
  const serialized=JSON.stringify(value||null);
  if(serialized.length>(kind==='frame'?48000:3000))
    throw fault('memory_relay_payload_oversized',413);
  const meta=kind==='frame'?value?.meta:value;
  if(!meta||meta.accountId!==accountId||!scopePattern.test(String(meta.scopeId||''))||
    !Number.isSafeInteger(meta.homeEpoch)||meta.homeEpoch<1||
    !Number.isSafeInteger(meta.revision)||meta.revision<1||
    typeof value.signature!=='string'||value.signature.length>400)
    throw fault('memory_relay_envelope_invalid',403);
  const source=kind==='frame'?meta.homeDeviceId:meta.deviceId,
    recipient=kind==='frame'?meta.toDeviceId:meta.homeDeviceId;
  if(source!==deviceId||!idPattern.test(recipient)||recipient===deviceId||
    !owned(devices,accountId,recipient))
    throw fault('memory_relay_target_invalid',403);
  if(kind==='frame'&&(typeof value.ciphertext!=='string'||!value.ciphertext.length))
    throw fault('memory_relay_ciphertext_required',403);
  const id=[accountId,kind,recipient,source,meta.scopeId,meta.homeEpoch,
    meta.revision].join('\\n');
  relay.set(id,{accountId,recipient,kind,value,createdAt:now,expiresAt:now+RELAY_TTL});
  if(relay.size>300){
    const oldest=[...relay].sort((a,b)=>a[1].createdAt-b[1].createdAt);
    for(const [k] of oldest.slice(0,relay.size-250))relay.delete(k);
  }
  return {queued:true,transport:'volatile_e2ee_relay',expiresAt:now+RELAY_TTL};
}
