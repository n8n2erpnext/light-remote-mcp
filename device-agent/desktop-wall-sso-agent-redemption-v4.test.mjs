import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {EnrollmentRegistry} from '../operator-host/enrollment-registry.mjs';
import {deviceChannelMessage} from '../lib/device-proof.mjs';
import {createDesktopWallSsoV4} from '../plugin-server/desktop-wall-sso-v4.mjs';
import {createDesktopWallSsoDeviceProofV4} from '../operator-host/desktop-wall-sso-device-proof-v4.mjs';
import {handleDesktopWallSsoSignedRedeemV4}
  from '../operator-host/desktop-wall-sso-signed-route-v4.mjs';
import {createDesktopWallSsoAgentRedemptionV4}
  from './desktop-wall-sso-agent-redemption-v4.mjs';

const ACCESS='A'.repeat(43),FAMILY='F'.repeat(43),ACCOUNT='acct_t04b9b';
const denied=e=>e?.code==='desktop_wall_sso_agent_redeem_denied';
function fixture(){
  let now=1_700_000_000_000,ownerActive=true,enrollmentActive=true;
  let signed=0,verifications=0,transportCalls=0;
  const pair=crypto.generateKeyPairSync('ed25519');
  const enrollments=new EnrollmentRegistry({now:()=>now,emit:()=>{}});
  const start=enrollments.begin({
    publicIdentityKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64'),
    displayName:'T04b9b real signed enrollment fixture',
    platform:'linux',architecture:'arm64',capabilities:['filesystem']
  });
  const accepted=enrollments.approve({
    code:start.deviceCode,accountId:ACCOUNT,approvedCapabilities:['filesystem']
  });
  const deviceId=accepted.deviceId;
  const oldVerify=enrollments.verifyChannel.bind(enrollments);
  enrollments.verifyChannel=(...args)=>{verifications++;return oldVerify(...args);};
  const proof=createDesktopWallSsoDeviceProofV4({enrollments});
  const store=new Map();
  const redis={
    async set(k,v,opt){
      assert.deepEqual(opt,{EX:45,NX:true});
      if(store.has(k))return null;
      store.set(k,v);return 'OK';
    },
    async getDel(k){const old=store.get(k);store.delete(k);return old??null;}
  };
  const service=createDesktopWallSsoV4({
    redis,prefix:'lr:gold:lab:',clock:()=>now,
    inspectNativeAccess:async token=>({
      verified:token===ACCESS,isOwner:token===ACCESS,
      accountId:ACCOUNT,familyId:FAMILY,
      resource:'urn:light-remote:desktop-owner:v4',scope:'desktop:read'
    }),
    verifyEnrolledDevice:proof.verifyEnrolledDevice,
    verifySignedWallDevice:proof.verifySignedWallDevice,
    verifyOwnerFamilyCurrent:async(a,f)=>ownerActive&&a===ACCOUNT&&f===FAMILY
  });
  const readEnrollment=()=>({
    accountId:ACCOUNT,deviceId,revoked:!enrollmentActive
  });
  const signChannel=(action,payload)=>{
    signed++;
    const envelope={
      deviceId,timestamp:now,
      nonce:crypto.randomBytes(18).toString('base64url'),payload
    };
    return {...envelope,signature:crypto.sign(null,
      Buffer.from(deviceChannelMessage({...envelope,action})),
      pair.privateKey).toString('base64url')};
  };
  async function sendSignedRedeem(request){
    transportCalls++;
    let result=null,code=null;
    await handleDesktopWallSsoSignedRedeemV4(
      {method:'POST'},
      {setHeader(){}},
      {
        readJson:async()=>request,
        sendJson:(_res,status,value)=>{code=status;result=value;return value;},
        signedRedeem:service.redeem
      }
    );
    if(code!==200)return result;
    return result;
  }
  const relay=createDesktopWallSsoAgentRedemptionV4({
    readEnrollment,signChannel,sendSignedRedeem,clock:()=>now
  });
  const issue=()=>service.issue({accessToken:ACCESS,deviceId});
  return {
    relay,service,issue,deviceId,store,proof,sendSignedRedeem,
    signChannel,readEnrollment,enrollments,
    revokeOwner:()=>{ownerActive=false;},
    revokeEnrollment:()=>{enrollmentActive=false;},
    advance:ms=>{now+=ms;},
    metrics:()=>({signed,verifications,transportCalls}),
    makeAdapter:changes=>createDesktopWallSsoAgentRedemptionV4({
      readEnrollment,signChannel,sendSignedRedeem,clock:()=>now,...changes
    })
  };
}

test('T04b9b real enrolled Ed25519 ticket digest -> Operator -> one-use principal',async()=>{
  const f=fixture(),issued=await f.issue();
  const principal=await f.relay.redeem(issued.ticket);
  assert.deepEqual(principal,{
    verified:true,purpose:'wall_local_session_authority_v1',
    accountId:ACCOUNT,deviceId:f.deviceId,familyId:FAMILY
  });
  assert.deepEqual(f.metrics(),{signed:1,verifications:1,transportCalls:1});
  assert.equal(f.store.size,0,'atomic Redis GETDEL consumes exactly once');
  assert.equal(JSON.stringify(principal).includes(ACCESS),false);
  assert.equal(JSON.stringify(principal).includes(issued.ticket),false);
  await assert.rejects(f.relay.redeem(issued.ticket),denied);
  assert.equal(f.metrics().verifications,2);
});

test('T04b9b signer binds only exact SHA-256 and action, never permits spoofed A/B fields',async()=>{
  const f=fixture(),issued=await f.issue();
  const adapted=f.makeAdapter({
    signChannel:async(action,payload)=>{
      assert.equal(action,'desktop-wall-sso-redeem');
      assert.deepEqual(Object.keys(payload),['ticketDigest']);
      assert.equal(payload.ticketDigest,
        crypto.createHash('sha256').update(issued.ticket).digest('hex'));
      return {...f.signChannel(action,payload),agentId:'forged'};
    }
  });
  await assert.rejects(adapted.redeem(issued.ticket),denied);
  assert.equal(f.metrics().transportCalls,0);
  assert.equal(f.store.size,1);
});

test('T04b9b rejects raw/oversized ticket, missing trusted Agent callbacks',async()=>{
  const f=fixture();
  for(const ticket of ['',123,'a'.repeat(44),'bad-sso-ticket']){
    await assert.rejects(f.relay.redeem(ticket),denied);
  }
  assert.throws(()=>createDesktopWallSsoAgentRedemptionV4(),denied);
  assert.equal(f.metrics().transportCalls,0);
});

test('T04b9b Owner revocation and invalid enrollment fail closed',async()=>{
  const f=fixture(),issued=await f.issue();
  f.revokeOwner();
  await assert.rejects(f.relay.redeem(issued.ticket),denied);
  assert.equal(f.store.size,0);
  const next=fixture(),second=await next.issue();
  next.revokeEnrollment();
  await assert.rejects(next.relay.redeem(second.ticket),denied);
  assert.equal(next.metrics().signed,0);
});

test('T04b9b forged device proof is denied by real EnrollmentRegistry',async()=>{
  const f=fixture(),issued=await f.issue();
  const attacker=crypto.generateKeyPairSync('ed25519');
  const relay=f.makeAdapter({
    signChannel:async(action,payload)=>{
      const original=f.signChannel(action,payload);
      return {...original,signature:crypto.sign(null,Buffer.from(
        deviceChannelMessage({...original,action})),
        attacker.privateKey).toString('base64url')};
    }
  });
  await assert.rejects(relay.redeem(issued.ticket),denied);
  assert.equal(f.store.size,1);
  assert.equal(f.metrics().verifications,1);
});

test('T04b9b concurrent signed redemptions cannot both win same ticket',async()=>{
  const f=fixture(),issued=await f.issue();
  const both=await Promise.allSettled([
    f.relay.redeem(issued.ticket),f.relay.redeem(issued.ticket)
  ]);
  assert.equal(both.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(both.filter(x=>x.status==='rejected').length,1);
  assert.equal(f.store.size,0);
});

test('T04b9b device relink while Operator returns refuses stale Wall principal',async()=>{
  const f=fixture(),issued=await f.issue();
  const relay=f.makeAdapter({
    sendSignedRedeem:async input=>{
      const response=await f.sendSignedRedeem(input);
      f.revokeEnrollment();
      return response;
    }
  });
  await assert.rejects(relay.redeem(issued.ticket),denied);
  assert.equal(f.store.size,0);
});

test('T04b9b source cannot treat unrelated or malformed Operator JSON as Owner',async()=>{
  const f=fixture(),issued=await f.issue();
  for(const invalid of [
    {ok:true,authority:{purpose:'wall_local_session_authority_v1',
      accountId:'attacker',deviceId:f.deviceId,familyId:FAMILY}},
    {ok:true,authority:{purpose:'wall_local_session_authority_v1',
      accountId:ACCOUNT,deviceId:f.deviceId,familyId:FAMILY},refreshToken:ACCESS},
    {ok:true,authority:{purpose:'agent_grant',
      accountId:ACCOUNT,deviceId:f.deviceId,familyId:FAMILY}},
    {ok:false,error:'not_found'},null,[],{}
  ]){
    const relay=f.makeAdapter({sendSignedRedeem:async()=>invalid});
    await assert.rejects(relay.redeem(issued.ticket),denied);
  }
  assert.equal(f.store.size,1);
});

test('T04b9b ticket expiry at 45s never silently extends authority',async()=>{
  const f=fixture(),issued=await f.issue();
  f.advance(46_000);
  // In-memory fixture lacks TTL eviction, so explicit issue expiry inside
  // authority must prevent promotion, even if Redis GETDEL still has bytes.
  await assert.rejects(f.relay.redeem(issued.ticket),denied);
});
