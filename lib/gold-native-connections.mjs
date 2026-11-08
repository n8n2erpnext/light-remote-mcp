/** Gold native Device Connection registry, persisted to lr_device_connections. */
const dt=v=>v==null?null:new Date(Number(v));
const ms=v=>v==null?null:new Date(v).getTime();
export class GoldNativeConnections{
 constructor({pool}){if(!pool?.connect||!pool?.query)throw Error('gold_native_connections_pg_required');this.pool=pool}
 static async open({pool}){
  const instance=new GoldNativeConnections({pool});
  const {rows}=await pool.query(`SELECT DISTINCT ON(device_id) * FROM lr_device_connections
     WHERE registry_visible=true ORDER BY device_id,connected_at DESC,connection_id DESC`);
  return {store:instance,rows:rows.map(r=>[r.device_id,{
   connectionId:r.connection_id,accountId:r.account_id,deviceId:r.device_id,
   plan:r.plan,planCapMs:r.plan_cap_ms===null?null:Number(r.plan_cap_ms),
   connectedAt:ms(r.connected_at),hardExpiresAt:ms(r.hard_expires_at),
   reconnectGraceMs:r.reconnect_grace_ms,lastActivityAt:ms(r.last_activity_at),
   closedAt:ms(r.closed_at),closeReason:r.close_reason,
   ...(r.last_renewed_ms!==null?{lastRenewedAt:Number(r.last_renewed_ms)}:{})
  }])};
 }
 async write(connections){
  const client=await this.pool.connect();let begun=false;
  try{
   await client.query('BEGIN');begun=true;
   await client.query('UPDATE lr_device_connections SET registry_visible=false WHERE registry_visible=true');
   for(const r of connections.values()){
    await client.query(`INSERT INTO lr_device_connections
      (connection_id,account_id,device_id,plan,connected_at,hard_expires_at,
       reconnect_grace_ms,last_activity_at,closed_at,close_reason,plan_cap_ms,last_renewed_ms,registry_visible)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
      ON CONFLICT(connection_id) DO UPDATE SET
       plan=EXCLUDED.plan,hard_expires_at=EXCLUDED.hard_expires_at,
       reconnect_grace_ms=EXCLUDED.reconnect_grace_ms,
       last_activity_at=EXCLUDED.last_activity_at,closed_at=EXCLUDED.closed_at,
       close_reason=EXCLUDED.close_reason,plan_cap_ms=EXCLUDED.plan_cap_ms,
       last_renewed_ms=EXCLUDED.last_renewed_ms,registry_visible=true`,
      [r.connectionId,r.accountId,r.deviceId,r.plan,dt(r.connectedAt),
       dt(r.hardExpiresAt),r.reconnectGraceMs,dt(r.lastActivityAt),dt(r.closedAt),
       r.closeReason??null,r.planCapMs??null,r.lastRenewedAt??null]);
   }
   await client.query('COMMIT');begun=false;
  }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
}
