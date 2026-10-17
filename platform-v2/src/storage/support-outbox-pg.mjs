// Transactional Gold Support Outbox. No JSON snapshot, local queue or SQLite.
// Delivery is injected and off by default. Remote exactly-once semantics also
// require ERPNext to dedupe the stable payload.event_id after network timeouts.
import crypto from 'node:crypto';
const MAX_PENDING=5000;
const RETRY_MS=[5000,15000,30000,60000,120000,300000,600000,1800000,3600000];
const waitFor=n=>RETRY_MS[Math.min(RETRY_MS.length-1,Math.max(0,n-1))];
const error=(message,status=503)=>Object.assign(new Error(message),{status});
const timestamp=x=>x==null?null:(x instanceof Date?x:new Date(x)).getTime();
const view=r=>r?({
 eventId:r.event_id,status:r.status,attempts:Number(r.attempts),
 createdAt:timestamp(r.created_at),deliveredAt:timestamp(r.delivered_at),
 nextAttemptAt:timestamp(r.next_attempt_at),
 remoteStatus:r.remote_status,resultName:r.result_name,
 statusCheckAttempts:Number(r.status_check_attempts),
 lastError:r.last_error
}):null;
const hydrate=r=>({...view(r),accountId:r.account_id,accountEmail:r.account_email,
 accountPlan:r.account_plan,payload:r.payload,leaseToken:r.lease_token});
const identity=/^lr\.support\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const safeError=e=>String(e?.message||e||'support_delivery_failed').slice(0,500);
export class GoldPgSupportOutbox{
 constructor({pool,now=()=>Date.now(),deliver=null,checkStatus=null,deliveryEnabled=false}={}){
  if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')
   throw Error('gold_support_pg_pool_required');
  this.pool=pool;this.now=now;this.deliver=deliver;this.checkStatus=checkStatus;
  this.deliveryEnabled=deliveryEnabled;this.pumping=false;
 }
 async enqueue({account,payload,eventId=null}={}){
  const id=String(eventId||'lr.support.'+crypto.randomUUID());
  if(!identity.test(id))throw error('invalid_support_event_id',400);
  const accountId=String(account?.accountId||'');
  const email=String(account?.email||'').toLowerCase();
  const plan=String(account?.plan||'free').toLowerCase();
  if(!accountId||!email||!['pro','vip'].includes(plan))
   throw error('support_account_not_eligible',403);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
   throw error('support_payload_invalid',400);
  const body={...payload,event_id:id};
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   await client.query("SELECT pg_advisory_xact_lock(hashtext('lr_gold_support_outbox_limit'))");
   // Idempotent replay checked before count; never expose cross-account status.
   const known=await client.query(
    'SELECT * FROM lr_support_outbox WHERE event_id=$1 FOR UPDATE',[id]);
   if(known.rows?.length){
    if(known.rows[0].account_id!==accountId)throw error('support_event_not_found',404);
    await client.query('COMMIT');return view(known.rows[0]);
   }
   const count=Number((await client.query(
    "SELECT COUNT(*)::integer AS count FROM lr_support_outbox WHERE status='queued'"
   )).rows?.[0]?.count);
   if(!Number.isSafeInteger(count)||count>=MAX_PENDING)throw error('support_queue_full');
   const sql='INSERT INTO lr_support_outbox(event_id,account_id,account_email,'+
    "account_plan,payload,status,created_at,next_attempt_at) VALUES("+
    "$1,$2,$3,$4,$5::jsonb,'queued',now(),now()) RETURNING *";
   const result=await client.query(sql,[id,accountId,email,plan,JSON.stringify(body)]);
   if(result.rows?.length!==1)throw Error('gold_support_enqueue_missing');
   await client.query('COMMIT');return view(result.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}
  finally{client.release()}
 }
 async get(eventId,accountId){
  if(!identity.test(String(eventId||''))||!String(accountId||''))return null;
  const found=await this.pool.query(
   'SELECT * FROM lr_support_outbox WHERE event_id=$1 AND account_id=$2',
   [String(eventId),String(accountId)]);
  return view(found.rows?.[0]);
 }
 async claim(kind,{limit=8,leaseSeconds=75}={}){
  if(!['delivery','status'].includes(kind))throw error('invalid_support_lease_kind',400);
  const safeLimit=Math.max(1,Math.min(30,Number(limit)||8));
  const seconds=Math.max(20,Math.min(300,Number(leaseSeconds)||75));
  const token=crypto.randomUUID();
  const eligible=kind==='delivery'?
   "status='queued' AND next_attempt_at<=now()":
   "status='sent' AND result_name IS NULL AND next_status_check_at<=now()";
  const order=kind==='delivery'?'next_attempt_at':'next_status_check_at';
  const sql='WITH due AS (SELECT event_id FROM lr_support_outbox WHERE '+
   eligible+' AND (lease_until IS NULL OR lease_until<=now()) ORDER BY '+
   order+",created_at FOR UPDATE SKIP LOCKED LIMIT $1) "+
   "UPDATE lr_support_outbox AS s SET lease_token=$2::uuid,"+
   "lease_until=now()+($3::integer * interval '1 second'),lease_kind=$4 "+
   'FROM due WHERE s.event_id=due.event_id RETURNING s.*';
  const claimed=await this.pool.query(sql,[safeLimit,token,seconds,kind]);
  return (claimed.rows||[]).map(hydrate);
 }
 async _complete(kind,row,fields){
  if(!identity.test(row?.eventId||'')||!row?.leaseToken)throw error('support_lease_invalid',400);
  const vals=[row.eventId,row.leaseToken,...fields.values];
  const sql='UPDATE lr_support_outbox SET '+fields.sql+
    ',lease_token=NULL,lease_until=NULL,lease_kind=NULL WHERE event_id=$1 '+
    'AND lease_token=$2::uuid AND lease_until>now() AND lease_kind=$'+
    String(vals.length+1)+' RETURNING *';
  const saved=await this.pool.query(sql,[...vals,kind]);
  if(saved.rows?.length!==1)throw error('support_lease_expired_or_stolen',409);
  return view(saved.rows[0]);
 }
 async markDelivered(row,result={}){
  const now=this.now();
  return this._complete('delivery',row,{
   sql:"status='sent',delivered_at=to_timestamp($3/1000.0),"+
    "next_attempt_at=NULL,remote_status=$4,result_name=$5,"+
    "next_status_check_at=CASE WHEN $5::text IS NULL THEN to_timestamp($3/1000.0) ELSE NULL END,"+
    "last_error=NULL,status_check_attempts=0",
   values:[now,String(result.remoteStatus||'Received'),result.resultName||null]
  });
 }
 async reschedule(row,cause){
  const attempts=Number(row.attempts)+1;
  return this._complete('delivery',row,{
   sql:"attempts=attempts+1,status='queued',"+
    "next_attempt_at=to_timestamp($3/1000.0),last_error=$4",
   values:[this.now()+waitFor(attempts),safeError(cause)]
  });
 }
 async updateStatus(row,result={}){
  const now=this.now();
  const remote=String(result.remoteStatus||'');
  if(!remote)throw error('support_remote_status_invalid',502);
  const resultName=result.resultName?String(result.resultName):null;
  if(remote==='Failed'){
   const attempts=Number(row.attempts)+1;
   return this._complete('status',row,{
    sql:"status='queued',attempts=attempts+1,"+
      "next_attempt_at=to_timestamp($3/1000.0),next_status_check_at=NULL,"+
      "remote_status=$4,last_error='backoffice_processing_failed'",
    values:[now+waitFor(attempts),remote]
   });
  }
  const next=resultName?null:now+Math.min(60000,2000*Math.max(1,Number(row.statusCheckAttempts)+1));
  return this._complete('status',row,{
   sql:"remote_status=$3,result_name=$4,status_check_attempts=status_check_attempts+1,"+
    "next_status_check_at=CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5/1000.0) END,"+
    "last_error=NULL",
   values:[remote,resultName,next]
  });
 }
 async statusRetry(row,cause){
  const attempt=Number(row.statusCheckAttempts)+1;
  return this._complete('status',row,{
   sql:'status_check_attempts=status_check_attempts+1,'+
    'next_status_check_at=to_timestamp($3/1000.0),last_error=$4',
   values:[this.now()+Math.min(60000,5000*attempt),safeError(cause)]
  });
 }
 async pump({limit=8}={}){
  if(!this.deliveryEnabled)return{ok:true,skipped:true,reason:'gold_support_delivery_disabled'};
  if(typeof this.deliver!=='function'||typeof this.checkStatus!=='function')
   throw error('gold_support_delivery_adapter_missing');
  if(this.pumping)return{ok:true,skipped:true,reason:'worker_busy'};
  this.pumping=true;
  let delivered=0,failed=0,resolved=0;
  try{
   for(const row of await this.claim('delivery',{limit})){
    try{
     const result=await this.deliver(row);
     await this.markDelivered(row,result||{});
     delivered++;
    }catch(e){
     if(e?.status===409)throw e;
     await this.reschedule(row,e);failed++;
    }
   }
   for(const row of await this.claim('status',{limit})){
    try{
     const result=await this.checkStatus(row);
     await this.updateStatus(row,result);
     if(result?.remoteStatus==='Succeeded'&&result?.resultName)resolved++;
    }catch(e){
     if(e?.status===409)throw e;
     await this.statusRetry(row,e);
    }
   }
   const result=await this.pool.query(
    "SELECT COUNT(*)::integer AS count FROM lr_support_outbox WHERE status='queued'");
   return{ok:true,delivered,failed,resolved,pending:Number(result.rows?.[0]?.count||0)};
  }finally{this.pumping=false}
 }
}
