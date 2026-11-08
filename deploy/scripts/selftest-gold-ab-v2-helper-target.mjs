// Gold P2-I2g exact OAuth-derived Helper target discovery, no A/B/grant.
// Source-only simulated Operator PG043 and signed HMAC over private socket.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {signGoldAbV2HelperTarget,goldAbV2HelperKey,verifyGoldAbV2HelperTarget,
 stableGoldV2AgentId} from '../../lib/gold-ab-v2-helper-proof.mjs';
import {createGoldAbV2HelperTarget} from '../../operator-host/gold-ab-v2-helper-target.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'abv2-helper-proof-'));
const secret=path.join(root,'helper-proof-key');
fs.writeFileSync(secret,crypto.randomBytes(32),{mode:0o600});
const env={LIGHT_REMOTE_GOLD_ROOT:root,LR_GOLD_AB_V2_HELPER_PROOF_KEY_FILE:secret,
 LR_GOLD_AB_V2_HELPER_TARGET_QUERY:'1',LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',
 LR_GOLD_AB_V2_OWNER_ORIGIN:'https://gold.example.test',
 LR_GOLD_AB_V2_SEAL_KEY_FILE:secret,
 LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'acct1',
 LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:'dev1,dev2,dev3'};
const identity={accountId:'acct1',clientId:'eyJhbGciOiJIUzI1NiJ9.'+'a'.repeat(260)+'.signature'};
const key=goldAbV2HelperKey(env);
const redisKeys=new Set(),redis={
 async set(k,v,options){
  assert.equal(options.NX,true);assert.equal(options.EX,90);
  if(redisKeys.has(k))return null;
  redisKeys.add(k);return 'OK';
 }
};
const signed=query=>signGoldAbV2HelperTarget({identity,targetQuery:query,key});
const assertRejects=async(p,part)=>{
 await assert.rejects(p,err=>String(err.message).includes(part));
};
let schema=true,queryCount=0,sqlCount=0;
const rows=[
 {device_id:'dev1',node_id:'node1',display_name:'Windows PC',platform:'windows',state:'online',short_id:'ABCD02'},
 {device_id:'dev2',node_id:'node2',display_name:'Windows PC',platform:'windows',state:'online',short_id:'GHJK45'},
 {device_id:'dev3',node_id:'node3',display_name:'Home Server',platform:'linux',state:'online',short_id:'MNPQ67'},
 {device_id:'dev_other',node_id:'node4',display_name:'Other Secret',platform:'linux',state:'online',short_id:'QQQQ22'}
];
const sql={async query(text,params){
 sqlCount++;
 if(text.includes('to_regclass'))return {rows:[{present:schema}]};
 assert(text.includes('owner_account_id=$1'),'SQL must scope to owner');
 assert.equal(params[0],'acct1');
 return {rows:rows.filter(x=>x.device_id!=='dev_other')};
}};
let principal={accountId:'acct1',emailVerified:true};
let revoked=false,changedKey=false;
const poolDevices={get(id){return {deviceId:id,accountId:'acct1',state:'online',
 publicIdentityKey:'pkey-'+id};}};
const enrollments={
 binding(id){return {deviceId:id,accountId:'acct1',revokedAt:revoked?1:null,
 publicIdentityKey:changedKey?'rotated':'pkey-'+id};},
 policyView:()=>({accountId:'acct1',policyProfile:'default',
 approvedCapabilities:['filesystem']})
};
const connections={get:id=>({deviceId:id,accountId:'acct1',
 connectionId:'cn-'+id,state:'connected',hardExpiresAt:Date.now()+60000})};
const route=new URL('http://operator/v1/plugin/abv2/target-resolve');
const sendJson=(res,status,body)=>{res.status=status;res.body=body;return body};
const create=(customEnv=env)=>createGoldAbV2HelperTarget({
 env:customEnv,storage:{pool:sql,redis,prefix:'lr:gold:fixture:'},
 accounts:{assertOperational:()=>principal},devices:poolDevices,
 enrollments,connections,readJson:async req=>req.data,sendJson});
const execute=async(handler,proof,method='POST')=>{
 const res={};const handled=await handler({method,data:proof},res,route);
 assert.equal(handled,true);return res;
};
try{
 const unsigned=create({...env,LR_GOLD_AB_V2_HELPER_TARGET_QUERY:'0'});
 assert.equal((await execute(unsigned,signed('Windows PC'))).status,404);
 const handle=create();
 const a=signed('Windows PC');
 assert.equal(a.agentId,stableGoldV2AgentId(identity));
 const multi=await execute(handle,a);
 assert.equal(multi.status,200);
 assert.equal(multi.body.status,'ambiguous');
 assert.equal(multi.body.total,2);
 assert.equal(multi.body.matches.length,2);
 assert.equal(multi.body.approvalState,'not_issued');
 assert.equal(multi.body.helperReady,false);
 assert.equal(multi.body.nextAction,'choose_exact_device');
 const again=await execute(handle,a);
 assert.equal(again.status,409,'same proof nonce cannot replay');
 const exact=await execute(handle,signed('ABCD02'));
 assert.equal(exact.status,200);
 assert.equal(exact.body.status,'single');
 assert.equal(exact.body.matches[0].deviceId,'dev1');
 assert.equal(exact.body.matches[0].shortId,'ABCD02');
 const unknown=await execute(handle,signed('Other Secret'));
 assert.equal(unknown.body.status,'not_found','other account must be excluded');
 assert.equal(unknown.body.matches.length,0);
 const tampered={...signed('ABCD02'),targetQuery:'GHJK45'};
 assert.equal((await execute(handle,tampered)).status,401);
 const other={...signed('ABCD02'),accountId:'acct2'};
 assert.equal((await execute(handle,other)).status,401);
 const expired=signGoldAbV2HelperTarget({identity,targetQuery:'ABCD02',key,now:Date.now()-80000});
 assert.equal((await execute(handle,expired)).status,401);
 const future=signGoldAbV2HelperTarget({identity,targetQuery:'ABCD02',key,now:Date.now()+80000});
 assert.equal((await execute(handle,future)).status,401);
 const preSchema=sqlCount;
 schema=false;
 const missing=await execute(handle,signed('ABCD02'));
 assert.equal(missing.status,503);
 assert.equal(missing.body.error,'abv2_short_id_schema_not_ready');
 assert.equal(sqlCount,preSchema+1,'no owner SQL before PG043');
 schema=true;
 principal={...principal,emailVerified:false};
 assert.equal((await execute(handle,signed('ABCD02'))).status,403);
 principal={...principal,emailVerified:true};
 revoked=true;
 assert.equal((await execute(handle,signed('ABCD02'))).body.status,'not_found');
 revoked=false;
 changedKey=true;
 assert.equal((await execute(handle,signed('ABCD02'))).body.status,'not_found');
 changedKey=false;
 assert.equal((await execute(handle,signed('ABCD02'),'GET')).status,405);
 assert.equal(create({...env,LR_GOLD_AB_V2_HELPER_TARGET_QUERY:'0'}) instanceof Function,true);
 const text=JSON.stringify(multi.body);
 for(const forbidden of ['bCode','pollToken','grantId','authorization','ready:true','dev_other'])
  assert.equal(text.includes(forbidden),false,forbidden);
 assert.equal(redisKeys.size>=5,true);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('GOLD_ABV2_OAUTH_HELPER_TARGET_PROOF_REPLAY_SCOPE_PG043_FAILCLOSED=PASS');
