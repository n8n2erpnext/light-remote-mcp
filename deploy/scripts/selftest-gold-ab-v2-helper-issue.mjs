// P2-I2h1: Agent-first source issue with OAuth proof and Redis request identity.
// Fake Redis implements issue/agent atomically for contract testing; real
// Redis Lua concurrency acceptance stays on the isolated no-NIC clone.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGoldAbV2HelperTarget} from '../../operator-host/gold-ab-v2-helper-target.mjs';
import {goldAbV2HelperKey,signGoldAbV2HelperTarget}
 from '../../lib/gold-ab-v2-helper-proof.mjs';
import {AB_V2_B_RE,GoldAbV2PendingRedis} from '../../lib/gold-ab-v2-pending-redis.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-abv2-issue-'));
const keyFile=path.join(root,'key');
fs.writeFileSync(keyFile,crypto.randomBytes(32),{mode:0o600});
const env={LIGHT_REMOTE_GOLD_ROOT:root,LR_GOLD_AB_V2_SEAL_KEY_FILE:keyFile,
 LR_GOLD_AB_V2_HELPER_PROOF_KEY_FILE:keyFile,
 LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',LR_GOLD_AB_V2_HELPER_TARGET_QUERY:'1',
 LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE:'1',
 LR_GOLD_AB_V2_OWNER_ORIGIN:'https://gold.example.test',
 LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'acct1',
 LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:'dev1;invalid'.split(';')[0]};
const key=goldAbV2HelperKey(env);
const id={accountId:'acct1',clientId:'opaque-oauth-client-'+('x'.repeat(310))};
const records=new Map(),used=new Set();
const redis={
 async set(k,_v,{NX,EX}){assert.equal(NX,true);assert.equal(EX,90);
  if(used.has(k))return null;used.add(k);return 'OK';},
 async eval(_lua,{keys,arguments:args}){
  const [op,raw]=args,p=JSON.parse(raw),rk=keys[0],old=records.get(rk);
  if(op==='issue'){
   if(old){
    for(const fld of ['owner','actor','agent','client','device','connection','shortId'])
     assert.equal(old[fld],p[fld],'idempotent scoped reuse');
    return JSON.stringify({state:old.state,requestId:old.requestId,
     attempt:old.attempt,expiresAt:old.expiresAt,reused:true});
   }
   const row={...p,createdAt:Date.now(),expiresAt:Date.now()+300000};
   records.set(rk,row);
   return JSON.stringify({state:'pending',requestId:p.requestId,attempt:1,expiresAt:row.expiresAt});
  }
  if(op==='agent'){
   assert(old,'agent request must exist');
   for(const [fld,value] of Object.entries({
    actor:p.actor,agent:p.agent,client:p.client,connection:p.connection}))
    assert.equal(old[fld],value,'private B only to exact OAuth Agent');
   return JSON.stringify({state:old.state,requestId:old.requestId,
    attempt:old.attempt,expiresAt:old.expiresAt,box:old.box});
  }
  throw Error('unexpected_redis_mutation');
 }
};
let schema=true,revoked=false,online=true,connectionId='cn-1',connected=true;
const sql={async query(sqlText,params){
 if(sqlText.includes('to_regclass'))return {rows:[{present:schema}]};
 assert.equal(params[0],'acct1');
 return {rows:[{device_id:'dev1',short_id:'ABCD02',node_id:'node1',
  display_name:'Windows 11',platform:'windows',state:'online'}]};
}};
const devices={get:()=>({deviceId:'dev1',accountId:'acct1',
 state:online?'online':'offline',publicIdentityKey:'pub1'})};
const enrollments={binding:()=>({accountId:'acct1',publicIdentityKey:'pub1',revokedAt:revoked?Date.now():null}),
 policyView:()=>({accountId:'acct1',policyProfile:'default',approvedCapabilities:['filesystem']})};
const connections={get:()=>({deviceId:'dev1',accountId:'acct1',
 connectionId,state:connected?'connected':'disconnected',hardExpiresAt:Date.now()+600000}),
 assertConnected:()=>{if(!connected)throw Error('connection_closed');
 return connections.get();}};
const route='/v1/plugin/abv2/request-issue';
const resolver='/v1/plugin/abv2/target-resolve';
const make=(e=env)=>createGoldAbV2HelperTarget({env:e,
 storage:{pool:sql,redis,prefix:'lr:gold:fixture:'},
 accounts:{assertOperational:()=>({accountId:'acct1',emailVerified:true})},
 devices,enrollments,connections,readJson:async req=>req.body,
 sendJson:(res,status,payload)=>{res.status=status;res.body=payload;}});
const signed=(purpose='issue',extra={},identity=id)=>signGoldAbV2HelperTarget({
 identity,targetQuery:'ABCD02',purpose,
 selectedDeviceId:purpose==='issue'?'dev1':null,
 requestKey:purpose==='issue'?'a'.repeat(32):null,...extra,key});
const call=async(handler,proof,path=route,method='POST')=>{
 const res={};const handled=await handler({method,body:proof},res,
  new URL('http://operator'+path));assert.equal(handled,true);return res;
};
try{
 const off=make({...env,LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE:'0'});
 assert.equal((await call(off,signed())).status,404);
 assert.equal(records.size,0);
 const issue=make();
 assert.equal((await call(issue,signed('resolve'))).status,403,
  'resolve proof cannot write pending');
 assert.equal((await call(issue,signed(),resolver)).status,403,
  'issue proof cannot be used for discovery');
 assert.equal(records.size,0);
 const first=await call(issue,signed());
 assert.equal(first.status,200);
 assert.equal(first.body.status,'v2_pending_unapproved');
 assert.equal(first.body.approvalState,'pending');
 assert.equal(first.body.helperReady,false);
 assert.match(first.body.requestId,/^av2_[a-f0-9]{32}$/);
 assert.match(first.body.bCode,AB_V2_B_RE);
 assert.equal(first.body.shortId,'ABCD02');
 assert.equal(first.body.requestKey,'a'.repeat(32));
 assert.equal(first.body.nextAction,'owner_v2_b_approval_not_enabled');
 assert.equal(records.size,1);
 const stored=[...records.values()][0];
 assert.equal(stored.actor,'acct1');
 assert.equal(stored.agent,first.body.requestId?stored.agent:'');
 assert.match(stored.client,/^oauth-[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(stored).includes(id.clientId),'opaque OAuth JWT never stored');
 assert.ok(!JSON.stringify(stored).includes(first.body.bCode),'plaintext B not stored');
 const again=await call(issue,signed());
 assert.equal(again.status,200);
 assert.equal(again.body.requestId,first.body.requestId);
 assert.equal(again.body.bCode,first.body.bCode);
 assert.equal(again.body.reused,true);
 assert.equal(records.size,1,'retry must not create a second pending request');
 const changedAttempt=await call(issue,signed('issue',{requestKey:'b'.repeat(32)}));
 assert.equal(changedAttempt.status,200);
 assert.notEqual(changedAttempt.body.requestId,first.body.requestId);
 assert.equal(records.size,2);
 const otherClient=await call(issue,signed('issue',{},{
  accountId:'acct1',clientId:'opaque-other-client-'+('y'.repeat(300))}));
 assert.equal(otherClient.status,200);
 assert.notEqual(otherClient.body.requestId,first.body.requestId,
  'different OAuth clients cannot reuse another Agent request');
 const badDevice=await call(issue,signed('issue',{selectedDeviceId:'dev2'}));
 assert.equal(badDevice.status,409);
 const badTarget=await call(issue,signed('issue',{targetQuery:'Windows 11'}));
 assert.equal(badTarget.status,409);
 const forged={...signed(),selectedDeviceId:'dev2'};
 assert.equal((await call(issue,forged)).status,401);
 const old=signGoldAbV2HelperTarget({identity:id,targetQuery:'ABCD02',purpose:'issue',
  selectedDeviceId:'dev1',requestKey:'c'.repeat(32),key,now:Date.now()-90000});
 assert.equal((await call(issue,old)).status,401);
 const replay=signed('issue',{requestKey:'d'.repeat(32)});
 assert.equal((await call(issue,replay)).status,200);
 assert.equal((await call(issue,replay)).status,409);
 const count=records.size;
 schema=false;
 const missing=await call(issue,signed('issue',{requestKey:'e'.repeat(32)}));
 assert.equal(missing.status,503);
 assert.equal(missing.body.error,'abv2_short_id_schema_not_ready');
 assert.equal(records.size,count);
 schema=true;
 revoked=true;
 assert.equal((await call(issue,signed('issue',{requestKey:'e'.repeat(32)}))).status,409);
 revoked=false;
 online=false;
 assert.equal((await call(issue,signed('issue',{requestKey:'e'.repeat(32)}))).status,409);
 online=true;connected=false;
 assert.equal((await call(issue,signed('issue',{requestKey:'e'.repeat(32)}))).status,409);
 connected=true;connectionId='cn-2';
 const reconnected=await call(issue,signed());
 assert.equal(reconnected.status,200);
 assert.notEqual(reconnected.body.requestId,first.body.requestId,
  'new connection must use a different requestId, even with same client request key');
 assert.equal((await call(issue,signed('issue',{requestKey:'f'.repeat(32)}),route,'GET')).status,405);
 const lua=fs.readFileSync(new URL('../../lib/gold-ab-v2-pending-redis.mjs',import.meta.url),'utf8');
 assert.match(lua,/if redis\.call\('EXISTS',k\)==1 then/);
 assert.match(lua,/old\.owner~=p\.owner/);
 assert.match(lua,/old\.connection~=p\.connection/);
 assert.match(lua,/reused=true/);
 console.log('GOLD_ABV2_HELPER_AGENT_FIRST_ISSUE_SCOPE_REPLAY_IDEMPOTENT_NO_READY=PASS');
 console.log('GOLD_ABV2_HELPER_ISSUE_PG043_OFFLINE_REVOKE_FAILCLOSED=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
