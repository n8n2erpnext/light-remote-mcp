// Gold P2-I4C3c: immutable, encrypted, job-scoped Guest process intent.
// Staging is NOT execution. No caller-provided account/job authority is
// trusted: live job is loaded from PG and must survive fresh OAuth/B checks.
import crypto from 'node:crypto';
import {goldAbV2HelperKey} from '../lib/gold-ab-v2-helper-proof.mjs';
import {goldGuestIntentHash,normalizeGoldGuestProcessIntent} from '../lib/gold-pro-share-guest-process-contract.mjs';
export {goldGuestIntentHash,normalizeGoldGuestProcessIntent} from '../lib/gold-pro-share-guest-process-contract.mjs';
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const SHA=/^[a-f0-9]{64}$/;
const DENY=(code,status=403)=>{const e=Error(code);e.status=status;throw e};
function aadFor(job){
 const keys=['jobId','actorAccountId','ownerAccountId','agentId',
  'deviceId','grantId','connectionId','operationId','permissionRevision'];
 if(!job||keys.some(k=>!ID.test(String(job[k]||'')))||
   job.operation!=='process'||!Array.isArray(job.requiredCapabilities)||
   !job.requiredCapabilities.length)DENY('guest_intent_trusted_job_required',403);
 return JSON.stringify(['gold-guest-intent-v1',...keys.map(k=>job[k]),
  [...job.requiredCapabilities].sort()]);
}
export function createGoldGuestIntentCodec({key}={}){
 if(!Buffer.isBuffer(key)||key.length!==32)DENY('guest_intent_key_invalid',503);
 const secret=crypto.createHmac('sha256',key)
  .update('light-remote:gold-pro-share:guest-payload-aes-v1').digest();
 return Object.freeze({
  seal({job,payload}){
   const normalized=normalizeGoldGuestProcessIntent(payload);
   const aad=aadFor(job),iv=crypto.randomBytes(12);
   const cipher=crypto.createCipheriv('aes-256-gcm',secret,iv);
   cipher.setAAD(Buffer.from(aad));
   const ct=Buffer.concat([cipher.update(JSON.stringify(normalized)),cipher.final()]);
   return Object.freeze({format:'gpi1',iv:iv.toString('base64url'),
    ct:ct.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),
    sha256:goldGuestIntentHash(normalized)});
  },
  open({job,sealed}){
   if(!sealed||sealed.format!=='gpi1'||!SHA.test(sealed.sha256||''))
    DENY('guest_intent_sealed_invalid',403);
   const textFields=['iv','ct','tag'];
   if(textFields.some(k=>typeof sealed[k]!=='string'||
      !/^[A-Za-z0-9_-]+$/.test(sealed[k])||
      sealed[k].length>16000))DENY('guest_intent_sealed_invalid',403);
   let plain;
   try{
    const iv=Buffer.from(sealed.iv,'base64url'),
     tag=Buffer.from(sealed.tag,'base64url');
    if(iv.length!==12||tag.length!==16)
     DENY('guest_intent_sealed_invalid',403);
    const c=crypto.createDecipheriv('aes-256-gcm',secret,iv);
    c.setAAD(Buffer.from(aadFor(job)));c.setAuthTag(tag);
    plain=Buffer.concat([c.update(Buffer.from(sealed.ct,'base64url')),
     c.final()]).toString('utf8');
   }catch{DENY('guest_intent_integrity_denied',403)}
   let p;
   try{p=normalizeGoldGuestProcessIntent(JSON.parse(plain))}
   catch{DENY('guest_intent_integrity_denied',403)}
   if(goldGuestIntentHash(p)!==sealed.sha256)
    DENY('guest_intent_hash_mismatch',403);
   return p;
  }
 });
}
// The only durable staging write uses the actual queued PG identity.
// A trusted caller must supply an opaque OAuth principal validated by the
// injected authorizePrincipal callback, never an MCP accountId parameter.
export class GoldProShareGuestIntentPg {
 constructor({pool,env=process.env,loadTrustedJob,authorizePrincipal,
  validateFreshAuthority,key=goldAbV2HelperKey(env)}={}){
  if(!pool?.connect)DENY('guest_intent_pg_required',503);
  this.enabled=env.LR_GOLD_PRO_SHARE_GUEST_PAYLOAD_STAGE==='1';
  if(this.enabled&&['LR_GOLD_PRO_SHARE_CORE','LR_GOLD_PRO_SHARE_GUEST_QUEUE',
   'LR_GOLD_PRO_SHARE_GUEST_SLOTS','LR_GOLD_PRO_SHARE_GUEST_BIND'].some(k=>env[k]!=='1'))
   DENY('guest_intent_prerequisites_off',503);
  if(this.enabled&&[loadTrustedJob,authorizePrincipal,validateFreshAuthority]
   .some(f=>typeof f!=='function'))DENY('guest_intent_authority_missing',503);
  this.pool=pool;this.loadTrustedJob=loadTrustedJob;
  this.authorizePrincipal=authorizePrincipal;
  this.validateFreshAuthority=validateFreshAuthority;
  this.codec=this.enabled?createGoldGuestIntentCodec({key}):null;
 }
 // Can only be called by the trusted Operator dispatch adapter. It
 // loads fresh queue identity from PG, rechecks Grant/connection/revision
 // via injected authority and authenticates encrypted AAD before returning
 // the private script to an independent Guest-capable Agent lane.
 async loadTrustedIntent(jobId,{reservedSlot=null}={}){
  if(!this.enabled)DENY('guest_intent_staging_disabled',404);
  if(!ID.test(jobId||''))DENY('guest_intent_job_invalid',400);
  const job=await this.loadTrustedJob(jobId);
  if(!job||job.state!=='queued'||job.operation!=='process'||
     await this.validateFreshAuthority(job)!==true)
   DENY('guest_intent_current_authority_denied',403);
  // Phase one has NO slot. Phase two is legal only with the exact PG
  // RESERVED slot of this same job; never accept UNKNOWN/submitted.
  const slotScoped=reservedSlot!==null;
  if(slotScoped&&[
    ['jobId',job.jobId],['operationId',job.operationId],
    ['ownerAccountId',job.ownerAccountId],
    ['guestAccountId',job.actorAccountId],['deviceId',job.deviceId],
    ['grantId',job.grantId],['connectionId',job.connectionId]
   ].some(([k,value])=>reservedSlot?.[k]!==value))
   DENY('guest_intent_reserved_slot_scope_invalid',403);
  const result=await this.pool.query(`SELECT p.payload_sha256,p.sealed_payload
    FROM lr_gold_pro_share_guest_payloads p
    JOIN lr_gold_pro_share_guest_jobs g
      ON g.job_id=p.job_id AND g.operation_id=p.operation_id
       AND g.guest_account_id=p.guest_account_id
    WHERE p.job_id=$1 AND g.state='queued'
      AND (
       ($2::boolean=false AND NOT EXISTS(
         SELECT 1 FROM lr_gold_pro_share_guest_slots s WHERE s.job_id=g.job_id))
       OR ($2::boolean=true AND EXISTS(
         SELECT 1 FROM lr_gold_pro_share_guest_slots s
         WHERE s.job_id=g.job_id AND s.operation_id=g.operation_id
          AND s.owner_account_id=g.owner_account_id
          AND s.guest_account_id=g.guest_account_id
          AND s.device_id=g.device_id AND s.grant_id=g.grant_id
          AND s.connection_id=g.connection_id AND s.state='reserved'))
      )
    LIMIT 2`,[jobId,slotScoped]);
  if(result.rowCount!==1)return null;
  const row=result.rows[0],command=this.codec.open({
   job,sealed:row.sealed_payload});
  if(row.payload_sha256!==goldGuestIntentHash(command))
   DENY('guest_intent_pg_hash_changed',409);
  return Object.freeze({
   jobId,ownerAccountId:job.ownerAccountId,
   actorAccountId:job.actorAccountId,agentId:job.agentId,
   deviceId:job.deviceId,grantId:job.grantId,
   connectionId:job.connectionId,operationId:job.operationId,
   permissionRevision:job.permissionRevision,
   payloadSha256:row.payload_sha256,operation:job.operation,
   command
  });
 }
 async stage({opaquePrincipal,jobId,payload}={}){
  if(!this.enabled)DENY('guest_intent_staging_disabled',404);
  if(!ID.test(jobId||''))DENY('guest_intent_job_invalid',400);
  const identity=await this.authorizePrincipal(opaquePrincipal);
  if(!identity?.verified||!ID.test(identity.accountId||'')||
     !ID.test(identity.agentId||''))DENY('guest_intent_oauth_required',401);
  const job=await this.loadTrustedJob(jobId);
  if(!job||job.state!=='queued'||job.actorAccountId!==identity.accountId||
     job.agentId!==identity.agentId||job.operation!=='process')
   DENY('guest_intent_queue_actor_mismatch',403);
  if(await this.validateFreshAuthority(job)!==true)
   DENY('guest_intent_current_authority_denied',403);
  const normalized=normalizeGoldGuestProcessIntent(payload);
  const hash=goldGuestIntentHash(normalized);
  const sealed=this.codec.seal({job,payload:normalized});
  const db=await this.pool.connect();let begun=false;
  try{
   await db.query('BEGIN');begun=true;
   const match=await db.query(`SELECT g.* FROM lr_gold_pro_share_guest_jobs g
    WHERE g.job_id=$1 AND g.state='queued'
      AND NOT EXISTS(SELECT 1 FROM lr_gold_pro_share_guest_slots s
        WHERE s.job_id=g.job_id)
    FOR UPDATE`,[jobId]);
   if(match.rowCount!==1)DENY('guest_intent_queue_no_longer_admissible',409);
   const r=match.rows[0];
   if(r.operation_id!==job.operationId||r.owner_account_id!==job.ownerAccountId||
      r.guest_account_id!==job.actorAccountId||r.agent_id!==job.agentId||
      r.device_id!==job.deviceId||r.grant_id!==job.grantId||
      r.connection_id!==job.connectionId||
      Number(r.permission_revision)!==job.permissionRevision)
    DENY('guest_intent_queue_scope_changed',409);
   const old=await db.query(
    'SELECT payload_sha256 FROM lr_gold_pro_share_guest_payloads WHERE job_id=$1',
    [jobId]);
   let reused=false;
   if(old.rowCount){
    if(old.rows[0].payload_sha256!==hash)
     DENY('guest_intent_payload_replay_conflict',409);
    reused=true;
   }else{
    const inserted=await db.query(`INSERT INTO lr_gold_pro_share_guest_payloads
     (job_id,operation_id,guest_account_id,payload_sha256,sealed_payload)
     VALUES($1,$2,$3,$4,$5::jsonb)`,
     [jobId,job.operationId,job.actorAccountId,hash,JSON.stringify(sealed)]);
    if(inserted.rowCount!==1)DENY('guest_intent_pg_write_failed',503);
   }
   await db.query('COMMIT');begun=false;
   return Object.freeze({staged:true,reused,jobId,payloadSha256:hash,
    executable:false});
  }catch(e){if(begun)await db.query('ROLLBACK').catch(()=>{});throw e}
  finally{db.release()}
 }
}
