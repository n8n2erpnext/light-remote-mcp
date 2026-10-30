// P2-I2h2e source fixture: signed enrolled device+local owner Wall B
// → Redis B proof → staged/activated PG grant; never a live connection.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import crypto from 'node:crypto';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
import {createGoldAbV2SignedApproval} from '../../operator-host/gold-ab-v2-signed-approval.mjs';
import {GoldAbV2WallOwnerConsent} from '../../lib/gold-ab-v2-wall-owner-consent.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-abv2-signed-approve-'));
const file=path.join(root,'key');const secret=crypto.randomBytes(32);
fs.writeFileSync(file,secret,{mode:0o600});
const reqid='av2_'+'a'.repeat(32);
const consentRows=new Map();
let time=Date.now(),approved=false,grantCommitted=false,writeCount=0,failPgOnce=false,conn='conn1',revoked=false,policyEnabled=true;
const id={deviceId:'dev1',accountId:'owner1',publicIdentityKey:'pub1'};
const binding={...id},ctx={
 binding,proof:{binding},device:{...id},
 payload:{action:'approve',ownerLoggedIn:true,wallUsername:'owner@example.test',
  requestId:reqid,expectedAttempt:1,bCode:'ABCD-2345',consentCode:'',agentId:'evil-agent'}
};
const grantRegistry=new DeviceAccessGrantRegistry({stateFile:path.join(root,'grants.json'),now:()=>time});
const receipt={requestId:reqid,state:'pending',owner:'owner1',actor:'owner1',
 agent:'agent-a',client:'oauth-'+'f'.repeat(64),device:'dev1',
 connection:'conn1',attempt:1,approvedAt:null,grantId:null};
const codeHash=crypto.createHmac('sha256',secret).update(reqid+'|1|ABCD-2345').digest('hex');
const redis={
 set:async(k,v)=>{consentRows.set(k,v);return 'OK';},
 eval:async(_lua,{keys,arguments:args})=>{
  if(args.length===1){
   const actual=consentRows.get(keys[0]);
   if(!actual)return 0;
   if(actual!==args[0])return -1;
   consentRows.delete(keys[0]);return 1;
  }
  const [op,raw]=args,p=JSON.parse(raw);
  if(p.owner!=='owner1'||p.device!=='dev1'||p.connection!==receipt.connection)
   throw Error('abv2_owner_scope_denied');
  if(op==='grant_receipt'){
   if(!approved)throw Error('abv2_b_not_verified');
   return JSON.stringify(receipt);
  }
  if(op==='approve'){
   if(p.attempt!==1)throw Error('abv2_attempt_changed');
   if(p.codeHash!==codeHash)throw Error('abv2_b_wrong');
   approved=true;receipt.state='approved';receipt.approvedAt=time;writeCount++;
   return JSON.stringify({state:'approved',requestId:reqid});
  }
  if(op==='grant_commit'){
   if(!approved||p.attempt!==1||p.approvedAt!==receipt.approvedAt)
    throw Error('abv2_commit_invalid');
   grantCommitted=true;receipt.state='granted';receipt.grantId=p.grantId;
   return JSON.stringify({state:'granted',grantId:p.grantId});
  }
  throw Error('unexpected_redis_operation:'+op);
 }
};
const env={LIGHT_REMOTE_GOLD_ROOT:root,LR_GOLD_AB_V2_SEAL_KEY_FILE:file,
 LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',
 LR_GOLD_AB_V2_OWNER_APPROVE_HTTP:'1',
 LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE:'1',
 LR_GOLD_AB_V2_WALL_SIGNED_APPROVE:'1',
 LR_GOLD_AB_V2_WALL_OWNER_CONSENT:'1',
 LR_GOLD_AB_V2_WALL_PENDING_PREVIEW:'1',
 LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE:'1',
 LR_GOLD_AB_V2_HELPER_TARGET_QUERY:'1',
 LR_GOLD_AB_V2_OWNER_ORIGIN:'https://gold.example.test',
 LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'owner1',
 LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:'dev1'};
const deps={
 storage:{redis,prefix:'lr:gold:test:',pool:{query:async(_sql,[grantId])=>{
  const g=grantRegistry.grants.get(grantId);
  if(!g)return {rows:[]};
  return {rows:[{grant_id:g.grantId,account_id:g.accountId,
   device_id:g.deviceId,connection_id:g.connectionId,agent_id:g.agentId,
   approved_at:new Date(g.approvedAt),absolute_expires_at:new Date(g.absoluteExpiresAt),
   closed_at:g.closedAt==null?null:new Date(g.closedAt),close_reason:g.closeReason}]};
 }}},
 accounts:{assertOperational:()=>({accountId:'owner1',emailVerified:true,email:'OWNER@example.test'})},
 devices:{get:()=>({...id,state:'online'})},
 enrollments:{binding:()=>({...id,revokedAt:revoked?time:null}),
  policyView:()=>({accountId:'owner1',policyRevision:1,
   policyProfile:policyEnabled?'default':'disabled',approvedCapabilities:['filesystem']})},
 connections:{assertConnected:()=>({deviceId:'dev1',accountId:'owner1',
  connectionId:conn,state:'connected',hardExpiresAt:time+7200000})},
 accessGrants:grantRegistry,goldRegistries:{flush:async()=>{
  writeCount++;if(failPgOnce){failPgOnce=false;throw Error('pg_fixture_interrupted_stage');}
 }},
 now:()=>time
};
const consent=new GoldAbV2WallOwnerConsent({redis,prefix:'lr:gold:test:',
 sealingKey:secret,now:()=>time});
const issueConsent=()=>consent.issue({ownerAccountId:'owner1',deviceId:'dev1',
 connectionId:'conn1',requestId:reqid,expectedAttempt:1,
 requestExpiresAt:time+300000});
try{
 assert.equal(createGoldAbV2SignedApproval({env:{},...deps}),null);
 assert.throws(()=>createGoldAbV2SignedApproval({env:{...env,LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE:'0'},...deps}),
  /abv2_wall_approve_requires_owner_grant_gate/);
 const handler=createGoldAbV2SignedApproval({env,...deps});
 await assert.rejects(handler(ctx),/abv2_wall_approval_payload_invalid/);
 ctx.payload.consentCode=(await issueConsent()).consentCode;
 await assert.rejects(handler({...ctx,proof:null}),/abv2_wall_signed_owner_proof_required/);
 await assert.rejects(handler({...ctx,payload:{...ctx.payload,ownerLoggedIn:false}}),/abv2_wall_signed_owner_proof_required/);
 await assert.rejects(handler({...ctx,payload:{...ctx.payload,wallUsername:'other@example.test'}}),/abv2_wall_owner_email_mismatch/);
 await assert.rejects(handler({...ctx,payload:{...ctx.payload,bCode:'AB10-2345'}}),/abv2_wall_approval_payload_invalid/);
 await assert.rejects(handler({...ctx,payload:{...ctx.payload,bCode:'AAAA-AAAA'}}),/abv2_b_wrong/);
 ctx.payload.consentCode=(await issueConsent()).consentCode;
 revoked=true;await assert.rejects(handler(ctx),/abv2_wall_enrollment_or_policy_denied/);
 revoked=false;policyEnabled=false;
 await assert.rejects(handler(ctx),/abv2_wall_enrollment_or_policy_denied/);
 policyEnabled=true;conn='conn2';
 await assert.rejects(handler(ctx),/abv2_wall_consent_scope_mismatch/);
 conn='conn1';
 ctx.payload.consentCode=(await issueConsent()).consentCode;
 assert.equal(grantRegistry.grants.size,0);
 failPgOnce=true;
 await assert.rejects(handler(ctx),/pg_fixture_interrupted_stage/);
 assert.equal(receipt.state,'approved','B was verified, grant not yet durable');
 assert.equal(grantCommitted,false,'Redis granted must not be issued on failed PG stage');
 const originalApproval=receipt.approvedAt;
 await assert.rejects(handler(ctx),/abv2_wall_consent_expired_or_used/);
 ctx.payload.consentCode=(await issueConsent()).consentCode;
 const good=await handler(ctx);
 assert.equal(good.approvedAt,originalApproval,'new consent must not restart 24h');
 assert.equal(good.ok,true);assert.equal(good.state,'granted');
 assert.equal(good.requestId,reqid);assert.equal(good.agentId,'agent-a');
 assert.equal(good.absoluteExpiresAt,receipt.approvedAt+86400000);
 assert.equal(grantCommitted,true);
 assert.equal(Object.hasOwn(good,'grantId'),false);
 assert.ok(!JSON.stringify(good).includes('ABCD-2345'));
 assert.ok(!JSON.stringify(good).includes('oauth-'));
 const seen=grantRegistry.activeGrantsForDevice('dev1','conn1');
 assert.equal(seen.length,1);
 assert.equal(seen[0].agentId,'agent-a');
 time+=5000;
 await assert.rejects(handler(ctx),/abv2_wall_consent_expired_or_used/);
 ctx.payload.consentCode=(await issueConsent()).consentCode;
 const retry=await handler(ctx);
 assert.equal(retry.absoluteExpiresAt,good.absoluteExpiresAt,'no 24h renewal on retry');
 assert.equal(grantRegistry.activeGrantsForDevice('dev1','conn1').length,1);
 console.log('GOLD_ABV2_SIGNED_WALL_OWNER_B_PG_DURABLE_GRANT_SCOPE=PASS');
 console.log('GOLD_ABV2_SIGNED_WALL_OWNER_B_RETRY_RESTART_SAFE_NO_SECRET=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
