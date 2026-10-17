import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {GoldPgCoreAuthority} from '../src/storage/gold-core-authority.mjs';
import {createGoldCoreHttpHandler} from '../src/http/gold-core-http.mjs';

test('HTTP → relational Gold Authority → parameterized PostgreSQL registration, session, logout roundtrip',async()=>{
 const accounts=new Map(),sessions=new Map(),statements=[];
 let commits=0;
 const query=async(sql,params=[])=>{
  statements.push({sql,params});
  if(sql==='BEGIN'||sql==='ROLLBACK')return{rows:[]};
  if(sql==='COMMIT'){commits++;return{rows:[]}}
  if(sql.includes('INSERT INTO lr_accounts(')){
   const [id,email,pass]=params;
   if(accounts.has(id))return{rows:[]};
   const row={account_id:id,email,plan:'free',status:'active',
    password_hash:pass,email_verified:true,password_enabled:true};
   accounts.set(id,row);
   return{rows:[{account_id:id,email,plan:row.plan,status:row.status}]};
  }
  if(sql.includes('FROM lr_accounts WHERE lower(email)=lower($1)'))
   return{rows:[...accounts.values()].filter(x=>x.email===params[0])};
  if(sql.includes('INSERT INTO lr_sessions(')){
   const [sessionId,accountId,tokenHash,expires]=params;
   assert.match(tokenHash,/^[a-f0-9]{64}$/);
   sessions.set(tokenHash,{session_id:sessionId,account_id:accountId,
    expires_at:new Date(expires),revoked:false});
   return{rows:[]};
  }
  if(sql.includes('UPDATE lr_accounts SET last_login_at'))return{rows:[]};
  if(sql.includes('FROM lr_sessions s JOIN lr_accounts a')){
   const row=sessions.get(params[0]),person=accounts.get(row?.account_id);
   if(!row||row.revoked||person?.status!=='active')return{rows:[]};
   return{rows:[{...row,email:person.email,plan:person.plan}]};
  }
  if(sql.startsWith("UPDATE lr_sessions SET revoked_at=now(),revoked_reason='logout'")){
   const row=sessions.get(params[0]);
   if(!row||row.revoked)return{rows:[]};
   row.revoked=true;return{rows:[{session_id:row.session_id}]};
  }
  throw Error('unhandled_sql_roundtrip:'+sql.slice(0,150));
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const core=new GoldPgCoreAuthority({
  pool,pairingEncryptionKey:crypto.randomBytes(32),
  verifyIdentityProof:async ctx=>ctx.purpose==='verified_email'&&
    ctx.accountId==='acct_roundtrip'&&ctx.proof==='internal_challenge',
  verifyDeviceProof:async()=>false,verifyAgentPrincipal:async()=>null,
  verifyWallApproval:async()=>false,verifyPaddleSignature:async()=>null
 });
 const route=createGoldCoreHttpHandler({
  core,team:{},
  approveWallRequest:async()=>null,verifyAgentIngress:async()=>null,
  verifyOAuthClient:async()=>null,verifyBillingIngress:async()=>null,
  verifyUsageIngress:async()=>null
 });
 const server=http.createServer(async(req,res)=>{
  if(!await route(req,res)){res.statusCode=404;res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint='http://127.0.0.1:'+server.address().port;
 const req=async(path,method='POST',body=null,token=null)=>{
  const res=await fetch(endpoint+path,{method,headers:{
   ...(body!==null?{'content-type':'application/json'}:{}),
   ...(token?{authorization:'Bearer '+token}:{})
  },body:body!==null?JSON.stringify(body):undefined});
  return{status:res.status,body:await res.json()};
 };
 try{
  const signup=await req('/v1/accounts/register','POST',{
   accountId:'acct_roundtrip',email:'test@local.invalid',password:'Long-Passphrase-123',
   emailChallenge:'internal_challenge'});
  assert.equal(signup.status,201);
  assert.equal(accounts.size,1);
  assert.notEqual(accounts.get('acct_roundtrip').password_hash,'Long-Passphrase-123');
  const failed=await req('/v1/accounts/login','POST',
   {email:'test@local.invalid',password:'WrongPassword!'});
  assert.equal(failed.status,401);
  const login=await req('/v1/accounts/login','POST',
   {email:'test@local.invalid',password:'Long-Passphrase-123'});
  assert.equal(login.status,200);
  const bearer=login.body.token;
  assert.equal(sessions.size,1);
  assert(!sessions.has(bearer),'a raw bearer must not be stored in PostgreSQL');
  assert.equal((await req('/v1/accounts/me','GET',null,bearer)).status,200);
  assert.equal((await req('/v1/accounts/logout','POST',{},bearer)).status,200);
  const after=await req('/v1/accounts/me','GET',null,bearer);
  assert.equal(after.status,401,'revoked token must never authenticate');
  assert.equal(commits,2,'only signup and successful login commit; incorrect password rolls back');
  assert(statements.some(s=>s.sql==='ROLLBACK'),'incorrect password must roll back');
  assert(statements.some(s=>s.sql.startsWith('INSERT INTO lr_sessions(')));
  assert(statements.some(s=>s.sql.includes("revoked_reason='logout'")));
 }finally{await new Promise(resolve=>server.close(resolve))}
});
