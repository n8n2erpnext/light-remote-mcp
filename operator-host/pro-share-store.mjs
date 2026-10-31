// Gold P2-I4A: independently gated Pro Share persistence/policy primitive.
// SOURCE ONLY: not mounted in Operator routing or billing. A Pro Team grant
// NEVER implies a Pro Share right. Guest OAuth/A-B and queue must be wired later.
import crypto from 'node:crypto';

const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TTL=24*60*60*1000;
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const normEmail=v=>String(v||'').trim().toLowerCase();
const safe=(v,name)=>{if(!ID.test(String(v||'')))throw new ProShareError(name,400);return String(v)};
const fail=(reason,status=403)=>{throw new ProShareError(reason,status)};
export class ProShareError extends Error{
 constructor(reason,status=403){super(reason);this.name='ProShareError';this.status=status;}
}
export class GoldProShareStore {
 constructor({pool,env=process.env,now=Date.now,planFor,accountActive,
   emailFor,accountVerified}={}){
  if(!pool?.connect||!pool?.query||typeof planFor!=='function'||
     typeof accountActive!=='function'||typeof emailFor!=='function'||
     typeof accountVerified!=='function')fail('pro_share_dependencies_missing',503);
  this.pool=pool;this.now=now;this.planFor=planFor;
  this.accountActive=accountActive;this.emailFor=emailFor;
  this.accountVerified=accountVerified;
  this.enabled=env.LR_GOLD_PRO_SHARE_CORE==='1';
  this.adminUat=env.LR_GOLD_PRO_SHARE_ADMIN_UAT==='1';
 }
 _enabled(){if(!this.enabled)fail('pro_share_disabled',404)}
 _eligible(owner){
  this._enabled();
  if(!['pro','vip'].includes(String(this.planFor(owner)||'free').toLowerCase())||
     !this.accountActive(owner)||!this.accountVerified(owner))
   fail('pro_share_owner_not_eligible');
 }
 async _tx(fn){
  const client=await this.pool.connect();let inTx=false;
  try{await client.query('BEGIN');inTx=true;
   const out=await fn(client);await client.query('COMMIT');inTx=false;return out;
  }catch(error){if(inTx)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
 async _ownerRow(db,owner){
  this._eligible(owner);
  const r=await db.query('SELECT * FROM lr_gold_pro_share_addons WHERE owner_account_id=$1 FOR UPDATE',[owner]);
  const row=r.rows?.[0];
  if(!row||!['trial','active'].includes(row.state)||Number(row.valid_until_ms)<=this.now())
   fail('pro_share_addon_required');
  return row;
 }
 // Only an explicit UAT administrator may provision a trial entitlement.
 // Checkout/Paddle is deliberately absent. This is NOT a payment API.
 async grantUatEntitlement({ownerAccountId,validUntil,monthlyGuestCallBudget=5000}={}){
  this._enabled();
  if(!this.adminUat)fail('pro_share_admin_issuer_disabled',404);
  const owner=safe(ownerAccountId,'pro_share_owner_invalid'),end=Number(validUntil),
    budget=Number(monthlyGuestCallBudget);
  this._eligible(owner);
  if(!Number.isSafeInteger(end)||end<=this.now()||
     !Number.isSafeInteger(budget)||budget<1||budget>1000000)
    fail('pro_share_entitlement_invalid',400);
  return this._tx(async db=>{
   const r=await db.query(`INSERT INTO lr_gold_pro_share_addons
    (owner_account_id,state,valid_until_ms,monthly_guest_call_budget,source)
    VALUES($1,'trial',$2,$3,'explicit-uat')
    ON CONFLICT(owner_account_id) DO UPDATE SET
    state='trial',valid_until_ms=EXCLUDED.valid_until_ms,
    monthly_guest_call_budget=EXCLUDED.monthly_guest_call_budget,
    revision=lr_gold_pro_share_addons.revision+1,updated_at=now()
    RETURNING owner_account_id,valid_until_ms,monthly_guest_call_budget,revision`,
    [owner,end,budget]);
   return {...r.rows[0],active:true,paid:false};
  });
 }
 async inviteEmail({authenticatedOwnerAccountId,guestEmail}={}){
  const owner=safe(authenticatedOwnerAccountId,'pro_share_owner_invalid');
  const email=normEmail(guestEmail);
  if(!EMAIL.test(email)||email.length>254||email===normEmail(this.emailFor(owner)))
   fail('pro_share_guest_email_invalid',400);
  return this._tx(async db=>{
   await this._ownerRow(db,owner);
   const seat=await db.query('SELECT status FROM lr_gold_pro_share_seats WHERE owner_account_id=$1 FOR UPDATE',[owner]);
   if(seat.rows?.[0]?.status==='accepted')fail('pro_share_one_guest_limit',409);
   const code=crypto.randomBytes(24).toString('base64url'),expiry=this.now()+TTL;
   await db.query(`INSERT INTO lr_gold_pro_share_seats
    (owner_account_id,status,invited_email,invite_hash,invite_expires_ms)
    VALUES($1,'invited',$2,$3,$4)
    ON CONFLICT(owner_account_id) DO UPDATE SET
    status='invited',guest_account_id=NULL,invited_email=EXCLUDED.invited_email,
    invite_hash=EXCLUDED.invite_hash,invite_expires_ms=EXCLUDED.invite_expires_ms,
    accepted_at=NULL,updated_at=now()`,[owner,email,hash(code),expiry]);
   await db.query('UPDATE lr_gold_pro_share_addons SET revision=revision+1,updated_at=now() WHERE owner_account_id=$1',[owner]);
   return {ownerAccountId:owner,inviteCode:code,expiresAt:expiry,guestEmail:email,seatLimit:1};
  });
 }
 async acceptInvite({authenticatedGuestAccountId,ownerAccountId,inviteCode}={}){
  const guest=safe(authenticatedGuestAccountId,'pro_share_guest_invalid');
  const owner=safe(ownerAccountId,'pro_share_owner_invalid');
  if(guest===owner||!this.accountActive(guest)||!this.accountVerified(guest)||
     String(this.planFor(guest)||'free').toLowerCase()!=='free')
   fail('pro_share_guest_not_eligible');
  const code=String(inviteCode||'');
  if(!/^[A-Za-z0-9_-]{32}$/.test(code))fail('pro_share_invite_invalid');
  return this._tx(async db=>{
   await this._ownerRow(db,owner);
   const r=await db.query('SELECT * FROM lr_gold_pro_share_seats WHERE owner_account_id=$1 FOR UPDATE',[owner]);
   const row=r.rows?.[0],email=normEmail(this.emailFor(guest));
   if(!row||row.status!=='invited'||row.invited_email!==email||
      Number(row.invite_expires_ms)<=this.now()||
      !row.invite_hash||row.invite_hash!==hash(code))
    fail('pro_share_invite_invalid');
   await db.query(`UPDATE lr_gold_pro_share_seats
    SET status='accepted',guest_account_id=$2,invited_email=NULL,invite_hash=NULL,
    invite_expires_ms=NULL,accepted_at=now(),updated_at=now()
    WHERE owner_account_id=$1`,[owner,guest]);
   await db.query('UPDATE lr_gold_pro_share_addons SET revision=revision+1,updated_at=now() WHERE owner_account_id=$1',[owner]);
   return {ownerAccountId:owner,guestAccountId:guest,seatLimit:1,accepted:true};
  });
 }
 async shareDevice({authenticatedOwnerAccountId,deviceId}={}){
  const owner=safe(authenticatedOwnerAccountId,'pro_share_owner_invalid'),
    device=safe(deviceId,'pro_share_device_invalid');
  return this._tx(async db=>{
   await this._ownerRow(db,owner);
   const result=await db.query(`INSERT INTO lr_gold_pro_share_devices(owner_account_id,device_id)
    SELECT $1,d.device_id FROM lr_devices d
    WHERE d.device_id=$2 AND d.owner_account_id=$1 AND d.state<>'revoked'
    ON CONFLICT(owner_account_id,device_id) DO NOTHING RETURNING device_id`,[owner,device]);
   if(result.rowCount!==1){
    const already=await db.query('SELECT 1 FROM lr_gold_pro_share_devices s JOIN lr_devices d ON d.device_id=s.device_id AND d.owner_account_id=s.owner_account_id WHERE s.owner_account_id=$1 AND s.device_id=$2',[owner,device]);
    if(already.rowCount!==1)fail('pro_share_device_not_owned');
   }else await db.query('UPDATE lr_gold_pro_share_addons SET revision=revision+1,updated_at=now() WHERE owner_account_id=$1',[owner]);
   return {ownerAccountId:owner,deviceId:device,shared:true};
  });
 }
 async revoke({authenticatedOwnerAccountId,deviceId=null,removeGuest=false}={}){
  const owner=safe(authenticatedOwnerAccountId,'pro_share_owner_invalid');
  if(!removeGuest&&!deviceId)fail('pro_share_revoke_target_missing',400);
  return this._tx(async db=>{
   // Cleanup must remain available after lapse/downgrade: never strand shares.
   this._enabled();
   if(!this.accountActive(owner)||!this.accountVerified(owner))
    fail('pro_share_owner_not_active');
   const locked=await db.query('SELECT owner_account_id FROM lr_gold_pro_share_addons WHERE owner_account_id=$1 FOR UPDATE',[owner]);
   if(locked.rowCount!==1)fail('pro_share_addon_not_found',404);
   if(removeGuest){
    await db.query(`INSERT INTO lr_gold_pro_share_seats(owner_account_id,status)
     VALUES($1,'empty') ON CONFLICT(owner_account_id) DO UPDATE SET
     guest_account_id=NULL,invited_email=NULL,invite_hash=NULL,invite_expires_ms=NULL,
     status='empty',accepted_at=NULL,updated_at=now()`,[owner]);
   }
   if(deviceId)await db.query('DELETE FROM lr_gold_pro_share_devices WHERE owner_account_id=$1 AND device_id=$2',[owner,safe(deviceId,'pro_share_device_invalid')]);
   await db.query('UPDATE lr_gold_pro_share_addons SET revision=revision+1,updated_at=now() WHERE owner_account_id=$1',[owner]);
   return {ownerAccountId:owner,guestRemoved:Boolean(removeGuest),deviceRemoved:deviceId||null};
  });
 }
 async overview({authenticatedOwnerAccountId}={}){
  const owner=safe(authenticatedOwnerAccountId,'pro_share_owner_invalid');
  this._enabled();
  if(!this.accountActive(owner)||!this.accountVerified(owner))
   fail('pro_share_owner_not_active');
  const [addon,seat,devices]=await Promise.all([
   this.pool.query('SELECT state,valid_until_ms,monthly_guest_call_budget,revision FROM lr_gold_pro_share_addons WHERE owner_account_id=$1',[owner]),
   this.pool.query('SELECT status,guest_account_id,invited_email,invite_expires_ms FROM lr_gold_pro_share_seats WHERE owner_account_id=$1',[owner]),
   this.pool.query(`SELECT d.device_id,d.display_name,d.state,
     CASE WHEN sh.device_id IS NULL THEN false ELSE true END AS shared
     FROM lr_devices d LEFT JOIN lr_gold_pro_share_devices sh
      ON sh.device_id=d.device_id AND sh.owner_account_id=d.owner_account_id
     WHERE d.owner_account_id=$1 AND d.state<>'revoked'
     ORDER BY d.device_id LIMIT 100`,[owner])
  ]);
  const a=addon.rows?.[0]||null,t=seat.rows?.[0]||null;
  return {ownerAccountId:owner,addOnActive:Boolean(a&&['trial','active'].includes(a.state)&&
    Number(a.valid_until_ms)>this.now()&&
    ['pro','vip'].includes(String(this.planFor(owner)||'free').toLowerCase())),validUntil:a?.valid_until_ms||null,
   monthlyGuestCallBudget:a?.monthly_guest_call_budget||null,
   revision:a?.revision||null,seatLimit:1,seat:{status:t?.status||'empty',
    guestAccountId:t?.guest_account_id||null,invitedEmail:t?.invited_email||null,
    inviteExpiresAt:t?.invite_expires_ms||null},devices:devices.rows||[],
   checkoutEnabled:false,guestExecutionEnabled:false};
 }
 // Pre-issuance eligibility only: no B grant/connection/session is minted here.
 // The future guest OAuth Helper MUST derive actor from its verified OAuth proof
 // and recheck this on resolve, issue, owner B approval and actual dispatch.
 async assertEligibleGuestRequest({authenticatedGuestAccountId,device,connection}={}){
  this._enabled();
  const guest=safe(authenticatedGuestAccountId,'pro_share_guest_invalid');
  if(!device?.deviceId||!device?.accountId||guest===device.accountId||
     !this.accountActive(guest)||!this.accountVerified(guest)||
     String(this.planFor(guest)||'free').toLowerCase()!=='free'||
     device.state!=='online'||!connection||connection.state!=='connected'||
     connection.accountId!==device.accountId||
     connection.deviceId!==device.deviceId||
     !ID.test(String(connection.connectionId||''))||
     Number(connection.hardExpiresAt)<=this.now())
    fail('pro_share_guest_request_denied');
  this._eligible(device.accountId);
  const row=await this.pool.query(`SELECT a.revision FROM lr_gold_pro_share_addons a
    JOIN lr_gold_pro_share_seats s ON s.owner_account_id=a.owner_account_id
      AND s.status='accepted' AND s.guest_account_id=$2
    JOIN lr_gold_pro_share_devices x ON x.owner_account_id=a.owner_account_id
      AND x.device_id=$3
    JOIN lr_devices d ON d.device_id=x.device_id
      AND d.owner_account_id=a.owner_account_id
    WHERE a.owner_account_id=$1 AND a.state IN ('trial','active') AND a.valid_until_ms>$4`,
    [device.accountId,guest,device.deviceId,this.now()]);
  if(row.rowCount!==1)fail('pro_share_guest_device_or_addon_required');
  return Object.freeze({actorAccountId:guest,ownerAccountId:device.accountId,
   deviceId:device.deviceId,connectionId:connection.connectionId,
   permissionRevision:Number(row.rows[0].revision),
   grantPurpose:'pro-share-guest',requiresOwnerB:true});
 }
 // This preflight is NOT an execution route. Every queued operation MUST call
 // it again at dispatch, with the authenticated OAuth guest and fresh A/B.
 async authorize({authenticatedActorAccountId,authenticatedAgentId,device,
   connection,grantId,accessGrants,db=this.pool}={}){
  this._enabled();
  const guest=safe(authenticatedActorAccountId,'pro_share_guest_invalid'),
    agent=safe(authenticatedAgentId,'pro_share_agent_invalid'),
    id=safe(grantId,'pro_share_ab_required');
  if(!device||!ID.test(String(device.deviceId||''))||
     !ID.test(String(device.accountId||''))||
     guest===device.accountId||device.state!=='online'||
     !connection||connection.state!=='connected'||
     connection.accountId!==device.accountId||
     connection.deviceId!==device.deviceId||
     !ID.test(String(connection.connectionId||''))||
     Number(connection.hardExpiresAt)<=this.now())
   fail('pro_share_device_or_connection_invalid');
  this._eligible(device.accountId);
  if(!this.accountActive(guest)||!this.accountVerified(guest))
   fail('pro_share_guest_not_active');
  const q=await db.query(`SELECT a.owner_account_id,a.valid_until_ms,a.monthly_guest_call_budget,a.revision,
    se.guest_account_id
    FROM lr_gold_pro_share_addons a
    JOIN lr_gold_pro_share_seats se ON se.owner_account_id=a.owner_account_id
      AND se.status='accepted' AND se.guest_account_id=$2
    JOIN lr_gold_pro_share_devices sh ON sh.owner_account_id=a.owner_account_id
      AND sh.device_id=$3
    JOIN lr_devices d ON d.device_id=sh.device_id AND d.owner_account_id=a.owner_account_id
    WHERE a.owner_account_id=$1 AND a.state IN ('trial','active') AND a.valid_until_ms>$4`,
    [device.accountId,guest,device.deviceId,this.now()]);
  if(q.rowCount!==1)fail('pro_share_guest_device_or_addon_required');
  if(!accessGrants?.assert)fail('pro_share_ab_required');
  const grant=accessGrants.assert(id,{accountId:guest,agentId:agent,
    deviceId:device.deviceId,connectionId:connection.connectionId,touch:false});
  // Owner's A/B, legacy unscoped grant and dormant Pro Team grant NEVER work.
  if(grant.agentId!==agent||grant.accountId!==guest||
     grant.purpose!=='pro-share-guest'||grant.closedAt||
     Number(grant.absoluteExpiresAt)>Number(grant.approvedAt)+86400000||
     Math.min(Number(grant.expiresAt),Number(grant.absoluteExpiresAt),
      Number(connection.hardExpiresAt))<=this.now())
   fail('pro_share_guest_independent_ab_required');
  return Object.freeze({actorAccountId:guest,agentId:agent,
   billedAccountId:device.accountId,deviceOwnerAccountId:device.accountId,
   deviceId:device.deviceId,connectionId:connection.connectionId,
   grantId:id,permissionRevision:Number(q.rows[0].revision),
   monthlyGuestCallBudget:Number(q.rows[0].monthly_guest_call_budget),
   accessExpiresAt:Math.min(Number(grant.expiresAt),Number(grant.absoluteExpiresAt),
     Number(connection.hardExpiresAt)),maxGuestConcurrentJobs:1});
 }
 // No live metering route calls this. To use at dispatch, first re-authorize
 // after queue wait, then atomically debit via one PG owner-row lock.
 async billOnce({authenticatedActorAccountId,authenticatedAgentId,device,
   connection,grantId,accessGrants,operationId,units=1}={}){
  const op=safe(operationId,'pro_share_operation_invalid');
  if(op.length<16||!Number.isSafeInteger(units)||units<1||units>10000)
   fail('pro_share_billing_payload_invalid',400);
  return this._tx(async db=>{
   // Serializes owner budget checks under the same transaction.
   const owner=safe(device?.accountId,'pro_share_owner_invalid');
   await this._ownerRow(db,owner);
   const authority=await this.authorize({
    authenticatedActorAccountId,authenticatedAgentId,device,connection,
    grantId,accessGrants,db});
   const prior=await db.query(`SELECT guest_account_id,device_id,agent_id,grant_id,connection_id,units
    FROM lr_gold_pro_share_usage_events WHERE owner_account_id=$1 AND operation_id=$2`,[owner,op]);
   if(prior.rowCount){
    const p=prior.rows[0];
    if(p.guest_account_id!==authority.actorAccountId||p.device_id!==authority.deviceId||
       p.agent_id!==authority.agentId||p.grant_id!==authority.grantId||
       p.connection_id!==authority.connectionId||Number(p.units)!==units)
      fail('pro_share_operation_id_conflict',409);
    return {billedAccountId:owner,operationId:op,charged:false,idempotent:true};
   }
   const date=new Date(this.now()),period=date.getUTCFullYear()*100+(date.getUTCMonth()+1);
   const used=await db.query('SELECT COALESCE(SUM(units),0)::bigint AS used FROM lr_gold_pro_share_usage_events WHERE owner_account_id=$1 AND period_utc=$2',[owner,period]);
   if(Number(used.rows[0].used)+units>authority.monthlyGuestCallBudget)
    fail('pro_share_guest_monthly_budget_exhausted',429);
   await db.query(`INSERT INTO lr_gold_pro_share_usage_events
    (owner_account_id,operation_id,guest_account_id,device_id,agent_id,grant_id,connection_id,period_utc,units)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[owner,op,authority.actorAccountId,
     authority.deviceId,authority.agentId,authority.grantId,authority.connectionId,period,units]);
   return {billedAccountId:owner,operationId:op,charged:true,idempotent:false};
  });
 }
}
