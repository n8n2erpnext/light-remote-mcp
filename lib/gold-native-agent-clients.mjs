/** Native Agent Client and Device binding tables. */
const dt=v=>v==null?null:new Date(Number(v));
const ms=v=>v==null?null:new Date(v).getTime();
export class GoldNativeAgentClients{
 constructor({pool}){if(!pool?.connect||!pool?.query)throw Error('gold_agent_pg_required');this.pool=pool}
 static async open({pool}){
  const store=new GoldNativeAgentClients({pool});
  const [clients,bindings]=await Promise.all([
   pool.query('SELECT * FROM lr_agent_clients'),
   pool.query('SELECT * FROM lr_agent_bindings')
  ]);
  return {store,rows:clients.rows.map(r=>[r.client_session_id,{
   clientSessionId:r.client_session_id,accountId:r.account_id,agentId:r.agent_id,
   createdAt:ms(r.created_at),lastActivityAt:ms(r.last_activity_at),
   expiresAt:ms(r.expires_at),closedAt:ms(r.closed_at),
   closeReason:r.close_reason,defaultDeviceId:r.default_device_id,
   bindings:Object.fromEntries(bindings.rows.filter(b=>b.client_session_id===r.client_session_id)
     .map(b=>[b.device_id,{
      deviceId:b.device_id,grantId:b.grant_id,connectionId:b.connection_id,
      pairingRequestId:b.pairing_request_id,boundAt:ms(b.bound_at),
      lastActivityAt:ms(b.last_activity_at),workingContext:b.working_context
     }]))
  }])};
 }
 async write(rows){
  const client=await this.pool.connect();let started=false;
  try{
   await client.query('BEGIN');started=true;
   for(const row of rows.values()){
    await client.query(`INSERT INTO lr_agent_clients
     (client_session_id,account_id,agent_id,created_at,last_activity_at,expires_at,closed_at,close_reason,default_device_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(client_session_id) DO UPDATE SET
      last_activity_at=EXCLUDED.last_activity_at,expires_at=EXCLUDED.expires_at,
      closed_at=EXCLUDED.closed_at,close_reason=EXCLUDED.close_reason,
      default_device_id=EXCLUDED.default_device_id`,
     [row.clientSessionId,row.accountId,row.agentId,dt(row.createdAt),
      dt(row.lastActivityAt),dt(row.expiresAt),dt(row.closedAt),
      row.closeReason??null,row.defaultDeviceId??null]);
   }
   await client.query('DELETE FROM lr_agent_bindings');
   for(const row of rows.values())for(const b of Object.values(row.bindings||{})){
    await client.query(`INSERT INTO lr_agent_bindings
     (client_session_id,device_id,grant_id,connection_id,pairing_request_id,
      bound_at,last_activity_at,account_id,working_context)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
     [row.clientSessionId,b.deviceId,b.grantId,b.connectionId,
      b.pairingRequestId??null,dt(b.boundAt),dt(b.lastActivityAt),
      row.accountId,b.workingContext==null?null:JSON.stringify(b.workingContext)]);
   }
   await client.query('DELETE FROM lr_agent_clients WHERE NOT(client_session_id=ANY($1::text[]))',
    [[...rows.keys()]]);
   await client.query('COMMIT');started=false;
  }catch(error){if(started)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
}
