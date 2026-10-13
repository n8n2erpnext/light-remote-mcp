/**
 * rc50 PRIVATE SYNTHETIC fixture signer — no real owner approval.
 * CLI requires --synthetic-only and LR_RC50_UAT_ONLY=1. Generates throwaway
 * Ed25519 key IN MEMORY. Never imported from production.
 */
import crypto from 'node:crypto';
const FIELDS=['kind','requestId','grantId','generation','grantRevision',
 'deviceId','deviceKeySha256','accountId','agentId','connectionId',
 'claimSeq','notBeforeMs','expiresAtMs'];
const DOMAIN='LR_RC50_ISOLATED_PG_PENDING_OUTBOX_FAKE_SIGNER_V1\n';
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_-]{6,180}$/;
const time=x=>Number.isSafeInteger(x)&&x>=0;
const canon=p=>Buffer.from(DOMAIN+JSON.stringify(Object.fromEntries(
  FIELDS.map(f=>[f,p[f]]))),'utf8');
function validate(p){
 if(!p||typeof p!=='object'||Array.isArray(p)||
    FIELDS.length!==Object.keys(p).length||
    FIELDS.some(k=>!Object.hasOwn(p,k)))throw Error('invalid_fake_lease_shape');
 if(p.kind!=='uat_issuer_lease'||!['requestId','grantId','deviceId',
   'accountId','agentId','connectionId'].every(k=>ID.test(p[k]||''))||
   !(p.requestId.startsWith('uat_')||p.requestId.includes('_uat_'))||
   !(p.deviceId.startsWith('uat_')||p.deviceId.includes('_uat_'))||
   !HASH.test(p.deviceKeySha256||'')||
   ![p.generation,p.grantRevision,p.claimSeq,p.notBeforeMs,p.expiresAtMs].every(time)
   ||p.generation<1||p.grantRevision<1||p.claimSeq<1||
   p.expiresAtMs<=p.notBeforeMs||p.expiresAtMs-p.notBeforeMs>30000)
   throw Error('invalid_fake_lease_values');
 return p;
}
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
export function signSyntheticOutboxLease(payload,privateKey){
 validate(payload);
 if(privateKey?.type!=='private'||privateKey.asymmetricKeyType!=='ed25519')
   throw Error('fake_private_issuer_required');
 return {payload,signature:crypto.sign(null,canon(payload),privateKey).toString('base64url')};
}
export function verifySyntheticOutboxLease(packet,publicKey){
 if(publicKey?.type!=='public'||publicKey.asymmetricKeyType!=='ed25519')
   throw Error('fake_public_issuer_required');
 if(!packet||Object.keys(packet).sort().join(',')!=='payload,signature'||
   typeof packet.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(packet.signature))
   throw Error('fake_packet_invalid');
 validate(packet.payload);
 if(!crypto.verify(null,canon(packet.payload),publicKey,
     Buffer.from(packet.signature,'base64url')))
   throw Error('fake_issuer_signature_invalid');
 return packet.payload;
}
export function fakeIssuerPublicKeyFingerprint(publicKey){
 if(publicKey?.type!=='public'||publicKey.asymmetricKeyType!=='ed25519')
  throw Error('fake_public_issuer_required');
 return digest(publicKey.export({format:'der',type:'spki'}));
}
export function fakeSignedOutboxDigest(packet){
 if(!packet||typeof packet.signature!=='string')throw Error('fake_packet_invalid');
 return digest(Buffer.from(JSON.stringify(packet)));
}
export function syntheticPublisherFixture(claim,now=Date.now()){
 if(!claim||!time(now))throw Error('bad_fake_claim');
 const n=x=>Number(x);
 const payload={
   kind:'uat_issuer_lease',
   requestId:String(claim.out_request_id||''),
   grantId:String(claim.out_grant_id||''),
   generation:n(claim.out_generation),grantRevision:n(claim.out_grant_revision),
   deviceId:String(claim.out_device_id||''),
   deviceKeySha256:String(claim.out_device_key_sha256||''),
   accountId:String(claim.out_account_id||''),
   agentId:String(claim.out_agent_id||''),
   connectionId:String(claim.out_connection_id||''),
   claimSeq:n(claim.out_claim_seq),
   notBeforeMs:now-1000,expiresAtMs:now+15000
 };
 validate(payload);
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
 const packet=signSyntheticOutboxLease(payload,privateKey);
 verifySyntheticOutboxLease(packet,publicKey);
 return {issuerFingerprint:fakeIssuerPublicKeyFingerprint(publicKey),
   packet,signatureDigest:fakeSignedOutboxDigest(packet),
   leaseExpiresAt:new Date(payload.expiresAtMs).toISOString(),
   // No privateKey nor raw customer/session info included in output.
   physicalExecutionAuthorized:false,productionIssuerAuthorized:false};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 if(process.argv.slice(2).join(' ')!=='--synthetic-only'||
   process.env.LR_RC50_UAT_ONLY!=='1'){
   process.stderr.write('synthetic_publisher_requires_isolated_uat\n');
   process.exit(3);
 }
 try{
   let input='';
   for await(const chunk of process.stdin){
     input+=chunk.toString('utf8');
     if(input.length>8192)throw Error('fixture_input_too_large');
   }
   const result=syntheticPublisherFixture(JSON.parse(input));
   process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){
   process.stderr.write('synthetic_publisher_refused_'+
      String(error?.message||'invalid').slice(0,70)+'\n');
   process.exitCode=4;
 }
}
