import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {EnrollmentRegistry} from '../../operator-host/enrollment-registry.mjs';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';

// Exercise the REAL Ed25519 enrollment signature verifier, account-binding
// and anti-replay checks against the actual notification routing function.
// Fixtures only: no Gold UAT account, token, or database access.
const now=Date.now();
const accountId='acct_owner_signed_fixture';
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
const enrollments=new EnrollmentRegistry({now:()=>now,emit:()=>{}});
const challenge=enrollments.begin({publicIdentityKey,displayName:'notification sign test',
 platform:'linux',architecture:'arm64',capabilities:['filesystem']});
const approved=enrollments.approve({code:challenge.deviceCode,
 accountId,approvedCapabilities:['filesystem']});
const deviceId=approved.deviceId;
const url=new URL('http://operator.local/v1/device-channel/account-notifications');
const payload={accountId:'acct_attacker_request_override'};

function makeSigned(action='account-notifications',body=payload,key=privateKey){
 const timestamp=now,nonce=crypto.randomBytes(18).toString('base64url');
 const signature=crypto.sign(null,Buffer.from(deviceChannelMessage({
  deviceId,action,timestamp,nonce,payload:body})),key).toString('base64url');
 return {deviceId,timestamp,nonce,signature,payload:body};
}
let registryReads=0;
const deps={
 readJson:async req=>req.signed,
 verifiedChannelContext:async(input,action)=>{
  const proof=enrollments.verifyChannel(input,action,input.payload);
  assert.equal(proof.binding.accountId,accountId);
  return {binding:proof.binding,device:{accountId,deviceId}};
 },
 accounts:{assertOperational:id=>{assert.equal(id,accountId);},
  account:id=>{assert.equal(id,accountId);return {accountId:id,email:'owner@example.invalid',plan:'pro'};}},
 accountNotifications:{inbox:async id=>{
   assert.equal(id,accountId);registryReads++;
   return {unreadCount:1,notifications:[{notificationId:'sys_11111111-2222-3333-4444-555555555555',
    type:'feature',title:'Signed test',body:'Fixture',readAt:null,createdAt:now}]};
 }},
 proTeams:{inbox:()=>({unreadCount:0,notifications:[]})},
 sendJson:(res,status,value)=>{res.status=status;return value}
};
const valid=makeSigned();
const response=await handleDeviceChannelRoutes({method:'POST',signed:valid},{},url,deps);
assert.equal(response.ok,true);assert.equal(response.unreadCount,1);
assert.equal(response.accountEmail,'owner@example.invalid');
assert.equal(registryReads,1);
await assert.rejects(()=>handleDeviceChannelRoutes({method:'POST',signed:valid},{},url,deps),
 /device_proof_replay/);
const {privateKey:attackerKey}=crypto.generateKeyPairSync('ed25519');
await assert.rejects(()=>handleDeviceChannelRoutes({
 method:'POST',signed:makeSigned('account-notifications',payload,attackerKey)
},{},url,deps),/invalid_device_proof/);
await assert.rejects(()=>handleDeviceChannelRoutes({
 method:'POST',signed:makeSigned('memory-peers')
},{},url,deps),/invalid_device_proof/);
assert.equal(registryReads,1,'all rejected signatures must avoid registry read');
const next=await handleDeviceChannelRoutes({method:'POST',signed:makeSigned()},{},url,deps);
assert.equal(next.ok,true);assert.equal(registryReads,2);
console.log('GOLD_NOTIFICATION_REAL_ED25519_SIGNATURE_ACCOUNT_SCOPE_REPLAY_AND_WRONG_ACTION_PASS');
