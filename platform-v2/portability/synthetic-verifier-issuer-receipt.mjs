/**
 * rc50 UAT ONLY — signed PRE-COMMIT verifier->issuer decision contract.
 * No real keys, permission to grant, PTY/RM/SCP or production transport.
 * Signer re-verifies fake Wall+channel packets against caller-supplied scratch
 * context. In production that context MUST be fetched from authenticated PG.
 * Cryptographic validity IS NOT one-time consumption: PG must atomically claim.
 */
import crypto from 'node:crypto';
import {verifySyntheticOwnerChannelEnvelope}
 from './synthetic-owner-channel-verify-only.mjs';

const DOMAIN='LIGHT_REMOTE_RC50_FAKE_VERIFIER_ISSUER_RECEIPT_V1\n';
const FIELDS=['kind','decision','receiptId','verifierId','verifierKeyEpoch',
 'requestId','grantId','accountId','deviceId','agentId','connectionId',
 'ownerSessionSha256','enrolledKeySha256','nonceSha256','wallProofSha256',
 'channelAckSha256','expectedWriterEpoch','expectedGrantGeneration',
 'issuedAtMs','expiresAtMs'];
const ID=/^uat_[A-Za-z0-9_-]{4,90}$/;
const HASH=/^[a-f0-9]{64}$/;
const RECEIPT_ID=/^[a-f0-9]{32}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
const UAT_WINDOW=10000;
const exact=(o,fields)=>Boolean(o&&typeof o==='object'&&!Array.isArray(o)
 &&Object.keys(o).sort().join('|')===fields.slice().sort().join('|'));
const integer=n=>Number.isSafeInteger(n)&&n>0;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const canon=p=>Buffer.from(DOMAIN+JSON.stringify(Object.fromEntries(
 FIELDS.map(k=>[k,p[k]]))),'utf8');
const deny=reason=>Object.freeze({decision:'DENY',reason,
 productionIssuerAuthorized:false,physicalExecutionAuthorized:false,
 grantCommitted:false});
function shape(p){
 return exact(p,FIELDS)&&p.kind==='uat_fake_verifier_issuer_receipt'
  &&p.decision==='VERIFIED_FAKE_OWNER_CHANNEL_PRECOMMIT'
  &&RECEIPT_ID.test(p.receiptId??'')
  &&['verifierId','requestId','grantId','accountId','deviceId','agentId',
      'connectionId'].every(k=>ID.test(p[k]??''))
  &&['ownerSessionSha256','enrolledKeySha256','nonceSha256',
      'wallProofSha256','channelAckSha256'].every(k=>HASH.test(p[k]??''))
  &&['verifierKeyEpoch','expectedWriterEpoch','expectedGrantGeneration',
       'issuedAtMs','expiresAtMs'].every(k=>integer(p[k]))
  &&p.expiresAtMs>p.issuedAtMs
  &&p.expiresAtMs-p.issuedAtMs<=UAT_WINDOW;
}
function publicKey(spki){
 if(typeof spki!=='string'||spki.length>128||
    !spki.startsWith('MCowBQYDK2VwAyEA'))throw Error('RECEIPT_KEY_SHAPE');
 const k=crypto.createPublicKey({key:Buffer.from(spki,'base64url'),
  format:'der',type:'spki'});
 if(k.asymmetricKeyType!=='ed25519'||
    k.export({type:'spki',format:'der'}).toString('base64url')!==spki)
  throw Error('RECEIPT_UNTRUSTED_SPKI');
 return k;
}
export function fakeVerifierKeyPin(publicKeyObject){
 if(publicKeyObject?.type!=='public'||
    publicKeyObject.asymmetricKeyType!=='ed25519')
  throw Error('RECEIPT_PUBLIC_KEY_REQUIRED');
 return sha(publicKeyObject.export({type:'spki',format:'der'}));
}

/**
 * Test-only separate signer. Its ephemeral private key never appears in output.
 * Context here is a SYNTHETIC fixture, not authenticated storage.
 */
export function signSyntheticVerifiedOriginReceipt({
 envelope,trusted,privateKey,verifierId,verifierKeyEpoch,
 writerEpoch,grantGeneration,nowMs=Date.now()
}={}){
 if(privateKey?.type!=='private'||privateKey.asymmetricKeyType!=='ed25519')
  throw Error('RECEIPT_FAKE_PRIVATE_KEY_REQUIRED');
 if(!ID.test(verifierId??'')||![verifierKeyEpoch,writerEpoch,grantGeneration]
     .every(integer)||!integer(nowMs))
  throw Error('RECEIPT_SIGNER_CONTEXT_INVALID');
 const proof=verifySyntheticOwnerChannelEnvelope(envelope,trusted,nowMs);
 if(proof.decision!=='VERIFIED_FAKE_OWNER_CHANNEL_PRECOMMIT')
  throw Error('RECEIPT_SOURCE_SIGNATURE_NOT_VERIFIED');
 // Derive all identities / evidence from VERIFIED bytes, not supplied claims.
 const p={
  kind:'uat_fake_verifier_issuer_receipt',decision:proof.decision,
  receiptId:crypto.randomBytes(16).toString('hex'),verifierId,
  verifierKeyEpoch,
  requestId:proof.requestId,grantId:proof.grantId,
  accountId:proof.ownerAccountId,deviceId:proof.deviceId,
  agentId:proof.agentId,connectionId:proof.connectionId,
  ownerSessionSha256:sha(proof.ownerSessionId),
  enrolledKeySha256:proof.enrolledKeySha256,
  nonceSha256:proof.nonceSha256,wallProofSha256:proof.wallProofSha256,
  channelAckSha256:proof.channelAckSha256,
  expectedWriterEpoch:writerEpoch,expectedGrantGeneration:grantGeneration,
  issuedAtMs:nowMs,expiresAtMs:Math.min(nowMs+UAT_WINDOW,
    Date.parse(proof.requestExpiresAt))
 };
 if(!shape(p))throw Error('RECEIPT_PROOF_INVALID');
 return Object.freeze({payload:Object.freeze(p),
  signature:crypto.sign(null,canon(p),privateKey).toString('base64url')});
}

/**
 * The issuer MUST supply independently read trusted context, not a value from
 * the message sender. This verifier does not consume a receipt in a DB.
 */
export function verifySyntheticVerifierIssuerReceipt(packet,context,nowMs=Date.now()){
 if(!exact(packet,['payload','signature'])||
    !SIGNATURE.test(packet?.signature??'')||!shape(packet.payload))
   return deny('RECEIPT_SHAPE_INVALID');
 if(!context||typeof context!=='object'||!integer(nowMs))
   return deny('RECEIPT_TRUSTED_CONTEXT_MISSING');
 const p=packet.payload;
 if(context.verifierState!=='active'||!ID.test(context.verifierId??'')||
    !integer(context.verifierKeyEpoch)||!HASH.test(context.verifierKeySha256??'')||
    typeof context.verifierPublicSpki!=='string')
   return deny('RECEIPT_KEY_NOT_ACTIVE');
 let key;
 try{key=publicKey(context.verifierPublicSpki);}
 catch{return deny('RECEIPT_PIN_INVALID');}
 if(fakeVerifierKeyPin(key)!==context.verifierKeySha256||
    p.verifierId!==context.verifierId||
    p.verifierKeyEpoch!==context.verifierKeyEpoch)
   return deny('RECEIPT_KEY_PIN_MISMATCH');
 if(!crypto.verify(null,canon(p),key,
     Buffer.from(packet.signature,'base64url')))
   return deny('RECEIPT_SIGNATURE_INVALID');
 if(p.issuedAtMs>nowMs||nowMs>=p.expiresAtMs||
    nowMs-p.issuedAtMs>UAT_WINDOW)
   return deny('RECEIPT_EXPIRED');
 if(context.ownerSessionActive!==true||
    context.requestState!=='pending'||
    context.deviceActive!==true||context.writerFenced!==false)
   return deny('RECEIPT_TRUSTED_STATE_REVOKED');
 const binds={
  requestId:'requestId',grantId:'grantId',accountId:'accountId',
  deviceId:'deviceId',agentId:'agentId',connectionId:'connectionId',
  ownerSessionSha256:'ownerSessionSha256',
  enrolledKeySha256:'enrolledKeySha256',nonceSha256:'nonceSha256',
  wallProofSha256:'wallProofSha256',channelAckSha256:'channelAckSha256',
  expectedWriterEpoch:'writerEpoch',
  expectedGrantGeneration:'nextGrantGeneration'
 };
 if(Object.entries(binds).some(([receiptKey,trustedKey])=>
   p[receiptKey]!==context[trustedKey]))
   return deny('RECEIPT_AUTHORITY_BINDING_MISMATCH');
 return Object.freeze({decision:'VERIFIED_FAKE_RECEIPT_PRECOMMIT',
  receiptId:p.receiptId,receiptSha256:sha(canon(p)),
  requestId:p.requestId,grantId:p.grantId,
  writerEpoch:p.expectedWriterEpoch,grantGeneration:p.expectedGrantGeneration,
  productionIssuerAuthorized:false,physicalExecutionAuthorized:false,
  grantCommitted:false});
}
