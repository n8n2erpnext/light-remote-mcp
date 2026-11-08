import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {normalizeGoldGuestProcessIntent,goldGuestIntentHash,
 createGoldGuestIntentCodec,GoldProShareGuestIntentPg}
 from '../../operator-host/pro-share-guest-intent-pg.mjs';
const key=crypto.randomBytes(32);
const job=Object.freeze({
 jobId:'34eea074-acb8-4093-84f1-f52466c851ad',actorAccountId:'guest1',
 ownerAccountId:'owner1',agentId:'plugin-aaaa',deviceId:'device1',
 grantId:'grant1',connectionId:'conn1',operationId:'guestop-faa1',
 permissionRevision:9,operation:'process',state:'queued',
 requiredCapabilities:Object.freeze(['filesystem'])
});
const payload={type:'process-start',script:'printf hello',cwd:'/tmp',
 shell:'bash',timeoutMs:60000};
const codec=createGoldGuestIntentCodec({key}),hash=goldGuestIntentHash(payload);
const sealed=codec.seal({job,payload});
assert.equal(sealed.sha256,hash);
assert.deepEqual(codec.open({job,sealed}),payload);
for(const change of [
 {...job,ownerAccountId:'other-owner'}, {...job,grantId:'other-grant'},
 {...job,permissionRevision:10},{...job,agentId:'other-agent'},
 {...job,operationId:'other-operation'}, {...job,deviceId:'other-device'},
 {...job,actorAccountId:'other-guest'}
])assert.throws(()=>codec.open({job:change,sealed}),/guest_intent_integrity_denied/);
assert.throws(()=>codec.open({job,sealed:{...sealed,sha256:'f'.repeat(64)}}),
 /guest_intent_hash_mismatch/);
assert.throws(()=>codec.open({job,sealed:{...sealed,ct:'AA'}}),
 /guest_intent_integrity_denied/);
for(const invalid of [
 {...payload,environment:{PASSWORD:'x'}},{...payload,script:''},
 {...payload,shell:'not-shell'}, {...payload,timeoutMs:0},
 {...payload,type:'exec'}, {...payload,cwd:'x\u0000y'}
])assert.throws(()=>normalizeGoldGuestProcessIntent(invalid),
 /guest_payload_extra_or_missing_fields|guest_payload_process_contract_denied/);
let active=true,identityOK=true,authorityOK=true,slot=false;
const payloads=new Map(),queries=[];
const savedRow={job_id:job.jobId,operation_id:job.operationId,
 owner_account_id:job.ownerAccountId,guest_account_id:job.actorAccountId,
 agent_id:job.agentId,device_id:job.deviceId,grant_id:job.grantId,
 connection_id:job.connectionId,permission_revision:job.permissionRevision};
const query=async(sql,args=[])=>{
 const q=sql.replace(/\s+/g,' ').trim();queries.push(q);
 if(['BEGIN','COMMIT','ROLLBACK'].includes(q))return {rowCount:0,rows:[]};
 if(q.startsWith('SELECT g.* FROM lr_gold_pro_share_guest_jobs g')){
  return slot?{rowCount:0,rows:[]}:
   {rowCount:1,rows:[savedRow]};
 }
 if(q.startsWith('SELECT p.payload_sha256,p.sealed_payload')){
  const row=payloads.get(args[0]);
  const admitted=args[1]===true?slot===true:slot===false;
  return (admitted&&row)?{rowCount:1,rows:[{
   payload_sha256:row.hash,sealed_payload:row.sealed}]}:
   {rowCount:0,rows:[]};
 }
 if(q.startsWith('SELECT payload_sha256 FROM lr_gold_pro_share_guest_payloads')){
  const x=payloads.get(args[0]);
  return {rowCount:x?1:0,rows:x?[{payload_sha256:x.hash}]:[]};
 }
 if(q.startsWith('INSERT INTO lr_gold_pro_share_guest_payloads')){
  payloads.set(args[0],{hash:args[3],sealed:JSON.parse(args[4])});
  return {rowCount:1,rows:[]};
 }
 throw Error('unexpected fixture SQL '+q.slice(0,95));
};
const pool={query,connect:async()=>({query,release(){}})};
const args={pool,key,env:{
 LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1',
 LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',LR_GOLD_PRO_SHARE_GUEST_BIND:'1',
 LR_GOLD_PRO_SHARE_GUEST_PAYLOAD_STAGE:'1'},
 authorizePrincipal:async opaque=>identityOK&&opaque==='oauth-cap'?
 {verified:true,accountId:'guest1',agentId:job.agentId}:null,
 loadTrustedJob:async id=>active&&id===job.jobId?job:null,
 validateFreshAuthority:async row=>authorityOK&&row.jobId===job.jobId
};
const stage=new GoldProShareGuestIntentPg(args);
await assert.rejects(stage.stage({opaquePrincipal:'wrong',jobId:job.jobId,payload}),
 /guest_intent_oauth_required/);
await assert.rejects(stage.stage({opaquePrincipal:'oauth-cap',
 jobId:job.jobId,payload:{...payload,script:''}}),
 /guest_payload_process_contract_denied/);
const first=await stage.stage({opaquePrincipal:'oauth-cap',jobId:job.jobId,payload});
assert.equal(first.staged,true);
assert.equal(first.executable,false);
assert.equal(first.reused,false);
assert.equal(first.payloadSha256,hash);
const stored=payloads.get(job.jobId);
assert.ok(stored);
assert.ok(!JSON.stringify(stored.sealed).includes('printf hello'));
assert.deepEqual(codec.open({job,sealed:stored.sealed}),payload);
const loaded=await stage.loadTrustedIntent(job.jobId);
assert.equal(loaded.jobId,job.jobId);
assert.equal(loaded.ownerAccountId,'owner1');
assert.equal(loaded.actorAccountId,'guest1');
assert.equal(loaded.permissionRevision,9);
assert.deepEqual(loaded.command,payload);
assert.equal(loaded.payloadSha256,hash);
const again=await stage.stage({opaquePrincipal:'oauth-cap',jobId:job.jobId,payload});
assert.equal(again.reused,true);
await assert.rejects(stage.stage({opaquePrincipal:'oauth-cap',
 jobId:job.jobId,payload:{...payload,script:'echo something else'}}),
 /guest_intent_payload_replay_conflict/);
authorityOK=false;
await assert.rejects(stage.stage({opaquePrincipal:'oauth-cap',jobId:job.jobId,payload}),
 /guest_intent_current_authority_denied/);
authorityOK=true;slot=true;
await assert.rejects(stage.stage({opaquePrincipal:'oauth-cap',jobId:job.jobId,payload}),
 /guest_intent_queue_no_longer_admissible/);
assert.equal(await stage.loadTrustedIntent(job.jobId),null,
 'reserved slot must be invisible without exact slot evidence');
const exactSlot={jobId:job.jobId,operationId:job.operationId,
 ownerAccountId:job.ownerAccountId,guestAccountId:job.actorAccountId,
 deviceId:job.deviceId,grantId:job.grantId,connectionId:job.connectionId};
assert.deepEqual((await stage.loadTrustedIntent(job.jobId,{reservedSlot:exactSlot})).command,payload);
await assert.rejects(stage.loadTrustedIntent(job.jobId,{reservedSlot:{
 ...exactSlot,guestAccountId:'other'}}),
 /guest_intent_reserved_slot_scope_invalid/);
slot=false;active=false;
await assert.rejects(stage.stage({opaquePrincipal:'oauth-cap',jobId:job.jobId,payload}),
 /guest_intent_queue_actor_mismatch/);
assert.equal(payloads.size,1,'no extra payload rows after denials');
assert.ok(queries.some(q=>q.startsWith('SELECT g.* FROM lr_gold_pro_share_guest_jobs g')));
const disabled=new GoldProShareGuestIntentPg({...args,env:{}});
await assert.rejects(disabled.stage({opaquePrincipal:'oauth-cap',jobId:job.jobId,payload}),
 /guest_intent_staging_disabled/);
console.log('GOLD_P2I4C3C_ENCRYPTED_GUEST_PAYLOAD_DIGEST_BOUND_TO_IMMUTABLE_JOB=PASS');
console.log('GOLD_P2I4C3C_OAUTH_REVOCATION_REPLAY_POST_SLOT_STAGING_DENIED=PASS');
console.log('GOLD_P2I4C3C_NO_OS_COMMAND_NO_GUEST_READY_FROM_PAYLOAD=PASS');
