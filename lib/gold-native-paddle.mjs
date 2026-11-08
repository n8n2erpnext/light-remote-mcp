/**
 * PostgreSQL Paddle canonical state: typed subscription/refund/event rows.
 * JSONB is limited to polymorphic Paddle processing result objects.
 */
const num=n=>n==null?null:Number(n);
export class GoldNativePaddle{
 constructor({pool}){if(!pool?.connect||!pool?.query)throw Error('gold_paddle_pool_required');this.pool=pool}
 static async open({pool}){
  const store=new GoldNativePaddle({pool});
  const [events,subscriptions,refunds]=await Promise.all([
   pool.query('SELECT * FROM lr_gold_paddle_events'),
   pool.query('SELECT * FROM lr_gold_paddle_subscriptions'),
   pool.query('SELECT * FROM lr_gold_paddle_refunds')
  ]);
  return {store,data:{schemaVersion:2,
   events:Object.fromEntries(events.rows.map(r=>[r.event_id,{
    eventType:r.event_type,processedAt:num(r.processed_ms),result:r.result
   }])),
   subscriptions:Object.fromEntries(subscriptions.rows.map(r=>[r.subscription_id,{
    accountId:r.account_id,status:r.status,eventType:r.event_type,updatedAt:num(r.updated_ms)
   }])),
   refunds:Object.fromEntries(refunds.rows.map(r=>[r.adjustment_id,{
    transactionId:r.transaction_id,accountId:r.account_id,
    subscriptionId:r.subscription_id,status:r.status,requestedBy:r.requested_by,
    reason:r.reason,requestedAt:num(r.requested_ms),updatedAt:num(r.updated_ms),
    result:r.result
   }]))
  }};
 }
 async write(state){
  const client=await this.pool.connect();let began=false;
  try{
   await client.query('BEGIN');began=true;
   for(const [id,row]of Object.entries(state.events||{})){
    await client.query(`INSERT INTO lr_gold_paddle_events(event_id,event_type,processed_ms,result)
     VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(event_id) DO UPDATE SET
      event_type=EXCLUDED.event_type,processed_ms=EXCLUDED.processed_ms,result=EXCLUDED.result`,
     [id,row.eventType||'unknown',row.processedAt||Date.now(),JSON.stringify(row.result||{})]);
   }
   for(const [id,row]of Object.entries(state.subscriptions||{})){
    await client.query(`INSERT INTO lr_gold_paddle_subscriptions(subscription_id,account_id,status,event_type,updated_ms)
     VALUES($1,$2,$3,$4,$5) ON CONFLICT(subscription_id) DO UPDATE SET
      account_id=EXCLUDED.account_id,status=EXCLUDED.status,
      event_type=EXCLUDED.event_type,updated_ms=EXCLUDED.updated_ms`,
     [id,row.accountId??null,row.status??null,row.eventType??null,row.updatedAt||Date.now()]);
   }
   for(const [id,row]of Object.entries(state.refunds||{})){
    await client.query(`INSERT INTO lr_gold_paddle_refunds(adjustment_id,transaction_id,account_id,subscription_id,status,requested_by,reason,requested_ms,updated_ms,result)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(adjustment_id) DO UPDATE SET
      transaction_id=EXCLUDED.transaction_id,account_id=EXCLUDED.account_id,
      subscription_id=EXCLUDED.subscription_id,status=EXCLUDED.status,
      requested_by=EXCLUDED.requested_by,reason=EXCLUDED.reason,
      requested_ms=EXCLUDED.requested_ms,updated_ms=EXCLUDED.updated_ms,result=EXCLUDED.result`,
     [id,row.transactionId??null,row.accountId??null,row.subscriptionId??null,
      row.status??null,row.requestedBy??null,row.reason??null,row.requestedAt??null,
      row.updatedAt??null,JSON.stringify(row.result??{})]);
   }
   await client.query('DELETE FROM lr_gold_paddle_events WHERE NOT(event_id=ANY($1::text[]))',[Object.keys(state.events||{})]);
   await client.query('DELETE FROM lr_gold_paddle_subscriptions WHERE NOT(subscription_id=ANY($1::text[]))',[Object.keys(state.subscriptions||{})]);
   await client.query('DELETE FROM lr_gold_paddle_refunds WHERE NOT(adjustment_id=ANY($1::text[]))',[Object.keys(state.refunds||{})]);
   await client.query('COMMIT');began=false;
  }catch(e){if(began)await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
 }
}
