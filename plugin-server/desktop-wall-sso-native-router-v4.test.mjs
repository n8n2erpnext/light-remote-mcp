import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  desktopWallSsoIssuerEnabledV4,
  createDesktopWallSsoIssueRateGateV4,
  registerDesktopWallSsoNativeIssuerV4,
  DESKTOP_WALL_SSO_TICKET_PATH_V4,
  DESKTOP_WALL_SSO_INTERNAL_ISSUE_V4
} from './desktop-wall-sso-native-router-v4.mjs';
import {
  DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS,
  DESKTOP_WALL_SSO_ISSUER_FLAG_V4,
  createDesktopWallSsoOperatorGateV4
} from '../operator-host/desktop-wall-sso-operator-gate-v4.mjs';
import {handleDeviceChannelRoutes}
  from '../operator-host/executor-routes-device-channel.mjs';

const TOKEN='A'.repeat(43),TICKET='T'.repeat(43);
const DEVICE='dev_t04b7b_native_fixture';
const ORIGIN='https://goldabv2.light-remote.thaiduy.digital';
const FLAGS=()=>{
  const flags=Object.fromEntries(DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS
    .map(key=>[key,'1']));
  flags[DESKTOP_WALL_SSO_ISSUER_FLAG_V4]='1';
  return flags;
};
function fakeRequest(){
  const b=JSON.stringify({device_id:DEVICE});
  return {
    method:'POST',originalUrl:DESKTOP_WALL_SSO_TICKET_PATH_V4,
    headers:{
      host:new URL(ORIGIN).host,
      authorization:'Bearer '+TOKEN,
      'content-type':'application/json',
      'content-length':String(Buffer.byteLength(b))
    },
    body:{device_id:DEVICE},socket:{encrypted:true}
  };
}
const response=()=>({
  code:null,body:null,headers:{},
  set(k,v){this.headers[k]=v;return this;},
  status(n){this.code=n;return this;},
  json(v){this.body=v;return this;}
});
function fixture({env=FLAGS(),issue,clock=Date.now,proxyPeers=[]}={}){
  const paths=new Map(),calls=[];
  const app={post(path,handler){
    assert.equal(paths.has(path),false);
    paths.set(path,handler);
  }};
  const operatorCall=issue||(async(method,path,body)=>{
    calls.push({method,path,body});
    return {ok:true,ticket:TICKET,deviceId:DEVICE,
      expiresAt:Number(clock())+45_000,purpose:'desktop_wall_sso_v4'};
  });
  const gate=registerDesktopWallSsoNativeIssuerV4(app,{
    env,publicOrigin:ORIGIN,proxyPeers,operatorCall,clock
  });
  const call=async(req=fakeRequest())=>{
    const res=response();
    if(paths.has(DESKTOP_WALL_SSO_TICKET_PATH_V4))
      await paths.get(DESKTOP_WALL_SSO_TICKET_PATH_V4)(req,res);
    return res;
  };
  return {gate,paths,calls,call,operatorCall};
}
test('T04b7b six independent exact flags are required, default zero routes',()=>{
  assert.equal(desktopWallSsoIssuerEnabledV4({}),false);
  assert.equal(desktopWallSsoIssuerEnabledV4(null),false);
  assert.equal(fixture({env:{}}).gate.routes,0);
  assert.equal(fixture({env:{}}).paths.size,0);
  for(const key of Object.keys(FLAGS())){
    const env=FLAGS();delete env[key];
    assert.equal(desktopWallSsoIssuerEnabledV4(env),false,key);
    assert.deepEqual(fixture({env}).gate,{enabled:false,routes:0});
  }
});
test('T04b7b truthy, typed, whitespace and incomplete flags fail closed',()=>{
  for(const key of Object.keys(FLAGS())){
    for(const value of ['true','yes','01','1 ','0','',true,1,null]){
      const env={...FLAGS(),[key]:value};
      assert.equal(desktopWallSsoIssuerEnabledV4(env),false,key);
    }
  }
  assert.equal(desktopWallSsoIssuerEnabledV4(FLAGS()),true);
});
test('T04b7b enabled without actual Operator Unix transport refuses startup',()=>{
  const app={post(){}};
  assert.throws(()=>registerDesktopWallSsoNativeIssuerV4(app,{
    env:FLAGS(),publicOrigin:ORIGIN
  }),/issuer_transport_unavailable/);
  assert.throws(()=>registerDesktopWallSsoNativeIssuerV4(app,{
    env:FLAGS(),publicOrigin:'http://example.invalid',
    operatorCall:async()=>{}
  }));
  assert.throws(()=>registerDesktopWallSsoNativeIssuerV4(app,{
    env:FLAGS(),publicOrigin:ORIGIN,
    proxyPeers:['*'],operatorCall:async()=>{}
  }));
});
test('T04b7b native token is forwarded only via fixed Operator Unix path',async()=>{
  const f=fixture();
  assert.deepEqual(f.gate,{enabled:true,routes:1});
  assert.deepEqual([...f.paths.keys()],[DESKTOP_WALL_SSO_TICKET_PATH_V4]);
  const r=await f.call();
  assert.equal(r.code,200);
  assert.deepEqual(r.body,{
    ok:true,ticket:TICKET,deviceId:DEVICE,expiresAt:r.body.expiresAt
  });
  assert.deepEqual(f.calls,[{
    method:'POST',path:DESKTOP_WALL_SSO_INTERNAL_ISSUE_V4,
    body:{accessToken:TOKEN,deviceId:DEVICE}
  }]);
  assert.equal('authorization' in r.body,false);
  assert.equal('familyId' in r.body,false);
  assert.equal('refresh_token' in r.body,false);
  assert.equal(JSON.stringify(r.body).includes(TOKEN),false);
});
test('T04b7b untrusted Operator, extra metadata or leaked secrets fail 403',async()=>{
  for(const upstream of [
    {ok:false,ticket:TICKET,deviceId:DEVICE,expiresAt:Date.now()+45_000,purpose:'desktop_wall_sso_v4'},
    {ok:true,ticket:TICKET,deviceId:DEVICE,expiresAt:Date.now()+45_000,purpose:'desktop_wall_sso_v4',refreshToken:TOKEN},
    {ok:true,ticket:TICKET,deviceId:DEVICE,expiresAt:Date.now()+45_000,purpose:'bad'},
    {ok:true,ticket:'invalid',deviceId:DEVICE,expiresAt:Date.now()+45_000,purpose:'desktop_wall_sso_v4'}
  ]){
    const f=fixture({issue:async()=>upstream});
    const r=await f.call();
    assert.equal(r.code,403);
    assert.deepEqual(r.body,{ok:false,error:'desktop_wall_sso_issue_denied'});
  }
});
test('T04b7b rate limiter caps each hashed access at five per minute',()=>{
  let now=1_000_000;
  const rate=createDesktopWallSsoIssueRateGateV4({clock:()=>now});
  for(let i=0;i<5;i++)assert.equal(rate.allow(TOKEN),true);
  assert.equal(rate.allow(TOKEN),false);
  now+=60_001;
  assert.equal(rate.allow(TOKEN),true);
});
test('T04b7b global requests are bounded despite many forged tokens',()=>{
  const rate=createDesktopWallSsoIssueRateGateV4();
  for(let i=0;i<100;i++){
    const token=i.toString(36).padStart(43,'A');
    assert.equal(rate.allow(token),true,i);
  }
  assert.equal(rate.allow('C'.repeat(43)),false);
});
test('T04b7b rate-denied native call produces generic denial, no Operator call',async()=>{
  const f=fixture();
  for(let i=0;i<5;i++)assert.equal((await f.call()).code,200);
  const denied=await f.call();
  assert.equal(denied.code,403);
  assert.deepEqual(denied.body,{ok:false,error:'desktop_wall_sso_issue_denied'});
  assert.equal(f.calls.length,5);
});
test('T04b7b invalid native cookie/browser request never calls Unix Operator',async()=>{
  const f=fixture();
  for(const extra of [
    {cookie:'__Host-gold_session=abc'},
    {origin:'https://evil.invalid'},
    {'sec-fetch-site':'cross-site'}
  ]){
    const req=fakeRequest();
    req.headers={...req.headers,...extra};
    assert.equal((await f.call(req)).code,403);
  }
  assert.equal(f.calls.length,0);
});
test('T04b7b actual Operator internal dispatcher returns 404 when issue flag OFF',async()=>{
  const flags=FLAGS();delete flags[DESKTOP_WALL_SSO_ISSUER_FLAG_V4];
  const gate=createDesktopWallSsoOperatorGateV4({
    env:flags,
    storage:{prefix:'lr:gold:lab:',redis:{
      get(){return null;},set(){return 'OK';},getDel(){return null;}
    }},
    accounts:{desktopOwnerSessionActive(){return false;}},
    enrollments:{binding(){throw Error('none');},verifyChannel(){throw Error('none');}}
  });
  assert.equal(gate.enabled,true);
  assert.equal(gate.internalIssue,undefined);
  let code=0,reads=0;
  await handleDeviceChannelRoutes(
    {method:'POST',headers:{},socket:{}}, {},
    new URL('http://operator.local/v1/internal/desktop-wall-sso/issue'),
    {
      readJson:async()=>{reads++;return {accessToken:TOKEN,deviceId:DEVICE};},
      sendJson:(_res,status)=>{code=status;return {ok:false}},
      desktopWallSsoInternalIssue:gate.internalIssue
    }
  );
  assert.equal(code,404);
  assert.equal(reads,0);
});
test('T04b7b Operator internal dispatcher denies TCP and browser headers',async()=>{
  let code=0,reads=0;
  await handleDeviceChannelRoutes(
    {method:'POST',headers:{origin:ORIGIN},socket:{remoteAddress:'127.0.0.1'}},
    {},
    new URL('http://operator.local/v1/internal/desktop-wall-sso/issue'),
    {
      readJson:async()=>{reads++;return {accessToken:TOKEN,deviceId:DEVICE};},
      sendJson:(_res,status)=>{code=status;return {ok:false}},
      desktopWallSsoInternalIssue:async()=>{throw Error('no')}
    }
  );
  assert.equal(code,403);
  assert.equal(reads,0);
});
test('T04b7b request must have 2-KiB scoped JSON parser before product 12-MiB parser',()=>{
  const source=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
  const scoped=source.indexOf('app.use(DESKTOP_WALL_SSO_TICKET_PATH_V4,');
  // The T04b9c1 route-specific signed redeem parser now intercepts its
  // own path before the general product parser. Keep this T04b7b invariant
  // while requiring the signed route to explicitly skip 12-MiB parsing.
  const generic=source.indexOf("const generalJsonBodyParser=express.json({limit:'12mb'});");
  assert.ok(scoped>0&&generic>scoped);
  assert.ok(source.includes('req.path===DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4'));
  assert.ok(source.includes('app.use(DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4,'));
  assert.ok(source.includes('express.json({limit:DESKTOP_WALL_SSO_MAX_BODY_BYTES_V4,strict:true})'));
  assert.ok(source.includes('registerDesktopWallSsoNativeIssuerV4(app,'));
  assert.ok(source.includes('operatorCall:callOperatorJson'));
});

test('T04b8 Plugin refuses startup with allowlisted LXD proxy but no private edge proof',()=>{
  const app={post(){throw Error('must_not_register_route')}};
  assert.throws(()=>registerDesktopWallSsoNativeIssuerV4(app,{
    env:FLAGS(),publicOrigin:ORIGIN,
    proxyPeers:['127.0.0.1'],
    operatorCall:async()=>{}
  }),/desktop_wall_sso_edge_proof_unavailable/);
});
test('T04b8 Plugin server reads a separate opt-in private proxy proof from environment',()=>{
  const source=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
  assert.ok(source.includes(
    'edgeProofSecret:process.env.LR_GOLD_ABV2_DESKTOP_WALL_SSO_EDGE_PROOF_V4'
  ));
  assert.ok(!source.includes('console.log(process.env.LR_GOLD_ABV2_DESKTOP_WALL_SSO_EDGE_PROOF_V4'));
});
