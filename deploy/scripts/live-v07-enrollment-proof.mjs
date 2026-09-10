import fs from 'node:fs';
import crypto from 'node:crypto';
import { deviceHeartbeatMessage } from '../../lib/device-proof.mjs';

const base=String(process.env.BRIDGE_PROOF_BASE||'https://light-remote-mcp.vercel.app').replace(/\/$/,'');
const cfg=JSON.parse(fs.readFileSync(process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json','utf8'));
const password=fs.readFileSync(process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password','utf8').trim();
async function request(path,options={}){ const response=await fetch(base+path,options); const text=await response.text(); let json; try{json=JSON.parse(text);}catch{json={raw:text};} return {status:response.status,json}; }
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
let ownerToken='',deviceId='',enrollmentId='';
try {
  const begin=await request('/api/operator',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'enrollment-begin',payload:{publicIdentityKey,displayName:'v0.7 live proof',platform:'linux',architecture:process.arch,agentVersion:'0.7.0-dev',fingerprintSummary:'ephemeral live acceptance device',capabilities:['git','filesystem'],policyProfile:'default'}})});
  if(begin.status!==200||!begin.json?.upstream?.enrollment?.deviceCode||!begin.json?.upstream?.enrollment?.pollToken) throw new Error(`begin_failed:${begin.status}:${begin.json?.error}`);
  const enrollment=begin.json.upstream.enrollment; enrollmentId=enrollment.enrollmentId;
  if(enrollment.activationUrl.includes(enrollment.deviceCode.replace('-',''))) throw new Error('device_code_leaked_in_activation_url');
  const login=await request('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:cfg.username,password})});
  if(login.status!==200||!login.json?.session?.token) throw new Error(`owner_auth_failed:${login.status}`);
  ownerToken=login.json.session.token;
  const ownerHeaders={'content-type':'application/json','x-bridge-session':ownerToken};
  const approve=await request('/api/operator',{method:'POST',headers:ownerHeaders,body:JSON.stringify({action:'enrollment-approve',payload:{code:enrollment.deviceCode,displayName:'v0.7 live proof',approvedCapabilities:['git'],policyProfile:'default'}})});
  if(approve.status!==200||!approve.json?.upstream?.approval?.deviceId) throw new Error(`approve_failed:${approve.status}:${approve.json?.error}`);
  deviceId=approve.json.upstream.approval.deviceId;
  const before=await request(`/api/operator?action=device&id=${encodeURIComponent(deviceId)}`,{headers:{'x-bridge-session':ownerToken}});
  if(before.status!==200||before.json?.upstream?.device?.state!=='offline') throw new Error(`approved_device_not_offline:${before.status}`);
  const poll=await request('/api/operator',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'enrollment-poll',payload:{enrollmentId:enrollment.enrollmentId,pollToken:enrollment.pollToken}})});
  if(poll.status!==200||poll.json?.upstream?.enrollment?.state!=='approved'||poll.json?.upstream?.enrollment?.deviceId!==deviceId) throw new Error(`poll_failed:${poll.status}`);
  const enrolled=poll.json.upstream.enrollment; const cert=enrolled.certificate, signer=enrolled.signer;
  const certOk=crypto.verify(null,Buffer.from(JSON.stringify(cert)),crypto.createPublicKey({key:Buffer.from(signer.publicKey,'base64'),format:'der',type:'spki'}),Buffer.from(enrolled.certificateSignature,'base64url'));
  if(!certOk) throw new Error('certificate_signature_invalid');
  const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url'),capabilities=['git'];
  const signature=crypto.sign(null,Buffer.from(deviceHeartbeatMessage({deviceId,timestamp,nonce,capabilities})),privateKey).toString('base64url');
  const beat=await request('/api/operator',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'device-heartbeat',payload:{deviceId,timestamp,nonce,capabilities,signature}})});
  if(beat.status!==200||beat.json?.upstream?.device?.state!=='online') throw new Error(`heartbeat_failed:${beat.status}:${beat.json?.error}`);
  const visible=await request(`/api/operator?action=device&id=${encodeURIComponent(deviceId)}`,{headers:{'x-bridge-session':ownerToken}});
  if(visible.status!==200||visible.json?.upstream?.device?.state!=='online') throw new Error(`device_visibility_failed:${visible.status}`);
  const revoke=await request('/api/operator',{method:'POST',headers:ownerHeaders,body:JSON.stringify({action:'device-revoke',payload:{deviceId,reason:'v0.7 live acceptance cleanup'}})});
  if(revoke.status!==200||!revoke.json?.upstream?.binding?.revokedAt) throw new Error(`revoke_failed:${revoke.status}`);
  const replayAfterRevoke=await request('/api/operator',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'device-heartbeat',payload:{deviceId,timestamp:Date.now(),nonce:crypto.randomBytes(18).toString('base64url'),capabilities,signature}})});
  if(replayAfterRevoke.status!==403||replayAfterRevoke.json?.upstream?.error!=='device_revoked') throw new Error(`revoked_heartbeat_not_blocked:${replayAfterRevoke.status}`);
  console.log(JSON.stringify({begin:begin.status,activationCodeInUrl:false,approve:approve.status,approvedState:before.json.upstream.device.state,poll:enrolled.state,certificateSignature:'valid',heartbeat:beat.json.upstream.device.state,capabilities:beat.json.upstream.device.capabilities,revoke:'ok',revokedHeartbeat:replayAfterRevoke.status},null,2));
  console.log('LIVE_V07_ENROLLMENT_PROOF=PASS');
} finally {
  if(ownerToken){ try{ if(deviceId) await request('/api/operator',{method:'POST',headers:{'content-type':'application/json','x-bridge-session':ownerToken},body:JSON.stringify({action:'device-revoke',payload:{deviceId,reason:'v0.7 live proof final cleanup'}})}); else if(enrollmentId) await request('/api/operator',{method:'POST',headers:{'content-type':'application/json','x-bridge-session':ownerToken},body:JSON.stringify({action:'enrollment-cancel',payload:{enrollmentId}})}); }catch{} }
}
