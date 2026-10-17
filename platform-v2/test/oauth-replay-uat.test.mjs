import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {OAuthReplayGateUat,PgOAuthReplayStoreUat} from '../src/identity/oauth-replay-uat.mjs';

const ORIGIN='https://rc50-mcp.thaiduy.digital';
const secret=crypto.randomBytes(32);
const verifier=crypto.randomBytes(32).toString('base64url');
const now=Date.UTC(2026,9,11,16,30)/1000;
function sign(payload){
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const content=header+'.'+body;
  const mac=crypto.createHmac('sha256',secret).update(content).digest('base64url');
  return content+'.'+mac;
}
function verifyJwt(token,{issuer,audience,tokenUse}){
  const [a,b,c,...extra]=token.split('.');
  if(!a||!b||!c||extra.length)throw Error('invalid_jwt_parts');
  const hdr=JSON.parse(Buffer.from(a,'base64url'));
  if(hdr.alg!=='HS256')throw Error('invalid_jwt_alg');
  const mac=crypto.createHmac('sha256',secret).update(a+'.'+b).digest('base64url');
  if(c.length!==mac.length||!crypto.timingSafeEqual(Buffer.from(c),Buffer.from(mac)))
    throw Error('invalid_jwt_signature');
  const claims=JSON.parse(Buffer.from(b,'base64url'));
  if(claims.iss!==issuer||claims.aud!==audience||claims.token_use!==tokenUse||claims.exp<=now)
    throw Error('invalid_jwt_claim');
  return claims;
}
function claim(type,jti){
  const common={iss:ORIGIN,client_id:'uat_client',jti,iat:now,scope:'remote:read'};
  if(type==='authorization_code')return {...common,token_use:'code',
    aud:ORIGIN+'/mcp',exp:now+110,sub:'uat_owner',
    resource:ORIGIN+'/mcp',redirect_uri:'https://client.example.invalid/callback',
    code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')};
  if(type==='refresh')return {...common,token_use:'refresh',aud:ORIGIN+'/mcp',
    exp:now+3600,sub:'uat_owner',resource:ORIGIN+'/mcp'};
  return {...common,token_use:'oauth-resume',aud:ORIGIN+'/oauth/resume',
    exp:now+3600,response_type:'code',code_challenge_method:'S256',
    resource:ORIGIN+'/mcp'};
}
function source(){
 const consumed=new Map();
 const store={
   verifyTarget:async()=>({database:'light_remote_rc50_uat',role:'lr_rc50_oauth_replay',superuser:false}),
   consume:async args=>{
     // Emulates one atomic DB INSERT ON CONFLICT; concurrency guarantee itself
     // is separately tested against real UAT PostgreSQL.
     if(consumed.has(args.tokenSha256))return false;
     consumed.set(args.tokenSha256,args);return true;
   }
 };
 const make=()=>new OAuthReplayGateUat({store,verifyJwt,now:()=>now*1000,allowUat:true});
 return {consumed,store,make};
}
function request(purpose,id){
 const token=sign(claim(purpose,id));
 return {token,purpose,clientId:'uat_client',
   ...(purpose==='authorization_code'?{
      redirectUri:'https://client.example.invalid/callback',codeVerifier:verifier
   }:{})};
}
test('two UAT API gate objects share one-use code and refresh decisions',async()=>{
 const {make,consumed}=source();
 const a=make(),b=make();
 await assert.rejects(()=>a.consume(request('authorization_code','code_multiprocess_123')),/oauth_replay_not_initialized/);
 await Promise.all([a.initialize(),b.initialize()]);
 for(const purpose of ['authorization_code','refresh','resume']){
   const args=request(purpose,'same_test_jti_123_'+purpose);
   const results=await Promise.all(Array.from({length:20},(_,i)=>(i%2?a:b).consume(args)));
   assert.equal(results.filter(Boolean).length,1,purpose);
   assert.equal(results.filter(x=>x===false).length,19,purpose);
 }
 assert.equal(consumed.size,3);
 assert([...consumed.keys()].every(h=>/^[0-9a-f]{64}$/.test(h)));
 assert([...consumed.keys()].every(h=>!h.includes('same_test_jti')));
 assert([...consumed.values()].every(row=>!('token' in row)&&!('jti' in row)));
});
test('invalid JWT signature, issuer, audience, PKCE and client never consume',async()=>{
 const {make,consumed}=source();const gate=make();await gate.initialize();
 const code=request('authorization_code','secure_code_123456');
 const mutated=code.token.slice(0,-1)+(code.token.endsWith('A')?'B':'A');
 await assert.rejects(()=>gate.consume({...code,token:mutated}),/invalid_jwt_signature/);
 await assert.rejects(()=>gate.consume({...code,codeVerifier:'y'.repeat(43)}),/oauth_pkce_or_redirect_mismatch/);
 await assert.rejects(()=>gate.consume({...code,clientId:'other-client'}),/oauth_verified_claim_mismatch/);
 await assert.rejects(()=>gate.consume({...code,redirectUri:'https://evil.example.invalid/callback'}),/oauth_pkce_or_redirect_mismatch/);
 await assert.rejects(()=>gate.consume({...code,resource:'https://other.invalid/mcp'}),/oauth_resource_mismatch/);
 const foreign=sign({...claim('refresh','foreign_issuer_123'),iss:'https://evil.example.invalid'});
 await assert.rejects(()=>gate.consume({token:foreign,purpose:'refresh',clientId:'uat_client'}),/invalid_jwt_claim/);
 assert.equal(consumed.size,0);
 assert.equal(await gate.consume(code),true);
});
test('replay store failures remain fail closed',async()=>{
 const {store}=source();
 store.consume=async()=>{throw Error('uat_db_offline')};
 const gate=new OAuthReplayGateUat({store,verifyJwt,now:()=>now*1000,allowUat:true});
 await gate.initialize();
 await assert.rejects(()=>gate.consume(request('refresh','failing_db_123456')),/uat_db_offline/);
});
test('API replay gate requires trusted signature verifier and approved UAT role',async()=>{
 const {store}=source();
 assert.throws(()=>new OAuthReplayGateUat({store,allowUat:true}),/trusted_signed_jwt_verifier_required/);
 assert.throws(()=>new OAuthReplayGateUat({store,verifyJwt}),/oauth_replay_uat_only/);
 store.verifyTarget=async()=>({database:'light_remote_rc50_uat',role:'lr_rc50_uat',superuser:false});
 const gate=new OAuthReplayGateUat({store,verifyJwt,allowUat:true});
 await assert.rejects(()=>gate.initialize(),/oauth_replay_unapproved_db_identity/);
});
test('Postgres adapter binds SQL and refuses owner/bootstrap role',async()=>{
 const queries=[];
 const pool={query:async(sql,args=[])=>{
   queries.push([sql,args]);
   if(sql.includes('current_database()'))
     return {rows:[{database:'light_remote_rc50_uat',role:'lr_rc50_oauth_replay',superuser:false}]};
   return {rows:[{consumed:queries.length===2}]};
 }};
 const adapter=new PgOAuthReplayStoreUat({pool,allowUat:true});
 const arg={tokenSha256:'d'.repeat(64),purpose:'authorization_code',
   accountId:'uat_owner',clientId:'uat_client',expiresEpoch:now+90};
 await assert.rejects(()=>adapter.consume(arg),/oauth_pg_not_initialized/);
 await adapter.verifyTarget();
 assert.equal(await adapter.consume(arg),true);
 assert.equal(await adapter.consume(arg),false);
 assert.deepEqual(queries[1],[
   'SELECT lr_consume_oauth_once_uat($1,$2,$3,$4,$5) AS consumed',
   ['d'.repeat(64),'authorization_code','uat_owner','uat_client',now+90]
 ]);
 await assert.rejects(()=>adapter.consume({...arg,tokenSha256:'bad'}),/invalid_oauth_replay_db_arguments/);
 assert.equal(queries.length,3);
 const denied=new PgOAuthReplayStoreUat({
   allowUat:true,pool:{query:async()=>({rows:[{database:'light_remote_rc50_uat',role:'lr_rc50_uat',superuser:false}]})}
 });
 await assert.rejects(()=>denied.verifyTarget(),/oauth_replay_unapproved_db_identity/);
});
