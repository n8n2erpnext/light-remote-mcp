/** Native PostgreSQL Support delivery outbox. JSONB only for ticket payload. */
const num=x=>x==null?null:Number(x);
export class GoldNativeSupport{
 constructor({pool}){if(!pool?.connect||!pool?.query)throw Error('gold_support_pg_required');this.pool=pool}
 static async open({pool}){
  const store=new GoldNativeSupport({pool});
  const {rows}=await pool.query('SELECT * FROM lr_gold_support_outbox ORDER BY created_ms,event_id');
  return {store,rows:rows.map(r=>({
   eventId:r.event_id,accountId:r.account_id,accountEmail:r.account_email,
   accountPlan:r.account_plan,payload:r.payload,status:r.status,attempts:r.attempts,
   createdAt:num(r.created_ms),nextAttemptAt:num(r.next_attempt_ms),
   deliveredAt:num(r.delivered_ms),remoteStatus:r.remote_status,
   resultName:r.result_name,statusCheckAttempts:r.status_check_attempts,
   nextStatusCheckAt:num(r.next_status_check_ms),lastError:r.last_error
  }))};
 }
 async write(rows){
  const client=await this.pool.connect();let began=false;
  try{
   await client.query('BEGIN');began=true;
   for(const r of rows){
    await client.query(`INSERT INTO lr_gold_support_outbox(
     event_id,account_id,account_email,account_plan,payload,status,attempts,created_ms,
     next_attempt_ms,delivered_ms,remote_status,result_name,status_check_attempts,
     next_status_check_ms,last_error)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT(event_id) DO UPDATE SET
     status=EXCLUDED.status,attempts=EXCLUDED.attempts,
     next_attempt_ms=EXCLUDED.next_attempt_ms,delivered_ms=EXCLUDED.delivered_ms,
     remote_status=EXCLUDED.remote_status,result_name=EXCLUDED.result_name,
     status_check_attempts=EXCLUDED.status_check_attempts,
     next_status_check_ms=EXCLUDED.next_status_check_ms,last_error=EXCLUDED.last_error`,
     [r.eventId,r.accountId,r.accountEmail,r.accountPlan,JSON.stringify(r.payload),
      r.status,r.attempts,r.createdAt,r.nextAttemptAt,r.deliveredAt??null,
      r.remoteStatus??null,r.resultName??null,r.statusCheckAttempts||0,
      r.nextStatusCheckAt??null,r.lastError??null]);
   }
   await client.query('DELETE FROM lr_gold_support_outbox WHERE NOT(event_id=ANY($1::text[]))',[rows.map(x=>x.eventId)]);
   await client.query('COMMIT');began=false;
  }catch(error){if(began)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
}
