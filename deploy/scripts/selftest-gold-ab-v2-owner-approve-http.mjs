// P2-I2h2d: owner B V2 approve HTTP, SOURCE-ONLY loopback fixture.
// Feature OFF by default; never touches Gold UAT or real user accounts.
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {createGoldAbV2Csrf,createGoldAbV2OwnerHttp,isGoldAbV2WallConsentRecoverable}
 from '../../operator-host/gold-ab-v2-owner-http.mjs';
const origin='https://gold.example.test';
const owner='owner-proof-'+crypto.randomBytes(16).toString('hex');
const requestId='av2_'+'a'.repeat(32);
const t=Date.now(),baseRow={attempt:2,expiresAt:t+300000};
for(const state of ['pending','approved','granted']){
 assert.equal(isGoldAbV2WallConsentRecoverable({...baseRow,state},2,t),true);
}
for(const state of ['denied','expired','locked'])
 assert.equal(isGoldAbV2WallConsentRecoverable({...baseRow,state},2,t),false);
assert.equal(isGoldAbV2WallConsentRecoverable({...baseRow,state:'approved'},1,t),false);
assert.equal(isGoldAbV2WallConsentRecoverable({...baseRow,state:'approved',expiresAt:t},2,t),false);
console.log('GOLD_ABV2_WALL_OWNER_FRESH_CONSENT_PG_INTERRUPTED_RECOVERY_STATES=PASS');
const base='/v1/accounts/ab-v2/devices/dev1/pending/'+requestId+'/approve';
const key=crypto.randomBytes(32);
const csrf=createGoldAbV2Csrf({sealingKey:key,origin,sessionToken:req=>
 String(req.headers['x-light-account-session']||'')});
let approved=0,rated=0,checked=0;
const fake={
 enabled:true,
 adapter:{guard:async(req,deviceId)=>{
  checked++;
  if(deviceId!=='dev1'||req.headers['x-light-account-session']!==owner)
   throw Error('owner_guard_denied');
 }},
 csrf,
 rateLimit:async()=>{rated++;},
 readJson:async req=>{let b='';for await(const c of req)b+=c;return JSON.parse(b||'{}');},
 sendJson:(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});
  res.end(JSON.stringify(data));}
};
const route=createGoldAbV2OwnerHttp({...fake,
 approveOwner:async(req,x)=>{
  approved++;
  assert.equal(req.headers.origin,origin);
  assert.deepEqual(x,{deviceId:'dev1',requestId,expectedAttempt:2,bCode:'ABCD-2345'});
  return {state:'granted',grantId:'private-do-not-expose',
   requestId,agentId:'agent-a',approvedAt:1_800_000_000_000,
   expiresAt:1_800_000_100_000,absoluteExpiresAt:1_800_086_400_000};
 }});
const consentRoute=createGoldAbV2OwnerHttp({...fake,
 issueWallConsent:async(req,args)=>{
  assert.equal(req.headers.origin,origin);
  assert.deepEqual(args,{deviceId:'dev1',requestId,expectedAttempt:2});
  return {consentCode:'c'.repeat(32),requestId,expiresAt:1800000000000};
 }});
const disabled=createGoldAbV2OwnerHttp({...fake});
const server=http.createServer(async(req,res)=>{
 await (req.url.startsWith('/disabled/')?disabled:
  req.url.endsWith('/consent')?consentRoute:route)(req,res,
  new URL(req.url.replace(/^\/disabled/,''),'http://localhost'));
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const endpoint='http://127.0.0.1:'+server.address().port;
async function call(path,{token=owner,originHeader=origin,csrfToken,
 body={expectedAttempt:2,bCode:'ABCD-2345',agentId:'impostor',
 ownerAccountId:'impostor',connectionId:'wrong'},method='POST'}={}){
 const headers={'x-light-account-session':token,
  'content-type':'application/json',origin:originHeader};
 if(csrfToken)headers['x-light-abv2-csrf']=csrfToken;
 const res=await fetch(endpoint+path,{method,headers,body:method==='POST'?JSON.stringify(body):undefined});
 return {status:res.status,data:await res.json()};
}
try{
 const cs=csrf.nonce({headers:{'x-light-account-session':owner}},'dev1');
 assert.equal((await call('/disabled'+base,{csrfToken:cs})).status,404);
 assert.equal(approved,0);
 assert.equal((await call(base,{csrfToken:null})).status,403);
 assert.equal((await call(base,{csrfToken:cs,originHeader:'https://attacker.invalid'})).status,403);
 assert.equal((await call(base,{csrfToken:cs,token:'some-other-auth-token-with-20-letters'})).status,403);
 assert.equal((await call(base,{csrfToken:cs,body:{expectedAttempt:0,bCode:'ABCD-2345'}})).status,400);
 assert.equal((await call(base,{csrfToken:cs,body:{expectedAttempt:2,bCode:'AB10-1234'}})).status,400);
 assert.equal(approved,0,'no rejected request can grant');
 const good=await call(base,{csrfToken:cs});
 assert.equal(good.status,200);
 assert.equal(good.data.state,'granted');
 assert.equal(approved,1);
 const consentPath=base.replace('/approve','/consent');
 const consOff=await call('/disabled'+consentPath,{csrfToken:cs});
 assert.equal(consOff.status,404);
 assert.equal((await call(consentPath,{csrfToken:null})).status,403);
 assert.equal((await call(consentPath,{csrfToken:cs,originHeader:'https://bad.test'})).status,403);
 assert.equal((await call(consentPath,{csrfToken:cs,body:{expectedAttempt:0}})).status,400);
 const minted=await call(consentPath,{csrfToken:cs,body:{expectedAttempt:2,
  ownerAccountId:'spoof',connectionId:'spoof',agentId:'spoof'}});
 assert.equal(minted.status,200);
 assert.equal(minted.data.consentCode,'c'.repeat(32));
 assert.equal(Object.hasOwn(good.data,'grantId'),false,'never expose internal grantId');
 assert.ok(!JSON.stringify(good.data).includes('ABCD-2345'));
 console.log('GOLD_ABV2_OWNER_B_HTTP_ORIGIN_CSRF_NO_SPOOF_FLAG_OFF=PASS');
}finally{server.close();await once(server,'close')}
