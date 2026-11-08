/**
 * Explicit synthetic-only bridge between fake signed Wall/channel packets
 * and disposable PostgreSQL origin UAT; no customer sessions or real B codes.
 * Performs Ed25519 validation in Node; SQL only sees trusted-looking fixture
 * digests and MUST NEVER be accessible without an authenticated verifier.
 */
import crypto from 'node:crypto';
import {signSyntheticWallApprovalOrigin,syntheticWallOriginFingerprint}
 from './synthetic-wall-approval-origin.mjs';
import {signSyntheticChannelApprovalAck,
 hashSyntheticChannelApprovalPacket,verifySyntheticChannelAndWallOrigin}
 from './synthetic-channel-approval-attestation.mjs';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const ids=['requestId','grantId','accountId','deviceId','agentId',
  'connectionId','ownerSessionId'];
export function makeSyntheticOwnerChannelDbProof(input,at=Date.now(),testKeys=null,includePackets=false){
 if(!input||ids.some(k=>typeof input[k]!=='string'||
     !/^uat_[A-Za-z0-9_-]{4,90}$/.test(input[k]))||
     !/^[a-f0-9]{64}$/.test(input.deviceKeySha256||'')||
     !Number.isSafeInteger(input.requestCreatedAtMs)||
     !Number.isSafeInteger(input.requestExpiresAtMs)||
     input.requestCreatedAtMs>at-2000||
     input.requestExpiresAtMs<=at||
     input.requestExpiresAtMs-input.requestCreatedAtMs>600000||
     !Number.isSafeInteger(at))throw Error('invalid_synthetic_owner_db_input');
 const wall=testKeys?.wall||crypto.generateKeyPairSync('ed25519');
 const channel=testKeys?.channel||crypto.generateKeyPairSync('ed25519');
 const wallApproved=at-2000;
 const channelApproved=wallApproved-50;
 const channelPacket=signSyntheticChannelApprovalAck(channel.privateKey,{
  kind:'uat_device_channel_grant_ack',
  ...Object.fromEntries(ids.filter(x=>x!=='ownerSessionId')
    .map(k=>[k,input[k]])),
  approvedAt:channelApproved,state:'approved'
 });
 const channelDigest=hashSyntheticChannelApprovalPacket(channelPacket);
 const nonceSha256=sha(crypto.randomBytes(32));
 const ownerSessionSha256=sha(input.ownerSessionId);
 const wallApproval=signSyntheticWallApprovalOrigin(wall.privateKey,{
  kind:'uat_wall_approval_origin',
  requestId:input.requestId,grantId:input.grantId,
  ownerAccountId:input.accountId,accountId:input.accountId,
  deviceId:input.deviceId,connectionId:input.connectionId,
  agentId:input.agentId,deviceKeySha256:input.deviceKeySha256,
  ownerSessionSha256,wallDecisionNonceSha256:nonceSha256,
  channelAckSha256:channelDigest,
  requestCreatedAt:input.requestCreatedAtMs,
  requestExpiresAt:input.requestExpiresAtMs,
  approvedAt:wallApproved,grantExpiresAt:at+40000,
  absoluteExpiresAt:wallApproved+86400000,
  action:'approve',purpose:'device'
 });
 const channelKeySha256=sha(channel.publicKey.export({type:'spki',format:'der'}));
 const wallKeySha256=syntheticWallOriginFingerprint(wall.publicKey);
 const v=verifySyntheticChannelAndWallOrigin({
  channelAck:channelPacket,wallApproval,
  channelPublicKey:channel.publicKey,wallPublicKey:wall.publicKey,
  nowMs:at,
  expected:{
    requestId:input.requestId,grantId:input.grantId,
    ownerAccountId:input.accountId,accountId:input.accountId,
    deviceId:input.deviceId,agentId:input.agentId,
    connectionId:input.connectionId,deviceKeySha256:input.deviceKeySha256,
    ownerSessionSha256,purpose:'device',
    channelPublicSha256:channelKeySha256,
    approvedRequestState:'approved',ownerSessionActive:true,
    deviceEnrollmentActive:true,connectionActive:true,
    originNonceUnused:true,deviceChannelActive:true
  }
 });
 if(v.decision!=='VERIFIED_FAKE_OWNER_AND_CHANNEL'||v.productionIssuerAuthorized!==false)
    throw Error('fake_owner_channel_signatures_not_verified');
 return Object.freeze({
  ...(includePackets?{signedPackets:{wallApproval,channelAck:channelPacket,
    wallPublicSpki:wall.publicKey.export({type:'spki',format:'der'}).toString('base64url'),
    channelPublicSpki:channel.publicKey.export({type:'spki',format:'der'}).toString('base64url')}}:{}),
  requestId:input.requestId,grantId:input.grantId,
  ownerSessionId:input.ownerSessionId,ownerAccountId:input.accountId,
  deviceId:input.deviceId,connectionId:input.connectionId,agentId:input.agentId,
  enrolledKeySha256:input.deviceKeySha256,
  wallVerifierSha256:wallKeySha256,channelVerifierSha256:channelKeySha256,
  nonceSha256,wallProofSha256:v.ownerProofDigest,
  channelAckSha256:v.deviceChannelProofDigest,
  requestCreatedAt:new Date(input.requestCreatedAtMs).toISOString(),
  requestExpiresAt:new Date(input.requestExpiresAtMs).toISOString(),
  approvedAt:new Date(wallApproved).toISOString(),
  channelApprovedAt:new Date(channelApproved).toISOString(),
  productionIssuerAuthorized:false,physicalExecutionAuthorized:false
 });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 if(!['--synthetic-only','--synthetic-envelope-only'].includes(process.argv.slice(2).join(' '))||
    process.env.LR_RC50_UAT_ONLY!=='1'){
   process.stderr.write('synthetic_owner_channel_db_proof_uat_only\n');
   process.exit(3);
 }
 try{
  let input='';
  for await(const buf of process.stdin){
   input+=buf.toString('utf8');
   if(input.length>6000)throw Error('fake_input_too_large');
  }
  const parsed=JSON.parse(input);
  const result=Array.isArray(parsed?.batch)&&parsed.batch.length>0&&parsed.batch.length<=3
    ?(()=>{const shared={wall:crypto.generateKeyPairSync('ed25519'),
      channel:crypto.generateKeyPairSync('ed25519')};
      return parsed.batch.map(x=>makeSyntheticOwnerChannelDbProof(x,Date.now(),shared,
        process.argv[2]==='--synthetic-envelope-only'));})()
    :makeSyntheticOwnerChannelDbProof(parsed,Date.now(),null,
      process.argv[2]==='--synthetic-envelope-only');
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(e){
  process.stderr.write('synthetic_owner_channel_db_proof_refused\n');
  process.exitCode=4;
 }
}
