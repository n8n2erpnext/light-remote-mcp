// Gold P2-I4C3b. Server-created, PostgreSQL-authoritative Guest queue.
// Not exposed on plugin routes. A caller-supplied "verified-oauth" label,
// owner, agent, grant or bill-to identity is NEVER an authority.
import crypto from 'node:crypto';
import {stableGoldV2AgentId} from '../lib/gold-ab-v2-helper-proof.mjs';

export class GoldProShareGuestQueueError extends Error{
 constructor(code,status=403){super(code);this.name='GoldProShareGuestQueueError';this.status=status;}
}
const fail=(reason,status=403)=>{throw new GoldProShareGuestQueueError(reason,status)};
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const KEY=/^[a-f0-9]{32}$/;
const id=(v,reason)=>{if(typeof v!=='string'||!ID.test(v))fail(reason,400);return v};
const normalizeCaps=xs=>{
 if(!Array.isArray(xs)||xs.length>32||xs.some(x=>typeof x!=='string'||!/^[A-Za-z0-9._:-]{1,80}$/.test(x)))
  fail('guest_queue_invalid_capabilities',400);
 return [...new Set(xs)].sort();
};
const toJob=r=>Object.freeze({
 jobId:r.job_id,identitySource:'verified-oauth',state:r.state,
 actorAccountId:r.guest_account_id,agentId:r.agent_id,deviceId:r.device_id,
 grantId:r.grant_id,ownerAccountId:r.owner_account_id,
 connectionId:r.connection_id,operationId:r.operation_id,operation:r.operation,
 requiredCapabilities:Object.freeze([...(r.required_capabilities||[])]),
 permissionRevision:Number(r.permission_revision),clientSessionId:r.client_session_id
});
export class GoldProShareGuestQueuePg{
 constructor({pool,env=process.env,authenticateOAuth,loadFreshContext,
  accountActive,guestVerifiedFree,store,accessGrants,agentClients,now=Date.now}={}){
  if(!pool?.connect||!pool?.query)fail('guest_queue_pg_unavailable',503);
  this.enabled=env.LR_GOLD_PRO_SHARE_GUEST_QUEUE==='1';
  if(this.enabled&&(env.LR_GOLD_PRO_SHARE_CORE!=='1'||env.LR_GOLD_PRO_SHARE_GUEST_SLOTS!=='1'))
   fail('guest_queue_prerequisites_disabled',503);
  this.pool=pool;this.authenticateOAuth=authenticateOAuth;
  this.loadFreshContext=loadFreshContext;this.accountActive=accountActive;
  this.guestVerifiedFree=guestVerifiedFree;
  this.store=store;this.accessGrants=accessGrants;
  this.agentClients=agentClients;this.now=now;
  if(this.enabled&&(
   typeof authenticateOAuth!=='function'||typeof loadFreshContext!=='function'||
   typeof accountActive!=='function'||typeof guestVerifiedFree!=='function'||
   typeof store?.authorizeOperation!=='function'||
   typeof accessGrants?.assert!=='function'||typeof agentClients?.findActive!=='function'
  ))fail('guest_queue_dependencies_missing',503);
 }
 _enabled(){if(!this.enabled)fail('guest_queue_disabled',404)}
 async _tx(fn){
  const client=await this.pool.connect();let tx=false;
  try{await client.query('BEGIN');tx=true;
   const out=await fn(client);
   await client.query('COMMIT');tx=false;return out;
  }catch(e){if(tx)await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
 }
 // opaqueOAuthContext must be authenticated by plugin OAuth middleware,
 // NOT accepted directly as a caller-supplied {accountId,clientId} object.
 async enqueue({opaqueOAuthContext,deviceId,requestKey,operation,
  requiredCapabilities=[]}={}){
  this._enabled();
  const device=id(deviceId,'guest_queue_device_invalid');
  if(!KEY.test(String(requestKey||'')))fail('guest_queue_request_key_invalid',400);
  const caps=normalizeCaps(requiredCapabilities);
  const actor=await this.authenticateOAuth(opaqueOAuthContext);
  if(!actor||actor.verified!==true||typeof actor.accountId!=='string'||
     typeof actor.clientId!=='string')fail('guest_queue_verified_oauth_required',401);
  const guest=id(actor.accountId,'guest_queue_oauth_actor_invalid');
  const agent=stableGoldV2AgentId(actor);
  if(!this.accountActive(guest)||!this.guestVerifiedFree(guest))
   fail('guest_queue_verified_free_actor_required');
  const current=await this.loadFreshContext(device);
  if(!current?.device||current.device.deviceId!==device||
     !current?.connection||current.connection.deviceId!==device||
     current.connection.accountId!==current.device.accountId||
     current.device.accountId===guest||current.device.nodeId!==current.nodeId)
   fail('guest_queue_fresh_owner_route_required',403);
  const client=this.agentClients.findActive({accountId:guest,agentId:agent,touch:false});
  const binding=client?.bindings?.find(b=>b.deviceId===device);
  // These are native AgentClient bindings created ONLY by verified owner B,
  // never a caller-provided clientSessionId, default device, or grant ID.
  if(!binding||binding.grantPurpose!=='pro-share-guest'||
     binding.connectionId!==current.connection.connectionId)
   fail('guest_queue_independent_agent_binding_required');
  const grantId=id(binding.grantId,'guest_queue_grant_invalid');
  const authority=await this.store.authorizeOperation({
   authenticatedActorAccountId:guest,authenticatedAgentId:agent,
   device:current.device,connection:current.connection,grantId,
   accessGrants:this.accessGrants,operation,requiredCapabilities:caps,
   approvedCapabilities:current.approvedCapabilities,
   routeCapabilities:current.routeCapabilities
  });
  if(authority.actorAccountId!==guest||authority.agentId!==agent||
     authority.grantId!==grantId||authority.deviceId!==device||
     authority.billedAccountId!==current.device.accountId||
     authority.connectionId!==current.connection.connectionId||
     !Number.isSafeInteger(authority.permissionRevision)||
     authority.accessExpiresAt<=this.now())
   fail('guest_queue_authority_mismatch');
  const jobId=crypto.randomUUID();
  const opId='guestop_'+crypto.randomUUID();
  const owner=id(authority.billedAccountId,'guest_queue_owner_invalid');
  return this._tx(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    ['lr_gold_pro_share_guest_queue:'+guest+':'+agent]);
   const previous=await db.query(`SELECT * FROM lr_gold_pro_share_guest_jobs
     WHERE guest_account_id=$1 AND agent_id=$2 AND request_key=$3 FOR UPDATE`,
    [guest,agent,requestKey]);
   if(previous.rowCount){
    const row=previous.rows[0];
    if(row.device_id!==device||row.operation!==operation||
       JSON.stringify([...(row.required_capabilities||[])].sort())!==JSON.stringify(caps))
     fail('guest_queue_request_replay_conflict',409);
    return Object.freeze({job:toJob(row),reused:true});
   }
   const pending=await db.query(
    "SELECT count(*)::int AS n FROM lr_gold_pro_share_guest_jobs WHERE guest_account_id=$1 AND state='queued'",
    [guest]);
   if(Number(pending.rows?.[0]?.n)>=16)fail('guest_queue_capacity_reached',429);
   // Recheck entitlement and scope while the immutable job is created.
   // Dispatch gate independently checks again after any queue delay.
   const last=await this.store.authorizeOperation({
    authenticatedActorAccountId:guest,authenticatedAgentId:agent,
    device:current.device,connection:current.connection,grantId,
    accessGrants:this.accessGrants,operation,requiredCapabilities:caps,
    approvedCapabilities:current.approvedCapabilities,
    routeCapabilities:current.routeCapabilities
   });
   if(last.permissionRevision!==authority.permissionRevision||
      last.connectionId!==authority.connectionId||
      last.billedAccountId!==owner)
    fail('guest_queue_permission_changed',409);
   const inserted=await db.query(`INSERT INTO lr_gold_pro_share_guest_jobs
     (job_id,operation_id,request_key,owner_account_id,guest_account_id,
      agent_id,client_session_id,device_id,grant_id,connection_id,operation,
      required_capabilities,permission_revision,state)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13,'queued')
     RETURNING *`,
    [jobId,opId,requestKey,owner,guest,agent,client.clientSessionId,
     device,grantId,authority.connectionId,operation,caps,authority.permissionRevision]);
   if(inserted.rowCount!==1)fail('guest_queue_pg_insert_failed',503);
   return Object.freeze({job:toJob(inserted.rows[0]),reused:false});
  });
 }
 // Intended ONLY for injection as dispatchGate.loadTrustedJob.
 // It never materializes actor/owner/billing scope from caller JSON.
 async loadTrustedJob(jobId){
  this._enabled();
  const jid=id(jobId,'guest_queue_job_invalid');
  const row=await this.pool.query(
   'SELECT * FROM lr_gold_pro_share_guest_jobs WHERE job_id=$1',[jid]);
  if(row.rowCount!==1)return null;
  const job=toJob(row.rows[0]);
  if(job.state!=='queued')return job;
  if(!this.accountActive(job.actorAccountId)||
     !this.guestVerifiedFree(job.actorAccountId))return null;
  // Recheck native binding on every read so an old queued Guest job cannot
  // outlive a revoked/rebound OAuth AgentClient or connection.
  let current;
  try{current=this.agentClients.findActive({
   accountId:job.actorAccountId,agentId:job.agentId,touch:false});}
  catch{return null}
  const binding=current?.bindings?.find(x=>x.deviceId===job.deviceId);
  if(current.clientSessionId!==job.clientSessionId||
     binding?.grantId!==job.grantId||
     binding?.grantPurpose!=='pro-share-guest'||
     binding?.connectionId!==job.connectionId)
   return null;
  return job;
 }
 async cancelQueued({jobId,opaqueOAuthContext}={}){
  this._enabled();
  const identity=await this.authenticateOAuth(opaqueOAuthContext);
  if(identity?.verified!==true)fail('guest_queue_verified_oauth_required',401);
  const guest=id(identity.accountId,'guest_queue_actor_invalid'),
   agent=stableGoldV2AgentId(identity),
   jid=id(jobId,'guest_queue_job_invalid');
  const row=await this.pool.query(`UPDATE lr_gold_pro_share_guest_jobs
    SET state='cancelled',updated_at=clock_timestamp()
    WHERE job_id=$1 AND guest_account_id=$2 AND agent_id=$3
      AND state='queued'
      AND NOT EXISTS(SELECT 1 FROM lr_gold_pro_share_guest_slots s
        WHERE s.job_id=lr_gold_pro_share_guest_jobs.job_id)
    RETURNING job_id`,[jid,guest,agent]);
  return Object.freeze({cancelled:row.rowCount===1});
 }
}
