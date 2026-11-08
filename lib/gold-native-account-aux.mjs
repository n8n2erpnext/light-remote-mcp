/** Account/Auth auxiliaries on typed PostgreSQL, not a JSONB snapshot. */
const N=v=>v==null?null:Number(v);
const DT=v=>v==null?null:new Date(Number(v));
const MS=v=>v==null?null:new Date(v).getTime();
const SCHEMA={
 sessions:{
  table:'lr_sessions',key:'token_sha256',fields:[
   ['session_id','sessionId'],['token_sha256','tokenHash'],['account_id','accountId'],
   ['created_at','createdAt','date'],['expires_at','expiresAt','date'],['last_seen_ms','lastSeenAt']
  ]
 },
 oneTimeTokens:{
  table:'lr_gold_account_one_time_tokens',key:'token_sha256',fields:[
   ['token_sha256','tokenHash'],['kind','kind'],['account_id','accountId'],
   ['created_ms','createdAt'],['expires_ms','expiresAt']
  ]
 },
 upgradeRequests:{
  table:'lr_gold_account_upgrade_requests',key:'request_id',fields:[
   ['request_id','requestId'],['account_id','accountId'],['plan','plan'],
   ['status','status'],['created_ms','createdAt'],['resolved_ms','resolvedAt'],
   ['resolution','resolution']
  ]
 },
 pendingRegistrations:{
  table:'lr_gold_pending_registrations',key:'pending_id',fields:[
   ['pending_id','pendingId'],['email','email'],['password_hash','passwordHash'],
   ['provider','provider'],['google_sub','googleSub'],['created_ms','createdAt'],
   ['expires_ms','expiresAt'],['verification_token_sha256','verificationTokenHash'],
   ['verification_pin_hash','verificationPinHash'],['challenge_expires_ms','challengeExpiresAt'],
   ['send_count','sendCount'],['pin_attempts','pinAttempts'],
   ['challenge_locked','challengeLocked'],['last_sent_ms','lastSentAt'],
   ['resend_available_ms','resendAvailableAt']
  ]
 },
 googleSignupIntents:{
  table:'lr_gold_google_signup_intents',key:'token_sha256',fields:[
   ['token_sha256','tokenHash'],['google_sub','sub'],['email','email'],
   ['created_ms','createdAt'],['expires_ms','expiresAt']
  ]
 },
 groups:{
  table:'lr_gold_account_groups',key:'group_id',fields:[
   ['group_id','groupId'],['name','name'],['protected','protected'],['created_ms','createdAt']
  ]
 }
};
const sqlFor=s=>{
 const cols=s.fields.map(f=>f[0]);
 return `INSERT INTO ${s.table}(${cols.join(',')})
 VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')})
 ON CONFLICT(${s.key}) DO UPDATE SET
 ${cols.filter(col=>col!==s.key).map(col=>col+'=EXCLUDED.'+col).join(',')}`;
};
const encode=(row,field)=>{
 const v=row[field[1]]??null;
 return field[2]==='date'?DT(v):v;
};
const decode=(db,field)=>{
 const value=db[field[0]];
 return field[2]==='date'?MS(value):(
  field[0].endsWith('_ms')||['created_ms','expires_ms'].includes(field[0])
  ?N(value):value);
};
export class GoldNativeAccountAux{
 constructor({pool,singleOwnerEnabled=process.env.LR_GOLD_SINGLE_OWNER_AUTHORITY==='1'}={}){
  if(!pool?.query)throw Error('gold_account_aux_pg_required');
  this.pool=pool;this.singleOwnerEnabled=singleOwnerEnabled;
 }
 static async open({pool,singleOwnerEnabled=process.env.LR_GOLD_SINGLE_OWNER_AUTHORITY==='1'}={}){
  const store=new GoldNativeAccountAux({pool,singleOwnerEnabled}),data={schemaVersion:1};
  if(singleOwnerEnabled){
   // Fail closed if SQL045 is not explicitly installed in this instance.
   const owner=await pool.query(
    'SELECT owner_account_id,revision FROM lr_gold_owner_authority WHERE singleton_id=1');
   if(owner.rows.length>1)throw Error('gold_single_owner_multiple_rows');
   data.ownerAccountId=owner.rows[0]?.owner_account_id??null;
   data.ownerRevision=Number(owner.rows[0]?.revision??0);
  }
  for(const [domain,spec] of Object.entries(SCHEMA)){
   const {rows}=await pool.query('SELECT * FROM '+spec.table);
   data[domain]=rows.map(r=>[
    r[spec.key],Object.fromEntries(spec.fields.map(f=>[f[1],decode(r,f)]))
   ]);
  }
  return {store,data};
 }
 async write(data,client){
  // Called inside the same transaction that upserts lr_accounts AND revokes
  // sessions. A stale writer must never resurrect a previous Owner.
  if(this.singleOwnerEnabled){
   const accountIds=new Set((data.accounts||[]).map(row=>row[0]));
   const desired=String(data.ownerAccountId||''),revision=Number(data.ownerRevision);
   if(!Number.isSafeInteger(revision)||revision<0||!desired||
      (accountIds.size>0&&!accountIds.has(desired)))
    throw Error('gold_single_owner_persistence_invalid');
   if(accountIds.size){
    const current=await client.query(
     'SELECT owner_account_id,revision FROM lr_gold_owner_authority WHERE singleton_id=1 FOR UPDATE');
    if(!current.rows.length){
     if(revision!==0)throw Error('gold_single_owner_initial_revision_mismatch');
     await client.query(
      'INSERT INTO lr_gold_owner_authority(singleton_id,owner_account_id,revision) VALUES(1,$1,0)',
      [desired]);
    }else{
     const stored=current.rows[0],storedRev=Number(stored.revision);
     if(storedRev===revision&&stored.owner_account_id===desired){
      // Unchanged Owner: routine account writes may proceed.
     }else if(storedRev+1===revision&&stored.owner_account_id!==desired){
      const updated=await client.query(
       'UPDATE lr_gold_owner_authority SET owner_account_id=$1,revision=$2,updated_at=now() WHERE singleton_id=1 AND owner_account_id=$3 AND revision=$4',
       [desired,revision,stored.owner_account_id,storedRev]);
      if(updated.rowCount!==1)throw Error('gold_single_owner_cas_conflict');
      await client.query(
       'INSERT INTO lr_gold_owner_handoffs(owner_revision,from_account_id,to_account_id) VALUES($1,$2,$3)',
       [revision,stored.owner_account_id,desired]);
     }else throw Error('gold_single_owner_stale_write_denied');
    }
   }
  }
  for(const [domain,spec] of Object.entries(SCHEMA)){
   const rows=new Map(data[domain]||[]);
   for(const row of rows.values()){
    const values=spec.fields.map(f=>encode(row,f));
    await client.query(sqlFor(spec),values);
   }
   await client.query(`DELETE FROM ${spec.table} WHERE NOT(${spec.key}=ANY($1::text[]))`,
    [[...rows.keys()]]);
  }
 }
}
