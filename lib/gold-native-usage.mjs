/** Native PostgreSQL Usage aggregations. No JSONB usage state. */
const N=x=>x==null?null:Number(x);
export class GoldNativeUsage{
 constructor({pool}){if(!pool?.connect||!pool?.query)throw Error('gold_usage_pg_required');this.pool=pool}
 static async open({pool}){
  const store=new GoldNativeUsage({pool});
  const [cfg,accounts,months,devices,opens]=await Promise.all([
   pool.query('SELECT tracking_since_ms FROM lr_gold_usage_config WHERE singleton_id=1'),
   pool.query('SELECT account_id,last_tool_call_ms FROM lr_gold_usage_account'),
   pool.query('SELECT * FROM lr_gold_usage_month'),
   pool.query('SELECT * FROM lr_gold_usage_device'),
   pool.query('SELECT * FROM lr_gold_usage_open_connection')
  ]);
  const rows=Object.fromEntries(accounts.rows.map(r=>[r.account_id,{months:{},lastToolCallAt:N(r.last_tool_call_ms)}]));
  for(const r of months.rows){
   const a=rows[r.account_id];if(!a)continue;
   a.months[r.month_key]={toolCalls:N(r.tool_calls),onlineMs:N(r.online_ms),devices:{}};
  }
  for(const r of devices.rows){
   const b=rows[r.account_id]?.months[r.month_key];
   if(b)b.devices[r.device_id]={toolCalls:N(r.tool_calls),onlineMs:N(r.online_ms)};
  }
  return {store,data:{
   schemaVersion:1,accounts:rows,
   trackingSince:N(cfg.rows?.[0]?.tracking_since_ms)||Date.now(),
   openConnections:opens.rows.map(r=>[r.connection_id,{
    connectionId:r.connection_id,accountId:r.account_id,deviceId:r.device_id,
    openedAt:N(r.opened_ms),lastAccruedAt:N(r.last_accrued_ms),
    hardExpiresAt:N(r.hard_expires_ms)
   }])
  }};
 }
 async write(state){
  const client=await this.pool.connect();let began=false;
  try{
   await client.query('BEGIN');began=true;
   await client.query(`INSERT INTO lr_gold_usage_config(singleton_id,tracking_since_ms)
     VALUES(1,$1) ON CONFLICT(singleton_id) DO UPDATE SET tracking_since_ms=EXCLUDED.tracking_since_ms`,
     [state.trackingSince]);
   const accounts=Object.entries(state.accounts||{});
   for(const [accountId,row]of accounts){
    await client.query(`INSERT INTO lr_gold_usage_account(account_id,last_tool_call_ms)
     VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET last_tool_call_ms=EXCLUDED.last_tool_call_ms`,
     [accountId,row.lastToolCallAt??null]);
    for(const [key,b]of Object.entries(row.months||{})){
     await client.query(`INSERT INTO lr_gold_usage_month(account_id,month_key,tool_calls,online_ms)
      VALUES($1,$2,$3,$4) ON CONFLICT(account_id,month_key)
      DO UPDATE SET tool_calls=EXCLUDED.tool_calls,online_ms=EXCLUDED.online_ms`,
      [accountId,key,b.toolCalls||0,b.onlineMs||0]);
     for(const [deviceId,d]of Object.entries(b.devices||{})){
      await client.query(`INSERT INTO lr_gold_usage_device(account_id,month_key,device_id,tool_calls,online_ms)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,month_key,device_id)
       DO UPDATE SET tool_calls=EXCLUDED.tool_calls,online_ms=EXCLUDED.online_ms`,
       [accountId,key,deviceId,d.toolCalls||0,d.onlineMs||0]);
     }
    }
   }
   const openConnections=new Map(state.openConnections||[]);
   for(const [,row]of openConnections){
    await client.query(`INSERT INTO lr_gold_usage_open_connection
     (connection_id,account_id,device_id,opened_ms,last_accrued_ms,hard_expires_ms)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(connection_id) DO UPDATE SET
     last_accrued_ms=EXCLUDED.last_accrued_ms,hard_expires_ms=EXCLUDED.hard_expires_ms`,
     [row.connectionId,row.accountId,row.deviceId,row.openedAt,row.lastAccruedAt,row.hardExpiresAt??null]);
   }
   await client.query('DELETE FROM lr_gold_usage_open_connection WHERE NOT(connection_id=ANY($1::text[]))',
    [[...openConnections.keys()]]);
   // Canonical usage counters only increase in this write path. Account removal
   // cascades; do not silently reset historical usage on a local cache eviction.
   await client.query('COMMIT');began=false;
  }catch(error){if(began)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
}
