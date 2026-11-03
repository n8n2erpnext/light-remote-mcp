import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {EnrollmentRegistry} from './enrollment-registry.mjs';
import {deviceChannelMessage} from '../lib/device-proof.mjs';
import {createDesktopWallSsoDeviceProofV4,WALL_SSO_SIGNED_ACTION}
  from './desktop-wall-sso-device-proof-v4.mjs';
import {createDesktopWallSsoV4} from '../plugin-server/desktop-wall-sso-v4.mjs';

const ACCOUNT='acct_owner_t04_signed_test',ACCESS='X'.repeat(43);
const FAMILY='F'.repeat(43);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function setup(){
  let now=1700000000000,live=true;
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const {privateKey:attackerKey}=crypto.generateKeyPairSync('ed25519');
  const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
  const enrollments=new EnrollmentRegistry({now:()=>now,emit:()=>{}});
  const begin=enrollments.begin({publicIdentityKey,displayName:'T04 signed fixture',
    platform:'linux',architecture:'arm64',capabilities:['filesystem']});
  const approved=enrollments.approve({code:begin.deviceCode,
    accountId:ACCOUNT,approvedCapabilities:['filesystem']});
  const deviceId=approved.deviceId;
  const proof=createDesktopWallSsoDeviceProofV4({enrollments});
  function signed(ticketDigest,{action=WALL_SSO_SIGNED_ACTION,key=privateKey,
    deviceIdOverride=deviceId,nonce=crypto.randomBytes(18).toString('base64url'),
    digest=ticketDigest,timestamp=now}={}){
    const payload={ticketDigest:digest};
    const message=deviceChannelMessage({
      deviceId:deviceIdOverride,action,timestamp,nonce,payload
    });
    return {deviceId:deviceIdOverride,timestamp,nonce,payload,
      signature:crypto.sign(null,Buffer.from(message),key).toString('base64url')};
  }
  const store=new Map();
  const redis={
    async set(k,v,opts){
      assert.equal(opts?.EX,45);assert.equal(opts?.NX,true);
      if(store.has(k))return null;
      store.set(k,v);return 'OK';
    },
    async getDel(k){const v=store.get(k);store.delete(k);return v??null;}
  };
  const service=createDesktopWallSsoV4({
    redis,prefix:'lr:gold:lab:',
    inspectNativeAccess:async token=>({
      verified:token===ACCESS,isOwner:token===ACCESS,
      accountId:ACCOUNT,familyId:FAMILY,
      resource:'urn:light-remote:desktop-owner:v4',scope:'desktop:read'
    }),
    verifyEnrolledDevice:proof.verifyEnrolledDevice,
    verifySignedWallDevice:proof.verifySignedWallDevice,
    verifyOwnerFamilyCurrent:async(a,f)=>live&&a===ACCOUNT&&f===FAMILY,
    clock:()=>now
  });
  return {proof,service,store,enrollments,signed,deviceId,
    revokeDevice:()=>enrollments.revoke({accountId:ACCOUNT,deviceId}),
    revokeOwner:()=>{live=false;},
    moveTime:ms=>{now+=ms;},
    attackerKey};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error?.code===code);

test('T04b3 enrolled Ed25519 proof authenticates exact registered account and device',async()=>{
  const f=setup();
  const row=await f.proof.verifyEnrolledDevice(ACCOUNT,f.deviceId);
  assert.deepEqual(row,{verified:true,enrolled:true,revoked:false,
    accountId:ACCOUNT,deviceId:f.deviceId});
  assert.equal((await f.proof.verifyEnrolledDevice('acct_other',f.deviceId)).verified,false);
  assert.equal((await f.proof.verifyEnrolledDevice(ACCOUNT,'unknown')).verified,false);
  const digest='a'.repeat(64);
  const verified=await f.proof.verifySignedWallDevice({
    signedEnvelope:f.signed(digest),ticketDigest:digest
  });
  assert.deepEqual(verified,{verified:true,authentication:'device_signed',
    accountId:ACCOUNT,deviceId:f.deviceId,ticketDigest:digest});
});

test('T04b3 signed device proof is replay-protected by real enrollment verifier',async()=>{
  const f=setup(),digest='a'.repeat(64),env=f.signed(digest);
  await f.proof.verifySignedWallDevice({signedEnvelope:env,ticketDigest:digest});
  await rejects(f.proof.verifySignedWallDevice({
    signedEnvelope:env,ticketDigest:digest
  }),'wall_sso_signed_device_required');
});

test('T04b3 forged Ed25519 key and wrong signed action are denied',async()=>{
  const f=setup(),digest='b'.repeat(64);
  await rejects(f.proof.verifySignedWallDevice({
    signedEnvelope:f.signed(digest,{key:f.attackerKey}),ticketDigest:digest
  }),'wall_sso_signed_device_required');
  await rejects(f.proof.verifySignedWallDevice({
    signedEnvelope:f.signed(digest,{action:'account-auth'}),ticketDigest:digest
  }),'wall_sso_signed_device_required');
});

test('T04b3 digest mismatch, extra account fields and payload overrides denied',async()=>{
  const f=setup(),digest='c'.repeat(64);
  await rejects(f.proof.verifySignedWallDevice({
    signedEnvelope:f.signed(digest,{digest:'d'.repeat(64)}),
    ticketDigest:digest
  }),'wall_sso_signed_device_required');
  await rejects(f.proof.verifySignedWallDevice({
    signedEnvelope:{...f.signed(digest),accountId:'acct_attacker'},
    ticketDigest:digest
  }),'wall_sso_signed_device_required');
  const envelope=f.signed(digest);
  await rejects(f.proof.verifySignedWallDevice({
    signedEnvelope:{...envelope,payload:{ticketDigest:digest,agentId:'agent_1'}},
    ticketDigest:digest
  }),'wall_sso_signed_device_required');
});

test('T04b3 old timestamp and unregistered device never redeem',async()=>{
  const f=setup(),digest='d'.repeat(64);
  await rejects(f.proof.verifySignedWallDevice({
    signedEnvelope:f.signed(digest,{timestamp:1700000000000-61000}),
    ticketDigest:digest
  }),'wall_sso_signed_device_required');
  await rejects(f.proof.verifySignedWallDevice({
    signedEnvelope:f.signed(digest,{deviceIdOverride:'dev_wrong'}),
    ticketDigest:digest
  }),'wall_sso_signed_device_required');
});

test('T04b3 device enrollment revocation immediately blocks signed redemption',async()=>{
  const f=setup(),digest='e'.repeat(64);
  f.revokeDevice();
  assert.equal((await f.proof.verifyEnrolledDevice(ACCOUNT,f.deviceId)).verified,false);
  await rejects(f.proof.verifySignedWallDevice({
    signedEnvelope:f.signed(digest),ticketDigest:digest
  }),'wall_sso_signed_device_required');
});

test('T04b3 full 45s ticket issue -> real Ed25519 redemption -> one-use',async()=>{
  const f=setup();
  const issued=await f.service.issue({accessToken:ACCESS,deviceId:f.deviceId});
  assert.match(issued.ticket,/^[A-Za-z0-9_-]{43}$/);
  const digest=hash(issued.ticket);
  const authority=await f.service.redeem({
    ticket:issued.ticket,signedEnvelope:f.signed(digest)
  });
  assert.deepEqual(authority,{
    verified:true,purpose:'wall_local_session_authority_v1',
    accountId:ACCOUNT,deviceId:f.deviceId,familyId:FAMILY
  });
  assert.equal(f.store.size,0);
  assert.equal(JSON.stringify(authority).includes(ACCESS),false);
  await rejects(f.service.redeem({
    ticket:issued.ticket,signedEnvelope:f.signed(digest)
  }),'wall_sso_ticket_expired_or_used');
});

test('T04b3 owner revocation fail-closed despite valid device signature',async()=>{
  const f=setup();
  const issued=await f.service.issue({accessToken:ACCESS,deviceId:f.deviceId});
  f.revokeOwner();
  await rejects(f.service.redeem({
    ticket:issued.ticket,signedEnvelope:f.signed(hash(issued.ticket))
  }),'wall_sso_owner_revoked');
  assert.equal(f.store.size,0);
});

test('T04b3 device re-link/removal invalidates outstanding ticket and Wall identity',async()=>{
  const f=setup();
  const issued=await f.service.issue({accessToken:ACCESS,deviceId:f.deviceId});
  f.revokeDevice();
  await rejects(f.service.redeem({
    ticket:issued.ticket,signedEnvelope:f.signed(hash(issued.ticket))
  }),'wall_sso_signed_device_required');
  await rejects(f.service.assertWallSessionCurrent({
    accountId:ACCOUNT,deviceId:f.deviceId,familyId:FAMILY
  }),'wall_sso_device_mismatch');
});

test('T04b3 cannot initialize without the authoritative enrollment registry',()=>{
  assert.throws(()=>createDesktopWallSsoDeviceProofV4(),
    e=>e.code==='wall_sso_enrollment_registry_required');
});
