/**
 * Relational Gold Team + owner-billed usage authority.
 *
 * No filesystem state, no in-memory entitlement source, no client-provided
 * billing owner or budget. Only signed accepted job evidence can charge usage.
 * Lease/grant/team authorization is checked inside a PG transaction.
 */
import crypto from 'node:crypto';
const VALID=/^[A-Za-z0-9._:-]{1,160}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail=(name,status=403)=>Object.assign(new Error(name),{code:name,status});
const id=v=>{const s=String(v||'');if(!VALID.test(s))throw fail('gold_team_invalid_id',400);return s};
const sha=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');
export class GoldPgTeamUsageAuthority{
 constructor({pool,core,verifyOwnerProof,verifyUsageEvidence,now=()=>Date.now(),
  freeMonthlyCallCap=10000}={}){
  if(!pool?.query||!pool?.connect)throw Error('gold_team_pg_pool_required');
  if(!core?.authenticate||typeof verifyOwnerProof!=='function'||
   typeof verifyUsageEvidence!=='function')throw Error('gold_team_trusted_authority_required');
  if(!Number.isSafeInteger(freeMonthlyCallCap)||freeMonthlyCallCap<0)
   throw Error('gold_team_invalid_free_cap');
  Object.assign(this,{pool,core,verifyOwnerProof,verifyUsageEvidence,now,freeMonthlyCallCap});
 }
 async tx(fn){
  const c=await this.pool.connect();let started=false;
  try{
   await c.query('BEGIN');started=true;const answer=await fn(c);
   await c.query('COMMIT');started=false;return answer;
  }catch(error){if(started)await c.query('ROLLBACK').catch(()=>{});throw error}
  finally{c.release()}
 }
 async createTeam({sessionToken,proof}={}){
  const principal=await this.core.authenticate(sessionToken);
  if(await this.verifyOwnerProof({purpose:'team_create',ownerAccountId:principal.accountId,proof})!==true)
   throw fail('gold_team_owner_proof_required');
  return this.tx(async c=>{
   const owner=await c.query(
    "SELECT a.plan,a.status,EXISTS(SELECT 1 FROM lr_entitlements e "+
    "WHERE e.owner_account_id=a.account_id "+
    "AND e.kind IN ('personal_pro','pro_team') AND e.revoked_at IS NULL "+
    "AND e.effective_at<=now() AND (e.valid_until IS NULL OR e.valid_until>now())) "+
    "AS active_entitlement FROM lr_accounts a WHERE a.account_id=$1 FOR UPDATE",
    [principal.accountId]);
   if(owner.rows?.[0]?.plan!=='pro'||owner.rows[0].status!=='active'||
     owner.rows[0].active_entitlement!==true)
    throw fail('gold_team_owner_requires_pro');
   const teamId='team_'+crypto.randomUUID();
   const created=await c.query(
    'INSERT INTO lr_teams(team_id,owner_account_id,seat_cap) '+
    'VALUES($1,$2,5) ON CONFLICT(owner_account_id) DO NOTHING RETURNING team_id',
    [teamId,principal.accountId]);
   if(created.rows?.length!==1)throw fail('gold_team_already_exists',409);
   await c.query(
    "INSERT INTO lr_team_members(team_id,account_id,state) VALUES($1,$2,'active')",
    [teamId,principal.accountId]);
   return {teamId,ownerAccountId:principal.accountId,seatCap:5};
  });
 }
 async inviteMember({sessionToken,teamId,recipientEmail,proof,ttlMs=604800000}={}){
  const principal=await this.core.authenticate(sessionToken),team=id(teamId);
  const mail=String(recipientEmail||'').trim().toLowerCase();
  if(!EMAIL.test(mail)||mail.length>254||!Number.isSafeInteger(ttlMs)||
   ttlMs<60000||ttlMs>604800000)throw fail('gold_team_invite_invalid',400);
  if(await this.verifyOwnerProof({purpose:'team_invite',teamId:team,
    ownerAccountId:principal.accountId,recipientEmail:mail,proof})!==true)
   throw fail('gold_team_invite_proof_required');
  return this.tx(async c=>{
   const owner=await c.query(
    'SELECT owner_account_id,seat_cap FROM lr_teams WHERE team_id=$1 FOR UPDATE',[team]);
   if(owner.rows?.[0]?.owner_account_id!==principal.accountId)
    throw fail('gold_team_owner_mismatch');
   const seats=await c.query(
    "SELECT COUNT(*)::integer AS count FROM lr_team_members WHERE team_id=$1 AND state='active'",
    [team]);
   if(Number(seats.rows?.[0]?.count)>=Number(owner.rows[0].seat_cap))
    throw fail('gold_team_seat_limit',409);
   const raw=crypto.randomBytes(32).toString('base64url');
   const accepted=await c.query(
    'INSERT INTO lr_team_invites(invite_sha256,team_id,recipient_email,expires_at) '+
    'VALUES($1,$2,$3,to_timestamp($4/1000.0)) RETURNING invite_sha256',
    [sha(raw),team,mail,this.now()+ttlMs]);
   if(accepted.rows?.length!==1)throw Error('gold_team_invite_insert_failed');
   return {inviteCode:raw,teamId:team,expiresAt:this.now()+ttlMs};
  });
 }
 async acceptInvite({sessionToken,inviteCode}={}){
  const principal=await this.core.authenticate(sessionToken);
  if(typeof inviteCode!=='string'||inviteCode.length<20)
   throw fail('gold_team_invite_invalid',400);
  return this.tx(async c=>{
   const invited=await c.query(
    'SELECT invite_sha256,team_id,recipient_email,expires_at,accepted_at '+
    'FROM lr_team_invites WHERE invite_sha256=$1 FOR UPDATE',[sha(inviteCode)]);
   const row=invited.rows?.[0];
   if(!row||row.accepted_at||new Date(row.expires_at).getTime()<=this.now()||
    row.recipient_email.toLowerCase()!==principal.email.toLowerCase())
    throw fail('gold_team_invite_invalid_or_consumed',409);
   const actor=await c.query(
    "SELECT status,email,email_verified FROM lr_accounts WHERE account_id=$1 FOR SHARE",
    [principal.accountId]);
   if(actor.rows?.[0]?.status!=='active'||actor.rows[0].email_verified!==true||
    actor.rows[0].email.toLowerCase()!==row.recipient_email.toLowerCase())
    throw fail('gold_team_invited_account_not_verified');
   const team=await c.query(
    'SELECT owner_account_id,seat_cap FROM lr_teams WHERE team_id=$1 FOR UPDATE',[row.team_id]);
   if(!team.rows?.length)throw fail('gold_team_not_found',404);
   const members=await c.query(
    "SELECT COUNT(*)::integer AS count FROM lr_team_members WHERE team_id=$1 AND state='active'",
    [row.team_id]);
   if(Number(members.rows?.[0]?.count)>=Number(team.rows[0].seat_cap))
    throw fail('gold_team_seat_limit',409);
   await c.query(
    "INSERT INTO lr_team_members(team_id,account_id,state) VALUES($1,$2,'active') "+
    "ON CONFLICT(team_id,account_id) DO UPDATE SET state='active'",
    [row.team_id,principal.accountId]);
   const consumed=await c.query(
    'UPDATE lr_team_invites SET accepted_by=$2,accepted_at=now() '+
    'WHERE invite_sha256=$1 AND accepted_at IS NULL RETURNING invite_sha256',
    [sha(inviteCode),principal.accountId]);
   if(consumed.rows?.length!==1)throw fail('gold_team_invite_race_lost',409);
   return {teamId:row.team_id,memberAccountId:principal.accountId};
  });
 }
 async shareDevice({sessionToken,teamId,deviceId,proof}={}){
  const principal=await this.core.authenticate(sessionToken),
   team=id(teamId),device=id(deviceId);
  if(await this.verifyOwnerProof({purpose:'team_share_device',teamId:team,
    deviceId:device,ownerAccountId:principal.accountId,proof})!==true)
   throw fail('gold_team_share_owner_proof_required');
  return this.tx(async c=>{
   const owned=await c.query(
    'SELECT t.team_id FROM lr_teams t JOIN lr_devices d ON d.owner_account_id=t.owner_account_id '+
    "WHERE t.team_id=$1 AND d.device_id=$2 AND d.state<>'revoked' "+
    'AND t.owner_account_id=$3 FOR UPDATE',
    [team,device,principal.accountId]);
   if(!owned.rows?.length)throw fail('gold_team_device_owner_mismatch');
   await c.query('INSERT INTO lr_team_devices(team_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [team,device]);
   return {teamId:team,deviceId:device,shared:true};
  });
 }
 async removeMember({sessionToken,teamId,memberAccountId,proof}={}){
  const principal=await this.core.authenticate(sessionToken),
   team=id(teamId),member=id(memberAccountId);
  if(principal.accountId===member)throw fail('gold_team_owner_cannot_self_remove');
  if(await this.verifyOwnerProof({purpose:'team_remove_member',teamId:team,
    memberAccountId:member,ownerAccountId:principal.accountId,proof})!==true)
   throw fail('gold_team_remove_proof_required');
  return this.tx(async c=>{
   const owner=await c.query('SELECT owner_account_id FROM lr_teams WHERE team_id=$1 FOR UPDATE',
    [team]);
   if(owner.rows?.[0]?.owner_account_id!==principal.accountId)
    throw fail('gold_team_owner_mismatch');
   const affected=await c.query(
    "UPDATE lr_team_members SET state='revoked' WHERE team_id=$1 "+
    "AND account_id=$2 AND state='active' RETURNING account_id",[team,member]);
   await c.query(
    'UPDATE lr_ab_grants SET closed_at=now() WHERE grant_id IN ('+
    'SELECT grant_id FROM lr_ab_team_actor_grants WHERE team_id=$1 AND actor_account_id=$2'+
    ') AND closed_at IS NULL',[team,member]);
   return {teamId:team,memberAccountId:member,revoked:affected.rows?.length===1};
  });
 }
 async chargeToolCall({signedEvent}={}){
  // The trusted verifier decodes an accepted job/operation envelope and owns
  // the canonical event ID, actor, device, owner, and count. Nothing on the
  // client can choose another customer's billing owner or claim success.
  const v=await this.verifyUsageEvidence(signedEvent);
  if(!v||typeof v!=='object')throw fail('gold_usage_signed_evidence_required');
  const eventId=id(v.eventId),owner=id(v.ownerAccountId),
   actor=id(v.actorAccountId),device=id(v.deviceId),grant=id(v.grantId);
  const job=v.jobId==null?null:id(v.jobId),calls=Number(v.calls);
  if(!Number.isSafeInteger(calls)||calls<1||calls>1000)
   throw fail('gold_usage_call_count_invalid',400);
  const month=new Date(this.now()).toISOString().slice(0,7);
  return this.tx(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    ['gold:usage:'+owner+':'+month]);
   const prior=await c.query(
    'SELECT event_id,owner_account_id,actor_account_id,device_id,job_id,tool_calls,month_key '+
    'FROM lr_usage_events WHERE event_id=$1 FOR UPDATE',[eventId]);
   if(prior.rows?.length){
    const e=prior.rows[0];
    if(e.owner_account_id!==owner||e.actor_account_id!==actor||
     e.device_id!==device||(e.job_id||null)!==job||
     Number(e.tool_calls)!==calls||String(e.month_key).trim()!==month)
     throw fail('gold_usage_idempotency_conflict',409);
    return {recorded:false,duplicate:true,month};
   }
   const author=await c.query(
    'SELECT a.account_id,a.plan,a.status,d.owner_account_id AS device_owner,d.state AS device_state,'+
    'actor.status AS actor_status FROM lr_accounts a '+
    'JOIN lr_devices d ON d.owner_account_id=a.account_id '+
    'JOIN lr_accounts actor ON actor.account_id=$2 '+
    'WHERE a.account_id=$1 AND d.device_id=$3 FOR UPDATE',
    [owner,actor,device]);
   const rights=author.rows?.[0];
   if(!rights||rights.status!=='active'||rights.actor_status!=='active'||
    rights.device_state==='revoked')
    throw fail('gold_usage_owner_or_device_invalid');
   // Every billed call needs an unexpired, A/B-authorized job principal.
   // The signed job evidence also binds the actor and grant; this database
   // check prevents charging or dispatch after revocation across processes.
   const grantRow=await c.query(
    "SELECT g.grant_id FROM lr_ab_grants g "+
    "JOIN lr_device_connections cn ON cn.connection_id=g.connection_id "+
    "LEFT JOIN lr_ab_team_actor_grants tg ON tg.grant_id=g.grant_id "+
    "LEFT JOIN lr_team_members tm ON tm.team_id=tg.team_id "+
    "AND tm.account_id=tg.actor_account_id AND tm.state='active' "+
    "LEFT JOIN lr_team_devices td ON td.team_id=tg.team_id AND td.device_id=g.device_id "+
    "WHERE g.grant_id=$1 AND g.device_id=$2 AND g.account_id=$3 "+
    "AND g.closed_at IS NULL AND g.expires_at>now() AND g.absolute_expires_at>now() "+
    "AND cn.closed_at IS NULL AND cn.hard_expires_at>now() "+
    "AND ((g.purpose='device' AND $4=$3) "+
    "OR (g.purpose='team-member' AND tg.actor_account_id=$4 "+
    "AND tm.account_id IS NOT NULL AND td.device_id IS NOT NULL))",
    [grant,device,owner,actor]);
   if(!grantRow.rows?.length)throw fail('gold_usage_ab_grant_invalid');
   if(actor!==owner){
    const shared=await c.query(
     "SELECT t.team_id FROM lr_teams t JOIN lr_team_members m "+
     "ON m.team_id=t.team_id AND m.state='active' "+
     "JOIN lr_team_devices td ON td.team_id=t.team_id "+
     "WHERE t.owner_account_id=$1 AND m.account_id=$2 AND td.device_id=$3",
     [owner,actor,device]);
    if(!shared.rows?.length)throw fail('gold_usage_team_not_authorized');
    const budget=await c.query(
     'SELECT call_limit FROM lr_team_member_budgets '+
     'WHERE owner_account_id=$1 AND month_key=$2 FOR UPDATE',[owner,month]);
    if(!budget.rows?.length)throw fail('gold_usage_team_budget_not_configured');
    const teamCount=await c.query(
     'SELECT tool_calls FROM lr_team_member_monthly '+
     'WHERE owner_account_id=$1 AND month_key=$2 FOR UPDATE',[owner,month]);
    if(Number(teamCount.rows?.[0]?.tool_calls||0)+calls>Number(budget.rows[0].call_limit))
     throw fail('gold_usage_team_budget_exhausted',429);
   }
   const budget=await c.query(
    'SELECT call_limit FROM lr_usage_budgets '+
    'WHERE owner_account_id=$1 AND month_key=$2 FOR UPDATE',[owner,month]);
   const max=budget.rows?.length?Number(budget.rows[0].call_limit):
    rights.plan==='free'?this.freeMonthlyCallCap:Infinity;
   const used=await c.query(
    'SELECT tool_calls FROM lr_usage_monthly '+
    'WHERE owner_account_id=$1 AND month_key=$2 FOR UPDATE',[owner,month]);
   if(Number(used.rows?.[0]?.tool_calls||0)+calls>max)
    throw fail('gold_usage_owner_budget_exhausted',429);
   await c.query(
    'INSERT INTO lr_usage_events(event_id,owner_account_id,actor_account_id,'+
    'device_id,job_id,month_key,tool_calls) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [eventId,owner,actor,device,job,month,calls]);
   await c.query(
    'INSERT INTO lr_usage_monthly(owner_account_id,month_key,tool_calls) '+
    'VALUES($1,$2,$3) ON CONFLICT(owner_account_id,month_key) DO UPDATE '+
    'SET tool_calls=lr_usage_monthly.tool_calls+EXCLUDED.tool_calls,updated_at=now()',
    [owner,month,calls]);
   if(actor!==owner){
    await c.query(
     'INSERT INTO lr_team_member_monthly(owner_account_id,month_key,tool_calls) '+
     'VALUES($1,$2,$3) ON CONFLICT(owner_account_id,month_key) DO UPDATE '+
     'SET tool_calls=lr_team_member_monthly.tool_calls+EXCLUDED.tool_calls,updated_at=now()',
     [owner,month,calls]);
   }
   return {recorded:true,duplicate:false,month,ownerAccountId:owner,calls};
  });
 }
}
