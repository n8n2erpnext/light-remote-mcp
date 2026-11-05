import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {EnrollmentRegistry} from './enrollment-registry.mjs';
import {deviceChannelMessage} from '../lib/device-proof.mjs';
import {createDesktopWallSsoFamilyCurrentV4,
  WALL_SSO_FAMILY_CURRENT_ACTION_V4} from './desktop-wall-sso-family-current-v4.mjs';
import {createDesktopWallSsoV4} from '../plugin-server/desktop-wall-sso-v4.mjs';
import {createDesktopWallSsoDeviceProofV4} from './desktop-wall-sso-device-proof-v4.mjs';

const ACCOUNT='acct_t04b9c2',FAMILY='F'.repeat(43);
const rejects=p=>assert.rejects(p,e=>
  e?.code==='desktop_wall_sso_family_current_denied');
function fixture(){
  let now=1700000000000,ownerLive=true,verifyCalls=0;
  const pair=crypto.generateKeyPairSync('ed25519');
  const enrollments=new EnrollmentRegistry({now:()=>now,emit:()=>{}});
  const pending=enrollments.begin({
    publicIdentityKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64'),
    displayName:'T04b9c2',platform:'linux',architecture:'arm64',
    capabilities:['filesystem']
  });
  const {deviceId}=enrollments.approve({
    code:pending.deviceCode,accountId:ACCOUNT,
    approvedCapabilities:['filesystem']
  });
  const proof=createDesktopWallSsoDeviceProofV4({enrollments});
  const service=createDesktopWallSsoV4({
    redis:{set:async()=> 'OK',getDel:async()=>null},
    prefix:'lr:gold:lab:',
    clock:()=>now,
    inspectNativeAccess:async()=>null,
    verifyEnrolledDevice:proof.verifyEnrolledDevice,
    verifySignedWallDevice:proof.verifySignedWallDevice,
    verifyOwnerFamilyCurrent:async(a,f)=>ownerLive&&a===ACCOUNT&&f===FAMILY
  });
  const original=enrollments.verifyChannel.bind(enrollments);
  enrollments.verifyChannel=(...args)=>{
    verifyCalls++;
    return original(...args);
  };
  const live=createDesktopWallSsoFamilyCurrentV4({
    enabled:true,enrollments,
    assertWallSessionCurrent:service.assertWallSessionCurrent
  });
  const payload=()=>({accountId:ACCOUNT,deviceId,familyId:FAMILY});
  function sign(data=payload(),opts={}){
    const envelope={
      deviceId:opts.deviceId??deviceId,
      timestamp:opts.timestamp??now,
      nonce:opts.nonce??crypto.randomBytes(18).toString('base64url'),
      payload:data
    };
    const action=opts.action??WALL_SSO_FAMILY_CURRENT_ACTION_V4;
    const signed=crypto.sign(null,Buffer.from(deviceChannelMessage({
      ...envelope,action
    })),opts.key??pair.privateKey).toString('base64url');
    return {...envelope,signature:signed};
  }
  return {live,sign,payload,deviceId,enrollments,now,
    verifyCalls:()=>verifyCalls,
    revokeOwner:()=>{ownerLive=false;},
    revokeDevice:()=>enrollments.revoke({accountId:ACCOUNT,deviceId}),
    advance:ms=>{now+=ms;}
  };
}

test('T04b9c2 exact enrolled Ed25519 family-current proof checks authoritative Owner',async()=>{
  const f=fixture();
  assert.deepEqual(await f.live.check(f.sign()),{
    ok:true,current:true,deviceId:f.deviceId
  });
  assert.equal(f.verifyCalls(),1);
});

test('T04b9c2 each request needs unique signed nonce; replay cannot confirm Owner',async()=>{
  const f=fixture(),same=f.sign();
  assert.equal((await f.live.check(same)).current,true);
  await rejects(f.live.check(same));
  assert.equal(f.verifyCalls(),2);
  assert.equal((await f.live.check(f.sign())).current,true);
  assert.equal(f.verifyCalls(),3);
});

test('T04b9c2 Owner logout/revocation makes next request fail closed',async()=>{
  const f=fixture();
  assert.equal((await f.live.check(f.sign())).current,true);
  f.revokeOwner();
  await rejects(f.live.check(f.sign()));
});

test('T04b9c2 revoked/relinked enrolled device cannot revalidate',async()=>{
  const f=fixture();f.revokeDevice();
  await rejects(f.live.check(f.sign()));
  assert.equal(f.verifyCalls(),1);
});

test('T04b9c2 forged signer, other action, stale timestamp are rejected',async()=>{
  const f=fixture(),attacker=crypto.generateKeyPairSync('ed25519');
  await rejects(f.live.check(f.sign(undefined,{key:attacker.privateKey})));
  await rejects(f.live.check(f.sign(undefined,{action:'status'})));
  await rejects(f.live.check(f.sign(undefined,{timestamp:f.now-61000})));
});

test('T04b9c2 account/device/family mismatch and extra privilege fields fail',async()=>{
  const f=fixture();
  const rows=[
    f.sign({...f.payload(),accountId:'other'}),
    f.sign({...f.payload(),deviceId:'dev_attacker'}),
    f.sign({...f.payload(),familyId:'S'.repeat(43)}),
    f.sign({...f.payload(),agentId:'agent_1'}),
    {...f.sign(),accountId:ACCOUNT},
    {...f.sign(),payload:{accountId:ACCOUNT,deviceId:f.deviceId}},
    {...f.sign(),signature:'bad'}
  ];
  for(const row of rows)await rejects(f.live.check(row));
});

test('T04b9c2 device revoked while Owner lookup pending cannot become current',async()=>{
  const f=fixture();
  let finish;
  const waiting=new Promise(resolve=>{finish=resolve;});
  let entered;
  const inLookup=new Promise(resolve=>{entered=resolve;});
  const service=createDesktopWallSsoFamilyCurrentV4({
    enabled:true,enrollments:f.enrollments,
    assertWallSessionCurrent:async()=>{entered();return waiting;}
  });
  const pending=service.check(f.sign());
  await inLookup;
  f.revokeDevice();
  finish(true);
  await rejects(pending);
});

test('T04b9c2 temporary cloud/Redis failure fails closed',async()=>{
  const f=fixture();
  const service=createDesktopWallSsoFamilyCurrentV4({
    enabled:true,enrollments:f.enrollments,
    assertWallSessionCurrent:async()=>{throw Error('private Redis credential');}
  });
  await rejects(service.check(f.sign()));
});

test('T04b9c2 disabled service never accesses signer or backend',async()=>{
  let accesses=0;
  const service=createDesktopWallSsoFamilyCurrentV4({
    enabled:false,
    enrollments:{verifyChannel(){accesses++;throw Error('should not run');}}
  });
  assert.deepEqual(service,{enabled:false,check:undefined});
  assert.equal(accesses,0);
  assert.throws(()=>createDesktopWallSsoFamilyCurrentV4({enabled:true}),
    /desktop_wall_sso_family_current_unavailable/);
});
