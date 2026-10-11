import test from 'node:test';
import assert from 'node:assert/strict';
import {PgRotationStoreUat} from '../src/identity/pg-rotation-store-uat.mjs';

test('rotation SQL repository strictly gates database identity',async()=>{
 const queries=[];
 const pool={query:async(sql,args)=>{
   queries.push([sql,args]);
   return {rows:[{database:'light_remote_rc50_uat',
     role:'lr_rc50_rotation_verifier',superuser:false}]};
 }};
 assert.throws(()=>new PgRotationStoreUat({pool}),/rotation_pg_uat_only/);
 const repo=new PgRotationStoreUat({pool,allowUat:true});
 await assert.rejects(()=>repo.getIdentity('uat_device'),/rotation_pg_not_initialized/);
 await assert.rejects(()=>repo.finalizeChallenge({challengeId:'uat_id',
   nonceSha256:'a'.repeat(64),oldKeySha256:'b'.repeat(64),newKeySha256:'c'.repeat(64)}),
   /rotation_pg_not_initialized/);
 assert.equal(queries.length,0);
 await repo.verifyTarget();assert.equal(queries.length,1);
 const wrongPool={query:async()=>({rows:[{database:'light_remote_rc50_uat',
   role:'lr_rc50_uat',superuser:false}]})};
 const wrong=new PgRotationStoreUat({pool:wrongPool,allowUat:true});
 await assert.rejects(()=>wrong.verifyTarget(),/rotation_unapproved_db_identity/);
 await assert.rejects(()=>wrong.getIdentity('uat_device'),/rotation_pg_not_initialized/);
});
test('rotation SQL repository uses immutable device IDs and binds SQL params',async()=>{
 const queries=[];
 const pool={query:async(sql,args)=>{
   queries.push([sql,args]);
   if(sql.includes('current_database()'))return {rows:[{database:'light_remote_rc50_uat',role:'lr_rc50_rotation_verifier',superuser:false}]};
   if(sql.includes('FROM lr_devices d JOIN'))return {rows:[{deviceId:'old',ownerAccountId:'owner',state:'online',publicKeySpki:'identity_base64'}]};
   if(sql.includes('FROM lr_free_rotation_challenges WHERE'))return {rows:[{
     challengeId:'test_challenge',oldDeviceId:'old',newDeviceId:'next',
     oldOwnerAccountId:'owner',newOwnerAccountId:'owner2',sourceFamilyId:'original_family',
     oldKeySha256:'a'.repeat(64),newKeySha256:'b'.repeat(64),
     nonceSha256:'c'.repeat(64),issuedAtMs:'1791712800000',
     expiresAtMs:'1791712920000',consumedAtMs:null
   }]};
   if(sql.includes('lr_finalize_free_rotation_uat'))return {rows:[{linked:true}]};
   return {rows:[]};
 }};
 const repo=new PgRotationStoreUat({pool,allowUat:true});
 await repo.verifyTarget();
 assert.equal((await repo.getIdentity('old')).deviceId,'old');
 await assert.rejects(()=>repo.getIdentity("old';DROP TABLE x;--"),/invalid_rotation_device/);
 const issued={challengeId:'test_challenge',oldDeviceId:'old',newDeviceId:'next',
  oldOwnerAccountId:'owner',newOwnerAccountId:'owner2',sourceFamilyId:'original_family',oldKeySha256:'a'.repeat(64),
  newKeySha256:'b'.repeat(64),nonceSha256:'c'.repeat(64),
  issuedAtMs:1791712800000,expiresAtMs:1791712920000};
 await repo.insertChallenge(issued);
 assert.deepEqual((await repo.getChallenge('test_challenge')).expiresAtMs,1791712920000);
 assert.equal(await repo.finalizeChallenge({
   challengeId:issued.challengeId,nonceSha256:issued.nonceSha256,
   oldKeySha256:issued.oldKeySha256,newKeySha256:issued.newKeySha256
 }),true);
 assert(queries.some(([sql,args])=>sql.includes('INSERT INTO lr_free_rotation_challenges(')&&args?.length===11));
 assert(queries.some(([sql,args])=>sql.includes('SELECT lr_finalize_free_rotation_uat($1,$2,$3,$4)')&&args?.length===4));
 assert(queries.every(([sql])=>!sql.includes('test_challenge')));
});
