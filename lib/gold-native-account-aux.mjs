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
 constructor({pool}){if(!pool?.query)throw Error('gold_account_aux_pg_required');this.pool=pool}
 static async open({pool}){
  const store=new GoldNativeAccountAux({pool}),data={schemaVersion:1};
  for(const [domain,spec] of Object.entries(SCHEMA)){
   const {rows}=await pool.query('SELECT * FROM '+spec.table);
   data[domain]=rows.map(r=>[
    r[spec.key],Object.fromEntries(spec.fields.map(f=>[f[1],decode(r,f)]))
   ]);
  }
  return {store,data};
 }
 async write(data,client){
  // Called inside the same transaction that upserts lr_accounts.
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
