import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createDesktopWallSsoAgentHttpsTransportV4,
  createGoldAbv2AgentWallSsoBridgeV4,GOLDABV2_AGENT_SSO_REDEEM_URL}
  from './desktop-wall-sso-agent-transport-v4.mjs';
import {deviceChannelMessage} from '../lib/device-proof.mjs';
import {EnrollmentRegistry} from '../operator-host/enrollment-registry.mjs';
import {createDesktopWallSsoDeviceProofV4}
  from '../operator-host/desktop-wall-sso-device-proof-v4.mjs';
import {createDesktopWallSsoV4} from '../plugin-server/desktop-wall-sso-v4.mjs';
import {handleDesktopWallSsoSignedRedeemV4}
  from '../operator-host/desktop-wall-sso-signed-route-v4.mjs';
import {registerDesktopWallSsoPublicRedeemV4}
  from '../plugin-server/desktop-wall-sso-public-redeem-v4.mjs';

const ACCESS='A'.repeat(43),FAMILY='F'.repeat(43),ACCOUNT='acct_lab_t04c1';
const flags={
  LIGHT_REMOTE_GOLD_INDEPENDENT:'1',
  LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4:'1',
  LR_GOLD_ABV2_DESKTOP_TOKEN_V4:'1',
  LR_GOLD_ABV2_DESKTOP_WALL_SSO_V4:'1',
  LR_GOLD_ABV2_DESKTOP_WALL_SSO_OPERATOR_V4:'1',
  LR_GOLD_ABV2_DESKTOP_WALL_SSO_ISSUER_V4:'1'
};
const fakeReply=(value,init={})=>new Response(JSON.stringify(value),{
  status:init.status||200,
  headers:{'content-type':'application/json',...(init.headers||{})}
});
function fixture(){
  const now=1700000000000;
  const keys=crypto.generateKeyPairSync('ed25519');
  const enrollments=new EnrollmentRegistry({now:()=>now,emit:()=>{}});
  const begin=enrollments.begin({
    publicIdentityKey:keys.publicKey.export({format:'der',type:'spki'}).toString('base64'),
    displayName:'T04c1 end-to-end source fixture',
    platform:'linux',architecture:'arm64',capabilities:['filesystem']
  });
  const {deviceId}=enrollments.approve({
    code:begin.deviceCode,accountId:ACCOUNT,approvedCapabilities:['filesystem']
  });
  const fakeRedis=new Map();
  const redis={
    async set(key,val,{EX,NX}){
      assert.equal(EX,45);assert.equal(NX,true);
      if(fakeRedis.has(key))return null;
      fakeRedis.set(key,val);return 'OK';
    },
    async getDel(key){const val=fakeRedis.get(key);fakeRedis.delete(key);return val??null;}
  };
  const device=createDesktopWallSsoDeviceProofV4({enrollments});
  const owner=createDesktopWallSsoV4({
    redis,prefix:'lr:gold:lab:',clock:()=>now,
    inspectNativeAccess:async token=>({
      verified:token===ACCESS,isOwner:token===ACCESS,
      accountId:ACCOUNT,familyId:FAMILY,
      scope:'desktop:read',resource:'urn:light-remote:desktop-owner:v4'
    }),
    verifyEnrolledDevice:device.verifyEnrolledDevice,
    verifySignedWallDevice:device.verifySignedWallDevice,
    verifyOwnerFamilyCurrent:async()=>true
  });
  let verifyCount=0;
  const rawVerify=enrollments.verifyChannel.bind(enrollments);
  enrollments.verifyChannel=(...args)=>{verifyCount++;return rawVerify(...args);};
  const operatorCall=async(_method,path,body)=>{
    assert.equal(path,'/v1/device-channel/desktop-wall-sso-redeem');
    let status=503,payload=null;
    await handleDesktopWallSsoSignedRedeemV4({method:'POST'},
      {setHeader(){}},{
        readJson:async()=>body,signedRedeem:owner.redeem,
        sendJson:(_res,s,val)=>{status=s;payload=val;}
      });
    if(status!==200)throw Error('denied');
    return payload;
  };
  let callback;
  registerDesktopWallSsoPublicRedeemV4({
    post(path,handler){
      assert.equal(path,'/device-channel/desktop-wall-sso-redeem');
      callback=handler;
    }
  },{env:flags,rateAllow:async()=>true,operatorCall});
  const readEnrollment=()=>({accountId:ACCOUNT,deviceId});
  function signChannel(action,payload){
    const envelope={
      deviceId,timestamp:now,nonce:crypto.randomBytes(18).toString('base64url'),
      payload
    };
    return {...envelope,signature:crypto.sign(null,Buffer.from(
      deviceChannelMessage({...envelope,action})
    ),keys.privateKey).toString('base64url')};
  }
  let requests=0;
  const fetchImpl=async(url,options)=>{
    requests++;
    assert.equal(url,GOLDABV2_AGENT_SSO_REDEEM_URL);
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'error');
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(options.headers['content-type'],'application/json');
    assert.ok(!options.headers.cookie&&!options.headers.authorization);
    const obj=JSON.parse(options.body);
    const state={code:200,value:null};
    const res={
      set(){return this;},
      status(code){state.code=code;return this;},
      json(value){state.value=value;return this;}
    };
    await callback({
      method:'POST',originalUrl:'/device-channel/desktop-wall-sso-redeem',
      headers:{
        'content-type':'application/json',
        'content-length':String(Buffer.byteLength(options.body))
      },body:obj
    },res);
    return fakeReply(state.value,{status:state.code});
  };
  const bridge=createGoldAbv2AgentWallSsoBridgeV4({
    readEnrollment,signChannel,fetchImpl,clock:()=>now
  });
  return {bridge,owner,deviceId,requests:()=>requests,
    verifyCount:()=>verifyCount};
}
test('T04b9c1 Agent->HTTPS shim->public Plugin->Operator->Ed25519->Redis 1-use',async()=>{
  const f=fixture(),issued=await f.owner.issue({
    accessToken:ACCESS,deviceId:f.deviceId
  });
  const principal=await f.bridge.redeem(issued.ticket);
  assert.deepEqual(principal,{
    verified:true,purpose:'wall_local_session_authority_v1',
    accountId:ACCOUNT,deviceId:f.deviceId,familyId:FAMILY
  });
  assert.equal(f.requests(),1);
  assert.equal(f.verifyCount(),1,'Operator Ed25519 nonce verified exactly once');
  await assert.rejects(f.bridge.redeem(issued.ticket),
    /desktop_wall_sso_agent_redeem_denied/);
  assert.equal(f.verifyCount(),2);
});

test('T04b9c1 rejects redirects, non-JSON, errors and response size overflow',async()=>{
  const invalid=[
    ()=>fakeReply({ok:false,error:'not_found'},{status:404}),
    ()=>new Response('',{status:302,headers:{location:'https://evil.example'}}),
    ()=>new Response('OK',{headers:{'content-type':'text/plain'}}),
    ()=>fakeReply({ok:true,authority:{}},{headers:{'content-length':'9000'}}),
    ()=>fakeReply({ok:true,authority:{purpose:'wrong'}}),
    ()=>new Response('A'.repeat(2100),{headers:{'content-type':'application/json'}})
  ];
  const data={
    ticket:'T'.repeat(43),
    signedEnvelope:{
      deviceId:'dev_good',timestamp:1700000000000,
      nonce:'N'.repeat(24),signature:'S'.repeat(86),
      payload:{
        ticketDigest:crypto.createHash('sha256').update('T'.repeat(43)).digest('hex')
      }
    }
  };
  for(const response of invalid){
    const agent=createDesktopWallSsoAgentHttpsTransportV4({
      fetchImpl:async()=>response()
    });
    await assert.rejects(agent.sendSignedRedeem(data),
      /desktop_wall_sso_agent_transport_denied/);
  }
});

test('T04b9c1 no request is made for mutated signed digest, ticket or extra keys',async()=>{
  let called=0;
  const transport=createDesktopWallSsoAgentHttpsTransportV4({
    fetchImpl:async()=>{called++;return fakeReply({});}
  });
  const ticket='X'.repeat(43);
  const d={
    ticket,
    signedEnvelope:{
      deviceId:'dev_foo',timestamp:1700000000000,
      nonce:'N'.repeat(24),signature:'S'.repeat(86),
      payload:{ticketDigest:'a'.repeat(64)}
    }
  };
  for(const invalid of [
    d,{...d,agentId:'guest'},
    {...d,signedEnvelope:{...d.signedEnvelope,payload:{ticketDigest:'b'.repeat(64)}}},
    {...d,ticket:'x'},
  ]){
    await assert.rejects(transport.sendSignedRedeem(invalid),
      /desktop_wall_sso_agent_transport_denied/);
  }
  assert.equal(called,0);
});

test('T04b9c1 transport does not accept arbitrary URLs, invalid fetch or browser',()=>{
  assert.equal(
    GOLDABV2_AGENT_SSO_REDEEM_URL,
    'https://goldabv2.light-remote.thaiduy.digital/device-channel/desktop-wall-sso-redeem'
  );
  assert.throws(()=>createDesktopWallSsoAgentHttpsTransportV4({fetchImpl:null}),
    /desktop_wall_sso_agent_transport_denied/);
});
