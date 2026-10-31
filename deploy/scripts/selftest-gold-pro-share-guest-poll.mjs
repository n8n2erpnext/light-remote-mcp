import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {goldAbV2HelperKey} from '../../lib/gold-ab-v2-helper-proof.mjs';
import {signGoldAbV2HelperPoll,verifyGoldAbV2HelperPoll}
 from '../../lib/gold-ab-v2-helper-poll-proof.mjs';
import {createGoldProShareGuestPoll} from '../../operator-host/pro-share-guest-poll.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pro-share-guest-poll-'));
const secret=path.join(root,'secret');
fs.writeFileSync(secret,crypto.randomBytes(32),{mode:0o600});
const env={LIGHT_REMOTE_GOLD_ROOT:root,LR_GOLD_AB_V2_SEAL_KEY_FILE:secret,
 LR_GOLD_AB_V2_HELPER_PROOF_KEY_FILE:secret,
 LR_GOLD_AB_V2_OWNER_ORIGIN:'https://gold.example.test',
 LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',
 LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'owner1',
 LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:'dev1',
 LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_GUEST_AB_REQUEST_ISSUE:'1',
 LR_GOLD_PRO_SHARE_GUEST_B_APPROVE:'1',LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE:'1',
 LR_GOLD_PRO_SHARE_GUEST_AB_POLL:'1'};
const key=goldAbV2HelperKey(env);
const identity={accountId:'guest1',clientId:'oauth-'+crypto.randomBytes(35).toString('hex')};
const agent='plugin-'+crypto.createHash('sha256')
 .update(identity.accountId+'|'+identity.clientId).digest('hex').slice(0,40);
const client='oauth-'+crypto.createHash('sha256').update(identity.clientId).digest('hex');
const requestId='av2_'+'a'.repeat(32),grantId='dag_v2_'+requestId.slice(4);
const now=Date.now(),approvedAt=now-3000;
let phase='approved',revoked=false,revision=7,mutateRevisionAtFinal=false,grantPurpose='pro-share-guest',
 ownerId='owner1',connId='conn1',queryCount=0,attachCount=0,
 persistedClient=false,failedFlush=false;
const nonce=new Set();
const redis={
 async set(k){if(nonce.has(k))return null;nonce.add(k);return 'OK'},
 async eval(_lua,{arguments:args}){
  const [operation,serialized]=args,params=JSON.parse(serialized);
  if(operation==='agent'){
   if(params.actor!=='guest1'||params.agent!==agent||params.client!==client||
      params.connection!=='conn1')throw Error('bad actor');
   return JSON.stringify({requestId,state:phase,attempt:1,expiresAt:now+300000});
  }
  if(operation==='grant_receipt'){
   if(params.owner!=='owner1'||params.connection!=='conn1')throw Error('bad owner');
   return JSON.stringify({requestId,state:phase,owner:'owner1',actor:'guest1',
    purpose:'pro-share-guest',agent,client,device:'dev1',
    connection:'conn1',grantId,approvedAt});
  }
  throw Error('mutation is forbidden in guest read-only poll');
 }
};
const pool={async query(sql,params){
 queryCount++;
 if(sql.includes('lr_gold_device_short_ids'))
  return {rowCount:1,rows:[{short_id:'ABCD02'}]};
 if(sql.includes('FROM lr_agent_clients c JOIN lr_agent_bindings b')){
  if(!persistedClient)return {rowCount:0,rows:[]};
  return {rowCount:1,rows:[{account_id:'guest1',agent_id:agent,
   closed_at:null,expires_at:new Date(now+86400000),device_id:'dev1',
   connection_id:'conn1',grant_id:grantId,grant_purpose:grantPurpose,
   pairing_request_id:requestId}]};
 }
 if(sql.includes('lr_ab_grants'))
  return {rowCount:1,rows:[{grant_id:grantId,
   account_id:'guest1',purpose:grantPurpose,connection_owner_account_id:'owner1',
   device_id:'dev1',connection_id:'conn1',agent_id:agent,
   approved_at:new Date(approvedAt),expires_at:new Date(approvedAt+86400000),
   absolute_expires_at:new Date(approvedAt+86400000),
   closed_at:phase==='granted'?null:new Date(approvedAt),
   close_reason:phase==='granted'?null:'abv2_uncommitted'}]};
 throw Error('Unexpected SQL');
}};
const device={deviceId:'dev1',accountId:'owner1',state:'online',
 nodeId:'node1',publicIdentityKey:'pub'};
const accounts={assertOperational:id=>id==='guest1'?
 {accountId:id,emailVerified:true,plan:'free'}:
 {accountId:id,emailVerified:true,plan:'pro'}};
const store={async assertEligibleGuestRequest({authenticatedGuestAccountId,device:d,connection}) {
 assert.equal(authenticatedGuestAccountId,'guest1');
 assert.equal(d.deviceId,'dev1');
 if(revoked)throw Error('pro_share_device_revoked');
 if(mutateRevisionAtFinal&&queryCount>=2)revision++;
 return {ownerAccountId:'owner1',deviceId:'dev1',connectionId:connection.connectionId,
  grantPurpose:'pro-share-guest',permissionRevision:revision};
}};
const deps={env,storage:{pool,redis,prefix:'lr:gold:fixture:'},
 store,accounts,devices:{get:()=>({...device,accountId:ownerId})},
 connections:{assertConnected:()=>({deviceId:'dev1',accountId:'owner1',
 connectionId:connId,state:'connected',hardExpiresAt:now+120000})},
 enrollments:{binding:()=>({deviceId:'dev1',accountId:'owner1',
 publicIdentityKey:'pub',revokedAt:null}),
 policyView:()=>({accountId:'owner1',policyProfile:'default',
  policyRevision:1,approvedCapabilities:['filesystem']})},
 accessGrants:{assert:()=>({grantId,accountId:'guest1',agentId:agent,
  purpose:grantPurpose,approvedAt,absoluteExpiresAt:approvedAt+86400000})},
 // No AgentClient registry or attach callback intentionally supplied.
 readJson:async req=>req.proof,sendJson:(res,status,body)=>{
  res.status=status;res.body=body;
 },now:()=>now};
const route=new URL('http://localhost/v1/plugin/pro-share/request-poll');
const proof=(purpose='guest-poll')=>signGoldAbV2HelperPoll({
 identity,requestId,deviceId:'dev1',shortId:'ABCD02',purpose,key,now});
const call=async(handler,p=proof())=>{
 const res={};await handler({method:'POST',proof:p},res,route);return res;
};
try{
 const off=createGoldProShareGuestPoll({...deps,env:{...env,
  LR_GOLD_PRO_SHARE_GUEST_AB_POLL:'0'}});
 assert.equal((await call(off)).status,404);
 assert.throws(()=>createGoldProShareGuestPoll({...deps,env:{...env,
  LR_GOLD_PRO_SHARE_GUEST_B_APPROVE:'0'}}),/prerequisite_off/);
 const handler=createGoldProShareGuestPoll(deps);
 assert.equal((await call(handler,proof('poll'))).status,403);
 const tampered={...proof(),requestId:'av2_'+'b'.repeat(32)};
 assert.equal((await call(handler,tampered)).status,401);
 const pending=await call(handler);
 assert.equal(pending.body.helperReady,false);
 assert.equal(pending.body.status,'approval_pending');
 phase='granted';grantPurpose='device';
 assert.equal((await call(handler)).status,409);
 grantPurpose='pro-share-guest';revoked=true;
 assert.notEqual((await call(handler)).status,200);
 revoked=false;connId='old-connection';
 assert.notEqual((await call(handler)).status,200);
 connId='conn1';ownerId='owner2';
 assert.notEqual((await call(handler)).status,200);
 ownerId='owner1';mutateRevisionAtFinal=true;
 assert.equal((await call(handler)).status,409);
 mutateRevisionAtFinal=false;
 const yes=await call(handler);
 assert.equal(yes.status,200);
 assert.equal(yes.body.status,'guest_grant_verified_dispatch_hold');
 assert.equal(yes.body.helperReady,false);
 assert.equal(yes.body.clientSessionId,undefined);
 assert.equal(yes.body.grantId,undefined);
 assert.equal(attachCount,0);
 // Full Guest binding must NEVER become a usable owner session.
 const bindEnv={...env,LR_GOLD_PRO_SHARE_GUEST_BIND:'1',
  LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1',LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',
  LR_GOLD_PRO_SHARE_GUEST_SIGNED_LAUNCH:'1'};
 assert.throws(()=>createGoldProShareGuestPoll({...deps,
  env:{...bindEnv,LR_GOLD_PRO_SHARE_GUEST_QUEUE:'0'}}),
  /guest_bind_requires_queue_slot_signed_launch_and_native_pg/);
 const bindDeps={...deps,env:bindEnv,
  agentClients:{attach({accountId,agentId,grant:approvedGrant,pairingRequestId}){
   assert.equal(accountId,'guest1');assert.equal(agentId,agent);
   assert.equal(approvedGrant.purpose,'pro-share-guest');
   assert.equal(pairingRequestId,requestId);attachCount++;
   return {clientSessionId:'lrc_fixture_guest'};
  }},
  goldRegistries:{async flush(){
   if(failedFlush)throw Error('pg_flush_failed');
   persistedClient=true;
  }}
 };
 const binder=createGoldProShareGuestPoll(bindDeps);
 const bound=await call(binder);
 assert.equal(bound.status,200);
 assert.equal(bound.body.status,'guest_binding_persisted_dispatch_hold');
 assert.equal(bound.body.helperReady,false);
 assert.equal(bound.body.clientSessionId,'lrc_fixture_guest');
 assert.equal(attachCount,1);
 assert.equal(persistedClient,true);
 const identical=await call(binder);
 assert.equal(identical.body.clientSessionId,'lrc_fixture_guest');
 assert.equal(attachCount,2,'native attach must be idempotent by request ID');
 revoked=true;
 assert.notEqual((await call(binder)).status,200);
 assert.equal(attachCount,2,'revoke must prevent attach');
 revoked=false;persistedClient=false;failedFlush=true;
 assert.equal((await call(binder)).status,503);
 failedFlush=false;persistedClient=true;
 // Generic AgentClient APIs are explicitly fenced from Guest purpose.
 const routes=fs.readFileSync(new URL('../../operator-host/executor-routes-device-channel.mjs',import.meta.url),'utf8');
 assert.match(routes,/guest_purpose_requires_verified_pro_share_poll/);
 assert.match(routes,/guest_purpose_owner_route_denied/);
 assert.match(routes,/guest_purpose_owner_context_denied/);
 assert.match(routes,/guest_purpose_owner_grant_view_denied/);
 assert.match(routes,/visibleDefault/);
 assert.match(routes,/binding\.grantPurpose==='pro-share-guest'\)continue/);
 console.log('GOLD_P2I4C3B2_GUEST_NATIVE_BIND_PG_READBACK_HOLD=PASS');
 console.log('GOLD_P2I4C3B2_GENERIC_OWNER_ATTACH_RESOLVE_DENIED=PASS');
 const replayProof=proof();
 assert.equal((await call(handler,replayProof)).status,200);
 assert.equal((await call(handler,replayProof)).status,409);
 const p=proof('guest-poll');
 await assert.rejects(()=>verifyGoldAbV2HelperPoll({
  proof:p,key,redis,prefix:'lr:gold:fixture:',now,expectedPurpose:'poll'}),
  /abv2_poll_wrong_purpose/);
 console.log('GOLD_PRO_SHARE_GUEST_POLL_OAUTH_REDIS_PG_OWNER_SCOPE_REVOKE=PASS');
 console.log('GOLD_PRO_SHARE_GUEST_POLL_NO_ATTACH_NO_READY_NO_OWNER_FALLBACK=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true})}
