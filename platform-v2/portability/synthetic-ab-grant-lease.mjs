/**
 * Light Remote rc50 — OFFLINE UAT ONLY, no real A/B owner authentication.
 * Domain-separated Ed25519 proof-chain fixture:
 *   fake Wall approval -> fake issuer short lease -> device decision
 * plus signed revocation floor and persisted clock high-watermark proposals.
 * No filesystem I/O, network, grant issuance from production, or OS execution.
 */
import crypto from 'node:crypto';

const ID=/^uat_[A-Za-z0-9_-]{4,90}$/;
const HASH=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const fields={
  approval:['kind','requestId','grantId','ownerAccountId','accountId','deviceId',
    'agentId','connectionId','deviceKeySha256','purpose','createdAt',
    'requestExpiresAt','approvedAt','grantExpiresAt','absoluteExpiresAt','grantRevision'],
  lease:['kind','approvalDigest','requestId','grantId','ownerAccountId','accountId',
    'deviceId','agentId','connectionId','deviceKeySha256','purpose',
    'generation','grantRevision','revocationRevision','notBefore','expiresAt'],
  revocation:['kind','ownerAccountId','accountId','deviceId','grantId',
    'revocationRevision','effectiveAt','reason']
};
const DOMAIN='LR_RC50_FAKE_AB_ISSUER_LEASE_V1:';
const sameKeys=(value,keys)=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join('|')===keys.slice().sort().join('|'));
const encoded=(type,value)=>Buffer.from(DOMAIN+type+'\n'+JSON.stringify(
  Object.fromEntries(fields[type].map(k=>[k,value[k]]))),'utf8');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const isPub=k=>k?.type==='public'&&k.asymmetricKeyType==='ed25519';
const isPri=k=>k?.type==='private'&&k.asymmetricKeyType==='ed25519';
const deny=reason=>Object.freeze({decision:'DENY',reason,physicalExecutionAuthorized:false});
const propose=(reason,state)=>Object.freeze({
  decision:'PROPOSE_DURABLE_STATE',reason,next:state,requiresFsync:true,
  physicalExecutionAuthorized:false
});
function validate(type,p){
  if(!sameKeys(p,fields[type]))throw Error('fake_'+type+'_shape_invalid');
  if(p.kind!=='fake_'+type)throw Error('fake_'+type+'_kind_invalid');
  const ids=type==='revocation'
    ? ['ownerAccountId','accountId','deviceId','grantId']
    : ['requestId','grantId','ownerAccountId','accountId','deviceId','agentId','connectionId'];
  if(ids.some(k=>!ID.test(p[k]||'')))throw Error('fake_'+type+'_ids_invalid');
  if(p.accountId!==p.ownerAccountId)throw Error('fake_direct_owner_mismatch');
  if(type!=='revocation'&&(!HASH.test(p.deviceKeySha256||'')||p.purpose!=='device'))
    throw Error('fake_device_proof_invalid');
  if(type==='approval'){
    if(![p.createdAt,p.requestExpiresAt,p.approvedAt,p.grantExpiresAt,
      p.absoluteExpiresAt,p.grantRevision].every(safe)||p.grantRevision<1
      ||p.requestExpiresAt<=p.createdAt
      ||p.requestExpiresAt-p.createdAt>600000
      ||p.approvedAt<p.createdAt||p.approvedAt>=p.requestExpiresAt
      ||p.absoluteExpiresAt<=p.approvedAt
      ||p.absoluteExpiresAt-p.approvedAt>86400000
      ||p.grantExpiresAt<=p.approvedAt||p.grantExpiresAt>p.absoluteExpiresAt)
      throw Error('fake_ab_approval_invalid');
  } else if(type==='lease'){
    if(!HASH.test(p.approvalDigest||'') ||
      ![p.generation,p.grantRevision,p.revocationRevision,p.notBefore,p.expiresAt].every(safe)
      ||p.generation<1||p.grantRevision<1
      ||p.expiresAt<=p.notBefore||p.expiresAt-p.notBefore>30000)
      throw Error('fake_short_lease_invalid');
  } else {
    if(!safe(p.revocationRevision)||p.revocationRevision<1
      ||!safe(p.effectiveAt)||!['owner_revoke','lease_replaced','device_revoked'].includes(p.reason))
      throw Error('fake_revocation_invalid');
  }
  return p;
}
export function signFakeAbPacket(type,privateKey,payload){
  if(!Object.hasOwn(fields,type)||!isPri(privateKey))throw Error('invalid_fake_signer');
  validate(type,payload);
  return {payload,signature:crypto.sign(null,encoded(type,payload),privateKey).toString('base64url')};
}
export function verifyFakeAbPacket(type,publicKey,packet){
  if(!Object.hasOwn(fields,type)||!isPub(publicKey))throw Error('invalid_fake_verifier');
  if(!sameKeys(packet,['payload','signature'])||!SIG.test(packet.signature||''))
    throw Error('invalid_fake_envelope');
  validate(type,packet.payload);
  if(!crypto.verify(null,encoded(type,packet.payload),publicKey,
    Buffer.from(packet.signature,'base64url')))throw Error('fake_signature_mismatch');
  return packet.payload;
}
export function fakeApprovalDigest(approval){
  validate('approval',approval);
  return sha(encoded('approval',approval));
}
export function fakePublicKeyFingerprint(publicKey){
  if(!isPub(publicKey))throw Error('invalid_fake_verifier');
  return sha(publicKey.export({format:'der',type:'spki'}));
}
/** Creates only an in-memory PROPOSAL. Caller must persist it durably. */
export function makeFakeDeviceGrantState({ownerAccountId,accountId,deviceId,agentId,
  deviceKeySha256,wallPublicKey,issuerPublicKey}={}){
  if(![ownerAccountId,accountId,deviceId,agentId].every(x=>ID.test(x||''))
    ||accountId!==ownerAccountId||!HASH.test(deviceKeySha256||''))
    throw Error('invalid_fake_device_identity');
  return {
    schema:1,ownerAccountId,accountId,deviceId,agentId,deviceKeySha256,
    wallPin:fakePublicKeyFingerprint(wallPublicKey),
    issuerPin:fakePublicKeyFingerprint(issuerPublicKey),
    floorGeneration:0,floorGrantRevision:0,revocationRevision:0,lastSeenMs:0,
    activeGrantId:null,activeApprovalDigest:null,revokedGrantIds:[]
  };
}
function validState(s){
  return Boolean(s&&typeof s==='object'&&!Array.isArray(s)&&s.schema===1
    &&['ownerAccountId','accountId','deviceId','agentId'].every(k=>ID.test(s[k]||''))
    &&s.ownerAccountId===s.accountId&&HASH.test(s.deviceKeySha256||'')
    &&HASH.test(s.wallPin||'')&&HASH.test(s.issuerPin||'')
    &&[s.floorGeneration,s.floorGrantRevision,s.revocationRevision,s.lastSeenMs].every(safe)
    &&(s.activeGrantId===null||ID.test(s.activeGrantId))
    &&(s.activeApprovalDigest===null||HASH.test(s.activeApprovalDigest))
    &&(s.activeGrantId===null)===(s.activeApprovalDigest===null)
    &&Array.isArray(s.revokedGrantIds)&&s.revokedGrantIds.length<=512
    &&s.revokedGrantIds.every(id=>ID.test(id))
    &&new Set(s.revokedGrantIds).size===s.revokedGrantIds.length);
}
/** UAT-only: validates restored grant state before any mutation/recovery. */
export function validFakeDeviceGrantState(value){return validState(value);}
function bound(p,s){
  return p.ownerAccountId===s.ownerAccountId&&p.accountId===s.accountId
    &&p.deviceId===s.deviceId&&(!Object.hasOwn(p,'agentId')||p.agentId===s.agentId)
    &&(!Object.hasOwn(p,'deviceKeySha256')||p.deviceKeySha256===s.deviceKeySha256);
}
/**
 * timeSource is a trusted fixture clock injected by the TEST HARNESS.
 * Never pass request.nowMs or untrusted network time. In production a
 * protected service/monotonic lease and crash-safe clock floor are required.
 * No result ever gives permission to run an OS command.
 */
export function evaluateFakeAbGrantLease(state,request,{
  wallPublicKey,issuerPublicKey,timeSource=()=>Date.now()
}={}){
  if(!validState(state))return deny('CORRUPT_OR_UNINITIALIZED_GRANT_STATE');
  if(!isPub(wallPublicKey)||!isPub(issuerPublicKey)
    ||fakePublicKeyFingerprint(wallPublicKey)!==state.wallPin
    ||fakePublicKeyFingerprint(issuerPublicKey)!==state.issuerPin)
    return deny('PINNED_FAKE_ISSUER_MISMATCH');
  if(!request||typeof request!=='object'||Array.isArray(request))
    return deny('REQUEST_INVALID');
  const now=timeSource();
  if(!safe(now))return deny('TRUSTED_CLOCK_INVALID');
  if(now<state.lastSeenMs)return deny('CLOCK_ROLLBACK_FAIL_CLOSED');
  if(request.operation==='revoke'){
    let r;
    try{r=verifyFakeAbPacket('revocation',issuerPublicKey,request.signedRevocation);}
    catch{return deny('REVOCATION_SIGNATURE_INVALID');}
    if(!bound(r,state)||r.effectiveAt>now)
      return deny('REVOCATION_WRONG_TARGET_OR_FUTURE');
    if(r.revocationRevision<=state.revocationRevision)
      return deny('REVOCATION_NOT_MONOTONIC');
    if(state.revokedGrantIds.length>=512&&!state.revokedGrantIds.includes(r.grantId))
      return deny('REVOCATION_TOMBSTONE_CAP');
    const set=new Set([...state.revokedGrantIds,r.grantId]);
    return propose('SIGNED_REVOCATION_FLOOR_ADVANCED',{
      ...state,revocationRevision:r.revocationRevision,lastSeenMs:now,
      activeGrantId:state.activeGrantId===r.grantId?null:state.activeGrantId,
      activeApprovalDigest:state.activeGrantId===r.grantId?null:state.activeApprovalDigest,
      revokedGrantIds:[...set]
    });
  }
  if(!['accept','check'].includes(request.operation))return deny('ACTION_UNSUPPORTED');
  let a,l;
  try{
    a=verifyFakeAbPacket('approval',wallPublicKey,request.signedApproval);
    l=verifyFakeAbPacket('lease',issuerPublicKey,request.signedLease);
  }catch{return deny('APPROVAL_OR_LEASE_SIGNATURE_INVALID');}
  if(!bound(a,state)||!bound(l,state))return deny('GRANT_TARGET_MISMATCH');
  const approvalHash=fakeApprovalDigest(a);
  const tied=['requestId','grantId','ownerAccountId','accountId','deviceId',
    'agentId','connectionId','deviceKeySha256','purpose','grantRevision'];
  if(tied.some(k=>a[k]!==l[k])||l.approvalDigest!==approvalHash)
    return deny('LEASE_NOT_BOUND_TO_APPROVAL');
  if(l.notBefore<a.approvedAt||l.expiresAt>a.grantExpiresAt||
     l.expiresAt>a.absoluteExpiresAt||now<l.notBefore||now>=l.expiresAt)
    return deny('LEASE_EXPIRED_OUTSIDE_APPROVAL_OR_ABSOLUTE_LIMIT');
  if(state.revokedGrantIds.includes(l.grantId))
    return deny('GRANT_TOMBSTONED');
  if(l.revocationRevision<state.revocationRevision)
    return deny('STALE_REVOCATION_FLOOR');
  if(l.generation<state.floorGeneration||
     l.grantRevision<state.floorGrantRevision)
    return deny('STALE_GENERATION_OR_GRANT_REVISION');
  if(request.operation==='check'){
    if(state.activeGrantId!==l.grantId
       ||state.activeApprovalDigest!==approvalHash
       ||state.floorGeneration!==l.generation
       ||state.floorGrantRevision!==l.grantRevision)
      return deny('NOT_ACTIVE_APPROVED_GRANT');
    return propose('SIGNED_FAKE_LEASE_CHECK_ONLY',{
      ...state,lastSeenMs:now,revocationRevision:l.revocationRevision
    });
  }
  if(l.generation===state.floorGeneration && state.activeGrantId!==null &&
    (state.activeGrantId!==l.grantId||state.activeApprovalDigest!==approvalHash||
      state.floorGrantRevision!==l.grantRevision))
    return deny('GENERATION_REUSE_WITH_DIFFERENT_GRANT');
  if(l.generation>state.floorGeneration&&l.grantRevision<state.floorGrantRevision)
    return deny('ADVANCED_EPOCH_WITH_OLD_GRANT');
  return propose('FAKE_APPROVAL_BOUND_LEASE_ACCEPTED',{
    ...state,activeGrantId:l.grantId,activeApprovalDigest:approvalHash,
    floorGeneration:l.generation,floorGrantRevision:l.grantRevision,
    revocationRevision:l.revocationRevision,lastSeenMs:now
  });
}
