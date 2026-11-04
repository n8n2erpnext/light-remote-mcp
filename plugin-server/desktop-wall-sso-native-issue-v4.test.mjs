import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDesktopWallSsoNativeIssueV4}
  from './desktop-wall-sso-native-issue-v4.mjs';
import {handleDesktopWallSsoInternalIssueV4}
  from '../operator-host/desktop-wall-sso-internal-issue-v4.mjs';

const ORIGIN='https://goldabv2.light-remote.thaiduy.digital';
const DEVICE='dev_test_native_t04b7';
const ACCESS='A'.repeat(43),TICKET='T'.repeat(43);
const EDGE_PROOF='a'.repeat(64);
function setup({peer=[],trustedIssue}={}){
  const calls=[];
  const clock=()=>Date.now();
  const issueTrusted=trustedIssue||(async input=>{
    calls.push(input);
    return {ticket:TICKET,expiresAt:clock()+44_000,
      deviceId:input.deviceId,purpose:'desktop_wall_sso_v4'};
  });
  const created=createDesktopWallSsoNativeIssueV4({
    enabled:true,publicOrigin:ORIGIN,proxyPeers:peer,
    edgeProofSecret:peer.length?EDGE_PROOF:undefined,
    issueTrusted,clock
  });
  const body=JSON.stringify({device_id:DEVICE});
  const req={
    method:'POST',
    originalUrl:'/account/desktop/v4/wall-sso/ticket',
    url:'/account/desktop/v4/wall-sso/ticket',
    headers:{
      host:'goldabv2.light-remote.thaiduy.digital',
      authorization:'Bearer '+ACCESS,
      'content-type':'application/json',
      'content-length':String(Buffer.byteLength(body))
    },
    body:{device_id:DEVICE},
    socket:{encrypted:true}
  };
  const res=()=>({
    code:200,headers:{},data:null,
    set(k,v){this.headers[k]=v;return this;},
    status(n){this.code=n;return this;},
    json(v){this.data=v;return this;}
  });
  const call=async input=>{
    const response=res();
    await created.handler(input||req,response);
    return response;
  };
  return {created,calls,req,res,call,clock};
}
test('T04b7 native HTTPS source defaults OFF even without dependencies',()=>{
  assert.deepEqual(createDesktopWallSsoNativeIssueV4(),{
    enabled:false,handler:null
  });
});
test('T04b7 refuses non-HTTPS public origin and unconfigured issuer',()=>{
  for(const origin of [
    'http://goldabv2.light-remote.thaiduy.digital',
    'https://goldabv2.light-remote.thaiduy.digital/path',
    'https://user:pass@goldabv2.light-remote.thaiduy.digital'
  ])assert.throws(()=>createDesktopWallSsoNativeIssueV4({
    enabled:true,publicOrigin:origin,issueTrusted:async()=>{}
  }));
  assert.throws(()=>createDesktopWallSsoNativeIssueV4({
    enabled:true,publicOrigin:ORIGIN
  }));
  assert.throws(()=>createDesktopWallSsoNativeIssueV4({
    enabled:true,publicOrigin:ORIGIN,issueTrusted:async()=>{},
    proxyPeers:['*']
  }));
});
test('T04b7 native HTTPS issues scoped 45s opaque ticket, never credential',async()=>{
  const f=setup();
  const r=await f.call();
  assert.equal(r.code,200);
  assert.deepEqual(r.data,{
    ok:true,ticket:TICKET,deviceId:DEVICE,
    expiresAt:r.data.expiresAt
  });
  assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0],{accessToken:ACCESS,deviceId:DEVICE});
  assert.equal(r.headers['Cache-Control'],'no-store');
  assert.equal(r.headers['Referrer-Policy'],'no-referrer');
  assert.equal(JSON.stringify(r.data).includes(ACCESS),false);
  assert.equal('familyId' in r.data,false);
  assert.equal('refresh_token' in r.data,false);
  assert.equal('grantId' in r.data,false);
});
test('T04b7 plain HTTP and spoofed forwarded TLS cannot issue',async()=>{
  const f=setup();
  const q={...f.req,socket:{encrypted:false,remoteAddress:'203.0.113.71'},
    secure:true,headers:{...f.req.headers,'x-forwarded-proto':'https'}};
  assert.equal((await f.call(q)).code,403);
  const plain={...f.req,socket:{encrypted:false}};
  assert.equal((await f.call(plain)).code,403);
  assert.equal(f.calls.length,0);
});
test('T04b7 explicitly allowlisted HTTPS terminator peer accepted',async()=>{
  const f=setup({peer:['127.0.0.1']});
  const forwarded={...f.req,secure:true,
    socket:{encrypted:false,remoteAddress:'127.0.0.1'},
    headers:{...f.req.headers,
      'x-forwarded-proto':'https',
      'x-light-remote-edge-proof-v4':EDGE_PROOF}};
  assert.equal((await f.call(forwarded)).code,200);
  assert.equal((await f.call({...forwarded,secure:false})).code,403);
  assert.equal((await f.call({...forwarded,headers:{
    ...forwarded.headers,'x-forwarded-proto':'http'
  }})).code,403);
  assert.equal((await f.call({...forwarded,headers:{
    ...forwarded.headers,'x-forwarded-host':'evil.invalid'
  }})).code,403);
});
test('T04b7 pin exact public host, disallow URL query and bearer in URL',async()=>{
  const f=setup();
  const variants=[
    {...f.req,headers:{...f.req.headers,host:'evil.invalid'}},
    {...f.req,originalUrl:'/account/desktop/v4/wall-sso/ticket?bearer='+ACCESS},
    {...f.req,originalUrl:'/account/desktop/v4/wall-sso/ticket?device_id='+DEVICE}
  ];
  for(const v of variants)assert.equal((await f.call(v)).code,403);
  assert.equal(f.calls.length,0);
});
test('T04b7 reject all browser origin, cookies, fetch metadata, referrer',async()=>{
  const f=setup();
  for(const headers of [
    {origin:ORIGIN},{origin:'https://evil.invalid'},
    {cookie:'__Host-account=browser-session'},
    {referer:ORIGIN+'/account'},
    {'sec-fetch-site':'same-origin'},
    {'sec-fetch-site':'cross-site'},
    {'sec-fetch-mode':'cors'},
    {'sec-fetch-dest':'empty'}
  ]){
    const r=await f.call({...f.req,headers:{...f.req.headers,...headers}});
    assert.equal(r.code,403);
  }
  assert.equal(f.calls.length,0);
});
test('T04b7 reject non-JSON, oversized, chunked or missing lengths',async()=>{
  const f=setup();
  for(const h of [
    {'content-type':'text/plain'},
    {'content-type':'application/x-www-form-urlencoded'},
    {'content-length':'4096'},
    {'content-length':'abc'},
    {'content-length':''},
    {'transfer-encoding':'chunked'}
  ]){
    const r=await f.call({...f.req,headers:{...f.req.headers,...h}});
    assert.equal(r.code,403);
  }
});
test('T04b7 requires exact native Owner Bearer header, no cookie fallback',async()=>{
  const f=setup();
  for(const auth of ['',ACCESS,'Basic '+ACCESS,'Bearer invalid']){
    const r=await f.call({...f.req,headers:{
      ...f.req.headers,authorization:auth
    }});
    assert.equal(r.code,401);
  }
  assert.equal(f.calls.length,0);
});
test('T04b7 reject device body spoofing, refresh token and Agent B approvals',async()=>{
  const f=setup();
  for(const body of [
    {},{device_id:'not allowed spaces'},
    {device_id:DEVICE,accountId:'attacker'},
    {device_id:DEVICE,refresh_token:'r'.repeat(43)},
    {device_id:DEVICE,agentId:'agent_123'},
    {device_id:DEVICE,bCode:'ABCD-1234'},
    {device_id:DEVICE,grantId:'g123'}
  ]){
    const r=await f.call({...f.req,body});
    assert.equal(r.code,400);
  }
  assert.equal(f.calls.length,0);
});
test('T04b7 Operator errors and malformed issued tickets are generic 403',async()=>{
  const failures=[
    async()=>{throw Error('secret access '+ACCESS);},
    async()=>({ticket:'bad',deviceId:DEVICE,expiresAt:Date.now()+45_000,purpose:'desktop_wall_sso_v4'}),
    async()=>({ticket:TICKET,deviceId:'dev_other',expiresAt:Date.now()+45_000,purpose:'desktop_wall_sso_v4'}),
    async()=>({ticket:TICKET,deviceId:DEVICE,expiresAt:Date.now()-1,purpose:'desktop_wall_sso_v4'}),
    async()=>({ticket:TICKET,deviceId:DEVICE,expiresAt:Date.now()+120_000,purpose:'desktop_wall_sso_v4'}),
    async()=>({ticket:TICKET,deviceId:DEVICE,expiresAt:Date.now()+40_000,purpose:'desktop_wall_sso_v4',familyId:'private'})
  ];
  for(const issue of failures){
    const f=setup({trustedIssue:issue}),r=await f.call();
    assert.equal(r.code,403);
    assert.deepEqual(r.data,{ok:false,error:'desktop_wall_sso_issue_denied'});
    assert.equal(JSON.stringify(r.data).includes(ACCESS),false);
  }
});
test('T04b7 internal Operator route is OFF without callback and denies TCP peers',async()=>{
  let read=0,code;
  await handleDesktopWallSsoInternalIssueV4(
    {socket:{remoteAddress:'127.0.0.1'}},{},
    {sendJson:(_,s)=>{code=s},readJson:async()=>{read++}}
  );
  assert.equal(code,404);assert.equal(read,0);
  await handleDesktopWallSsoInternalIssueV4(
    {socket:{remoteAddress:'127.0.0.1'},headers:{}},{},
    {issueTrusted:async()=>{},sendJson:(_,s)=>{code=s},readJson:async()=>{read++}}
  );
  assert.equal(code,403);assert.equal(read,0);
});
test('T04b7 private Unix-socket issue validates request, returns ticket only',async()=>{
  let code=null,body=null,callCount=0;
  const reply={setHeader(){}};
  await handleDesktopWallSsoInternalIssueV4(
    {socket:{},headers:{}},reply,{
      readJson:async()=>({accessToken:ACCESS,deviceId:DEVICE}),
      issueTrusted:async({accessToken,deviceId})=>{
        callCount++;assert.equal(accessToken,ACCESS);
        return {ticket:TICKET,expiresAt:Date.now()+30_000,
          deviceId,purpose:'desktop_wall_sso_v4'};
      },
      sendJson:(_res,c,b)=>{code=c;body=b}
    }
  );
  assert.equal(code,200);assert.equal(callCount,1);
  assert.equal(body.ok,true);
  assert.equal(body.ticket,TICKET);
  assert.equal('accessToken' in body,false);
  assert.equal(JSON.stringify(body).includes(ACCESS),false);
});
test('T04b7b internal route is registered only behind explicit issue callback',()=>{
  const plugin=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
  const operator=fs.readFileSync(new URL('../operator-host/executor-routes-device-channel.mjs',import.meta.url),'utf8');
  assert.ok(plugin.includes("registerDesktopWallSsoNativeIssuerV4(app,"));
  assert.ok(operator.includes("url.pathname==='/v1/internal/desktop-wall-sso/issue'"));
  const host=fs.readFileSync(new URL('../operator-host/executor.mjs',import.meta.url),'utf8');
  assert.ok(host.includes('desktopWallSsoInternalIssue:desktopWallSsoOperatorGate.internalIssue'));
});

test('T04b8 real LXD localhost peer plus spoofed HTTPS forwarded headers fails without edge proof',async()=>{
  const f=setup({peer:['127.0.0.1']});
  const direct={
    ...f.req,secure:true,socket:{encrypted:false,remoteAddress:'127.0.0.1'},
    headers:{...f.req.headers,'x-forwarded-proto':'https',
      'x-forwarded-host':'goldabv2.light-remote.thaiduy.digital'}
  };
  assert.equal((await f.call(direct)).code,403);
  assert.equal((await f.call({...direct,headers:{...direct.headers,
    'x-light-remote-edge-proof-v4':'b'.repeat(64)}})).code,403);
  assert.equal((await f.call({...direct,headers:{...direct.headers,
    'x-light-remote-edge-proof-v4':'a'.repeat(63)}})).code,403);
  assert.equal(f.calls.length,0);
});
test('T04b8 fail-closed proxy configuration rejects missing or weak edge proof',()=>{
  for(const proof of [undefined,'','yes','1'.repeat(32),'z'.repeat(64)]){
    assert.throws(()=>createDesktopWallSsoNativeIssueV4({
      enabled:true,publicOrigin:ORIGIN,proxyPeers:['127.0.0.1'],
      edgeProofSecret:proof,issueTrusted:async()=>{}
    }),/desktop_wall_sso_edge_proof_unavailable/);
  }
  const off=createDesktopWallSsoNativeIssueV4({
    enabled:false,publicOrigin:ORIGIN,proxyPeers:['127.0.0.1']
  });
  assert.equal(off.enabled,false);
});
test('T04b8 a wrong peer cannot pass even with valid private edge proof',async()=>{
  const f=setup({peer:['127.0.0.1']});
  const direct={
    ...f.req,secure:true,socket:{encrypted:false,remoteAddress:'10.192.135.62'},
    headers:{...f.req.headers,'x-forwarded-proto':'https',
      'x-light-remote-edge-proof-v4':EDGE_PROOF}
  };
  assert.equal((await f.call(direct)).code,403);
  assert.equal(f.calls.length,0);
});
