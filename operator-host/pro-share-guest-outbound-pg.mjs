// Gold P2-I4C3c2b2: exactly one short-lived signed Guest command and
// the already-issued M4 execution epoch. SOURCE ONLY, no public/tool route.
// PostgreSQL PREPARED -> UNKNOWN is irrevocable before any Fleet enqueue.
// Never retry or re-sign an ambiguous effect after Operator restart.
import crypto from 'node:crypto';
import {devicePayloadSha256} from '../lib/device-proof.mjs';
import {goldGuestIntentHash,normalizeGoldGuestProcessIntent}
 from '../lib/gold-pro-share-guest-process-contract.mjs';
import {createGoldGuestDeviceTicketIssuer}
 from '../lib/gold-pro-share-guest-device-ticket.mjs';

const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const CMD=/^cmd_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const fail=(code,status=409)=>{const e=Error(code);e.status=status;throw e};
const ms=v=>v instanceof Date?v.getTime():Date.parse(String(v));
export class GoldGuestSignedOutboundPg{
 constructor({pool,env=process.env,signer,
  assertFreshAuthority,now=Date.now,randomUUID=crypto.randomUUID}={}){
  if(!pool?.connect)fail('guest_outbound_pg_required',503);
  this.enabled=env.LR_GOLD_PRO_SHARE_GUEST_OUTBOUND_PREPARE==='1';
  if(this.enabled&&[
   'LR_GOLD_PRO_SHARE_CORE','LR_GOLD_PRO_SHARE_GUEST_SLOTS',
   'LR_GOLD_PRO_SHARE_GUEST_QUEUE','LR_GOLD_PRO_SHARE_GUEST_PAYLOAD_STAGE',
   'LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE','LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL',
   'LR_GOLD_PRO_SHARE_GUEST_TICKET_ISSUE'
  ].some(k=>env[k]!=='1'))fail('guest_outbound_dependencies_off',503);
  if(this.enabled&&(
   env.OPERATOR_EXECUTION_EPOCH_ENABLED!=='1'||
   !signer?.privateKey||!signer?.publicEncoded||
   typeof assertFreshAuthority!=='function'))
   fail('guest_outbound_epoch_signer_or_authority_missing',503);
  if(this.enabled){
   const encoded=crypto.createPublicKey(signer.privateKey).export({
    format:'der',type:'spki'}).toString('base64');
   if(encoded!==signer.publicEncoded)
    fail('guest_outbound_enrollment_signer_mismatch',503);
  }
  this.pool=pool;this.now=now;this.randomUUID=randomUUID;
  this.signerPublicKey=signer?.publicEncoded||null;
  this.assertFreshAuthority=assertFreshAuthority;
  this.issuer=this.enabled?createGoldGuestDeviceTicketIssuer({
   env,now,assertFreshAuthority,
   sign:async bytes=>crypto.sign(null,bytes,signer.privateKey)}):null;
 }
 _on(){if(!this.enabled)fail('guest_outbound_prepare_disabled',404)}
 async _tx(callback){
  const db=await this.pool.connect();let started=false;
  try{
   await db.query('BEGIN');started=true;
   const value=await callback(db);
   await db.query('COMMIT');started=false;return value;
  }catch(error){
   if(started)await db.query('ROLLBACK').catch(()=>{});
   throw error;
  }finally{db.release()}
 }
 async prepare({jobId,processIntent}={}){
  this._on();
  if(!UUID.test(jobId||''))fail('guest_outbound_job_uuid_required',400);
  const commandIntent=normalizeGoldGuestProcessIntent(processIntent);
  const digest=goldGuestIntentHash(commandIntent),at=this.now();
  return this._tx(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    ['lr_gold_pro_share_guest_slot:'+jobId]);
   const r=await db.query(`SELECT g.job_id,g.operation_id,g.owner_account_id,
    g.guest_account_id,g.device_id,g.agent_id,g.connection_id,
    g.grant_id,g.permission_revision,g.required_capabilities,g.operation,
    g.state AS queue_state,s.state AS slot_state,
    p.payload_sha256 AS intent_sha,
    w.state AS m4_state,j.account_id AS ledger_owner,
    j.status AS ledger_status,j.public_view AS ledger_view,
    c.account_id AS claim_owner,c.worker_state AS claim_state,
    c.process_id AS claim_process_id,
    e.account_id AS epoch_owner,e.connection_id AS epoch_connection,
    e.epoch AS execution_epoch,e.inventory_at AS inventory_at,
    a.revision AS share_revision,a.state AS addon_state,
    a.valid_until_ms AS addon_expires,
    se.status AS seat_status,sh.device_id AS shared_device,
    ab.purpose AS grant_purpose,ab.closed_at AS grant_closed,
    ab.expires_at AS grant_expires,
    ab.absolute_expires_at AS grant_absolute_expires,
    cn.account_id AS connection_owner,
    cn.closed_at AS connection_closed,
    cn.hard_expires_at AS connection_expires
    FROM lr_gold_pro_share_guest_jobs g
    JOIN lr_gold_pro_share_guest_slots s
      ON s.job_id=g.job_id AND s.operation_id=g.operation_id
      AND s.owner_account_id=g.owner_account_id
      AND s.guest_account_id=g.guest_account_id
      AND s.device_id=g.device_id AND s.grant_id=g.grant_id
      AND s.connection_id=g.connection_id
    JOIN lr_gold_pro_share_guest_payloads p
      ON p.job_id=g.job_id AND p.operation_id=g.operation_id
      AND p.guest_account_id=g.guest_account_id
    JOIN lr_gold_personal_agent_work w ON w.job_id=g.job_id
      AND w.account_id=g.owner_account_id AND w.device_id=g.device_id
    JOIN lr_gold_job_records j ON j.job_id=g.job_id
      AND j.account_id=g.owner_account_id AND j.device_id=g.device_id
    JOIN lr_gold_device_resource_claims c ON c.job_id=g.job_id
      AND c.account_id=g.owner_account_id AND c.device_id=g.device_id
    JOIN lr_gold_device_execution_epochs e ON e.device_id=g.device_id
    JOIN lr_gold_pro_share_addons a ON a.owner_account_id=g.owner_account_id
    JOIN lr_gold_pro_share_seats se
      ON se.owner_account_id=g.owner_account_id
      AND se.guest_account_id=g.guest_account_id
    JOIN lr_gold_pro_share_devices sh
      ON sh.owner_account_id=g.owner_account_id AND sh.device_id=g.device_id
    JOIN lr_ab_grants ab
      ON ab.grant_id=g.grant_id AND ab.account_id=g.guest_account_id
      AND ab.device_id=g.device_id AND ab.connection_id=g.connection_id
    JOIN lr_device_connections cn ON cn.connection_id=g.connection_id
      AND cn.device_id=g.device_id
    WHERE g.job_id=$1
    FOR UPDATE OF g,s,w,j,c,e,a,se,ab,cn`,[jobId]);
   if(r.rowCount!==1)fail('guest_outbound_canonical_rows_missing',403);
   const x=r.rows[0],ledger=x.ledger_view||{};
   if(x.job_id!==jobId||x.operation!=='process'||
      x.queue_state!=='unknown'||x.slot_state!=='unknown'||
      x.m4_state!=='unknown'||x.ledger_status!=='running'||
      x.ledger_owner!==x.owner_account_id||
      ledger.guestScope?.purpose!=='pro-share-guest'||
      ledger.guestScope?.guestAccountId!==x.guest_account_id||
      ledger.guestScope?.grantId!==x.grant_id||
      ledger.guestScope?.connectionId!==x.connection_id||
      Number(ledger.guestScope?.permissionRevision)!==Number(x.permission_revision)||
      ledger.guestScope?.payloadSha256!==digest||
      x.intent_sha!==digest||x.claim_owner!==x.owner_account_id||
      x.claim_state!=='admitting'||x.claim_process_id!=null||
      x.epoch_owner!==x.owner_account_id||
      x.epoch_connection!==x.connection_id||x.inventory_at==null||
      !/^[1-9][0-9]{0,18}$/.test(String(x.execution_epoch))||
      x.share_revision==null||
      Number(x.share_revision)!==Number(x.permission_revision)||
      !['trial','active'].includes(x.addon_state)||
      Number(x.addon_expires)<=at||
      x.seat_status!=='accepted'||x.shared_device!==x.device_id||
      x.grant_purpose!=='pro-share-guest'||x.grant_closed!=null||
      ms(x.grant_expires)<=at||ms(x.grant_absolute_expires)<=at||
      x.connection_owner!==x.owner_account_id||
      x.connection_closed!=null||ms(x.connection_expires)<=at||
      !Array.isArray(x.required_capabilities)||
      !x.required_capabilities.includes('filesystem'))
    fail('guest_outbound_fresh_pg_b_epoch_m4_denied',403);
   const job=Object.freeze({
    jobId:x.job_id,operationId:x.operation_id,
    ownerAccountId:x.owner_account_id,
    actorAccountId:x.guest_account_id,agentId:x.agent_id,
    deviceId:x.device_id,connectionId:x.connection_id,
    grantId:x.grant_id,permissionRevision:Number(x.permission_revision),
    requiredCapabilities:[...x.required_capabilities],state:'unknown',
    operation:'process'});
   const fresh=await this.assertFreshAuthority(job);
   if(fresh?.verifiedB!==true||
      fresh?.ownerShareActive!==true||
      fresh?.deviceOwnerAccountId!==job.ownerAccountId||
      fresh?.guestAccountId!==job.actorAccountId||
      fresh?.grantId!==job.grantId||
      fresh?.agentId!==job.agentId||
      fresh?.connectionId!==job.connectionId||
      Number(fresh.permissionRevision)!==job.permissionRevision||
      !Number.isSafeInteger(fresh.devicePolicyRevision)||
      fresh.devicePolicyRevision<1||
      fresh.guestDeviceProtocol!=='signed-pro-share-guest-v1'||
      fresh.deviceSignerPublicKey!==this.signerPublicKey)
    fail('guest_outbound_live_authority_denied',403);
   const commandId='cmd_'+this.randomUUID();
   if(!CMD.test(commandId))fail('guest_outbound_command_id_invalid',503);
   const ticketEnvelope=await this.issuer.issue({
    job,slot:{state:'unknown',jobId:job.jobId,
     operationId:job.operationId,ownerAccountId:job.ownerAccountId,
     guestAccountId:job.actorAccountId,deviceId:job.deviceId,
     grantId:job.grantId,connectionId:job.connectionId},
    commandId,payload:commandIntent,
    devicePolicyRevision:fresh.devicePolicyRevision});
   if(ticketEnvelope.ticket.payloadSha256!==digest||
      ticketEnvelope.ticket.commandId!==commandId||
      ticketEnvelope.ticket.jobId!==jobId)
    fail('guest_outbound_ticket_binding_invalid',503);
   const fleetPayload=Object.freeze({
    type:'guest-process-v1',ticketEnvelope,processIntent:commandIntent});
   const fleetDigest=devicePayloadSha256(fleetPayload);
   const inserted=await db.query(`INSERT INTO lr_gold_pro_share_guest_outbound
    (job_id,operation_id,owner_account_id,guest_account_id,device_id,
     grant_id,connection_id,command_id,execution_epoch,
     payload_sha256,fleet_payload_sha256,permission_revision,
     device_policy_revision,ticket_envelope,ticket_expires_at_ms)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
    RETURNING command_id`,[
    jobId,job.operationId,job.ownerAccountId,job.actorAccountId,
    job.deviceId,job.grantId,job.connectionId,commandId,
    String(x.execution_epoch),digest,fleetDigest,
    job.permissionRevision,fresh.devicePolicyRevision,
    JSON.stringify(ticketEnvelope),ticketEnvelope.ticket.expiresAt]);
   if(inserted.rowCount!==1)fail('guest_outbound_command_not_durable',503);
   return Object.freeze({
    prepared:true,jobId,commandId,ownerAccountId:job.ownerAccountId,
    deviceId:job.deviceId,connectionId:job.connectionId,
    executionEpoch:String(x.execution_epoch),
    payloadSha256:digest,fleetPayloadSha256:fleetDigest,
    ticketExpiresAt:ticketEnvelope.ticket.expiresAt,
    fleetPayload
   });
  });
 }
 async markAttempt({jobId,commandId}={}){
  this._on();
  if(!UUID.test(jobId||'')||!CMD.test(commandId||''))
   fail('guest_outbound_attempt_identifiers_invalid',400);
  return this._tx(async db=>{
   const q=await db.query(`SELECT o.job_id,o.command_id,o.owner_account_id,
     o.device_id,o.connection_id,o.guest_account_id,o.execution_epoch,
     o.fleet_payload_sha256,o.ticket_expires_at_ms,o.state,
     e.account_id AS epoch_owner,e.connection_id AS epoch_connection,
     e.epoch AS live_epoch,e.inventory_at,
     i.job_id AS issued_job,i.account_id AS issued_owner,
     i.device_id AS issued_device,i.connection_id AS issued_connection,
     i.epoch AS issued_epoch,i.payload_sha256 AS issued_digest,
     g.state AS queue_state,s.state AS slot_state,
     w.state AS m4_state,j.status AS ledger_status,
     c.worker_state AS claim_state,c.process_id AS claim_process_id,
     a.revision AS share_revision,a.state AS addon_state,
     a.valid_until_ms AS addon_expires,
     se.status AS seat_status,sh.device_id AS shared_device,
     o.permission_revision,
     ab.purpose AS grant_purpose,ab.account_id AS grant_actor,
     ab.closed_at AS grant_closed,ab.expires_at AS grant_expires,
     ab.absolute_expires_at AS grant_absolute_expires,
     cn.account_id AS connection_owner,
     cn.closed_at AS connection_closed,
     cn.hard_expires_at AS connection_expires
    FROM lr_gold_pro_share_guest_outbound o
    JOIN lr_gold_pro_share_guest_jobs g ON g.job_id=o.job_id
    JOIN lr_gold_pro_share_guest_slots s ON s.job_id=o.job_id
    JOIN lr_gold_personal_agent_work w ON w.job_id=o.job_id
      AND w.account_id=o.owner_account_id AND w.device_id=o.device_id
    JOIN lr_gold_job_records j ON j.job_id=o.job_id
      AND j.account_id=o.owner_account_id AND j.device_id=o.device_id
    JOIN lr_gold_device_resource_claims c ON c.job_id=o.job_id
      AND c.account_id=o.owner_account_id AND c.device_id=o.device_id
    JOIN lr_gold_device_execution_epochs e ON e.device_id=o.device_id
    JOIN lr_gold_execution_command_issuance i
      ON i.command_id=o.command_id
    JOIN lr_gold_pro_share_addons a ON a.owner_account_id=o.owner_account_id
    JOIN lr_gold_pro_share_seats se ON se.owner_account_id=o.owner_account_id
      AND se.guest_account_id=o.guest_account_id
    JOIN lr_gold_pro_share_devices sh
      ON sh.owner_account_id=o.owner_account_id AND sh.device_id=o.device_id
    JOIN lr_ab_grants ab ON ab.grant_id=o.grant_id
    JOIN lr_device_connections cn ON cn.connection_id=o.connection_id
    WHERE o.job_id=$1 AND o.command_id=$2
    FOR UPDATE OF o,g,s,w,j,c,e,a,se,ab,cn`,[jobId,commandId]);
   if(q.rowCount!==1)fail('guest_outbound_epoch_ticket_issuance_missing',409);
   const x=q.rows[0],at=this.now();
   if(x.state!=='prepared'||x.queue_state!=='unknown'||
      x.slot_state!=='unknown'||x.m4_state!=='unknown'||
      x.ledger_status!=='running'||x.claim_state!=='admitting'||
      x.claim_process_id!=null||x.ticket_expires_at_ms<=at+1000||
      x.epoch_owner!==x.owner_account_id||
      x.epoch_connection!==x.connection_id||x.inventory_at==null||
      String(x.live_epoch)!==String(x.execution_epoch)||
      x.issued_job!==jobId||x.issued_owner!==x.owner_account_id||
      x.issued_device!==x.device_id||
      x.issued_connection!==x.connection_id||
      String(x.issued_epoch)!==String(x.execution_epoch)||
      x.issued_digest!==x.fleet_payload_sha256||
      Number(x.share_revision)!==Number(x.permission_revision)||
      !['trial','active'].includes(x.addon_state)||
      Number(x.addon_expires)<=at||
      x.seat_status!=='accepted'||x.shared_device!==x.device_id||
      x.grant_purpose!=='pro-share-guest'||
      x.grant_actor!==x.guest_account_id||
      x.grant_closed!=null||ms(x.grant_expires)<=at||
      ms(x.grant_absolute_expires)<=at||
      x.connection_owner!==x.owner_account_id||
      x.connection_closed!=null||ms(x.connection_expires)<=at)
    fail('guest_outbound_epoch_or_permission_changed',403);
   const changed=await db.query(`UPDATE lr_gold_pro_share_guest_outbound
    SET state='unknown',attempted_at=clock_timestamp()
    WHERE job_id=$1 AND command_id=$2 AND state='prepared'
    RETURNING command_id`,[jobId,commandId]);
   if(changed.rowCount!==1)fail('guest_outbound_attempt_lost_race',409);
   return Object.freeze({attempted:true,jobId,commandId,
    ownerAccountId:x.owner_account_id,deviceId:x.device_id,
    executionEpoch:String(x.execution_epoch),
    resubmissionAllowed:false});
  });
 }
}
