/** Disposable rc50 UAT ONLY: actual fake Wall/channel + verifier signatures.
 * This CLI creates NO real approvals, writes NO database, exports NO secrets.
 */
import crypto from 'node:crypto';
import {makeSyntheticOwnerChannelDbProof}
 from './synthetic-owner-channel-db-proof.mjs';
import {signSyntheticVerifiedOriginReceipt,
 verifySyntheticVerifierIssuerReceipt,fakeVerifierKeyPin}
 from './synthetic-verifier-issuer-receipt.mjs';
const ID=/^uat_[A-Za-z0-9_-]{4,90}$/;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
if(process.env.LR_RC50_UAT_ONLY!=='1'||
    process.argv.slice(2).join(' ')!=='--synthetic-only'){
 process.stderr.write('synthetic_receipt_fixture_optin_required\n');
 process.exit(3);
}
try{
 let raw='';
 for await(const b of process.stdin){
  raw+=b.toString('utf8');
  if(raw.length>5000)throw Error('INPUT_TOO_BIG');
 }
 const x=JSON.parse(raw);
 if(!['requestId','grantId','accountId','deviceId','producerId','agentId',
  'connectionId','sessionId'].every(k=>ID.test(x[k]??''))||
  !Number.isSafeInteger(x.writerEpoch)||x.writerEpoch<1||
  !Number.isSafeInteger(x.generation)||x.generation<1)
  throw Error('INVALID_SYNTHETIC_SCOPE');
 const at=Date.now();
 const req={
  requestId:x.requestId,grantId:x.grantId,
  accountId:x.accountId,deviceId:x.deviceId,
  agentId:x.agentId,connectionId:x.connectionId,
  ownerSessionId:x.sessionId,deviceKeySha256:'a'.repeat(64),
  requestCreatedAtMs:at-60000,requestExpiresAtMs:at+180000
 };
 const fake=makeSyntheticOwnerChannelDbProof(req,at,null,true);
 const trusted={
  requestId:req.requestId,grantId:req.grantId,accountId:req.accountId,
  deviceId:req.deviceId,agentId:req.agentId,connectionId:req.connectionId,
  ownerSessionId:req.ownerSessionId,deviceKeySha256:req.deviceKeySha256,
  wallVerifierSha256:fake.wallVerifierSha256,
  channelVerifierSha256:fake.channelVerifierSha256,
  requestCreatedAtMs:req.requestCreatedAtMs,
  requestExpiresAtMs:req.requestExpiresAtMs,
  requestState:'pending',ownerSessionActive:true,
  enrollmentActive:true,connectionActive:true,pinsActive:true,nonceUnused:true
 };
 const keys=crypto.generateKeyPairSync('ed25519');
 const verifierId='uat_fake_receipt_signer';
 const keyEpoch=3;
 const receipt=signSyntheticVerifiedOriginReceipt({
  envelope:fake.signedPackets,trusted,privateKey:keys.privateKey,
  verifierId,verifierKeyEpoch:keyEpoch,
  writerEpoch:x.writerEpoch,grantGeneration:x.generation,nowMs:at
 });
 const payload=receipt.payload;
 const keysha=fakeVerifierKeyPin(keys.publicKey);
 const pinned={
  verifierId,verifierKeyEpoch:keyEpoch,verifierState:'active',
  verifierPublicSpki:keys.publicKey
    .export({type:'spki',format:'der'}).toString('base64url'),
  verifierKeySha256:keysha,
  requestState:'pending',ownerSessionActive:true,deviceActive:true,
  writerFenced:false,
  requestId:x.requestId,grantId:x.grantId,accountId:x.accountId,
  deviceId:x.deviceId,agentId:x.agentId,connectionId:x.connectionId,
  ownerSessionSha256:sha(x.sessionId),
  enrolledKeySha256:req.deviceKeySha256,
  nonceSha256:payload.nonceSha256,
  wallProofSha256:payload.wallProofSha256,
  channelAckSha256:payload.channelAckSha256,
  writerEpoch:x.writerEpoch,nextGrantGeneration:x.generation
 };
 const v=verifySyntheticVerifierIssuerReceipt(receipt,pinned,at);
 if(v.decision!=='VERIFIED_FAKE_RECEIPT_PRECOMMIT')
  throw Error('FAKE_RECEIPT_VERIFICATION_FAILED');
 // The PG global ledger has a shorter, independent random nonce identifier.
 // It is NOT the signed Wall nonce hash; both are bound by this fake attestation.
 const claimNonce=sha(payload.receiptId).slice(0,32);
 const out={
  receiptId:payload.receiptId,receiptSha256:v.receiptSha256,
  verifierId,keyEpoch,publicKeySha256:keysha,
  verifierPublicSpki:pinned.verifierPublicSpki,
  requestId:payload.requestId,grantId:payload.grantId,
  accountId:payload.accountId,deviceId:payload.deviceId,
  ownerSessionSha256:payload.ownerSessionSha256,
  enrolledKeySha256:payload.enrolledKeySha256,
  wallProofSha256:payload.wallProofSha256,
  channelAckSha256:payload.channelAckSha256,
  producerId:x.producerId,producerKeySha256:'a'.repeat(64),
  nonceHex:claimNonce,messageSha256:v.receiptSha256,
  writerEpoch:payload.expectedWriterEpoch,
  nextGeneration:payload.expectedGrantGeneration,
  signedAt:new Date(payload.issuedAtMs).toISOString(),
  expiresAt:new Date(payload.expiresAtMs).toISOString(),
  originWasCryptographicallyVerified:true,
  physicalExecutionAuthorized:false,productionIssuerAuthorized:false
 };
 // Signature bytes tested within separate Node process; never export key.
 process.stdout.write(JSON.stringify(out)+'\n');
}catch{
 process.stderr.write('synthetic_receipt_fixture_refused\n');
 process.exitCode=4;
}
