#!/usr/bin/env node
/**
 * Source-real Local Wall HTTP UAT, localhost only and simulated owner/device.
 * Exercises ACTUAL device-agent/local-wall.mjs handler. No real B code, cookie,
 * account credential, network device, owner signing key or production callback.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {loadLocalWallAuth,writeLocalWallAuthConfig,LOCAL_WALL_COOKIE}
  from '../../device-agent/local-wall-auth.mjs';
import {
  signSyntheticWallApprovalOrigin,verifySyntheticWallApprovalOrigin
} from './synthetic-wall-approval-origin.mjs';
import {
  signSyntheticChannelApprovalAck,hashSyntheticChannelApprovalPacket,
  verifySyntheticChannelAndWallOrigin
} from './synthetic-channel-approval-attestation.mjs';

test('real local Wall HTTP /api/approve enforces simulated owner session and CSRF before mocked approval',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lr-uat-wall-proof-'));
 const file=path.join(folder,'fixture-auth.json');
 writeLocalWallAuthConfig(file,{
  username:'uat_owner',password:crypto.randomBytes(32).toString('base64url'),
  cookieSecret:crypto.randomBytes(48).toString('base64url')
 });
 const auth=loadLocalWallAuth(file,{required:true});
 const primary=auth.issue();
 const other=auth.issue();
 const cookie=LOCAL_WALL_COOKIE+'='+primary.token;
 const otherCookie=LOCAL_WALL_COOKIE+'='+other.token;
 const csrf=auth.csrfForRequest({headers:{cookie}});
 const otherCsrf=auth.csrfForRequest({headers:{cookie:otherCookie}});
 const now=Date.now();
 const userCode='7E2Q-P6RF'; // synthetic-only, never actual account B code
 const reqId='uat_request_http_gate',grantId='uat_grant_http_gate';
 const accountId='uat_account_http_gate',deviceId='uat_device_http_gate',
   agentId='uat_agent_http_gate',connectionId='uat_connection_http_gate';
 const pending={requestId:reqId,userCode,accountId,agentId,
   deviceId,connectionId,label:'Synthetic Approval',expiresAt:now+120000};
 const revoked=[];
 let outstanding=[pending],approvals=[],denials=[];
 const signer=crypto.generateKeyPairSync('ed25519');
 const channelSigner=crypto.generateKeyPairSync('ed25519');
 const channelPackets=[];
 const issuerPins={
   deviceKeySha256:'a'.repeat(64),ownerSessionSha256:'b'.repeat(64),
   channelAckSha256:'c'.repeat(64),wallDecisionNonceSha256:'d'.repeat(64)
 };
 const signedOrigins=[];
 const fakeOwnerProof=(id)=>{
   const at=Date.now();
   const channelAck=signSyntheticChannelApprovalAck(channelSigner.privateKey,{
     kind:'uat_device_channel_grant_ack',requestId:id,grantId,
     accountId,deviceId,agentId,connectionId,
     approvedAt:at-1,state:'approved'
   });
   channelPackets.push(channelAck);
   const receipt={
     kind:'uat_wall_approval_origin',requestId:id,grantId,
     ownerAccountId:accountId,accountId,deviceId,agentId,connectionId,
     ...issuerPins,channelAckSha256:hashSyntheticChannelApprovalPacket(channelAck),
     requestCreatedAt:now-30000,requestExpiresAt:now+120000,
     approvedAt:at,grantExpiresAt:at+60000,absoluteExpiresAt:at+86400000,
     action:'approve',purpose:'device'
   };
   signedOrigins.push(signSyntheticWallApprovalOrigin(signer.privateKey,receipt));
 };
 const localWall=startLocalWall({
  host:'127.0.0.1',port:0,auth,
  getLocalStatus:async()=>({deviceId,cloudDesiredConnected:true,cloudState:'connected'}),
  getRemoteStatus:async()=>({ok:true,device:{displayName:'UAT Test Device'},
    access:{pending:outstanding}}),
  accessApprove:async id=>{
    assert.equal(id,reqId);
    approvals.push(id);
    // This is a mocked device-channel ACK, not an actual Agent response.
    fakeOwnerProof(id);
    outstanding=[];
    return {requestId:id,grantId,status:'approved'};
  },
  accessDeny:async id=>{denials.push(id);outstanding=[];return {requestId:id,status:'denied'}},
  getRemoteActivity:async()=>({events:[]})
 });
 await once(localWall.server,'listening');
 const port=localWall.server.address().port;
 assert.equal(localWall.server.address().address,'127.0.0.1');
 const base='http://127.0.0.1:'+port;
 async function post(body,{cookie:sessionCookie=cookie,csrf:csrfToken=csrf}={}){
  const headers={'content-type':'application/json'};
  if(sessionCookie)headers.cookie=sessionCookie;
  if(csrfToken)headers['x-light-remote-csrf']=csrfToken;
  const r=await fetch(base+'/api/approve',{
    method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(4000)
  });
  return {status:r.status,value:await r.json()};
 }
 const decision={code:userCode,decision:'approve'};
 try{
  await t.test('01 missing session returns 401 and cannot call accessApprove',async()=>{
   const r=await post(decision,{cookie:'',csrf:''});
   assert.equal(r.status,401);
   assert.equal(approvals.length,0);
  });
  await t.test('02 missing owner-bound CSRF returns 403',async()=>{
   const r=await post(decision,{csrf:''});
   assert.equal(r.status,403);
   assert.equal(approvals.length,0);
  });
  await t.test('03 CSRF issued to another session is rejected',async()=>{
   const r=await post(decision,{csrf:otherCsrf});
   assert.equal(r.status,403);
   assert.equal(approvals.length,0);
  });
  await t.test('04 forged random cookie rejected as owner session',async()=>{
   const r=await post(decision,{cookie:LOCAL_WALL_COOKIE+'=falsified',csrf});
   assert.equal(r.status,401);
  });
  await t.test('05 wrong synthetic B code cannot authorize',async()=>{
   const r=await post({code:'ABCD-1234',decision:'approve'});
   assert.equal(r.status,404);
   assert.equal(approvals.length,0);
  });
  await t.test('06 valid B but invalid decision cannot authorize',async()=>{
   const r=await post({code:userCode,decision:'fake-approve'});
   assert.equal(r.status,400);
   assert.equal(approvals.length,0);
  });
  await t.test('07 deny never emits signed owner approval',async()=>{
   const original=outstanding;
   outstanding=[{...pending,requestId:'uat_request_denied'}];
   const r=await post({code:userCode,decision:'deny'});
   assert.equal(r.status,200);
   assert.deepEqual(denials,['uat_request_denied']);
   assert.equal(signedOrigins.length,0);
   outstanding=original;
  });
  await t.test('08 actual Wall route invokes mock accessApprove once',async()=>{
   const r=await post(decision);
   assert.equal(r.status,200,JSON.stringify(r.value));
   assert.equal(r.value.decision,'approved');
   assert.deepEqual(approvals,[reqId]);
   assert.equal(signedOrigins.length,1);
  });
  await t.test('09 detached Ed25519 UAT receipt matches synthetic owner/device',()=>{
   const cert=signedOrigins[0];
   const expected={
     requestId:reqId,grantId,ownerAccountId:accountId,accountId,
     deviceId,agentId,connectionId,
     deviceKeySha256:issuerPins.deviceKeySha256,
     ownerSessionSha256:issuerPins.ownerSessionSha256,
     channelAckSha256:issuerPins.channelAckSha256,purpose:'device',
     approvedRequestState:'approved',ownerSessionActive:true,
     deviceEnrollmentActive:true,connectionActive:true,originNonceUnused:true
   };
   const trusted={...expected,
     deviceChannelActive:true,
     channelPublicSha256:crypto.createHash('sha256').update(
       channelSigner.publicKey.export({type:'spki',format:'der'})).digest('hex')
   };
   const r=verifySyntheticChannelAndWallOrigin({
     wallApproval:cert,channelAck:channelPackets[0],
     wallPublicKey:signer.publicKey,channelPublicKey:channelSigner.publicKey,
     expected:trusted,nowMs:Date.now()
   });
   assert.equal(r.decision,'VERIFIED_FAKE_OWNER_AND_CHANNEL');
   assert.equal(r.physicalExecutionAuthorized,false);
   assert.equal(r.productionIssuerAuthorized,false);
   const mismatched=verifySyntheticWallApprovalOrigin(cert,{
     pinnedWallPublicKey:signer.publicKey,
     expected:{...expected,ownerSessionSha256:'f'.repeat(64)},now:Date.now()
   });
   assert.equal(mismatched.decision,'DENY');
  });
  await t.test('10 consumed B code fails replay and cannot mint another receipt',async()=>{
   const r=await post(decision);
   assert.equal(r.status,404);
   assert.equal(approvals.length,1);
   assert.equal(signedOrigins.length,1);
   assert.equal(channelPackets.length,1);
  });
  await t.test('11 no actual customer/device owner session used',()=>{
   assert.equal(outstanding.length,0);
   assert.equal(revoked.length,0);
   assert.match(file,/lr-uat-wall-proof-/);
   assert.equal(fs.statSync(file).mode&0o777,0o600);
  });
 }finally{
   await localWall.close();
   fs.rmSync(folder,{recursive:true,force:true});
 }
});

test('Local Wall without authenticated session cannot be promoted to verified OWNER issuer evidence',async()=>{
 const requestId='uat_request_local_only';
 const userCode='9K8V-M2QF';
 let approvals=0,issuerEvidence=[];
 const wall=startLocalWall({
  host:'127.0.0.1',port:0,auth:{enabled:false},
  getLocalStatus:async()=>({deviceId:'uat_device_local_only',
   cloudDesiredConnected:true,cloudState:'connected'}),
  getRemoteStatus:async()=>({device:{displayName:'Fake Local Only'},
   access:{pending:[{requestId,userCode,agentId:'uat_agent_local_only',
     accountId:'uat_account_local_only',expiresAt:Date.now()+60000}]}}),
  accessApprove:async id=>{
   assert.equal(id,requestId);approvals++;
   // There is no authenticated Wall session/CSRF identity here:
   // mock remote grant response is NOT evidence for a trusted issuer.
   return {requestId:id,grantId:'uat_grant_local_only',status:'approved'};
  }
 });
 await once(wall.server,'listening');
 try{
  const res=await fetch('http://127.0.0.1:'+wall.server.address().port+'/api/approve',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({decision:'approve',code:userCode}),
   signal:AbortSignal.timeout(4000)
  });
  assert.equal(res.status,200);
  assert.equal(approvals,1);
  assert.equal(issuerEvidence.length,0);
  assert.equal(Boolean(wall.auth?.enabled),false);
 }finally{
  await wall.close();
 }
});
