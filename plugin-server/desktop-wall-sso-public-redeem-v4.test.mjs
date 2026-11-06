import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {registerDesktopWallSsoPublicRedeemV4,
  DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4,
  DESKTOP_WALL_SSO_OPERATOR_REDEEM_PATH_V4}
  from './desktop-wall-sso-public-redeem-v4.mjs';

const ON=Object.freeze({
  LIGHT_REMOTE_GOLD_INDEPENDENT:'1',
  LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4:'1',
  LR_GOLD_ABV2_DESKTOP_TOKEN_V4:'1',
  LR_GOLD_ABV2_DESKTOP_WALL_SSO_V4:'1',
  LR_GOLD_ABV2_DESKTOP_WALL_SSO_OPERATOR_V4:'1',
  LR_GOLD_ABV2_DESKTOP_WALL_SSO_ISSUER_V4:'1'
});
const TOKEN='T'.repeat(43),FAMILY='F'.repeat(43),DEVICE='dev_foo',ACCOUNT='acct_test';
const dig=t=>crypto.createHash('sha256').update(t).digest('hex');
const form=(ticket=TOKEN)=>({
  ticket,
  signedEnvelope:{
    deviceId:DEVICE,timestamp:1700000000000,
    nonce:'N'.repeat(24),signature:'S'.repeat(86),
    payload:{ticketDigest:dig(ticket)}
  }
});
const good=Object.freeze({
  ok:true,authority:{
    purpose:'wall_local_session_authority_v1',accountId:ACCOUNT,
    deviceId:DEVICE,familyId:FAMILY
  }
});
function fixture({env=ON,operatorCall=async()=>good,rateAllow=async()=>true}={}){
  let handler,calls=0;
  const app={
    post(path,callback){
      assert.equal(path,DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4);
      handler=callback;
    }
  };
  const gate=registerDesktopWallSsoPublicRedeemV4(app,{
    env,
    operatorCall:async(...args)=>{calls++;return operatorCall(...args);},
    rateAllow
  });
  async function invoke(body=form(),headerChanges={},url=DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4){
    const size=Buffer.byteLength(JSON.stringify(body));
    const headers={
      'content-type':'application/json',
      'content-length':String(size),
      ...headerChanges
    };
    const req={method:'POST',headers,originalUrl:url,url,body};
    const state={status:200,headers:{},value:null};
    const res={
      set(k,v){state.headers[k.toLowerCase()]=v;return this;},
      status(v){state.status=v;return this;},
      json(v){state.value=v;return this;}
    };
    await handler(req,res);
    return state;
  }
  return {gate,invoke,calls:()=>calls};
}

test('T04b9c1 disabled gives 404 before access to any request body',async()=>{
  for(const env of [{},{...ON,LR_GOLD_ABV2_DESKTOP_WALL_SSO_ISSUER_V4:'0'}]){
    const f=fixture({env});
    const result=await f.invoke({ticket:TOKEN,unparsed:'true'});
    assert.deepEqual(f.gate,{enabled:false,routes:0});
    assert.equal(result.status,404);
    assert.equal(result.value.error,'not_found');
    assert.equal(f.calls(),0);
  }
  let handler;
  registerDesktopWallSsoPublicRedeemV4({
    post:(_path,cb)=>{handler=cb;}
  },{env:{}});
  const req={
    headers:{},
    get body(){throw new Error('OFF must not inspect body');}
  };
  const res={
    set(){return this;},
    status(n){assert.equal(n,404);return this;},
    json(b){assert.equal(b.error,'not_found');}
  };
  await handler(req,res);
});

test('T04b9c1 exact signed envelope forwarded to private Operator path once',async()=>{
  const f=fixture({operatorCall:async(method,path,body)=>{
    assert.equal(method,'POST');
    assert.equal(path,DESKTOP_WALL_SSO_OPERATOR_REDEEM_PATH_V4);
    assert.deepEqual(body,form());
    return good;
  }});
  assert.deepEqual(f.gate,{enabled:true,routes:1});
  const out=await f.invoke();
  assert.equal(out.status,200);
  assert.deepEqual(out.value,good);
  assert.equal(out.headers['cache-control'],'no-store');
  assert.equal(f.calls(),1);
});

test('T04b9c1 browser, cookie, unsafe body and unsigned digests rejected',async()=>{
  const f=fixture();
  for(const headers of [
    {origin:'https://evil.example'},
    {cookie:'session=value'},
    {'sec-fetch-site':'same-site'},
    {referer:'https://evil.example'},
    {'content-encoding':'gzip'},
    {'transfer-encoding':'chunked'},
    {'content-length':'65536'},
    {'content-type':'text/plain'}
  ]){
    assert.equal((await f.invoke(form(),headers)).status,403);
  }
  for(const invalid of [
    {},[],{...form(),accountId:'fake'},
    {...form(),signedEnvelope:{...form().signedEnvelope,agentId:'other'}},
    {...form(),signedEnvelope:{...form().signedEnvelope,
      payload:{ticketDigest:'a'.repeat(64)}}},
    {...form(),signedEnvelope:{...form().signedEnvelope,
      signature:'bad'}},
    {...form(),signedEnvelope:{...form().signedEnvelope,
      deviceId:'../file'}}
  ]){
    assert.equal((await f.invoke(invalid)).status,400);
  }
  assert.equal(f.calls(),0);
  assert.equal((await f.invoke(form(),{},DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4+'?ticket=x')).status,403);
});

test('T04b9c1 bounded payload, private Operator errors and rate fail closed',async()=>{
  const f=fixture();
  const huge=await f.invoke({...form(),pad:'x'.repeat(2100)});
  assert.equal(huge.status,403);
  const denied=fixture({rateAllow:async()=>false});
  assert.equal((await denied.invoke()).status,429);
  assert.equal(denied.calls(),0);
  const wrongDevice=fixture({operatorCall:async()=>({
    ...good,authority:{...good.authority,deviceId:'dev_other'}
  })});
  assert.equal((await wrongDevice.invoke()).status,403);
  const privateError=fixture({operatorCall:async()=>{throw Error('Redis private value');}});
  const result=await privateError.invoke();
  assert.equal(result.status,403);
  assert.equal(JSON.stringify(result.value).includes('Redis'),false);
});

test('T04b9c1 startup never enables partial flags or missing trusted callback',()=>{
  assert.throws(()=>registerDesktopWallSsoPublicRedeemV4({
    post(){}
  },{env:ON}),/desktop_wall_sso_public_transport_unavailable/);
  assert.deepEqual(registerDesktopWallSsoPublicRedeemV4({
    post(){}
  },{env:{}}),{enabled:false,routes:0});
});

test('T04b9c1 static ingress pre-gate runs before 12MB parser, no generic allowlist action',()=>{
  const server=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
  const publicModule=fs.readFileSync(new URL('./device-public.mjs',import.meta.url),'utf8');
  const gateAt=server.indexOf('app.use(DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4');
  const globalAt=server.indexOf('const generalJsonBodyParser=express.json');
  assert.ok(gateAt>0 && globalAt>gateAt);
  assert.ok(server.includes("express.json({limit:'2048b',strict:true})"));
  assert.ok(server.includes('req.path===DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4'));
  assert.ok(publicModule.includes('registerDesktopWallSsoPublicRedeemV4(app'));
  const list=publicModule.split('const CHANNEL = new Set([')[1].split(']);')[0];
  assert.ok(!list.includes('desktop-wall-sso-redeem'));
});
