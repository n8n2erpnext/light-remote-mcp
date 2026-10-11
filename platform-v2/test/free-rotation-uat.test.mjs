import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {FreeRotationVerifierUat,rotationMessage} from '../src/identity/free-rotation-uat.mjs';

function identity(deviceId,ownerAccountId){
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
 return {deviceId,ownerAccountId,state:'online',privateKey,
   publicKeySpki:publicKey.export({type:'spki',format:'der'}).toString('base64')};
}
function fixture(){
 const old=identity('uat_old_device','uat_owner_a');
 old.familyId='uat_source_family';
 const next=identity('uat_new_device','uat_owner_b');
 next.familyId=null;
 let time=Date.UTC(2026,9,11,10,0);
 const records=new Map();let finalizations=0;
 const store={
   verifyTarget:async()=>({database:'light_remote_rc50_uat',role:'lr_rc50_rotation_verifier',superuser:false}),
   getIdentity:async id=>[old,next].find(x=>x.deviceId===id),
   insertChallenge:async rec=>{
     assert(!records.has(rec.challengeId));records.set(rec.challengeId,{...rec,consumedAtMs:null});
   },
   getChallenge:async id=>records.get(id),
   finalizeChallenge:async payload=>{
     const rec=records.get(payload.challengeId);
     if(!rec||rec.consumedAtMs!==null)return false;
     for(const field of ['nonceSha256','oldKeySha256','newKeySha256'])
       assert.equal(payload[field],rec[field]);
     rec.consumedAtMs=time;next.familyId=old.familyId;finalizations++;
     return true;
   }
 };
 const authorizeOwners=async({oldOwnerAccountId,newOwnerAccountId,authenticatedContext})=>
   authenticatedContext?.approvedOwners?.includes(oldOwnerAccountId)
   &&authenticatedContext?.approvedOwners?.includes(newOwnerAccountId);
 const verifier=new FreeRotationVerifierUat({store,authorizeOwners,now:()=>time,allowUat:true});
 const both={approvedOwners:['uat_owner_a','uat_owner_b']};
 const partial={approvedOwners:['uat_owner_a']};
 const sign=(challenge,oldKey=old.privateKey,newKey=next.privateKey)=>({
   oldSignature:crypto.sign(null,Buffer.from(challenge.message),oldKey).toString('base64url'),
   newSignature:crypto.sign(null,Buffer.from(challenge.message),newKey).toString('base64url')
 });
 return {verifier,old,next,both,partial,sign,records,store,
   get finalizeCount(){return finalizations},
   advance:ms=>{time+=ms;},now:()=>time};
}
test('dual Ed25519 proof consumes one short-lived trusted challenge',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.verifier.issue({oldDeviceId:f.old.deviceId,newDeviceId:f.next.deviceId,authenticatedContext:f.both}),
   /rotation_not_initialized/);
 await f.verifier.initialize();
 await assert.rejects(()=>f.verifier.issue({oldDeviceId:f.old.deviceId,newDeviceId:f.next.deviceId,authenticatedContext:f.partial}),
   /rotation_owner_approval_required/);
 const c=await f.verifier.issue({oldDeviceId:f.old.deviceId,newDeviceId:f.next.deviceId,authenticatedContext:f.both});
 assert.equal(c.expiresAtMs-f.now(),120000);
 assert(!f.records.get(c.challengeId).nonce);
 const signatures=f.sign(c);
 assert.equal(await f.verifier.complete({...c,...signatures,authenticatedContext:f.both}),true);
 assert.equal(f.finalizeCount,1);
 await assert.rejects(()=>f.verifier.complete({...c,...signatures,authenticatedContext:f.both}),
   /rotation_challenge_unavailable/);
 assert.equal(f.finalizeCount,1);
});
test('tampered nonce, wrong signer and swapped device signatures all fail closed',async()=>{
 const f=fixture();await f.verifier.initialize();
 const c=await f.verifier.issue({oldDeviceId:f.old.deviceId,newDeviceId:f.next.deviceId,authenticatedContext:f.both});
 const sigs=f.sign(c);
 await assert.rejects(()=>f.verifier.complete({...c,...sigs,nonce:'a'.repeat(43),authenticatedContext:f.both}),
   /rotation_nonce_mismatch/);
 await assert.rejects(()=>f.verifier.complete({...c,...sigs,oldSignature:sigs.newSignature,
   authenticatedContext:f.both}),/rotation_dual_signature_required/);
 await assert.rejects(()=>f.verifier.complete({...c,...sigs,newSignature:sigs.oldSignature,
   authenticatedContext:f.both}),/rotation_dual_signature_required/);
 assert.equal(f.finalizeCount,0);
 assert.equal(await f.verifier.complete({...c,...sigs,authenticatedContext:f.both}),true);
});
test('rotation expires, re-approvals required and current key fingerprints pinned',async()=>{
 const f=fixture();await f.verifier.initialize();
 const c=await f.verifier.issue({oldDeviceId:f.old.deviceId,newDeviceId:f.next.deviceId,authenticatedContext:f.both});
 const sigs=f.sign(c);
 await assert.rejects(()=>f.verifier.complete({...c,...sigs,authenticatedContext:f.partial}),
   /rotation_owner_approval_required/);
 const generated=crypto.generateKeyPairSync('ed25519');
 f.next.publicKeySpki=generated.publicKey.export({type:'spki',format:'der'}).toString('base64');
 await assert.rejects(()=>f.verifier.complete({...c,...sigs,authenticatedContext:f.both}),
   /rotation_public_key_changed/);
 f.advance(120000);
 await assert.rejects(()=>f.verifier.complete({...c,...sigs,authenticatedContext:f.both}),
   /rotation_challenge_expired/);
 assert.equal(f.finalizeCount,0);
});
test('only the UAT identity verifier DB role is accepted',async()=>{
 const f=fixture();
 assert.throws(()=>new FreeRotationVerifierUat({store:f.store,authorizeOwners:async()=>true}),
   /rotation_uat_only/);
 f.store.verifyTarget=async()=>({database:'light_remote_rc50_uat',role:'lr_rc50_uat',superuser:false});
 await assert.rejects(()=>f.verifier.initialize(),/rotation_unapproved_db_identity/);
 f.store.verifyTarget=async()=>({database:'light_remote_rc50_uat',role:'lr_rc50_rotation_verifier',superuser:true});
 await assert.rejects(()=>f.verifier.initialize(),/rotation_unapproved_db_identity/);
});
test('signed domain message is deterministic and uniquely binds account and device',async()=>{
 const f=fixture();await f.verifier.initialize();
 const c=await f.verifier.issue({oldDeviceId:f.old.deviceId,newDeviceId:f.next.deviceId,authenticatedContext:f.both});
 const record=f.records.get(c.challengeId);
 assert.equal(rotationMessage(record,c.nonce).toString(),c.message);
 const altered={...record,newOwnerAccountId:'different_owner'};
 assert.notDeepEqual(rotationMessage(altered,c.nonce),rotationMessage(record,c.nonce));
 const switched={...record,sourceFamilyId:'another_family'};
 assert.notDeepEqual(rotationMessage(switched,c.nonce),rotationMessage(record,c.nonce));
});

test('source family pin and pre-linked target both fail closed',async()=>{
 const f=fixture();await f.verifier.initialize();
 const c=await f.verifier.issue({oldDeviceId:f.old.deviceId,newDeviceId:f.next.deviceId,authenticatedContext:f.both});
 const signatures=f.sign(c);
 f.old.familyId='different_family';
 await assert.rejects(()=>f.verifier.complete({...c,...signatures,authenticatedContext:f.both}),
   /rotation_source_family_changed/);
 f.old.familyId='uat_source_family';
 f.next.familyId='already_linked_family';
 await assert.rejects(()=>f.verifier.complete({...c,...signatures,authenticatedContext:f.both}),
   /rotation_target_already_family_bound/);
 await assert.rejects(()=>f.verifier.issue({oldDeviceId:f.old.deviceId,newDeviceId:f.next.deviceId,authenticatedContext:f.both}),
   /rotation_target_already_family_bound/);
 assert.equal(f.finalizeCount,0);
});
