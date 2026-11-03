import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {EnrollmentRegistry} from './enrollment-registry.mjs';
import {deviceChannelMessage} from '../lib/device-proof.mjs';
import {createDesktopWallSsoDeviceProofV4,WALL_SSO_SIGNED_ACTION}
  from './desktop-wall-sso-device-proof-v4.mjs';
import {createDesktopWallSsoV4}
  from '../plugin-server/desktop-wall-sso-v4.mjs';
import {handleDesktopWallSsoSignedRedeemV4}
  from './desktop-wall-sso-signed-route-v4.mjs';
import {handleDeviceChannelRoutes}
  from './executor-routes-device-channel.mjs';

const ACCESS='X'.repeat(43),FAMILY='F'.repeat(43),ACCOUNT='acct_t04b4';
const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
function fixture(){
  let now=1700000000000,serial=0,verifyCalls=0,active=true;
  const pair=crypto.generateKeyPairSync('ed25519');
  const enrollments=new EnrollmentRegistry({now:()=>now,emit:()=>{}});
  const begin=enrollments.begin({
    publicIdentityKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64'),
    displayName:'T04b4 signed route fixture',platform:'linux',
    architecture:'arm64',capabilities:['filesystem']
  });
  const row=enrollments.approve({
    code:begin.deviceCode,accountId:ACCOUNT,approvedCapabilities:['filesystem']
  });
  const deviceId=row.deviceId;
  const rawVerify=enrollments.verifyChannel.bind(enrollments);
  enrollments.verifyChannel=(...args)=>{verifyCalls++;return rawVerify(...args);};
  const proof=createDesktopWallSsoDeviceProofV4({enrollments});
  const store=new Map();
  const redis={
    async set(key,val,opt){
      assert.equal(opt.EX,45);assert.equal(opt.NX,true);
      if(store.has(key))return null;
      store.set(key,val);return 'OK';
    },
    async getDel(key){const value=store.get(key);store.delete(key);return value??null;}
  };
  const service=createDesktopWallSsoV4({
    redis,prefix:'lr:gold:lab:',
    inspectNativeAccess:async(token)=>({
      verified:token===ACCESS,isOwner:token===ACCESS,
      accountId:ACCOUNT,familyId:FAMILY,
      resource:'urn:light-remote:desktop-owner:v4',scope:'desktop:read'
    }),
    verifyEnrolledDevice:proof.verifyEnrolledDevice,
    verifySignedWallDevice:proof.verifySignedWallDevice,
    verifyOwnerFamilyCurrent:async(a,f)=>active&&a===ACCOUNT&&f===FAMILY,
    clock:()=>now
  });
  function sign(ticket,{key=pair.privateKey,extra={}}={}){
    const data={ticketDigest:digest(ticket)};
    const envelope={
      deviceId,timestamp:now,
      nonce:crypto.randomBytes(18).toString('base64url'),
      payload:data
    };
    envelope.signature=crypto.sign(null,Buffer.from(deviceChannelMessage({
      ...envelope,action:WALL_SSO_SIGNED_ACTION
    })),key).toString('base64url');
    return {...envelope,...extra};
  }
  async function call(body,handler=service.redeem){
    const res={headers:{},setHeader(k,v){this.headers[k]=v}};
    let readCount=0;
    let consumed=false,code;
    await handleDesktopWallSsoSignedRedeemV4(
      {method:'POST'},
      res,
      {
        readJson:async()=>{readCount++;return body;},
        sendJson:(_r,status,result)=>{
          code=status;consumed=result;return result;
        },
        signedRedeem:handler
      }
    );
    return {code,body:consumed,headers:res.headers,readCount};
  }
  const issue=()=>service.issue({accessToken:ACCESS,deviceId});
  return {service,store,call,issue,sign,deviceId,enrollments,
    verifyCalls:()=>verifyCalls,revoke:()=>{active=false;},
    ticketValue:()=>[...store][0]?.[0]};
}

test('T04b4 disabled handler returns 404 BEFORE reading/accepting caller body',async()=>{
  let parsed=0,code;
  await handleDesktopWallSsoSignedRedeemV4({},{
    setHeader(){},
  },{
    readJson:async()=>{parsed++;throw Error('should not parse');},
    sendJson:(_,status)=>{code=status}
  });
  assert.equal(code,404);
  assert.equal(parsed,0);
});

test('real enrollment Ed25519 signs 45-second one-use ticket, verifies ONCE',async()=>{
  const f=fixture(),issued=await f.issue();
  const result=await f.call({
    ticket:issued.ticket,signedEnvelope:f.sign(issued.ticket)
  });
  assert.equal(result.code,200);
  assert.equal(result.readCount,1);
  assert.equal(result.headers['Cache-Control'],'no-store');
  assert.deepEqual(result.body,{
    ok:true,
    authority:{
      purpose:'wall_local_session_authority_v1',
      accountId:ACCOUNT,deviceId:f.deviceId,familyId:FAMILY
    }
  });
  assert.equal(f.verifyCalls(),1,'canonical signed verifier must run exactly once');
  assert.equal(f.store.size,0);
  assert.ok(!JSON.stringify(result.body).includes(ACCESS));
});

test('ticket cannot be redeemed again, even with a new valid device signature',async()=>{
  const f=fixture(),issued=await f.issue();
  assert.equal((await f.call({
    ticket:issued.ticket,signedEnvelope:f.sign(issued.ticket)
  })).code,200);
  assert.equal((await f.call({
    ticket:issued.ticket,signedEnvelope:f.sign(issued.ticket)
  })).code,403);
  assert.equal(f.verifyCalls(),2);
});

test('parallel redemption with unique signed nonces has exactly one winner',async()=>{
  const f=fixture(),issued=await f.issue();
  const [a,b]=await Promise.all([
    f.call({ticket:issued.ticket,signedEnvelope:f.sign(issued.ticket)}),
    f.call({ticket:issued.ticket,signedEnvelope:f.sign(issued.ticket)})
  ]);
  assert.deepEqual([a.code,b.code].sort(),[200,403]);
  assert.equal(f.store.size,0);
});

test('forged Ed25519 private key fails without burning ticket',async()=>{
  const f=fixture(),issued=await f.issue();
  const attacker=crypto.generateKeyPairSync('ed25519');
  const invalid=await f.call({
    ticket:issued.ticket,
    signedEnvelope:f.sign(issued.ticket,{key:attacker.privateKey})
  });
  assert.equal(invalid.code,403);
  assert.equal(f.store.size,1);
  assert.equal((await f.call({
    ticket:issued.ticket,signedEnvelope:f.sign(issued.ticket)
  })).code,200);
});

test('a signed proof cannot swap a different ticket digest',async()=>{
  const f=fixture(),a=await f.issue();
  const b=await f.issue();
  assert.equal((await f.call({
    ticket:a.ticket,signedEnvelope:f.sign(b.ticket)
  })).code,403);
  assert.equal(f.store.size,2);
});

test('extra account, Agent, refresh, B code or permission payload is rejected',async()=>{
  const f=fixture(),issued=await f.issue();
  const signedEnvelope=f.sign(issued.ticket);
  for(const extra of [
    {accountId:ACCOUNT},
    {agentId:'agent_1'},
    {bCode:'0000-0000'},
    {refreshToken:'R'.repeat(43)},
    {grantId:'g_1'}
  ]){
    const v=await f.call({ticket:issued.ticket,signedEnvelope,...extra});
    assert.equal(v.code,400);
  }
  assert.equal(f.store.size,1);
  assert.equal(f.verifyCalls(),0);
});

test('extra signed-envelope identity or payload fields are rejected',async()=>{
  const f=fixture(),issued=await f.issue();
  const signedEnvelope=f.sign(issued.ticket);
  for(const input of [
    {...signedEnvelope,accountId:'attacker'},
    {...signedEnvelope,payload:{ticketDigest:digest(issued.ticket),approved:true}}
  ]){
    const v=await f.call({ticket:issued.ticket,signedEnvelope:input});
    assert.equal(v.code,400);
  }
  assert.equal(f.store.size,1);
});

test('revoked Owner family fails closed, no authority or sensitive error',async()=>{
  const f=fixture(),issued=await f.issue();
  f.revoke();
  const v=await f.call({ticket:issued.ticket,signedEnvelope:f.sign(issued.ticket)});
  assert.equal(v.code,403);
  assert.deepEqual(v.body,{ok:false,error:'desktop_wall_sso_denied'});
  assert.equal(f.store.size,0);
});

test('service must return verified authority with enrolled account and family',async()=>{
  const f=fixture(),issued=await f.issue();
  for(const principal of [
    {verified:false},
    {verified:true,purpose:'Agent'},
    {verified:true,purpose:'wall_local_session_authority_v1',
      accountId:'attacker',deviceId:'',familyId:FAMILY}
  ]){
    const v=await f.call({
      ticket:issued.ticket,signedEnvelope:f.sign(issued.ticket)
    },async()=>principal);
    assert.equal(v.code,403);
  }
});

test('real Operator dispatcher refuses SSO route without trusted adapter',async()=>{
  let bodyRead=0,code=null;
  const response=await handleDeviceChannelRoutes(
    {method:'POST'},{},
    new URL('http://operator.local/v1/device-channel/desktop-wall-sso-redeem'),
    {
      readJson:async()=>{bodyRead++;throw Error('default-off must not read');},
      sendJson:(_,status,payload)=>{code=status;return payload;}
    }
  );
  assert.equal(code,404);
  assert.deepEqual(response,{ok:false,error:'not_found'});
  assert.equal(bodyRead,0);
});

test('real Operator dispatcher can delegate once to enrolled signed authority',async()=>{
  const f=fixture(),issued=await f.issue();
  let code=null;
  const input={ticket:issued.ticket,signedEnvelope:f.sign(issued.ticket)};
  const result=await handleDeviceChannelRoutes(
    {method:'POST'},{setHeader(){}},
    new URL('http://operator.local/v1/device-channel/desktop-wall-sso-redeem'),
    {
      readJson:async()=>input,
      sendJson:(_,status,payload)=>{code=status;return payload;},
      desktopWallSsoSignedRedeem:f.service.redeem
    }
  );
  assert.equal(code,200);
  assert.equal(result.authority.deviceId,f.deviceId);
  assert.equal(f.verifyCalls(),1);
  assert.equal(f.store.size,0);
});

test('Operator route is unmounted because no enabled signedRedeem dependency',()=>{
  const operator=fs.readFileSync(new URL('./executor-routes-device-channel.mjs',import.meta.url),'utf8');
  assert.ok(operator.includes("url.pathname==='/v1/device-channel/desktop-wall-sso-redeem'"));
  assert.ok(operator.includes('signedRedeem:deps.desktopWallSsoSignedRedeem'));
  const host=fs.readFileSync(new URL('./executor.mjs',import.meta.url),'utf8');
  assert.ok(host.includes('desktopWallSsoSignedRedeem:desktopWallSsoOperatorGate.signedRedeem'));
  assert.ok(host.includes('createDesktopWallSsoOperatorGateV4({'));
});
