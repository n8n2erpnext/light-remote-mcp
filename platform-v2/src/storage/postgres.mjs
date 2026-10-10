/**
 * Light Remote rc50-v2 additive, staging-only persistence boundary.
 * Operators/API keep their current data source until explicit migration sign-off.
 * No credentials or network connections are constructed at module import time.
 */
const IDENTIFIER=/^[A-Za-z0-9._:-]{1,160}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const check=(condition,code)=>{if(!condition)throw new Error(code);};
export class PgUatRepository {
  constructor({pool,allowUat=false,expectedDb='light_remote_rc50_uat',authorizeUsage}={}){
    check(allowUat===true,'pg_uat_mode_required');
    check(pool&&typeof pool.connect==='function'&&typeof pool.query==='function','pg_pool_required');
    check(expectedDb==='light_remote_rc50_uat','pg_uat_database_must_match');
    this.pool=pool;
    this.expectedDb=expectedDb;
    this.authorizeUsage=authorizeUsage;
  }
  async verifyTarget(){
    const result=await this.pool.query("SELECT current_database() AS database, current_user AS role, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser");
    const row=result.rows?.[0];
    check(row?.database===this.expectedDb,'pg_unexpected_database');
    check(row?.superuser===false,'pg_superuser_forbidden');
    return {database:row.database,role:row.role};
  }
  async tx(fn){
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
    check(IDENTIFIER.test(String(accountId||''))&&accountId.length<=128,'invalid_account_id');
    const {rows}=await this.pool.query('SELECT account_id,email,plan,status,created_at,updated_at FROM lr_accounts WHERE account_id=$1',[accountId]);
    return rows?.[0]||null;
  }
  async createAccount({accountId,email,plan='free',status='active'}){
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
   * Idempotent billable usage event. PostgreSQL owns the ledger, never Redis.
   * This deliberately does not dispatch jobs or authorize device access.
   */
  async recordUsage({eventId,ownerId,actorId,deviceId=null,jobId=null,monthKey,calls=1}){
    for(const id of [eventId,ownerId,actorId])check(IDENTIFIER.test(String(id||'')),'invalid_usage_identity');
    check(/^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthKey||'')),'invalid_month');
    check(Number.isSafeInteger(calls)&&calls>=0&&calls<=10000,'invalid_calls');
    check(typeof this.authorizeUsage==='function','usage_authority_callback_required');
    check(await this.authorizeUsage({ownerId,actorId,deviceId,jobId,eventId,calls}), 'usage_authorization_denied');
    return this.tx(async client=>{
      const {rows}=await client.query(
        'INSERT INTO lr_usage_events(event_id,owner_account_id,actor_account_id,device_id,job_id,month_key,tool_calls) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING event_id',
        [eventId,ownerId,actorId,deviceId,jobId,monthKey,calls]);
      if(!rows?.length)return {recorded:false,duplicate:true};
      await client.query(
        'INSERT INTO lr_usage_monthly(owner_account_id,month_key,tool_calls) VALUES($1,$2,$3) ON CONFLICT(owner_account_id,month_key) DO UPDATE SET tool_calls=lr_usage_monthly.tool_calls+EXCLUDED.tool_calls,updated_at=now()',
        [ownerId,monthKey,calls]);
      return {recorded:true,duplicate:false};
    });
  }
  async ownerMonthUsage(ownerId,monthKey){
    check(IDENTIFIER.test(String(ownerId||'')),'invalid_owner');
    check(/^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthKey||'')),'invalid_month');
    const {rows}=await this.pool.query(
      'SELECT COALESCE(tool_calls,0)::bigint::text AS calls FROM lr_usage_monthly WHERE owner_account_id=$1 AND month_key=$2',
      [ownerId,monthKey]);
    return BigInt(rows?.[0]?.calls||'0');
  }
  async writeOutbox(client,{topic,aggregateId,payload}){
    check(IDENTIFIER.test(String(topic||''))&&IDENTIFIER.test(String(aggregateId||'')),'invalid_outbox_identity');
    const {rows}=await client.query(
      'INSERT INTO lr_outbox(topic,aggregate_id,payload) VALUES($1,$2,$3::jsonb) RETURNING outbox_id',
      [topic,aggregateId,JSON.stringify(payload||{})]);
    return rows?.[0]?.outbox_id;
  }
}
