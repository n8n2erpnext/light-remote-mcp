// P2-I2d source-only loopback HTTP negative tests. Does not reach Gold UAT.
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {GoldAbV2OwnerPendingAdapter,GoldAbV2OwnerPendingError}
 from '../../lib/gold-ab-v2-owner-pending-adapter.mjs';
import {goldAbV2OwnerHttpConfig,createGoldAbV2Csrf,
 createGoldAbV2OwnerHttp,createGoldAbV2OwnerHttpFromOperator}
 from '../../operator-host/gold-ab-v2-owner-http.mjs';

const base='/v1/accounts/ab-v2/devices/dev1';
const reqId='av2_'+'a'.repeat(32);
const origin='https://gold.example.test';
const key=crypto.randomBytes(32);
const tokenOwner='owner-session-token-'+crypto.randomBytes(16).toString('hex');
const tokenOther='other-session-token-'+crypto.randomBytes(16).toString('hex');
const tokenByAccount=new Map([[tokenOwner,{account:{accountId:'owner1',status:'active'}}],
 [tokenOther,{account:{accountId:'owner2',status:'active'}}]]);
const devices=new Map([['dev1',{deviceId:'dev1',accountId:'owner1',state:'online',publicIdentityKey:'pkey'}]]);
let enrollment=true,policy=true,allowed=true;
let connection={deviceId:'dev1',accountId:'owner1',connectionId:'conn1',state:'connected',hardExpiresAt:Date.now()+300000};
const audit=[];
const pending={
 listDevicePending:async opts=>{
  audit.push(['list',opts]);return [{requestId:reqId,state:'pending',attempt:1,
   expiresAt:Date.now()+200000,aCode:'ABCD02-GHFDX',box:'SECRET',bCode:'SECRET'}];
 },
 wallView:async opts=>{
  audit.push(['view',opts]);return {requestId:reqId,state:'pending',attempt:1,
   expiresAt:Date.now()+200000,aCode:'ABCD02-GHFDX',box:'SECRET',bCode:'SECRET'};
 },
 refresh:async opts=>{audit.push(['refresh',opts]);return {requestId:reqId,state:'pending',
  attempt:2,expiresAt:Date.now()+300000};},
 deny:async opts=>{audit.push(['deny',opts]);return {requestId:reqId,state:'denied'};}
};
const token=req=>String(req.headers['x-light-account-session']||'');
const csrf=createGoldAbV2Csrf({sealingKey:key,origin,sessionToken:token});
const adapter=new GoldAbV2OwnerPendingAdapter({
 pending,
 authenticateOwner:req=>{
  const identity=tokenByAccount.get(token(req));
  if(!identity)throw new GoldAbV2OwnerPendingError('abv2_owner_session_required',401);
  return identity;
 },
 getDevice:async id=>devices.get(id)||null,
 getConnection:async()=>connection,
 verifyEnrolledConnection:async()=>enrollment,
 authorizeOwnerAction:async()=>policy,
 verifyOwnerMutation:({request,deviceId})=>csrf.verify(request,deviceId),
 isFeatureEnabled:async()=>allowed
});
let rateDeny=false;
const rateLimit=async()=>{if(rateDeny)throw new GoldAbV2OwnerPendingError('abv2_owner_http_rate_limited',429)};
const sendJson=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body))};
const readJson=async req=>{
 let src='';for await(const chunk of req)src+=chunk;
 return JSON.parse(src||'{}');
};
const ownerHttp=createGoldAbV2OwnerHttp({enabled:true,adapter,csrf,rateLimit,readJson,sendJson});
const server=http.createServer(async(req,res)=>{
 const handled=await ownerHttp(req,res,new URL(req.url,'http://localhost'));
 if(!handled)sendJson(res,404,{ok:false,error:'not_found'});
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const endpoint='http://127.0.0.1:'+server.address().port;
async function call(target,{method='GET',who=tokenOwner,cs='',originHeader=null,body=null}={}){
 const headers={'x-light-account-session':who};
 if(cs)headers['x-light-abv2-csrf']=cs;
 if(originHeader)headers.origin=originHeader;
 if(body){headers['content-type']='application/json'}
 const r=await fetch(endpoint+target,{method,headers,body:body?JSON.stringify(body):undefined});
 return {status:r.status,data:await r.json()};
}
try{
 const t=await call(base+'/csrf');
 assert.equal(t.status,200);
 const cs=t.data.csrf;
 assert.match(cs,/^[A-Za-z0-9_-]{43}$/);
 assert.notEqual(cs,createGoldAbV2Csrf({sealingKey:key,origin,sessionToken:()=>tokenOther}).nonce({},'dev1'));
 const l=await call(base+'/pending');
 assert.equal(l.status,200);
 assert.equal(l.data.pending[0].aCode,'ABCD02-GHFDX');
 assert.ok(!JSON.stringify(l.data).includes('SECRET'));
 assert.equal(audit.at(-1)[1].ownerAccountId,'owner1');
 const detail=await call(base+'/pending/'+reqId);
 assert.equal(detail.status,200);
 assert.ok(!JSON.stringify(detail.data).includes('SECRET'));
 const bads=[
  await call(base+'/pending',{who:tokenOther}),
  await call(base+'/pending',{who:'bogus-token-000000000000000000000000000000'}),
  await call(base+'/pending/'+reqId+'/refresh',{method:'POST',body:{expectedAttempt:1}}),
  await call(base+'/pending/'+reqId+'/refresh',{method:'POST',cs,originHeader:'https://evil.example',body:{expectedAttempt:1}}),
  await call(base+'/pending/'+reqId+'/refresh',{method:'POST',cs,body:{expectedAttempt:1},who:tokenOther})
 ];
 assert.deepEqual(bads.map(x=>x.status),[403,401,403,403,403]);
 assert.equal(audit.filter(x=>x[0]==='refresh').length,0,'bad requests have NO effect');
 const refresh=await call(base+'/pending/'+reqId+'/refresh',{method:'POST',cs,originHeader:origin,
  body:{expectedAttempt:1,ownerAccountId:'other-owner',deviceId:'other-device',clientId:'spoof'}});
 assert.equal(refresh.status,200);
 assert.equal(refresh.data.attempt,2);
 assert.equal(audit.at(-1)[1].ownerAccountId,'owner1');
 assert.equal(audit.at(-1)[1].deviceId,'dev1');
 const deny=await call(base+'/pending/'+reqId+'/deny',{method:'POST',cs,body:{}});
 assert.equal(deny.status,200);
 const before=audit.length;
 rateDeny=true;
 const limited=await call(base+'/pending/'+reqId+'/refresh',{method:'POST',cs,body:{expectedAttempt:2}});
 assert.equal(limited.status,429);
 assert.equal(audit.length,before,'rate limit before any effect');
 rateDeny=false;
 connection={...connection,hardExpiresAt:Date.now()-1};
 assert.equal((await call(base+'/pending')).status,409);
 connection={...connection,hardExpiresAt:Date.now()+300000};
 enrollment=false;assert.equal((await call(base+'/pending')).status,403);enrollment=true;
 policy=false;assert.equal((await call(base+'/pending')).status,403);policy=true;
 allowed=false;assert.equal((await call(base+'/pending')).status,404);allowed=true;
 assert.equal((await call(base+'/pending/'+reqId+'/approve',{method:'POST',cs,body:{}})).status,404);
 assert.equal((await call(base+'/pending/'+reqId+'/refresh',{method:'GET'})).status,405);
 assert.equal(typeof adapter.approve,'undefined');
}finally{server.close();await once(server,'close')}

const disabled=createGoldAbV2OwnerHttpFromOperator({env:{},sendJson});
const fake={headers:{},method:'GET'};
const response={headersSent:false,writeHead(status){this.status=status;this.headersSent=true},
 end(body){this.body=body}};
assert.equal(await disabled(fake,response,new URL(base+'/pending','http://localhost')),true);
assert.equal(response.status,404);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'abv2-http-fixture-'));
try{
 const secret=path.join(dir,'owner-key');
 fs.writeFileSync(secret,key,{mode:0o600});
 const env={LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',
 LIGHT_REMOTE_GOLD_ROOT:dir,LR_GOLD_AB_V2_SEAL_KEY_FILE:secret,
 LR_GOLD_AB_V2_OWNER_ORIGIN:origin,
 LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'owner1',
 LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:'dev1'};
 assert.equal(goldAbV2OwnerHttpConfig(env).enabled,true);
 assert.throws(()=>goldAbV2OwnerHttpConfig({...env,
  LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:''}),/abv2_owner_allowlist_required/);
 assert.throws(()=>goldAbV2OwnerHttpConfig({...env,
  LR_GOLD_AB_V2_OWNER_ORIGIN:'http://evil.example'}),/abv2_owner_origin_invalid/);
 fs.chmodSync(secret,0o644);
 assert.throws(()=>goldAbV2OwnerHttpConfig(env),/abv2_seal_file_permissions_invalid/);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('GOLD_ABV2_OPERATOR_HTTP_OWNER_AUTH_CSRF_SCOPE_RATE_NO_APPROVE=PASS');
// Exercise the actual Operator factory with a simulated Redis/EnrollmentRegistry.
// This is still a disposable local HTTP fixture, NOT a live OAuth/Agent test.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'abv2-operator-factory-'));
let factoryServer;
try{
 const secretFile=path.join(root,'owner-seal');
 fs.writeFileSync(secretFile,key,{mode:0o600});
 const env={LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',LIGHT_REMOTE_GOLD_ROOT:root,
  LR_GOLD_AB_V2_SEAL_KEY_FILE:secretFile,LR_GOLD_AB_V2_OWNER_ORIGIN:origin,
  LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'owner1',
  LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:'dev1'};
 let redisEvaluations=0;
 let activePolicy={accountId:'owner1',policyProfile:'default',policyRevision:1,
  approvedCapabilities:['filesystem']};
 let activeBinding={accountId:'owner1',publicIdentityKey:'pkey',revokedAt:null};
 let activeConnection={deviceId:'dev1',accountId:'owner1',connectionId:'conn1',
  state:'connected',hardExpiresAt:Date.now()+300000};
 const redis={
  zRange:async()=>activeConnection.connectionId==='conn1'?[reqId]:[],
  eval:async(script,{arguments:args})=>{
   redisEvaluations++;
   if(script.includes("local op=ARGV[1]")){
    const op=args[0],scope=JSON.parse(args[1]);
    assert.equal(scope.owner,'owner1');
    assert.equal(scope.device,'dev1');
    assert.equal(scope.connection,'conn1');
    if(op==='wall')return JSON.stringify({requestId:reqId,state:'pending',attempt:1,
     expiresAt:Date.now()+200000,aCode:'ABCD02-GHFDX',requester:'agent',box:'SECRET'});
    if(op==='refresh')return JSON.stringify({requestId:reqId,state:'pending',
     attempt:2,expiresAt:Date.now()+300000});
    if(op==='deny')return JSON.stringify({requestId:reqId,state:'denied'});
    throw Error('unexpected_redis_op_'+op);
   }
   return 1; // rate limiter fixture
  }
 };
 const composed=createGoldAbV2OwnerHttpFromOperator({
  env,storage:{redis,prefix:'lr:gold:sourcefixture:'},
  requireAccount:req=>{
   const found=tokenByAccount.get(token(req));
   if(!found)throw new GoldAbV2OwnerPendingError('abv2_owner_session_required',401);
   return found;
  },
  accountSessionToken:token,
  accounts:{assertOperational:id=>id==='owner1'?{accountId:'owner1'}:null},
  devices:{get:id=>devices.get(id)},
  connections:{get:()=>activeConnection},
  enrollments:{binding:()=>activeBinding,policyView:()=>activePolicy},
  readJson,sendJson
 });
 factoryServer=http.createServer(async(req,res)=>{
  if(!await composed(req,res,new URL(req.url,'http://localhost')))
   sendJson(res,404,{ok:false,error:'not_found'});
 });
 factoryServer.listen(0,'127.0.0.1');await once(factoryServer,'listening');
 const e='http://127.0.0.1:'+factoryServer.address().port;
 const fetchFactory=async(url,who=tokenOwner)=>{
  const r=await fetch(e+url,{headers:{'x-light-account-session':who}});
  return {status:r.status,data:await r.json()};
 };
 const good=await fetchFactory(base+'/pending');
 assert.equal(good.status,200);
 assert.equal(good.data.pending[0].aCode,'ABCD02-GHFDX');
 assert.ok(!JSON.stringify(good.data).includes('SECRET'));
 const beforeBad=redisEvaluations;
 assert.equal((await fetchFactory(base+'/pending',tokenOther)).status,403);
 assert.equal(redisEvaluations,beforeBad,'cross-owner request cannot touch Redis');
 activeBinding={...activeBinding,publicIdentityKey:'swapped-key'};
 assert.equal((await fetchFactory(base+'/pending')).status,403);
 assert.equal(redisEvaluations,beforeBad,'key-rotated binding denied before Redis');
 activeBinding={...activeBinding,publicIdentityKey:'pkey',revokedAt:123};
 assert.equal((await fetchFactory(base+'/pending')).status,403);
 activeBinding={...activeBinding,revokedAt:null};
 activePolicy={...activePolicy,approvedCapabilities:[]};
 assert.equal((await fetchFactory(base+'/pending')).status,403);
 activePolicy={...activePolicy,approvedCapabilities:['filesystem']};
 activeConnection={...activeConnection,connectionId:'other-connection'};
 const moved=await fetchFactory(base+'/pending');
 assert.equal(moved.status,200);
 assert.deepEqual(moved.data.pending,[], 'changed connection cannot see old pending requests');
 // The Redis index and pending row both bind the request to the old connection.
 activeConnection={...activeConnection,connectionId:'conn1',hardExpiresAt:Date.now()-1};
 assert.equal((await fetchFactory(base+'/pending')).status,409);
}finally{
 if(factoryServer){factoryServer.close();await once(factoryServer,'close');}
 fs.rmSync(root,{recursive:true,force:true});
}
console.log('GOLD_ABV2_OPERATOR_HTTP_REAL_FACTORY_BINDING_NEGATIVE=PASS');
