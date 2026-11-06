import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {GoldAbV2PendingRedis} from '../../lib/gold-ab-v2-pending-redis.mjs';
import {DeviceConnectionRegistry} from '../../operator-host/device-connection-registry.mjs';
import {createGoldAbV2HelperTarget} from '../../operator-host/gold-ab-v2-helper-target.mjs';
import {goldAbV2HelperKey,signGoldAbV2HelperTarget}
 from '../../lib/gold-ab-v2-helper-proof.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'abv2-recover-'));
const realConnection=new DeviceConnectionRegistry();
realConnection.connect({accountId:'acct1',deviceId:'dev1'});
assert.equal(realConnection.get('dev1').state,'connected');
assert.equal(Object.hasOwn(realConnection.assertConnected('dev1'),'state'),false,
 'production assertConnected returns a live raw row without a state property');
const file=path.join(root,'key');fs.writeFileSync(file,crypto.randomBytes(32),{mode:0o600});
const env={LIGHT_REMOTE_GOLD_ROOT:root,LR_GOLD_AB_V2_SEAL_KEY_FILE:file,
 LR_GOLD_AB_V2_HELPER_PROOF_KEY_FILE:file,
 LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',
 LR_GOLD_AB_V2_HELPER_TARGET_QUERY:'1',
 LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE:'1',
 LR_GOLD_AB_V2_HELPER_POLL_ATTACH:'1',
 LR_GOLD_AB_V2_OWNER_ORIGIN:'https://gold.example.test',
 LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'acct1',
 LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:'dev1'};
const id={accountId:'acct1',clientId:'opaque-oauth-'+('x'.repeat(200))};
const other={accountId:'acct1',clientId:'opaque-oauth-'+('y'.repeat(200))};
const key=goldAbV2HelperKey(env),records=new Map(),zsets=new Map(),proofs=new Set();
const redis={
 async set(k,v,{NX,EX}){assert.equal(NX,true);assert.equal(EX,90);
  if(proofs.has(k))return null;proofs.add(k);return 'OK';},
 async zRange(k,start,end){return [...(zsets.get(k)||[])].slice(start,end+1);},
 async eval(_src,{keys,arguments:args}){
  const [op,raw]=args,p=JSON.parse(raw),rk=keys[0],old=records.get(rk);
  if(op==='issue'){
   if(old)return JSON.stringify({state:old.state,requestId:old.requestId,
    attempt:old.attempt,expiresAt:old.expiresAt,reused:true});
   const row={...p,createdAt:Date.now(),expiresAt:Date.now()+300000};
   records.set(rk,row);
   for(const k of [keys[3],keys[4]])zsets.set(k,[...(zsets.get(k)||[]),p.requestId]);
   return JSON.stringify({state:'pending',requestId:p.requestId,attempt:1,expiresAt:row.expiresAt});
  }
  if(!old)throw Error('abv2_not_found');
  if(op==='recover'){
   assert.equal(old.actor,p.actor);assert.equal(old.agent,p.agent);
   assert.equal(old.client,p.client);
   return JSON.stringify({state:old.state,requestId:old.requestId,
    attempt:old.attempt,expiresAt:old.expiresAt,box:old.box,
    deviceId:old.device,shortId:old.shortId,connectionId:old.connection});
  }
  if(op==='agent')return JSON.stringify({state:old.state,requestId:old.requestId,
    attempt:old.attempt,expiresAt:old.expiresAt,box:old.box});
  throw Error('unexpected_mock_op_'+op);
 }
};
let online=true,revoked=false,cn='cn1',shortId='ABCD02';
const sql={async query(q){
 if(q.includes('to_regclass'))return {rows:[{present:true}]};
 if(q.includes('SELECT s.short_id'))return {rowCount:1,rows:[{short_id:shortId}]};
 return {rows:[{deviceId:'dev1',device_id:'dev1',short_id:shortId,
  display_name:'Windows 10',platform:'windows',state:'online'}]};
}};
const devices={get:()=>({deviceId:'dev1',accountId:'acct1',state:online?'online':'offline',
 publicIdentityKey:'pub1',revokedAt:revoked?1:null})};
const enrollments={binding:()=>({deviceId:'dev1',accountId:'acct1',
 publicIdentityKey:'pub1',revokedAt:revoked?1:null}),
 policyView:()=>({accountId:'acct1',policyProfile:'default',approvedCapabilities:['filesystem']})};
const connections={get:()=>({deviceId:'dev1',accountId:'acct1',connectionId:cn,
 state:'connected',hardExpiresAt:Date.now()+300000}),
 assertConnected:()=>{const {state,...raw}=connections.get();return raw;}};
const make=(e=env)=>createGoldAbV2HelperTarget({env:e,
 storage:{pool:sql,redis,prefix:'lr:gold:fixture:'},
 accounts:{assertOperational:()=>({accountId:'acct1',emailVerified:true})},
 devices,enrollments,connections,readJson:async req=>req.body,
 sendJson:(res,status,payload)=>{res.status=status;res.body=payload;}});
const sign=(purpose='recover',identity=id,requestKey='a'.repeat(32))=>
 signGoldAbV2HelperTarget({identity,targetQuery:purpose==='issue'?'ABCD02':'',
 purpose,selectedDeviceId:purpose==='issue'?'dev1':null,
 requestKey:purpose==='issue'?requestKey:null,key});
const call=async(h,proof,route='/v1/plugin/abv2/request-recover')=>{
 const res={};assert.equal(await h({method:'POST',body:proof},res,
  new URL('http://operator.local'+route)),true);return res;
};
try{
 const off=make({...env,LR_GOLD_AB_V2_HELPER_POLL_ATTACH:'0'});
 assert.equal((await call(off,sign())).status,404);
 const handler=make();
 assert.equal((await call(handler,sign())).body.status,'none');
 const issued=await call(handler,sign('issue'),'/v1/plugin/abv2/request-issue');
 assert.equal(issued.status,200);assert.equal(issued.body.status,'v2_pending_unapproved');
 const first=await call(handler,sign());
 assert.equal(first.status,200);assert.equal(first.body.status,'pending');
 assert.equal(first.body.bCode,issued.body.bCode);
 assert.equal(first.body.deviceId,'dev1');assert.equal(first.body.shortId,'ABCD02');
 assert.equal(first.body.helperReady,false);
 assert.equal(first.body.nextAction,'owner_enter_b_in_account');
 const signed=sign();
 assert.equal((await call(handler,signed)).status,200);
 assert.equal((await call(handler,signed)).status,409,'signed proof is one-time');
 assert.equal((await call(handler,sign('recover',other))).body.status,'none');
 const bad={...sign(),clientId:other.clientId};
 assert.equal((await call(handler,bad)).status,401);
 const old=signGoldAbV2HelperTarget({identity:id,targetQuery:'',purpose:'recover',
  key,now:Date.now()-120000});
 assert.equal((await call(handler,old)).status,401);
 revoked=true;assert.equal((await call(handler,sign())).status,409);
 revoked=false;cn='cn2';assert.equal((await call(handler,sign())).status,409);
 cn='cn1';shortId='ZZZZZZ';assert.equal((await call(handler,sign())).status,409);
 shortId='ABCD02';online=false;assert.equal((await call(handler,sign())).status,409);
 online=true;
 const row=[...records.values()][0];row.state='approved';
 const approved=await call(handler,sign());assert.equal(approved.body.status,'approved');
 assert.equal(approved.body.bCode,undefined);
 row.state='granted';
 const granted=await call(handler,sign());assert.equal(granted.body.status,'granted');
 assert.equal(granted.body.helperReady,false,'Redis granted is not Helper ready');
 row.state='pending';
 const second=await call(handler,sign('issue',id,'b'.repeat(32)),
  '/v1/plugin/abv2/request-issue');
 assert.equal(second.status,200);
 assert.equal((await call(handler,sign())).body.status,'ambiguous');
 assert.equal((await call(handler,sign())).body.helperReady,false);
 assert.ok(!JSON.stringify(await call(handler,sign())).includes(issued.body.bCode),
  'ambiguous recovery must never leak another pending B');
 console.log('GOLD_ABV2_NOARG_RECOVERY_OAUTH_SCOPED_PENDING_REFRESH_REPLAY_DENY=PASS');
 console.log('GOLD_ABV2_NOARG_RECOVERY_AMBIGUOUS_FAIL_CLOSED_NO_EARLY_READY=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
