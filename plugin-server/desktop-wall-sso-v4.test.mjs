import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {createDesktopWallSsoV4,DESKTOP_WALL_TICKET_TTL_MS}
  from './desktop-wall-sso-v4.mjs';

const ACCESS='A'.repeat(43);
const FAMILY='F'.repeat(43);
const ACCOUNT='acct_owner';
const DEVICE='dev_owned_01';
const RESOURCE='urn:light-remote:desktop-owner:v4';
const SCOPE='desktop:read';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');

function fixture(){
  let now=1000000,seq=0,active=true,enrolled=true;
  const store=new Map();
  const redis={
    async set(k,v,opts){
      if(opts?.NX!==true||opts.EX!==45)throw Error('unexpected_redis_options');
      if(store.has(k))return null;
      store.set(k,{value:v,expiry:now+opts.EX*1000});return 'OK';
    },
    async getDel(k){
      const row=store.get(k);store.delete(k);
      return row?.expiry>now?row.value:null;
    }
  };
  const calls={native:0,device:0,signed:0,family:0};
  const service=createDesktopWallSsoV4({
    redis,prefix:'lr:gold:lab:',
    inspectNativeAccess:async bearer=>{
      calls.native++;
      if(bearer!==ACCESS)return {verified:false};
      return {verified:true,isOwner:true,resource:RESOURCE,scope:SCOPE,
        accountId:ACCOUNT,familyId:FAMILY};
    },
    verifyEnrolledDevice:async(a,d)=>{
      calls.device++;
      return {verified:enrolled,enrolled,revoked:!enrolled,
        accountId:a,deviceId:d};
    },
    verifySignedWallDevice:async({signedEnvelope,ticketDigest})=>{
      calls.signed++;
      if(signedEnvelope?.signed!==true)return {verified:false};
      return {verified:true,authentication:'device_signed',
        accountId:signedEnvelope.accountId,
        deviceId:signedEnvelope.deviceId,
        ticketDigest:signedEnvelope.digest||ticketDigest};
    },
    verifyOwnerFamilyCurrent:async(a,f)=>{
      calls.family++;
      return active&&a===ACCOUNT&&f===FAMILY;
    },
    clock:()=>now,
    random:n=>{assert.equal(n,32);return Buffer.alloc(n,++seq);}
  });
  return {
    service,store,calls,
    now:()=>now,advance:n=>{now+=n;},
    revoke:()=>{active=false;},
    unenroll:()=>{enrolled=false;}
  };
}
const issue=f=>f.service.issue({accessToken:ACCESS,deviceId:DEVICE});
const signed=(ticket,{accountId=ACCOUNT,deviceId=DEVICE,digest}={})=>({
  signed:true,accountId,deviceId,digest:digest||hash(ticket)
});
const redeem=(f,ticket,extra={})=>f.service.redeem({
  ticket,signedEnvelope:signed(ticket,extra)
});
const rejects=(promise,code)=>assert.rejects(promise,e=>e?.code===code);

test('T04a issues 256-bit one-use ticket, hashed key and TTL 45s',async()=>{
  const f=fixture();const row=await issue(f);
  assert.match(row.ticket,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(row.expiresAt-f.now(),DESKTOP_WALL_TICKET_TTL_MS);
  assert.equal(row.deviceId,DEVICE);
  assert.equal(f.store.size,1);
  const [key,stored]=[...f.store][0];
  assert.ok(key.endsWith(hash(row.ticket)));
  assert.ok(!key.includes(row.ticket));
  assert.ok(!stored.value.includes(ACCESS));
  assert.ok(!JSON.stringify(row).includes(ACCESS));
  assert.ok(!JSON.stringify(row).includes(FAMILY));
});

test('signed exact-device redeem creates no Desktop bearer or Wall cookie',async()=>{
  const f=fixture();const {ticket}=await issue(f);
  const out=await redeem(f,ticket);
  assert.deepEqual(out,{verified:true,purpose:'wall_local_session_authority_v1',
    accountId:ACCOUNT,deviceId:DEVICE,familyId:FAMILY});
  assert.ok(!JSON.stringify(out).includes(ACCESS));
  assert.equal(f.store.size,0);
  assert.equal(f.calls.signed,1);
  assert.equal(f.calls.family,1);
  await rejects(redeem(f,ticket),'wall_sso_ticket_expired_or_used');
});

test('forged or absent signed-device proof denies before burning ticket',async()=>{
  const f=fixture();const {ticket}=await issue(f);
  await rejects(f.service.redeem({ticket,signedEnvelope:{signed:false}}),
    'wall_sso_device_proof_required');
  assert.equal(f.store.size,1);
  await redeem(f,ticket);
  assert.equal(f.store.size,0);
});

test('signed device proof bound to ticket digest; wrong digest denies',async()=>{
  const f=fixture();const {ticket}=await issue(f);
  await rejects(redeem(f,ticket,{digest:'0'.repeat(64)}),
    'wall_sso_device_proof_required');
  assert.equal(f.store.size,1);
});

test('signed but wrong device burns one-use ticket, no authority',async()=>{
  const f=fixture();const {ticket}=await issue(f);
  await rejects(redeem(f,ticket,{deviceId:'dev_attacker'}),
    'wall_sso_ticket_invalid');
  assert.equal(f.store.size,0);
  await rejects(redeem(f,ticket),'wall_sso_ticket_expired_or_used');
});

test('signed but wrong owner account burns one-use ticket',async()=>{
  const f=fixture();const {ticket}=await issue(f);
  await rejects(redeem(f,ticket,{accountId:'acct_other'}),
    'wall_sso_ticket_invalid');
  assert.equal(f.store.size,0);
});

test('tickets expire after 45 seconds even if device proof is valid',async()=>{
  const f=fixture();const {ticket}=await issue(f);
  f.advance(45000);
  await rejects(redeem(f,ticket),'wall_sso_ticket_expired_or_used');
});

test('logout/Owner session revocation invalidates pending and redeemed authority',async()=>{
  const f=fixture();const {ticket}=await issue(f);
  f.revoke();
  await rejects(redeem(f,ticket),'wall_sso_owner_revoked');
  assert.equal(f.store.size,0);
  await rejects(f.service.assertWallSessionCurrent({
    accountId:ACCOUNT,deviceId:DEVICE,familyId:FAMILY
  }),'wall_sso_owner_revoked');
});

test('device unenrollment invalidates pending and existing Wall authority',async()=>{
  const f=fixture();const {ticket}=await issue(f);f.unenroll();
  await rejects(redeem(f,ticket),'wall_sso_device_mismatch');
  await rejects(f.service.assertWallSessionCurrent({
    accountId:ACCOUNT,deviceId:DEVICE,familyId:FAMILY
  }),'wall_sso_device_mismatch');
});

test('native Desktop access proof is required to issue tickets',async()=>{
  const f=fixture();
  await rejects(f.service.issue({accessToken:'bad',deviceId:DEVICE}),
    'wall_sso_request_invalid');
  await rejects(f.service.issue({accessToken:'B'.repeat(43),deviceId:DEVICE}),
    'wall_sso_owner_required');
  assert.equal(f.store.size,0);
});

test('untrusted Agent approval, caller account ID and A/B fields forbidden',async()=>{
  const f=fixture();
  for(const extra of [
    {agentId:'agent_x'}, {bCode:'0000-0000'},
    {accountId:'acct_attacker'},{ownerApproved:true},{grantId:'g1'},
    {refreshToken:'R'.repeat(43)}
  ]){
    await rejects(f.service.issue({accessToken:ACCESS,deviceId:DEVICE,...extra}),
      'wall_sso_request_invalid');
  }
  assert.equal(f.calls.native,0);
  assert.equal(f.store.size,0);
});

test('untrusted redeem fields forbidden; no native bearer can be sent to Wall',async()=>{
  const f=fixture();const {ticket}=await issue(f);
  await rejects(f.service.redeem({
    ticket,signedEnvelope:signed(ticket),accessToken:ACCESS
  }),'wall_sso_request_invalid');
  await rejects(f.service.redeem({
    ticket,signedEnvelope:signed(ticket),refreshToken:'R'.repeat(43)
  }),'wall_sso_request_invalid');
  assert.equal(f.store.size,1);
});

test('every protected Wall request rechecks live Owner and enrolled device',async()=>{
  const f=fixture();const args={accountId:ACCOUNT,deviceId:DEVICE,familyId:FAMILY};
  assert.equal(await f.service.assertWallSessionCurrent(args),true);
  assert.equal(f.calls.family,1);
  assert.equal(await f.service.assertWallSessionCurrent(args),true);
  assert.equal(f.calls.family,2);
  f.revoke();
  await rejects(f.service.assertWallSessionCurrent(args),'wall_sso_owner_revoked');
});

test('session principal cannot be supplied with extra authority',async()=>{
  const f=fixture();
  await rejects(f.service.assertWallSessionCurrent({
    accountId:ACCOUNT,deviceId:DEVICE,familyId:FAMILY,
    agentPermission:true
  }),'wall_sso_session_invalid');
});

test('missing signed verifier or Redis refuses to enable SSO',()=>{
  const f=fixture();
  assert.throws(()=>createDesktopWallSsoV4({
    redis:{set(){},getDel(){}},prefix:'bad',
    inspectNativeAccess:async()=>true
  }),e=>e.code==='wall_sso_authority_unavailable');
  assert.ok(f.service);
});

test('T04a remains source-only: no HTTP route or Wall integration mounted',()=>{
  const cloud=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
  const wall=fs.readFileSync(new URL('../device-agent/local-wall.mjs',import.meta.url),'utf8');
  assert.ok(!cloud.includes("desktop-wall-sso-v4.mjs"));
  assert.ok(wall.includes('desktopWallSso=null'));
  assert.ok(wall.includes('permanently seal legacy browser-ticket redemption'));
  assert.ok(wall.includes("if(url.pathname==='/auth/desktop/sso/redeem')"));
  assert.ok(wall.includes('desktopSsoBootstrap.finish(req)'));
});
