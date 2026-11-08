import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {EnrollmentRegistry} from '../operator-host/enrollment-registry.mjs';
import {deviceChannelMessage} from '../lib/device-proof.mjs';
import {createDesktopWallSsoFamilyCurrentV4,
  WALL_SSO_FAMILY_CURRENT_ACTION_V4}
  from '../operator-host/desktop-wall-sso-family-current-v4.mjs';
import {handleDeviceChannelRoutes}
  from '../operator-host/executor-routes-device-channel.mjs';
import {registerDesktopWallSsoPublicFamilyCurrentV4,
  WALL_SSO_FAMILY_PUBLIC_PATH_V4,WALL_SSO_FAMILY_OPERATOR_PATH_V4}
  from '../plugin-server/desktop-wall-sso-public-family-current-v4.mjs';
import {createDesktopWallSsoAgentFamilyCurrentV4,
  GOLDABV2_WALL_SSO_FAMILY_URL_V4}
  from './desktop-wall-sso-family-current-v4.mjs';
import {createDesktopWallSsoSession}
  from './desktop-wall-sso-session.mjs';
const A='acct_t04b9c2_agent',F='F'.repeat(43),T='T'.repeat(43);
const ON=Object.fromEntries([
  'LIGHT_REMOTE_GOLD_INDEPENDENT',
  'LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4',
  'LR_GOLD_ABV2_DESKTOP_TOKEN_V4',
  'LR_GOLD_ABV2_DESKTOP_WALL_SSO_V4',
  'LR_GOLD_ABV2_DESKTOP_WALL_SSO_OPERATOR_V4',
  'LR_GOLD_ABV2_DESKTOP_WALL_SSO_ISSUER_V4'
].map(x=>[x,'1']));
const makeRes=()=>({
  statusCode:200,body:null,headers:{},
  status(n){this.statusCode=n;return this;},
  set(k,v){this.headers[k.toLowerCase()]=v;return this;},
  setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;},
  json(x){this.body=x;return this;}
});
function fixture({env=ON}={}){
  let now=1700000000000,ownerLive=true,enrollmentActive=true;
  let pluginInvocations=0,operatorInvocations=0,signatureVerifications=0;
  const pair=crypto.generateKeyPairSync('ed25519');
  const enrollment=new EnrollmentRegistry({now:()=>now,emit:()=>{}});
  const start=enrollment.begin({
    publicIdentityKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64'),
    displayName:'T04b9c2 full-chain fixture',platform:'linux',
    architecture:'arm64',capabilities:['filesystem']
  });
  const {deviceId}=enrollment.approve({
    code:start.deviceCode,accountId:A,approvedCapabilities:['filesystem']
  });
  const original=enrollment.verifyChannel.bind(enrollment);
  enrollment.verifyChannel=(...args)=>{
    signatureVerifications++;return original(...args);
  };
  const service=createDesktopWallSsoFamilyCurrentV4({
    enabled:true,enrollments:enrollment,
    assertWallSessionCurrent:async({accountId,deviceId:id,familyId})=>{
      const row=enrollment.binding(id);
      return ownerLive&&row.accountId===accountId&&row.deviceId===deviceId&&
        familyId===F;
    }
  });
  function signChannel(action,payload){
    const data={
      deviceId,timestamp:now,nonce:crypto.randomBytes(18).toString('base64url'),
      payload
    };
    return {...data,signature:crypto.sign(null,Buffer.from(
      deviceChannelMessage({...data,action})
    ),pair.privateKey).toString('base64url')};
  }
  let publicRoute;
  const publicGate=registerDesktopWallSsoPublicFamilyCurrentV4({
    post:(path,fn)=>{
      assert.equal(path,WALL_SSO_FAMILY_PUBLIC_PATH_V4);
      publicRoute=fn;
    }
  },{
    env,rateAllow:async()=>true,
    operatorCall:async(method,path,body)=>{
      operatorInvocations++;
      assert.equal(method,'POST');
      assert.equal(path,WALL_SSO_FAMILY_OPERATOR_PATH_V4);
      const result=makeRes();
      await handleDeviceChannelRoutes(
        {method:'POST'},result,new URL('http://operator.local'+path),
        {
          desktopWallSsoFamilyCurrent:service.check,
          readJson:async()=>body,
          sendJson:(_res,status,data)=>{
            result.statusCode=status;result.body=data;return data;
          }
        }
      );
      if(result.statusCode!==200)throw Error('family_denied');
      return result.body;
    }
  });
  const fetchImpl=async(url,options)=>{
    pluginInvocations++;
    assert.equal(url,GOLDABV2_WALL_SSO_FAMILY_URL_V4);
    assert.equal(options.redirect,'error');
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    assert.equal(options.referrerPolicy,'no-referrer');
    assert.ok(!options.headers.cookie&&!options.headers.authorization);
    const result=makeRes();
    await publicRoute({
      method:'POST',originalUrl:WALL_SSO_FAMILY_PUBLIC_PATH_V4,
      headers:{
        'content-type':'application/json',
        'content-length':String(Buffer.byteLength(options.body))
      },
      body:JSON.parse(options.body)
    },result);
    return new Response(JSON.stringify(result.body),{
      status:result.statusCode,
      headers:{'content-type':'application/json'}
    });
  };
  const current=createDesktopWallSsoAgentFamilyCurrentV4({
    readEnrollment:()=>({accountId:A,deviceId,revoked:!enrollmentActive}),
    signChannel,fetchImpl,clock:()=>now
  });
  const principal={verified:true,purpose:'wall_local_session_authority_v1',
    accountId:A,deviceId,familyId:F};
  const wall=createDesktopWallSsoSession({
    redeemSignedTicket:async()=>principal,
    verifyLiveOwnerFamily:current.verifyLiveOwnerFamily
  });
  return {
    deviceId,wall,current,publicGate,signChannel,
    identity:()=>({accountId:A,deviceId,familyId:F}),
    revokeOwner:()=>{ownerLive=false;},
    revokeDevice:()=>{enrollmentActive=false;},
    forceRevoke:()=>enrollment.revoke({accountId:A,deviceId}),
    metrics:()=>({pluginInvocations,operatorInvocations,signatureVerifications}),
    changeTime:ms=>{now+=ms;},
    testPlugin:async(body,headers={})=>{
      const out=makeRes();
      await publicRoute({
        method:'POST',originalUrl:WALL_SSO_FAMILY_PUBLIC_PATH_V4,
        headers:{
          'content-type':'application/json',
          'content-length':String(Buffer.byteLength(JSON.stringify(body))),
          ...headers
        },body
      },out);
      return out;
    }
  };
}

test('T04b9c2 signed Agent -> Plugin -> Operator -> Wall every request',async()=>{
  const f=fixture(),issued=await f.wall.redeem(T);
  const cookie=issued.cookie.split(';',1)[0];
  const req=()=>({headers:{cookie}});
  assert.equal((await f.wall.identity(req()))?.desktopOwnerSso,true);
  assert.equal((await f.wall.identity(req()))?.desktopOwnerSso,true);
  assert.deepEqual(f.metrics(),{
    pluginInvocations:2,operatorInvocations:2,signatureVerifications:2
  });
});

test('T04b9c2 Owner logout is reflected on next request, cookie evicted',async()=>{
  const f=fixture(),issued=await f.wall.redeem(T);
  const req={headers:{cookie:issued.cookie.split(';',1)[0]}};
  assert.ok(await f.wall.identity(req));
  f.revokeOwner();
  assert.equal(await f.wall.identity(req),null);
  assert.equal(await f.wall.identity(req),null);
  assert.equal(f.metrics().signatureVerifications,2);
});

test('T04b9c2 enrollment revocation and Agent relink deny current Owner',async()=>{
  const f=fixture();
  assert.equal(await f.current.verifyLiveOwnerFamily(f.identity()),true);
  f.forceRevoke();
  assert.equal(await f.current.verifyLiveOwnerFamily(f.identity()),false);
  const g=fixture();g.revokeDevice();
  assert.equal(await g.current.verifyLiveOwnerFamily(g.identity()),false);
  assert.equal(g.metrics().pluginInvocations,0);
});

test('T04b9c2 replaying an already signed nonce never succeeds',async()=>{
  const f=fixture(),envelope=f.signChannel(
    WALL_SSO_FAMILY_CURRENT_ACTION_V4,f.identity()
  );
  const first=await f.testPlugin(envelope);
  assert.equal(first.statusCode,200);
  const second=await f.testPlugin(envelope);
  assert.equal(second.statusCode,403);
});

test('T04b9c2 all six SSO flags OFF returns 404 with no Operator access',async()=>{
  const f=fixture({env:{}});
  assert.deepEqual(f.publicGate,{enabled:false,routes:0});
  assert.equal(await f.current.verifyLiveOwnerFamily(f.identity()),false);
  assert.deepEqual(f.metrics(),{
    pluginInvocations:1,operatorInvocations:0,signatureVerifications:0
  });
});

test('T04b9c2 browser Origin, cookie and extra identity fields denied',async()=>{
  const f=fixture(),envelope=f.signChannel(
    WALL_SSO_FAMILY_CURRENT_ACTION_V4,f.identity()
  );
  assert.equal((await f.testPlugin(envelope,{origin:'https://evil.example'})).statusCode,400);
  assert.equal((await f.testPlugin(envelope,{cookie:'session=1'})).statusCode,400);
  assert.equal((await f.testPlugin({...envelope,agentId:'evil'})).statusCode,400);
  assert.equal((await f.testPlugin({...envelope,
    payload:{...envelope.payload,approved:true}})).statusCode,400);
  assert.equal(f.metrics().operatorInvocations,0);
});

test('T04b9c2 malformed/redirect/unavailable cloud returns false',async()=>{
  const f=fixture();
  const responses=[
    new Response('',{status:302,headers:{location:'https://evil.example'}}),
    new Response('bad',{headers:{'content-type':'text/plain'}}),
    new Response('A'.repeat(2100),{headers:{'content-type':'application/json'}}),
    new Response(JSON.stringify({ok:true,current:true,deviceId:'dev_other'}),
      {headers:{'content-type':'application/json'}})
  ];
  for(const resp of responses){
    const s=createDesktopWallSsoAgentFamilyCurrentV4({
      readEnrollment:()=>f.identity(),
      signChannel:f.signChannel,
      fetchImpl:async()=>resp
    });
    assert.equal(await s.verifyLiveOwnerFamily(f.identity()),false);
  }
});

test('T04b9c2 new family-current route remains absent from generic whitelist',()=>{
  const devicePublic=fs.readFileSync(
    new URL('../plugin-server/device-public.mjs',import.meta.url),'utf8');
  const list=devicePublic.split('const CHANNEL = new Set([')[1].split(']);')[0];
  assert.equal(list.includes('desktop-wall-sso-family-current'),false);
  const app=fs.readFileSync(
    new URL('../plugin-server/server.mjs',import.meta.url),'utf8');
  assert.ok(app.includes('app.use(WALL_SSO_FAMILY_PUBLIC_PATH_V4,'));
  assert.ok(app.includes('req.path===WALL_SSO_FAMILY_PUBLIC_PATH_V4'));
  assert.ok(app.includes("express.json({limit:'2048b',strict:true})"));
});
