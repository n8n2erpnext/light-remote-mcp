/**
 * Source-only UAT: fake device-channel grant ACK + fake owner Wall signature.
 * NO production private keys, no live device, DB authorization or command.
 */
import crypto from 'node:crypto';
import {verifySyntheticWallApprovalOrigin}
 from './synthetic-wall-approval-origin.mjs';
const FIELDS=['kind','requestId','grantId','accountId','deviceId',
  'agentId','connectionId','approvedAt','state'];
const DOMAIN='LR_RC50_FAKE_DEVICE_CHANNEL_APPROVAL_ACK_V1\n';
const ID=/^uat_[A-Za-z0-9_-]{4,90}$/;
const validTime=x=>Number.isSafeInteger(x)&&x>0;
const keyIs=(k,type)=>k?.type===type&&k.asymmetricKeyType==='ed25519';
const exact=(v,fields)=>Boolean(v&&typeof v==='object'&&!Array.isArray(v)
  &&Object.keys(v).sort().join('|')===fields.slice().sort().join('|'));
const encoded=p=>Buffer.from(DOMAIN+JSON.stringify(Object.fromEntries(
  FIELDS.map(k=>[k,p[k]]))),'utf8');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=reason=>Object.freeze({decision:'DENY',reason,
  originVerified:false,productionIssuerAuthorized:false,
  physicalExecutionAuthorized:false});
function validate(p){
 if(!exact(p,FIELDS)||p.kind!=='uat_device_channel_grant_ack'||
   p.state!=='approved'||!validTime(p.approvedAt)||
   !['requestId','grantId','accountId','deviceId','agentId','connectionId']
     .every(k=>ID.test(p[k]||'')))throw Error('invalid_synthetic_channel_ack_shape');
 return p;
}
export function signSyntheticChannelApprovalAck(privateKey,payload){
 if(!keyIs(privateKey,'private'))throw Error('synthetic_channel_private_key_required');
 validate(payload);
 return {payload,signature:crypto.sign(null,encoded(payload),privateKey)
   .toString('base64url')};
}
export function hashSyntheticChannelApprovalPacket(packet){
 if(!exact(packet,['payload','signature']))throw Error('invalid_fake_channel_packet');
 return sha(Buffer.from(JSON.stringify(packet)));
}
export function verifySyntheticChannelAndWallOrigin({
  channelAck,wallApproval,channelPublicKey,wallPublicKey,expected,nowMs=Date.now()
}={}){
 if(!keyIs(channelPublicKey,'public')||!keyIs(wallPublicKey,'public'))
   return deny('TRUST_ANCHOR_MISSING');
 if(!exact(channelAck,['payload','signature'])||
   !/^[A-Za-z0-9_-]{86}$/.test(channelAck?.signature||''))
   return deny('CHANNEL_ENVELOPE_INVALID');
 let p;
 try{p=validate(channelAck.payload);}catch{return deny('CHANNEL_PAYLOAD_INVALID');}
 if(!crypto.verify(null,encoded(p),channelPublicKey,
    Buffer.from(channelAck.signature,'base64url')))
   return deny('CHANNEL_SIGNATURE_INVALID');
 if(!expected||typeof expected!=='object'||!validTime(nowMs)||
   expected.deviceChannelActive!==true)
   return deny('TRUSTED_CHANNEL_CONTEXT_REQUIRED');
 if(['requestId','grantId','accountId','deviceId','agentId','connectionId']
   .some(k=>p[k]!==expected[k]))
   return deny('CHANNEL_BINDING_MISMATCH');
 if(expected.channelPublicSha256!==
   sha(channelPublicKey.export({type:'spki',format:'der'})))
   return deny('CHANNEL_ISSUER_PIN_MISMATCH');
 let digest;
 try{digest=hashSyntheticChannelApprovalPacket(channelAck);}
 catch{return deny('CHANNEL_PACKET_INVALID');}
 const wall=verifySyntheticWallApprovalOrigin(wallApproval,{
   pinnedWallPublicKey:wallPublicKey,
   expected:{...expected,channelAckSha256:digest},
   now:nowMs
 });
 if(wall.decision!=='VERIFIED_SYNTHETIC_ORIGIN')
   return deny('WALL_ORIGIN_'+wall.reason);
 if(wallApproval.payload.approvedAt < p.approvedAt||
    wallApproval.payload.approvedAt-p.approvedAt>30000)
   return deny('CHANNEL_WALL_APPROVAL_ORDER_INVALID');
 return Object.freeze({decision:'VERIFIED_FAKE_OWNER_AND_CHANNEL',
   ownerProofDigest:wall.provenanceSha256,
   deviceChannelProofDigest:digest,
   deviceId:p.deviceId,grantId:p.grantId,requestId:p.requestId,
   originVerified:true,physicalExecutionAuthorized:false,
   productionIssuerAuthorized:false});
}
