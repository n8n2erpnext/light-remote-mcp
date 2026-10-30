// Source-only Operator factory: actual CSRF/owner enrollment and mocked PG.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
import {createGoldAbV2Csrf} from '../../operator-host/gold-ab-v2-owner-http.mjs';
import {createGoldAbV2GrantOperator} from '../../operator-host/gold-ab-v2-grant-operator.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-v2-factory-'));
const keyFile=path.join(root,'seal');
const secret=crypto.randomBytes(32);
fs.writeFileSync(keyFile,secret,{mode:0o600});
const origin='https://gold.example.test';
const env={LIGHT_REMOTE_GOLD_ROOT:root,
 LR_GOLD_AB_V2_SEAL_KEY_FILE:keyFile,LR_GOLD_AB_V2_OWNER_ORIGIN:origin,
 LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'owner',
 LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:'dev1',
 LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',
 LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE:'1',
 LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE:'1'};
const rid='av2_'+'a'.repeat(32);
const registry=new DeviceAccessGrantRegistry({stateFile:path.join(root,'grants.json')});
const row={requestId:rid,owner:'owner',actor:'owner',device:'dev1',
 connection:'conn1',client:'oauth-'+'a'.repeat(64),agent:'agent-a',
 attempt:1,approvedAt:null,state:'pending'};
let flushes=0, durable=true,verified=true,validOwner=true,revoked=false,policy=true;
let connection='conn1',writeCount=0;
const redis={eval:async(_source,{arguments:args})=>{
 const [op,payload]=args,p=JSON.parse(payload);
 if(op==='grant_receipt'){
  if(p.connection!==row.connection||p.owner!==row.owner||p.device!==row.device)
   throw Error('abv2_owner_scope_denied');
  if(row.state==='pending')throw Error('abv2_b_not_verified');
  return JSON.stringify(row);
 }
 if(op==='approve'){
  writeCount++;
  if(row.attempt!==p.attempt)throw Error('abv2_attempt_changed');
  if(!verified)throw Error('abv2_b_invalid');
  row.state='approved';row.approvedAt=Date.now();
  return JSON.stringify({state:'approved',requestId:rid,attempt:1});
 }
 if(op==='grant_commit'){
  assert(flushes>0);
  if(!durable)throw Error('commit_before_durable');
  assert.equal(p.grantId,'dag_v2_'+rid.slice(4));
  row.state='granted';row.grantId=p.grantId;
  return JSON.stringify({state:'granted',grantId:p.grantId});
 }
 throw Error('unexpected redis operation');
}};
const session='auth-session-token-0123456789';
const accountSessionToken=req=>req.session;
const csrf=createGoldAbV2Csrf({sealingKey:secret,origin,sessionToken:accountSessionToken});
const req={session,headers:{origin,'sec-fetch-site':'same-origin'}};
req.headers['x-light-abv2-csrf']=csrf.nonce(req,'dev1');
const mk=(cfg=env)=>createGoldAbV2GrantOperator({env:cfg,
 storage:{redis,prefix:'lr:gold:fixture:',
  pool:{query:async(_sql,params)=>{
   const g=registry.grants.get(params[0]);
   return {rows:durable&&g?[{grant_id:g.grantId,
    account_id:g.accountId,device_id:g.deviceId,connection_id:g.connectionId,
    agent_id:g.agentId,approved_at:new Date(g.approvedAt),
    absolute_expires_at:new Date(g.absoluteExpiresAt),
    closed_at:g.closedAt==null?null:new Date(g.closedAt),close_reason:g.closeReason}]:[]};
  }}},
 requireAccount:()=>({account:{accountId:validOwner?'owner':'other',status:'active'}}),
 accountSessionToken,accounts:{assertOperational:()=>({accountId:'owner',emailVerified:true})},
 devices:{get:()=>({deviceId:'dev1',accountId:'owner',state:'online',publicIdentityKey:'key'})},
 enrollments:{binding:()=>({deviceId:'dev1',accountId:'owner',publicIdentityKey:'key',revokedAt:revoked?1:null}),
  policyView:()=>({accountId:'owner',policyRevision:1,policyProfile:policy?'default':'disabled',
   approvedCapabilities:['filesystem']})},
 connections:{assertConnected:()=>({deviceId:'dev1',accountId:'owner',
  connectionId:connection,state:'connected',hardExpiresAt:Date.now()+3600000})},
 accessGrants:registry,goldRegistries:{flush:async()=>{flushes++;}}
});
const input={deviceId:'dev1',requestId:rid,expectedAttempt:1,bCode:'7KPX-42NM'};
try{
 assert.equal(mk({...env,LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE:'0'}),null);
 const op=mk();
 await assert.rejects(op({...req,headers:{origin:'https://evil.test'}},input),
  /abv2_grant_origin_csrf_denied/);
 await assert.rejects(op({...req,headers:{origin}},input),
  /abv2_grant_origin_csrf_denied/);
 validOwner=false;
 await assert.rejects(op(req,input),/abv2_grant_owner_denied/);
 validOwner=true;revoked=true;
 await assert.rejects(op(req,input),/abv2_grant_enrollment_or_policy_denied/);
 revoked=false;policy=false;
 await assert.rejects(op(req,input),/abv2_grant_enrollment_or_policy_denied/);
 policy=true;verified=false;
 await assert.rejects(op(req,input),/abv2_b_invalid/);
 assert.equal(registry.grants.size,0);
 verified=true;durable=false;
 await assert.rejects(op(req,input),/abv2_grant_not_durable/);
 assert.equal(row.state,'approved');
 assert.equal(flushes,1);
 durable=true;
 const good=await op(req,input);
 assert.equal(good.state,'granted');
 assert.equal(good.approvedAt,row.approvedAt);
 assert.equal(good.absoluteExpiresAt,row.approvedAt+86400000);
 assert.equal(writeCount,2,'retry after PG delay does not reverify B');
 const retry=await op(req,input);
 assert.equal(retry.reused,true);
 assert.equal(retry.grantId,good.grantId);
 connection='conn-other';
 await assert.rejects(op(req,input),/abv2_owner_scope_denied/);
 console.log('GOLD_ABV2_OPERATOR_OWNER_CSRF_PG_READBACK_GATE=PASS');
 console.log('GOLD_ABV2_OPERATOR_REVOKE_AND_RECOVERY=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
