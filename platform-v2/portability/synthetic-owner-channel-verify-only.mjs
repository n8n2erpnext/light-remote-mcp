/**
 * rc50 UAT-only PUBLIC-KEY-ONLY verifier subprocess for fake owner and
 * device-channel Ed25519 approval. Does not generate signing keys.
 * TRUSTED context must come from fresh private PG JOINs, never untrusted JSON
 * in production. No DB credentials, no physical action, no real B code.
 */
import crypto from 'node:crypto';
import {
 verifySyntheticChannelAndWallOrigin
} from './synthetic-channel-approval-attestation.mjs';
import {syntheticWallOriginFingerprint}
 from './synthetic-wall-approval-origin.mjs';
const HASH=/^[a-f0-9]{64}$/;
const ID=/^uat_[A-Za-z0-9_-]{4,90}$/;
const deny=reason=>Object.freeze({decision:'DENY',reason,
 productionIssuerAuthorized:false,physicalExecutionAuthorized:false});
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const validMs=x=>Number.isSafeInteger(x)&&x>0;
function pub(spki){
 if(typeof spki!=='string'||!spki.startsWith('MCowBQYDK2VwAyEA')||
    spki.length>128)throw Error('PUBLIC_SPKI_INVALID');
 const k=crypto.createPublicKey({key:Buffer.from(spki,'base64url'),
   format:'der',type:'spki'});
 if(k.asymmetricKeyType!=='ed25519'||
    k.export({type:'spki',format:'der'}).toString('base64url')!==spki)
   throw Error('PUBLIC_SPKI_INVALID');
 return k;
}
export function verifySyntheticOwnerChannelEnvelope(envelope,trusted,now=Date.now()){
 if(!envelope||!trusted||typeof trusted!=='object'||
  !validMs(now)||
  !['requestId','grantId','accountId','deviceId','agentId',
    'connectionId','ownerSessionId'].every(k=>ID.test(trusted[k]||''))||
  !['deviceKeySha256','wallVerifierSha256','channelVerifierSha256']
     .every(k=>HASH.test(trusted[k]||''))||
  !validMs(trusted.requestCreatedAtMs)||!validMs(trusted.requestExpiresAtMs))
    return deny('TRUSTED_STATE_INVALID');
 // A signed owner approval is a PRE-COMMIT decision event; DB row is pending.
 if(trusted.requestState!=='pending'||trusted.ownerSessionActive!==true||
    trusted.enrollmentActive!==true||trusted.connectionActive!==true||
    trusted.pinsActive!==true||trusted.nonceUnused!==true)
   return deny('OWNER_OR_DEVICE_NOT_CURRENT');
 let wallKey,channelKey;
 try{wallKey=pub(envelope.wallPublicSpki);channelKey=pub(envelope.channelPublicSpki);}
 catch{return deny('UNTRUSTED_PUBLIC_KEY');}
 if(syntheticWallOriginFingerprint(wallKey)!==trusted.wallVerifierSha256||
   sha(channelKey.export({type:'spki',format:'der'}))!==trusted.channelVerifierSha256)
    return deny('PUBLIC_KEY_PIN_MISMATCH');
 if(envelope.wallApproval?.payload?.requestCreatedAt!==trusted.requestCreatedAtMs||
    envelope.wallApproval?.payload?.requestExpiresAt!==trusted.requestExpiresAtMs||
    envelope.wallApproval?.payload?.ownerSessionSha256!==sha(trusted.ownerSessionId))
    return deny('OWNER_SESSION_OR_REQUEST_WINDOW_MISMATCH');
 const packet=envelope.wallApproval?.payload;
 if(!HASH.test(packet?.wallDecisionNonceSha256||''))
    return deny('APPROVAL_NONCE_INVALID');
 const expected={
   requestId:trusted.requestId,grantId:trusted.grantId,
   ownerAccountId:trusted.accountId,accountId:trusted.accountId,
   deviceId:trusted.deviceId,agentId:trusted.agentId,
   connectionId:trusted.connectionId,deviceKeySha256:trusted.deviceKeySha256,
   ownerSessionSha256:sha(trusted.ownerSessionId),
   channelPublicSha256:trusted.channelVerifierSha256,
   purpose:'device',
   approvedRequestState:'approved',ownerSessionActive:true,
   deviceEnrollmentActive:true,connectionActive:true,
   originNonceUnused:true,deviceChannelActive:true
 };
 const result=verifySyntheticChannelAndWallOrigin({
  wallApproval:envelope.wallApproval,channelAck:envelope.channelAck,
  wallPublicKey:wallKey,channelPublicKey:channelKey,expected,nowMs:now
 });
 if(result.decision!=='VERIFIED_FAKE_OWNER_AND_CHANNEL')
  return deny('SIGNED_APPROVAL_'+result.reason);
 return Object.freeze({
  decision:'VERIFIED_FAKE_OWNER_CHANNEL_PRECOMMIT',
  requestId:trusted.requestId,grantId:trusted.grantId,
  ownerSessionId:trusted.ownerSessionId,ownerAccountId:trusted.accountId,
  deviceId:trusted.deviceId,connectionId:trusted.connectionId,
  agentId:trusted.agentId,enrolledKeySha256:trusted.deviceKeySha256,
  wallVerifierSha256:trusted.wallVerifierSha256,
  channelVerifierSha256:trusted.channelVerifierSha256,
  nonceSha256:packet.wallDecisionNonceSha256,
  wallProofSha256:result.ownerProofDigest,
  channelAckSha256:result.deviceChannelProofDigest,
  requestCreatedAt:new Date(trusted.requestCreatedAtMs).toISOString(),
  requestExpiresAt:new Date(trusted.requestExpiresAtMs).toISOString(),
  approvedAt:new Date(packet.approvedAt).toISOString(),
  channelApprovedAt:new Date(envelope.channelAck.payload.approvedAt).toISOString(),
  physicalExecutionAuthorized:false,productionIssuerAuthorized:false
 });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 if(process.argv.slice(2).join(' ')!=='--synthetic-only'||
    process.env.LR_RC50_UAT_ONLY!=='1'){
   process.stderr.write('fake_owner_verifier_requires_isolated_uat\n');
   process.exit(3);
 }
 try{
  let text='';
  for await(const buf of process.stdin){
   text+=buf.toString('utf8');
   if(text.length>24000)throw Error('too_large');
  }
  const arg=JSON.parse(text);
  process.stdout.write(JSON.stringify(
    verifySyntheticOwnerChannelEnvelope(arg.envelope,arg.trusted))+'\n');
 }catch{process.stderr.write('fake_owner_verifier_refused\n');process.exitCode=4;}
}
