import test from 'node:test';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {
  createDesktopOwnerAuthorization, registerDesktopOwnerV4Authorization,
  browserOwnerFromOperator
} from './desktop-auth-v4-server.mjs';
import {createDesktopPkceMaterial, DESKTOP_OWNER_RESOURCE} from './desktop-auth-v4-contract.mjs';

const ORIGIN='https://goldabv2.light-remote.thaiduy.digital';
const PREFIX='lr:gold:goldabv2lab:';
const owner={verifiedBy:'account_portal_session',accountId:'owner_verified_42',isOwner:true,
  sessionFingerprint:'valid_portal_session_hash',
  accountSessionId:'acctsess_123e4567-e89b-42d3-a456-426614174000',
  accountSessionExpiresAt:Date.now()+7*24*60*60*1000};
function query() {
  const p=createDesktopPkceMaterial();
  return {
    req: {
      client_id:'light-remote-desktop-v4', resource:DESKTOP_OWNER_RESOURCE,
      scope:'desktop:read', response_type:'code', code_challenge_method:'S256',
      code_challenge:p.challenge, state:p.state, install_nonce:p.installNonce,
      redirect_uri:'http://127.0.0.1:49152/desktop/v4/callback'
    }, p
  };
}
function fakeRedis() {
  const m=new Map(), counts=new Map();
  return {
    m, counts,
    async set(key, val, options) {
      assert.ok(options.EX>0 && options.NX===true);
      if(m.has(key))return null;
      m.set(key,val);return 'OK';
    },
    async getDel(key) {
      const v=m.get(key)??null;m.delete(key);return v;
    },
    async incr(key) {
      const v=(counts.get(key)||0)+1;counts.set(key,v);return v;
    },
    async expire(_key, ttl) {assert.ok(ttl>0);return true;}
  };
}
function service(redis=fakeRedis()) {
  let now=1_000_000;
  const svc=createDesktopOwnerAuthorization({
    redis,prefix:PREFIX,publicOrigin:ORIGIN,clock:()=>now
  });
  return {svc,redis,advance:delta=>{now+=delta;}};
}
function fakeRes() {
  return {
    code:200, headers:{}, body:null, redirectTo:null, typeName:null,
    set(k,v){this.headers[k]=v;return this;},
    status(n){this.code=n;return this;},
    type(name){this.typeName=name;return this;},
    send(v){this.body=v;return this;},
    json(v){this.body=v;return this;},
    redirect(n,url){this.code=n;this.redirectTo=url;return this;}
  };
}
test('default OFF mounts no Desktop route and does not require Redis',() => {
  const paths=[];
  const app={get:path=>paths.push(path),post:path=>paths.push(path)};
  assert.deepEqual(registerDesktopOwnerV4Authorization(app),{enabled:false,routes:0});
  assert.equal(paths.length,0);
});
test('real portal owner produces single-use code bound to PKCE state and callback',async () => {
  const {svc}=service();
  const {req,p}=query();
  const a=await svc.begin(req,owner);
  const approved=await svc.approve({csrf:a.csrf,decision:'approve',owner});
  const url=new URL(approved.redirect);
  assert.equal(url.origin,'http://127.0.0.1:49152');
  assert.equal(url.pathname,'/desktop/v4/callback');
  assert.equal(url.searchParams.get('state'),p.state);
  assert.equal(url.searchParams.get('iss'),ORIGIN);
  assert.equal(url.searchParams.get('code')?.length,43);
  const v=await svc.consumeCode({
    code:url.searchParams.get('code'),verifier:p.verifier,
    redirectUri:req.redirect_uri,installNonce:p.installNonce,state:p.state
  });
  assert.equal(v.accountId,owner.accountId);
  assert.equal(v.scope,'desktop:read');
  assert.equal(Object.isFrozen(v),true);
  assert.equal('token' in v,false);
  await assert.rejects(svc.consumeCode({code:url.searchParams.get('code'),verifier:p.verifier,
    redirectUri:req.redirect_uri,installNonce:p.installNonce,state:p.state}));
  await assert.rejects(svc.approve({csrf:a.csrf,decision:'approve',owner}));
});
test('wrong session fingerprint cannot approve even for same accountId',async () => {
  const {svc}=service();
  const a=await svc.begin(query().req,owner);
  await assert.rejects(svc.approve({csrf:a.csrf,decision:'approve',
    owner:{...owner,sessionFingerprint:'different_portal_session'}}),/desktop_owner_mismatch/);
  await assert.rejects(svc.approve({csrf:a.csrf,decision:'approve',owner}));
});
test('wrong PKCE / redirect / nonce / state consumes code without releasing authority',async () => {
  for(const tweak of [
    {verifier:'x'.repeat(43)}, {redirectUri:'http://127.0.0.1:49153/desktop/v4/callback'},
    {installNonce:'z'.repeat(43)}, {state:'invalid-state'}
  ]) {
    const {svc}=service();
    const {req,p}=query();
    const a=await svc.begin(req,owner);
    const issued=await svc.approve({csrf:a.csrf,decision:'approve',owner});
    const code=new URL(issued.redirect).searchParams.get('code');
    const input={code,verifier:p.verifier,redirectUri:req.redirect_uri,
      installNonce:p.installNonce,state:p.state,...tweak};
    await assert.rejects(svc.consumeCode(input),/desktop_code_invalid/);
    await assert.rejects(svc.consumeCode({...input,...{
      verifier:p.verifier,redirectUri:req.redirect_uri,
      installNonce:p.installNonce,state:p.state
    }}),/desktop_consent_missing/);
  }
});
test('deny consent does not store a code or silently sign Owner in',async () => {
  const {svc,redis}=service();const a=await svc.begin(query().req,owner);
  const out=await svc.approve({csrf:a.csrf,decision:'deny',owner});
  assert.equal(out.approved,false);
  assert.equal(new URL(out.redirect).searchParams.get('error'),'access_denied');
  assert.equal(new URL(out.redirect).searchParams.get('code'),null);
  assert.equal([...redis.m.keys()].filter(k=>k.includes(':code:')).length,0);
});
test('intent denies unverified Owner, MCP audience, foreign callback, and grant injection',async () => {
  const {svc}=service();const {req}=query();
  await assert.rejects(svc.begin(req,{verifiedBy:'oauth_mcp',accountId:'owner'}));
  for(const extra of [
    {accountId:'other-owner'}, {grantId:'24h'}, {agentId:'forged'},
    {ownerConsentCode:'consent'}, {bCode:'ABCD-1234'},
    {resource:'https://goldabv2.light-remote.thaiduy.digital/mcp'},
    {scope:'remote:execute'}, {redirect_uri:'http://100.94.184.141:15591/callback'}
  ]) await assert.rejects(svc.begin({...req,...extra},owner));
});
test('hard rate limit prevents more than 12 Owner intents per ten minutes',async () => {
  const {svc}=service();
  for(let i=0;i<12;i++)assert.ok((await svc.begin(query().req,owner)).csrf);
  await assert.rejects(svc.begin(query().req,owner),/desktop_rate_limited/);
});
test('feature-flagged browser flow requires consent, same origin and verified Owner',async () => {
  const routes={};
  const app={
    get(path,handler){routes['GET '+path]=handler;},
    post(path,handler){routes['POST '+path]=handler;}
  };
  const redis=fakeRedis();
  const reg=registerDesktopOwnerV4Authorization(app,{
    enabled:true,redis,prefix:PREFIX,publicOrigin:ORIGIN,
    verifyOwner:async req=>req.owner||null
  });
  assert.equal(reg.enabled,true);
  assert.equal(reg.routes,2);
  assert.equal(typeof reg.consumeCode,'function');
  const {req,p}=query();
  const getReq={query:req,owner};
  const consent=fakeRes();
  await routes['GET /account/desktop/v4/authorize'](getReq,consent);
  assert.equal(consent.code,200);
  assert.match(consent.body,/Continue to Desktop/);
  assert.match(consent.headers['Content-Security-Policy'],/frame-ancestors 'none'/);
  assert.equal(consent.headers['Cache-Control'],'no-store');
  assert.equal(consent.headers['Referrer-Policy'],'origin');
  const csrf=consent.body.match(/name="csrf" value="([A-Za-z0-9_-]{43})"/)?.[1];
  assert.equal(csrf?.length,43);
  const headers={
    'origin':ORIGIN,'sec-fetch-site':'same-origin',
    'content-type':'application/x-www-form-urlencoded'
  };
  const wrongOrigin=fakeRes();
  await routes['POST /account/desktop/v4/authorize']({
    headers:{...headers,origin:'https://attacker.example', 'sec-fetch-site':'cross-site'},
    owner,body:{csrf,decision:'approve'}
  },wrongOrigin);
  assert.equal(wrongOrigin.code,403);
  const noOwner=fakeRes();
  await routes['POST /account/desktop/v4/authorize']({
    headers,body:{csrf,decision:'approve'}
  },noOwner);
  assert.equal(noOwner.code,401);
  const result=fakeRes();
  await routes['POST /account/desktop/v4/authorize']({
    headers,owner,body:{csrf,decision:'approve'}
  },result);
  assert.equal(result.code,303);
  assert.equal(new URL(result.redirectTo).searchParams.get('state'),p.state);
  const replay=fakeRes();
  await routes['POST /account/desktop/v4/authorize']({
    headers,owner,body:{csrf,decision:'approve'}
  },replay);
  assert.equal(replay.code,410);
});
test('missing Origin and Fetch-Site on browser form requires one-time CSRF and current Owner',async()=>{
  const handlers={};
  const redis=fakeRedis();
  registerDesktopOwnerV4Authorization({
    get:(_p,h)=>{handlers.get=h;},post:(_p,h)=>{handlers.post=h;}
  },{enabled:true,redis,prefix:PREFIX,publicOrigin:ORIGIN,
      verifyOwner:async(req)=>req.owner||null});
  const {req}=query();
  const result=fakeRes();
  await handlers.get({query:req,owner},result);
  assert.equal(result.code,200);
  const csrf=result.body.match(/name="csrf" value="([A-Za-z0-9_-]{43})"/)?.[1];
  assert.equal(csrf?.length,43);
  const headers={'content-type':'application/x-www-form-urlencoded'};
  const missingCsrf=fakeRes();
  await handlers.post({headers,owner,body:{decision:'approve'}},missingCsrf);
  assert.equal(missingCsrf.code,403);
  const badOrigin=fakeRes();
  await handlers.post({
    headers:{...headers,origin:'https://evil.example','sec-fetch-site':'same-origin'},
    owner,body:{csrf,decision:'approve'}
  },badOrigin);
  assert.equal(badOrigin.code,403);
  const crossSite=fakeRes();
  await handlers.post({
    headers:{...headers,'sec-fetch-site':'cross-site'},
    owner,body:{csrf,decision:'approve'}
  },crossSite);
  assert.equal(crossSite.code,403);
  const sameSite=fakeRes();
  await handlers.post({
    headers:{...headers,'sec-fetch-site':'same-site'},
    owner,body:{csrf,decision:'approve'}
  },sameSite);
  assert.equal(sameSite.code,403);
  const missingOwner=fakeRes();
  await handlers.post({headers,body:{csrf,decision:'approve'}},missingOwner);
  assert.equal(missingOwner.code,401);
  const good=fakeRes();
  await handlers.post({headers,owner,body:{csrf,decision:'approve'}},good);
  assert.equal(good.code,303);
  assert.equal(new URL(good.redirectTo).hostname,'127.0.0.1');
  const replay=fakeRes();
  await handlers.post({headers,owner,body:{csrf,decision:'approve'}},replay);
  assert.equal(replay.code,410);
});
test('anonymous GET is redirected only to same-origin Account Portal login',async () => {
  const paths={};
  registerDesktopOwnerV4Authorization({
    get:(p,h)=>paths.GET=h,
    post:(p,h)=>paths.POST=h
  },{
    enabled:true,redis:fakeRedis(),prefix:PREFIX,publicOrigin:ORIGIN,
    verifyOwner:async()=>null
  });
  const res=fakeRes();
  await paths.GET({query:query().req},res);
  assert.equal(res.code,303);
  assert.ok(res.redirectTo.startsWith('/account/login?next='));
  assert.ok(!res.redirectTo.includes('https://attacker.example'));
});
test('missing browser cookie is not an Owner session',async () => {
  assert.equal(await browserOwnerFromOperator({headers:{}}),null);
});
test('plugin server registers Desktop consent behind an exact default-OFF feature flag',() => {
  const src=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
  assert.ok(src.includes("process.env.LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4==='1'"));
  assert.ok(src.includes('registerDesktopOwnerV4Authorization(app,{'));
  assert.ok(!src.includes('DESKTOP_OWNER_AUTH_V4!=='));
});
