import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {goldAbV2HelperKey,signGoldAbV2HelperTarget} from '../../lib/gold-ab-v2-helper-proof.mjs';
import {createGoldProShareGuestHelper} from '../../operator-host/pro-share-guest-helper.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pro-share-guest-helper-'));
const keyFile=path.join(root,'helper-key');fs.writeFileSync(keyFile,crypto.randomBytes(32),{mode:0o600});
const env={LIGHT_REMOTE_GOLD_ROOT:root,
 LR_GOLD_AB_V2_HELPER_PROOF_KEY_FILE:keyFile,
 LR_GOLD_AB_V2_SEAL_KEY_FILE:keyFile,
 LR_GOLD_AB_V2_OWNER_ORIGIN:'https://gold.example.test',
 LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',
 LR_GOLD_AB_V2_HELPER_TARGET_QUERY:'1',
 LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'owner1',
 LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:'dev1',
 LR_GOLD_PRO_SHARE_CORE:'1',
 LR_GOLD_PRO_SHARE_GUEST_AB_TARGET_QUERY:'1',
 LR_GOLD_PRO_SHARE_GUEST_AB_REQUEST_ISSUE:'1'
};
const identity={accountId:'guest1',
 clientId:'jwt-'+crypto.randomBytes(48).toString('hex')};
const key=goldAbV2HelperKey(env);
const nonceKeys=new Set();
let issueRow=null,seatValid=true;
const redis={
 async set(k,v,o){if(nonceKeys.has(k))return null;nonceKeys.add(k);return 'OK'},
 async eval(lua,{keys,arguments:args}){
  const op=args[0],row=JSON.parse(args[1]);
  if(op==='issue'){
   issueRow=row;
   return JSON.stringify({state:'pending',requestId:row.requestId,
    attempt:1,expiresAt:Date.now()+300000});
  }
  throw Error('unexpected_redis_operation');
 }
};
const storedRows=[{short_id:'ABCD02',device_id:'dev1',
 owner_account_id:'owner1',display_name:'Owner PC',
 node_id:'node1',platform:'windows',state:'online'}];
const queryLog=[];
const storage={pool:{async query(sql,args){
 queryLog.push({sql,args});
 if(args?.[1]==='guest1'&&args?.[0]==='ABCD02')return {rowCount:1,rows:storedRows};
 return {rowCount:0,rows:[]};
}},redis,prefix:'lr:gold:fixture:'};
const accounts={assertOperational(id){
 if(id==='guest1')return {accountId:id,emailVerified:true,plan:'free'};
 if(id==='owner1')return {accountId:id,emailVerified:true,plan:'pro'};
 throw Error('other account');
}};
const devices={get:()=>({deviceId:'dev1',accountId:'owner1',
 state:'online',publicIdentityKey:'pubkey'})};
const enrollments={binding:()=>({deviceId:'dev1',accountId:'owner1',
 publicIdentityKey:'pubkey',revokedAt:null}),
 policyView:()=>({accountId:'owner1',policyProfile:'default',
 approvedCapabilities:['terminal']})};
const connection={connectionId:'conn1',deviceId:'dev1',accountId:'owner1',
 state:'connected',hardExpiresAt:Date.now()+600000};
const connections={assertConnected:()=>connection};
const store={async assertEligibleGuestRequest({authenticatedGuestAccountId,device,connection:cn}){
 assert.equal(authenticatedGuestAccountId,'guest1');
 assert.equal(device.deviceId,'dev1');
 assert.equal(cn.connectionId,'conn1');
 if(!seatValid)throw Error('seat_revoked');
 return {ownerAccountId:'owner1',guestAccountId:'guest1',deviceId:'dev1'};
}};
const readJson=async req=>req.proof,sendJson=(res,status,value)=>Object.assign(res,{status,body:value});
const make=(config=env)=>createGoldProShareGuestHelper({env:config,
 storage,accounts,devices,connections,enrollments,store,readJson,sendJson});
async function call(handler,route,proof){
 const res={};await handler({method:'POST',proof},res,new URL('http://op'+route));return res;
}
const sign=(purpose,params={})=>signGoldAbV2HelperTarget({
 identity,targetQuery:'ABCD02',purpose,
 selectedDeviceId:purpose==='issue'?'dev1':null,
 requestKey:purpose==='issue'?'a'.repeat(32):null,
 key,...params
});
try{
 const defaultOff=make({...env,LR_GOLD_PRO_SHARE_GUEST_AB_TARGET_QUERY:'0',
 LR_GOLD_PRO_SHARE_GUEST_AB_REQUEST_ISSUE:'0'});
 assert.equal((await call(defaultOff,'/v1/plugin/pro-share/target-resolve',sign('resolve'))).status,404);
 const h=make(),resolved=await call(h,'/v1/plugin/pro-share/target-resolve',sign('resolve'));
 assert.equal(resolved.status,200);
 assert.equal(resolved.body.matches[0].deviceId,'dev1');
 assert.equal(resolved.body.helperReady,false);
 assert.match(queryLog[0].sql,/lr_gold_pro_share_seats/);
 assert.match(queryLog[0].sql,/seat.guest_account_id=\$2/);
 const issued=await call(h,'/v1/plugin/pro-share/request-issue',sign('issue'));
 assert.equal(issued.status,200);
 assert.equal(issued.body.status,'v2_pending_unapproved');
 assert.match(issued.body.bCode,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
 assert.equal(issueRow.owner,'owner1');
 assert.equal(issueRow.actor,'guest1');
 assert.equal(issueRow.purpose,'pro-share-guest');
 assert.equal(issueRow.agent,issued.body.agentId??issueRow.agent);
 assert.equal(issued.body.helperReady,false);
 assert.equal(issued.body.grantId,undefined);
 const replayProof=sign('resolve');
 assert.equal((await call(h,'/v1/plugin/pro-share/target-resolve',replayProof)).status,200);
 assert.equal((await call(h,'/v1/plugin/pro-share/target-resolve',replayProof)).status,409);
 seatValid=false;
 assert.notEqual((await call(h,'/v1/plugin/pro-share/target-resolve',sign('resolve'))).status,200);
}finally{fs.rmSync(root,{recursive:true,force:true})}
console.log('GOLD_P2I4B2_GUEST_OAUTH_OWNER_DEVICE_SCOPE_REUSES_ABV2_PENDING=PASS');
