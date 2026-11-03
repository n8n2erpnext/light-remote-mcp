import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {AccountRegistry} from './account-registry.mjs';
import {EnrollmentRegistry} from './enrollment-registry.mjs';
import {deviceChannelMessage} from '../lib/device-proof.mjs';
import {createDesktopOwnerTokenService}
  from '../plugin-server/desktop-owner-token-v4.mjs';
import {
  createDesktopOwnerRedisProofV4,
  createDesktopWallSsoTrustedOperatorV4
} from './desktop-wall-sso-trusted-authority-v4.mjs';
import {WALL_SSO_SIGNED_ACTION}
  from './desktop-wall-sso-device-proof-v4.mjs';
import {handleDeviceChannelRoutes}
  from './executor-routes-device-channel.mjs';

const ACCOUNT='acct_owner_t04b5';
const SESSION='acctsess_123e4567-e89b-42d3-a456-426614174000';
const PREFIX='lr:gold:goldabv2lab:';
const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
const wallSession=p=>({accountId:p.accountId,deviceId:p.deviceId,familyId:p.familyId});

function fixture(){
  let now=1700000000000;
  const records=new Map();
  let failRedis=false;
  const redis={
    async get(key){
      if(failRedis)throw Error('storage_offline');
      const row=records.get(key);
      if(!row||row.expiresAt<=now){records.delete(key);return null;}
      return row.value;
    },
    async set(key,value,{EX,NX}={}){
      if(failRedis)throw Error('storage_offline');
      if(NX&&records.has(key))return null;
      records.set(key,{value,expiresAt:now+EX*1000});
      return 'OK';
    },
    async getDel(key){
      const result=await this.get(key);
      records.delete(key);
      return result;
    },
    async del(key){
      if(failRedis)throw Error('storage_offline');
      return records.delete(key)?1:0;
    }
  };
  const accounts=new AccountRegistry({
    bootstrapAccountId:ACCOUNT,
    now:()=>now,emit:()=>{}
  });
  // In-memory fixture uses the ACTUAL AccountRegistry single-Owner and
  // desktopOwnerSessionActive implementation, not a hardcoded true callback.
  accounts.accounts.set(ACCOUNT,{
    accountId:ACCOUNT,status:'active',
    email:'owner@example.invalid',passwordHash:'test-only-no-login'
  });
  accounts.ownerAccountId=ACCOUNT;
  accounts.sessions.set('owner-session-test-hash',{
    accountId:ACCOUNT,sessionId:SESSION,expiresAt:now+7*24*3600000
  });
  const native=createDesktopOwnerTokenService({
    redis,prefix:PREFIX,
    clock:()=>now,
    consumeCode:async()=>({
      purpose:'desktop_owner_verified_once',
      accountId:ACCOUNT,accountSessionId:SESSION,
      accountSessionExpiresAt:now+7*24*3600000,
      resource:'urn:light-remote:desktop-owner:v4',
      scope:'desktop:read'
    }),
    verifyPortalSession:async(a,s)=>accounts.desktopOwnerSessionActive(a,s)
  });
  const pair=crypto.generateKeyPairSync('ed25519');
  const enrollments=new EnrollmentRegistry({now:()=>now,emit:()=>{}});
  const begin=enrollments.begin({
    publicIdentityKey:pair.publicKey.export({
      format:'der',type:'spki'
    }).toString('base64'),
    displayName:'T04b5 verified fixture',
    platform:'linux',architecture:'arm64',capabilities:['filesystem']
  });
  const approved=enrollments.approve({
    code:begin.deviceCode,accountId:ACCOUNT,
    approvedCapabilities:['filesystem']
  });
  const deviceId=approved.deviceId;
  const bridge=()=>createDesktopWallSsoTrustedOperatorV4({
    enabled:true,redis,prefix:PREFIX,accounts,enrollments,clock:()=>now
  });
  const issue=()=>native.exchange({
    code:'C'.repeat(43),verifier:'verified-challenge',
    redirectUri:'http://127.0.0.1:49152/desktop/v4/callback',
    installNonce:'I'.repeat(43),state:'S'.repeat(43)
  });
  function sign(ticket,{privateKey=pair.privateKey,action=WALL_SSO_SIGNED_ACTION,
    nonce=crypto.randomBytes(18).toString('base64url'),time=now}={}){
    const signedEnvelope={
      deviceId,timestamp:time,nonce,payload:{ticketDigest:digest(ticket)}
    };
    signedEnvelope.signature=crypto.sign(null,Buffer.from(deviceChannelMessage({
      ...signedEnvelope,action
    })),privateKey).toString('base64url');
    return signedEnvelope;
  }
  return {
    redis,records,accounts,enrollments,native,bridge,issue,sign,deviceId,
    advance:ms=>{now+=ms;},
    offline:()=>{failRedis=true;},
    logoutPortal:()=>{accounts.sessions.clear();},
    transferOwner:()=>{accounts.ownerAccountId='acct_replacement';},
    disableOwner:()=>{accounts.accounts.get(ACCOUNT).status='admin_disabled';},
    revokeDevice:()=>enrollments.revoke({deviceId,accountId:ACCOUNT}),
    clock:()=>now
  };
}
const denied=async(p)=>assert.rejects(p);

test('T04b5 stays disabled without touching Redis or enrollment',()=>{
  const result=createDesktopWallSsoTrustedOperatorV4();
  assert.deepEqual(result,{enabled:false,authority:null});
  assert.equal('redeem' in result,false);
});

test('cross-process shared Redis access is hashed and Owner current, never browser state',async()=>{
  const f=fixture(),issued=await f.issue();
  const proof=createDesktopOwnerRedisProofV4({
    redis:f.redis,prefix:PREFIX,accounts:f.accounts,clock:f.clock
  });
  const row=await proof.inspectNativeAccess(issued.access_token);
  assert.deepEqual(Object.keys(row).sort(),[
    'accountId','familyId','isOwner','resource','scope','verified'
  ]);
  assert.equal(row.verified,true);
  assert.equal(row.accountId,ACCOUNT);
  assert.equal(row.isOwner,true);
  assert.equal(await proof.verifyOwnerFamilyCurrent(ACCOUNT,row.familyId),true);
  assert.ok(!JSON.stringify(row).includes(issued.access_token));
  const keys=[...f.records.keys()];
  assert.ok(keys.every(k=>!k.includes(issued.access_token)));
  assert.ok(keys.some(k=>k.endsWith(digest(issued.access_token))));
});

test('native Plugin Owner -> shared Redis -> Operator ticket -> REAL Ed25519 redeem',async()=>{
  const f=fixture(),native=await f.issue(),operator=f.bridge();
  const ticket=await operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  });
  assert.match(ticket.ticket,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(ticket.expiresAt-f.clock(),45000);
  assert.ok(!JSON.stringify(ticket).includes(native.access_token));
  assert.ok(!JSON.stringify(ticket).includes(native.refresh_token));
  const principal=await operator.redeem({
    ticket:ticket.ticket,signedEnvelope:f.sign(ticket.ticket)
  });
  assert.equal(principal.verified,true);
  assert.equal(principal.accountId,ACCOUNT);
  assert.equal(principal.deviceId,f.deviceId);
  assert.equal(principal.purpose,'wall_local_session_authority_v1');
  assert.equal(await operator.assertWallSessionCurrent({
    accountId:principal.accountId,deviceId:principal.deviceId,
    familyId:principal.familyId
  }),true);
  await denied(operator.redeem({
    ticket:ticket.ticket,signedEnvelope:f.sign(ticket.ticket)
  }));
});

test('Desktop Logout deletes family in Plugin; Operator rejects current Wall immediately',async()=>{
  const f=fixture(),native=await f.issue(),operator=f.bridge();
  const ticket=await operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  });
  const principal=await operator.redeem({
    ticket:ticket.ticket,signedEnvelope:f.sign(ticket.ticket)
  });
  assert.equal(await operator.assertWallSessionCurrent(wallSession(principal)),true);
  assert.deepEqual(await f.native.logout(native.refresh_token),
    {ok:true,revoked:true});
  await denied(operator.assertWallSessionCurrent({
    accountId:principal.accountId,deviceId:principal.deviceId,
    familyId:principal.familyId
  }));
  await denied(operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  }));
  const proof=createDesktopOwnerRedisProofV4({
    redis:f.redis,prefix:PREFIX,accounts:f.accounts,clock:f.clock
  });
  assert.equal(await proof.verifyOwnerFamilyCurrent(ACCOUNT,principal.familyId),false);
});

test('Account Portal sign-out invalidates a still-present Redis family',async()=>{
  const f=fixture(),native=await f.issue(),operator=f.bridge();
  const ticket=await operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  });
  const principal=await operator.redeem({
    ticket:ticket.ticket,signedEnvelope:f.sign(ticket.ticket)
  });
  f.logoutPortal();
  await denied(operator.assertWallSessionCurrent(wallSession(principal)));
  await denied(operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  }));
});

test('single Owner transfer immediately revokes current Wall without deleting Redis',async()=>{
  const f=fixture(),native=await f.issue(),operator=f.bridge();
  const ticket=await operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  });
  const principal=await operator.redeem({
    ticket:ticket.ticket,signedEnvelope:f.sign(ticket.ticket)
  });
  f.transferOwner();
  await denied(operator.assertWallSessionCurrent(wallSession(principal)));
  await denied(operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  }));
});

test('disabled Account or revoked enrollment blocks fresh tickets and Wall',async()=>{
  const f=fixture(),native=await f.issue(),operator=f.bridge();
  const ticket=await operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  });
  const principal=await operator.redeem({
    ticket:ticket.ticket,signedEnvelope:f.sign(ticket.ticket)
  });
  f.disableOwner();
  await denied(operator.assertWallSessionCurrent(wallSession(principal)));
  f.accounts.accounts.get(ACCOUNT).status='active';
  f.revokeDevice();
  await denied(operator.assertWallSessionCurrent(wallSession(principal)));
  await denied(operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  }));
});

test('storage unavailable never produces Owner proof or retains an already checked Wall',async()=>{
  const f=fixture(),native=await f.issue(),operator=f.bridge();
  const ticket=await operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  });
  const principal=await operator.redeem({
    ticket:ticket.ticket,signedEnvelope:f.sign(ticket.ticket)
  });
  f.offline();
  await denied(operator.assertWallSessionCurrent(wallSession(principal)));
  await denied(operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  }));
});

test('10-minute old access cannot issue ticket, though a valid Owner family may remain',async()=>{
  const f=fixture(),native=await f.issue(),operator=f.bridge();
  const ticket=await operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  });
  const principal=await operator.redeem({
    ticket:ticket.ticket,signedEnvelope:f.sign(ticket.ticket)
  });
  f.advance(600001);
  await denied(operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  }));
  assert.equal(await operator.assertWallSessionCurrent(wallSession(principal)),true);
});

test('shared Redis prefix isolation, malformed data, wrong family, invalid token fail closed',async()=>{
  const f=fixture(),native=await f.issue();
  const wrong=createDesktopOwnerRedisProofV4({
    redis:f.redis,prefix:'lr:gold:otherlab:',
    accounts:f.accounts,clock:f.clock
  });
  await denied(wrong.inspectNativeAccess(native.access_token));
  const good=createDesktopOwnerRedisProofV4({
    redis:f.redis,prefix:PREFIX,accounts:f.accounts,clock:f.clock
  });
  await denied(good.inspectNativeAccess('x'));
  const accessKey=PREFIX+'desktop-v4:access:'+digest(native.access_token);
  const saved=f.records.get(accessKey);
  f.records.set(accessKey,{value:'{"purpose":"not_owner"}',
    expiresAt:f.clock()+600000});
  await denied(good.inspectNativeAccess(native.access_token));
  f.records.set(accessKey,saved);
  const proof=await good.inspectNativeAccess(native.access_token);
  assert.equal(await good.verifyOwnerFamilyCurrent('attacker',proof.familyId),false);
  assert.equal(await good.verifyOwnerFamilyCurrent(ACCOUNT,'malformed'),false);
});

test('Operator dispatcher + shared Owner Redis + enrolled Ed25519 succeeds once and revokes',async()=>{
  const f=fixture(),native=await f.issue();
  let verifyCount=0;
  const realVerify=f.enrollments.verifyChannel.bind(f.enrollments);
  f.enrollments.verifyChannel=(...args)=>{
    verifyCount++;
    return realVerify(...args);
  };
  const operator=f.bridge();
  const issued=await operator.issue({
    accessToken:native.access_token,deviceId:f.deviceId
  });
  const signedEnvelope=f.sign(issued.ticket);
  const request={ticket:issued.ticket,signedEnvelope};
  let responseStatus=0;
  const dispatch=async input=>handleDeviceChannelRoutes(
    {method:'POST'},
    {setHeader(){}},
    new URL('http://operator.local/v1/device-channel/desktop-wall-sso-redeem'),
    {
      readJson:async()=>input,
      sendJson:(_res,status,data)=>{responseStatus=status;return data;},
      desktopWallSsoSignedRedeem:operator.redeem
    }
  );
  const verified=await dispatch(request);
  assert.equal(responseStatus,200);
  assert.equal(verified.ok,true);
  assert.equal(verifyCount,1,'Ed25519 nonce must be consumed exactly once');
  const principal=verified.authority;
  assert.equal(await operator.assertWallSessionCurrent(wallSession(principal)),true);
  await f.native.logout(native.refresh_token);
  await denied(operator.assertWallSessionCurrent(wallSession(principal)));
  assert.equal((await dispatch({
    ticket:issued.ticket,signedEnvelope:f.sign(issued.ticket)
  })).ok,false);
  assert.equal(responseStatus,403);
});

test('T04b5 can never be mounted without explicit runtime integration',()=>{
  const op=fs.readFileSync(new URL('./executor.mjs',import.meta.url),'utf8');
  const dispatcher=fs.readFileSync(
    new URL('./executor-routes-device-channel.mjs',import.meta.url),'utf8'
  );
  assert.equal(op.includes('createDesktopWallSsoTrustedOperatorV4('),false);
  assert.ok(dispatcher.includes('signedRedeem:deps.desktopWallSsoSignedRedeem'));
  assert.ok(op.includes('desktopWallSsoSignedRedeem:desktopWallSsoOperatorGate.signedRedeem'));
  assert.ok(op.includes('createDesktopWallSsoOperatorGateV4({'));
});

test('invalid Redis, missing AccountRegistry or empty enrollment cannot enable authority',()=>{
  assert.throws(()=>createDesktopWallSsoTrustedOperatorV4({
    enabled:true,redis:{},prefix:PREFIX,accounts:{},enrollments:{}
  }));
  assert.throws(()=>createDesktopOwnerRedisProofV4({
    redis:{},prefix:PREFIX,accounts:{}
  }));
});
