/**
 * Light Remote rc50-v2 additive, staging-only persistence boundary.
 * Operators/API keep their current data source until explicit migration sign-off.
 * No credentials or network connections are constructed at module import time.
 */
const IDENTIFIER=/^[A-Za-z0-9._:-]{1,160}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const check=(condition,code)=>{if(!condition)throw new Error(code);};
export class PgUatRepository {
  constructor({pool,allowUat=false,expectedDb='light_remote_rc50_uat',expectedRole='lr_rc50_app',authorizeUsage,budgetFor,allowLegacyUsageTestPath=false}={}){
    check(allowUat===true,'pg_uat_mode_required');
    check(pool&&typeof pool.connect==='function'&&typeof pool.query==='function','pg_pool_required');
    check(expectedDb==='light_remote_rc50_uat','pg_uat_database_must_match');
    check(expectedRole==='lr_rc50_app','pg_uat_role_must_match');
    this.pool=pool;
    this.expectedDb=expectedDb;
    this.expectedRole=expectedRole;
    this.ready=false;
    this.authorizeUsage=authorizeUsage;
    this.budgetFor=budgetFor;
    this.allowLegacyUsageTestPath=allowLegacyUsageTestPath===true;
  }
  async verifyTarget(){
    this.ready=false;
    const result=await this.pool.query("SELECT current_database() AS database, current_user AS role, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser");
    const row=result.rows?.[0];
    check(row?.database===this.expectedDb,'pg_unexpected_database');
    check(row?.superuser===false,'pg_superuser_forbidden');
    check(row?.role===this.expectedRole,'pg_unapproved_application_role');
    this.ready=true;
    return {database:row.database,role:row.role};
  }
  assertReady(){check(this.ready===true,'pg_uat_not_initialized');}
  async tx(fn){
    this.assertReady();
    const client=await this.pool.connect();
    let begun=false;
    try{
      await client.query('BEGIN');begun=true;
      const value=await fn(client);
      await client.query('COMMIT');begun=false;
      return value;
    }catch(error){
      if(begun)await client.query('ROLLBACK').catch(()=>{});
      throw error;
    }finally{client.release();}
  }
  async findAccount(accountId){
    this.assertReady();
    check(IDENTIFIER.test(String(accountId||''))&&accountId.length<=128,'invalid_account_id');
    const {rows}=await this.pool.query('SELECT account_id,email,plan,status,created_at,updated_at FROM lr_accounts WHERE account_id=$1',[accountId]);
    return rows?.[0]||null;
  }
  async createAccount({accountId,email,plan='free',status='active'}){
    this.assertReady();
    check(IDENTIFIER.test(String(accountId||''))&&accountId.length<=128,'invalid_account_id');
    check(EMAIL.test(String(email||''))&&email.length<=254,'invalid_email');
    check(['free','pro','vip'].includes(plan),'invalid_plan');
    check(['active','dormant','admin_disabled'].includes(status),'invalid_status');
    const {rows}=await this.pool.query(
      'INSERT INTO lr_accounts(account_id,email,plan,status) VALUES ($1,$2,$3,$4) ON CONFLICT (account_id) DO NOTHING RETURNING account_id,email,plan,status',
      [accountId,email.trim().toLowerCase(),plan,status]);
    // Fail closed if account ID already exists; never silently reset an entitlement.
    check(rows?.length===1,'account_exists');
    return rows[0];
  }
  /**
   * Staging-only owner-billed quota write. A single advisory transaction lock
   * serializes all accepted charges for owner/month across PG connections.
   * Trusted checks can consult the same transaction via {client}.
   */
  async recordUsage({eventId,ownerId,actorId,deviceId=null,jobId=null,monthKey,calls=1}){
    for(const id of [eventId,ownerId,actorId])check(IDENTIFIER.test(String(id||'')),'invalid_usage_identity');
    for(const id of [deviceId,jobId])check(id===null||IDENTIFIER.test(String(id)),'invalid_usage_reference');
    check(/^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthKey||'')),'invalid_month');
    check(Number.isSafeInteger(calls)&&calls>=1&&calls<=10000,'invalid_calls');
    check(this.allowLegacyUsageTestPath,'legacy_usage_write_test_only');
    check(typeof this.authorizeUsage==='function','usage_authority_callback_required');
    check(typeof this.budgetFor==='function','usage_budget_callback_required');

    return this.tx(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[ownerId+':'+monthKey]);
      const existing=async()=>{
        const result=await client.query(
          'SELECT event_id,owner_account_id,actor_account_id,device_id,job_id,month_key,tool_calls FROM lr_usage_events WHERE event_id=$1 LIMIT 1',
          [eventId]);
        return result.rows?.[0]||null;
      };
      const same=row=>row &&
        row.owner_account_id===ownerId && row.actor_account_id===actorId &&
        (row.device_id??null)===(deviceId??null) && (row.job_id??null)===(jobId??null) &&
        String(row.month_key).trim()===monthKey && Number(row.tool_calls)===calls;
      const prior=await existing();
      if(prior){
        check(same(prior),'usage_idempotency_payload_mismatch');
        return {recorded:false,duplicate:true};
      }
      check(await this.authorizeUsage({ownerId,actorId,deviceId,jobId,eventId,calls,monthKey},{client}),'usage_authorization_denied');
      const cap=await this.budgetFor({ownerId,actorId,monthKey},{client});
      check(cap===Infinity||(Number.isSafeInteger(cap)&&cap>=0),'invalid_owner_budget');
      const monthly=await client.query(
        'SELECT tool_calls::text AS calls FROM lr_usage_monthly WHERE owner_account_id=$1 AND month_key=$2 FOR UPDATE',
        [ownerId,monthKey]);
      const used=BigInt(monthly.rows?.[0]?.calls||'0');
      check(cap===Infinity||used+BigInt(calls)<=BigInt(cap),'monthly_call_quota_exceeded');
      const inserted=await client.query(
        'INSERT INTO lr_usage_events(event_id,owner_account_id,actor_account_id,device_id,job_id,month_key,tool_calls) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING event_id',
        [eventId,ownerId,actorId,deviceId,jobId,monthKey,calls]);
      if(!inserted.rows?.length){
        const conflict=await existing();
        check(same(conflict),'usage_idempotency_payload_mismatch');
        return {recorded:false,duplicate:true};
      }
      await client.query(
        'INSERT INTO lr_usage_monthly(owner_account_id,month_key,tool_calls) VALUES($1,$2,$3) ON CONFLICT(owner_account_id,month_key) DO UPDATE SET tool_calls=lr_usage_monthly.tool_calls+EXCLUDED.tool_calls,updated_at=now()',
        [ownerId,monthKey,calls]);
      return {recorded:true,duplicate:false};
    });
  }
  /**
   * Preferred rc50 UAT billing path: PostgreSQL is the single quota authority.
   * The SQL function checks owner/device/job relationships and budget atomically.
   * Team-member dispatch is deliberately denied until signed A/B proof is available.
   */
  async chargeUatEvent({eventId,ownerId,actorId,deviceId,jobId=null,monthKey,calls=1}={}){
    this.assertReady();
    for(const id of [eventId,ownerId,actorId,deviceId])
      check(IDENTIFIER.test(String(id||'')),'invalid_usage_identity');
    check(jobId===null||IDENTIFIER.test(String(jobId)),'invalid_usage_reference');
    check(/^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthKey||'')),'invalid_month');
    check(Number.isSafeInteger(calls)&&calls>=1&&calls<=10000,'invalid_calls');
    const result=await this.pool.query(
      'SELECT lr_charge_usage_uat($1,$2,$3,$4,$5,$6,$7) AS charged',
      [eventId,ownerId,actorId,deviceId,jobId,monthKey,calls]);
    check(typeof result.rows?.[0]?.charged==='boolean','invalid_usage_result');
    return {recorded:result.rows[0].charged,duplicate:!result.rows[0].charged};
  }
  async chargeFreeUat({eventId,ownerId,deviceId,jobId=null,monthKey,calls=1}={}){
    this.assertReady();
    for(const id of [eventId,ownerId,deviceId])
      check(IDENTIFIER.test(String(id||'')),'invalid_free_identity');
    check(jobId===null||IDENTIFIER.test(String(jobId)),'invalid_usage_reference');
    check(/^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthKey||'')),'invalid_month');
    check(Number.isSafeInteger(calls)&&calls>=1&&calls<=10000,'invalid_calls');
    const result=await this.pool.query(
      'SELECT lr_charge_free_uat($1,$2,$3,$4,$5,$6) AS charged',
      [eventId,ownerId,deviceId,jobId,monthKey,calls]);
    check(typeof result.rows?.[0]?.charged==='boolean','invalid_usage_result');
    return {recorded:result.rows[0].charged,duplicate:!result.rows[0].charged};
  }
  async chargeTeamMemberUat({
    eventId,ownerId,actorId,deviceId,jobId,clientSessionId,grantId,monthKey,calls=1
  }={}){
    this.assertReady();
    for(const id of [eventId,ownerId,actorId,deviceId,jobId,clientSessionId,grantId])
      check(IDENTIFIER.test(String(id||'')),'invalid_team_usage_identity');
    check(ownerId!==actorId,'team_actor_must_differ_from_owner');
    check(/^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthKey||'')),'invalid_month');
    check(Number.isSafeInteger(calls)&&calls>=1&&calls<=10000,'invalid_calls');
    const result=await this.pool.query(
      'SELECT lr_charge_team_member_uat($1,$2,$3,$4,$5,$6,$7,$8,$9) AS charged',
      [eventId,ownerId,actorId,deviceId,jobId,clientSessionId,grantId,monthKey,calls]);
    check(typeof result.rows?.[0]?.charged==='boolean','invalid_usage_result');
    return {recorded:result.rows[0].charged,duplicate:!result.rows[0].charged};
  }
  async ownerMonthUsage(ownerId,monthKey){
    this.assertReady();
    check(IDENTIFIER.test(String(ownerId||'')),'invalid_owner');
    check(/^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthKey||'')),'invalid_month');
    const {rows}=await this.pool.query(
      'SELECT COALESCE(tool_calls,0)::bigint::text AS calls FROM lr_usage_monthly WHERE owner_account_id=$1 AND month_key=$2',
      [ownerId,monthKey]);
    return BigInt(rows?.[0]?.calls||'0');
  }
  async writeOutbox(client,{topic,aggregateId,payload}){
    this.assertReady();
    check(IDENTIFIER.test(String(topic||''))&&IDENTIFIER.test(String(aggregateId||'')),'invalid_outbox_identity');
    const {rows}=await client.query(
      'INSERT INTO lr_outbox(topic,aggregate_id,payload) VALUES($1,$2,$3::jsonb) RETURNING outbox_id',
      [topic,aggregateId,JSON.stringify(payload||{})]);
    return rows?.[0]?.outbox_id;
  }
}
