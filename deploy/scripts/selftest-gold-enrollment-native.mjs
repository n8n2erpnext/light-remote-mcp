import assert from 'node:assert/strict';
import {GoldNativeEnrollment} from '../../lib/gold-native-enrollment.mjs';
const tables={pending:new Map(),bindings:new Map()};
const pendingCols=['enrollment_id','state','created_ms','expires_ms','poll_token_sha256','code_salt','code_sha256',
 'public_key_sha256','public_identity_key','requested_capabilities','requested_policy','display_name','platform',
 'architecture','agent_version','fingerprint_summary','source_hash','approved_ms','device_id','account_id','certificate_id','expired_ms','replaced_ms'];
const bindingCols=['device_id','account_id','public_key_sha256','public_identity_key','grantable_capabilities',
 'approved_capabilities','policy_profile','policy_revision','policy_updated_ms','display_name','platform',
 'architecture','agent_version','fingerprint_summary','certificate_id','issued_ms','not_after_ms',
 'certificate_signature','revoked_ms','revoke_reason'];
const query=async(sql,args=[])=>{
 if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
 if(sql==='SELECT * FROM lr_gold_enrollment_pending')return {rows:[...tables.pending.values()].map(x=>structuredClone(x))};
 if(sql==='SELECT * FROM lr_gold_enrollment_bindings')return {rows:[...tables.bindings.values()].map(x=>structuredClone(x))};
 if(sql.startsWith('INSERT INTO lr_gold_enrollment_pending')){
  const row=Object.fromEntries(pendingCols.map((k,i)=>[k,args[i]]));tables.pending.set(row.enrollment_id,row);return {rows:[]};
 }
 if(sql.startsWith('INSERT INTO lr_gold_enrollment_bindings')){
  const row=Object.fromEntries(bindingCols.map((k,i)=>[k,args[i]]));tables.bindings.set(row.device_id,row);return {rows:[]};
 }
 if(sql.startsWith('DELETE FROM lr_gold_enrollment_pending')){
  for(const id of [...tables.pending.keys()])if(!args[0].includes(id))tables.pending.delete(id);
  return {rows:[]};
 }
 if(sql.startsWith('DELETE FROM lr_gold_enrollment_bindings')){
  for(const id of [...tables.bindings.keys()])if(!args[0].includes(id))tables.bindings.delete(id);
  return {rows:[]};
 }
 throw Error('unexpected_sql:'+sql);
};
const pool={query,async connect(){return {query,release(){}}}};
const now=Date.now();
const pending={enrollmentId:'enr_test',state:'pending',createdAt:now,
 expiresAt:now+600000,pollTokenHash:'a'.repeat(64),codeSalt:'b'.repeat(32),codeHash:'c'.repeat(64),
 publicKeySha256:'d'.repeat(64),publicIdentityKey:'pubkey',requestedCapabilities:['filesystem'],
 requestedPolicy:'default',displayName:'Gold',platform:'linux',architecture:'arm64',
 agentVersion:'rc49',fingerprintSummary:'linux/arm64',sourceHash:'test'};
const binding={deviceId:'device',accountId:'owner',
 publicKeySha256:'d'.repeat(64),publicIdentityKey:'pubkey',
 grantableCapabilities:['filesystem'],approvedCapabilities:['filesystem'],policyProfile:'default',
 policyRevision:1,policyUpdatedAt:now,displayName:'Gold',platform:'linux',architecture:'arm64',
 agentVersion:'rc49',fingerprintSummary:'linux/arm64',certificateId:'cert_test',
 issuedAt:now,notAfter:now+31536000000,certificateSignature:'signature'};
const one=await GoldNativeEnrollment.open({pool});
await one.store.write({pending:[['enr_test',pending]],bindings:[['device',binding]]});
const reopened=await GoldNativeEnrollment.open({pool});
assert.equal(reopened.data.pending[0][1].codeSalt,pending.codeSalt);
assert.equal(reopened.data.bindings[0][1].certificate.deviceId,'device');
assert.equal(reopened.data.bindings[0][1].certificateSignature,'signature');
assert.deepEqual(reopened.data.bindings[0][1].approvedCapabilities,['filesystem']);
await reopened.store.write({pending:[],bindings:[]});
assert.equal((await GoldNativeEnrollment.open({pool})).data.bindings.length,0);
console.log('GOLD_NATIVE_ENROLLMENT_SQL_FAKE=PASS');
