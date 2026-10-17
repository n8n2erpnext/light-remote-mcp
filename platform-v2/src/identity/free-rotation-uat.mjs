import crypto from 'node:crypto';

const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const HASH=/^[0-9a-f]{64}$/;
const NONCE=/^[A-Za-z0-9_-]{43}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
const fail=(code)=>{throw new Error(code)};
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function decodePublicKey(spkiBase64){
  if(typeof spkiBase64!=='string'||spkiBase64.length>350)fail('invalid_identity_public_key');
  let key;try{
    key=crypto.createPublicKey({key:Buffer.from(spkiBase64,'base64'),format:'der',type:'spki'});
  }catch{fail('invalid_identity_public_key');}
  if(key.asymmetricKeyType!=='ed25519')fail('device_key_must_be_ed25519');
  const der=key.export({type:'spki',format:'der'});
  if(der.toString('base64')!==spkiBase64)fail('uncanonical_public_key');
  return {key,hash:sha256(der)};
}
function validateRecord(c){
  if(!c||![c.challengeId,c.oldDeviceId,c.newDeviceId,c.oldOwnerAccountId,c.newOwnerAccountId,c.sourceFamilyId]
    .every(id=>ID.test(String(id||''))))fail('invalid_rotation_record');
  if(c.oldDeviceId===c.newDeviceId)fail('same_device_rotation_forbidden');
  if(!HASH.test(String(c.nonceSha256||''))||!HASH.test(String(c.oldKeySha256||''))
    ||!HASH.test(String(c.newKeySha256||'')))fail('invalid_rotation_fingerprint');
  if(!Number.isSafeInteger(c.issuedAtMs)||!Number.isSafeInteger(c.expiresAtMs)
    ||c.expiresAtMs<=c.issuedAtMs||c.expiresAtMs-c.issuedAtMs>300000)
    fail('invalid_rotation_expiration');
}
export function rotationMessage(c,nonce){
  validateRecord(c);
  if(!NONCE.test(String(nonce||'')))fail('invalid_rotation_nonce');
  // Line-oriented fixed field order; no ambiguous JSON serialization.
  return Buffer.from([
    'LightRemoteFreeFamilyRotation/v1',
    c.challengeId,c.oldDeviceId,c.newDeviceId,
    c.oldOwnerAccountId,c.newOwnerAccountId,c.sourceFamilyId,
    c.oldKeySha256,c.newKeySha256,
    String(c.issuedAtMs),String(c.expiresAtMs),nonce
  ].join('\n')+'\n','utf8');
}
/**
 * Experimental proof gate only: not connected to production enrollment.
 * store must expose a trusted account/device key source and durable one-time DB
 * challenge APIs. The verifier MUST be a separate, narrowly authorized role.
 */
export class FreeRotationVerifierUat{
  #ready=false;
  constructor({store,authorizeOwners,now=()=>Date.now(),randomBytes=crypto.randomBytes,allowUat=false}={}){
    if(allowUat!==true)fail('rotation_uat_only');
    for(const m of ['verifyTarget','getIdentity','insertChallenge','getChallenge','finalizeChallenge'])
      if(typeof store?.[m]!=='function')fail('trusted_rotation_store_required');
    if(typeof authorizeOwners!=='function')fail('trusted_owners_authorization_required');
    this.store=store;this.authorizeOwners=authorizeOwners;this.now=now;this.randomBytes=randomBytes;
  }
  async initialize(){
    this.#ready=false;
    const target=await this.store.verifyTarget();
    if(target?.database!=='light_remote_rc50_uat'||target?.role!=='lr_rc50_rotation_verifier'
      ||target?.superuser!==false)fail('rotation_unapproved_db_identity');
    this.#ready=true;
  }
  #checkReady(){if(!this.#ready)fail('rotation_not_initialized');}
  async issue({oldDeviceId,newDeviceId,authenticatedContext}={}){
    this.#checkReady();
    if(!ID.test(String(oldDeviceId||''))||!ID.test(String(newDeviceId||''))
      ||oldDeviceId===newDeviceId)fail('invalid_rotation_devices');
    // Trusted identity repository, NOT a client provided public key or family ID.
    const [oldDevice,newDevice]=await Promise.all([
      this.store.getIdentity(oldDeviceId),this.store.getIdentity(newDeviceId)
    ]);
    if(!oldDevice||!newDevice||oldDevice.deviceId!==oldDeviceId
      ||newDevice.deviceId!==newDeviceId||oldDevice.state==='revoked'
      ||newDevice.state==='revoked')fail('rotation_identity_unavailable');
    if(!ID.test(String(oldDevice.ownerAccountId||''))||
      !ID.test(String(newDevice.ownerAccountId||'')))fail('rotation_owner_unavailable');
    if(!ID.test(String(oldDevice.familyId||'')))fail('rotation_source_family_unverified');
    if(newDevice.familyId!=null)fail('rotation_target_already_family_bound');
    const oldKey=decodePublicKey(oldDevice.publicKeySpki);
    const newKey=decodePublicKey(newDevice.publicKeySpki);
    if(await this.authorizeOwners({oldOwnerAccountId:oldDevice.ownerAccountId,
      newOwnerAccountId:newDevice.ownerAccountId,authenticatedContext,operation:'issue'})!==true)
      fail('rotation_owner_approval_required');
    const now=this.now(),nonce=this.randomBytes(32).toString('base64url');
    if(!Number.isSafeInteger(now)||!NONCE.test(nonce))fail('invalid_rotation_clock');
    const challenge={
      challengeId:crypto.randomUUID(),
      oldDeviceId,newDeviceId,
      oldOwnerAccountId:oldDevice.ownerAccountId,newOwnerAccountId:newDevice.ownerAccountId,
      sourceFamilyId:oldDevice.familyId,
      oldKeySha256:oldKey.hash,newKeySha256:newKey.hash,
      nonceSha256:sha256(Buffer.from(nonce,'utf8')),
      issuedAtMs:now,expiresAtMs:now+120000
    };
    validateRecord(challenge);
    // The secret nonce is NOT stored, only its digest; return the signed message
    // for delivery via mutually-authenticated device transports.
    await this.store.insertChallenge(challenge);
    return {challengeId:challenge.challengeId,nonce,message:rotationMessage(challenge,nonce).toString('utf8'),
      expiresAtMs:challenge.expiresAtMs};
  }
  async complete({challengeId,nonce,oldSignature,newSignature,authenticatedContext}={}){
    this.#checkReady();
    if(!ID.test(String(challengeId||''))||!NONCE.test(String(nonce||'')))
      fail('invalid_rotation_proof');
    if(!SIGNATURE.test(String(oldSignature||''))||!SIGNATURE.test(String(newSignature||'')))
      fail('invalid_rotation_signature');
    const record=await this.store.getChallenge(challengeId);
    validateRecord(record);
    if(record.challengeId!==challengeId||record.consumedAtMs!=null)
      fail('rotation_challenge_unavailable');
    const now=this.now();
    if(now>=record.expiresAtMs||now<record.issuedAtMs)fail('rotation_challenge_expired');
    const digest=Buffer.from(sha256(Buffer.from(nonce,'utf8')),'hex');
    if(!crypto.timingSafeEqual(digest,Buffer.from(record.nonceSha256,'hex')))
      fail('rotation_nonce_mismatch');
    const [oldDevice,newDevice]=await Promise.all([
      this.store.getIdentity(record.oldDeviceId),this.store.getIdentity(record.newDeviceId)
    ]);
    if(!oldDevice||!newDevice||oldDevice.ownerAccountId!==record.oldOwnerAccountId
      ||newDevice.ownerAccountId!==record.newOwnerAccountId
      ||oldDevice.state==='revoked'||newDevice.state==='revoked')
      fail('rotation_identity_changed');
    const oldKey=decodePublicKey(oldDevice.publicKeySpki);
    const newKey=decodePublicKey(newDevice.publicKeySpki);
    if(oldKey.hash!==record.oldKeySha256||newKey.hash!==record.newKeySha256)
      fail('rotation_public_key_changed');
    if(oldDevice.familyId!==record.sourceFamilyId)
      fail('rotation_source_family_changed');
    if(newDevice.familyId!=null)fail('rotation_target_already_family_bound');
    if(await this.authorizeOwners({oldOwnerAccountId:record.oldOwnerAccountId,
      newOwnerAccountId:record.newOwnerAccountId,authenticatedContext,operation:'complete'})!==true)
      fail('rotation_owner_approval_required');
    const message=rotationMessage(record,nonce);
    const oldSig=Buffer.from(oldSignature,'base64url'),newSig=Buffer.from(newSignature,'base64url');
    if(oldSig.length!==64||newSig.length!==64||
      !crypto.verify(null,message,oldKey.key,oldSig)||
      !crypto.verify(null,message,newKey.key,newSig))
      fail('rotation_dual_signature_required');
    // The durable DB finalize MUST atomically fence one-time challenge reuse,
    // check key hashes & accounts, forbid existing family merge and bind the new device.
    return await this.store.finalizeChallenge({
      challengeId,nonceSha256:record.nonceSha256,
      oldKeySha256:record.oldKeySha256,newKeySha256:record.newKeySha256
    });
  }
}
