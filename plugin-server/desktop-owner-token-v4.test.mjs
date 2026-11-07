import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountRegistry} from '../operator-host/account-registry.mjs';
import {
  createDesktopOwnerTokenService,registerDesktopOwnerTokenRoutes,
  DESKTOP_ACCESS_TTL_MS,DESKTOP_SESSION_TTL_MS
} from './desktop-owner-token-v4.mjs';
import {DESKTOP_OWNER_RESOURCE} from './desktop-auth-v4-contract.mjs';

const PREFIX='lr:gold:goldabv2lab:';
const SESSION='acctsess_123e4567-e89b-42d3-a456-426614174000';
const ACCOUNT='owner_v4_42';
const token='Q'.repeat(43);
const setup=({verified=true,operatorCall}={})=>{
  let now=1_000_000,sessionActive=verified;
  const data=new Map();
  const redis={
    async set(k,v,opt){
      if(opt.NX && data.has(k))return null;
      data.set(k,{value:v,until:now+opt.EX*1000});return 'OK';
    },
    async get(k){
      const row=data.get(k);
      if(!row||row.until<=now){data.delete(k);return null;}
      return row.value;
    },
    async getDel(k){const value=await this.get(k);data.delete(k);return value;},
    async del(k){return data.delete(k)?1:0;}
  };
  const code=async ({verifier,installNonce})=>{
    if(verifier!=='right-verifier')throw Error('code_invalid');
    return {
      purpose:'desktop_owner_verified_once',accountId:ACCOUNT,
      accountSessionId:SESSION,
      accountSessionExpiresAt:1_000_000+DESKTOP_SESSION_TTL_MS,
      scope:'desktop:read',resource:DESKTOP_OWNER_RESOURCE,
      installNonce
    };
  };
  const service=createDesktopOwnerTokenService({
    redis,prefix:PREFIX,consumeCode:code,clock:()=>now,
    operatorCall,
    verifyPortalSession:async(accountId,sessionId)=>sessionActive &&
      accountId===ACCOUNT && sessionId===SESSION
  });
  const input={
    code:token,verifier:'right-verifier',
    redirectUri:'http://127.0.0.1:49152/desktop/v4/callback',
    installNonce:'L'.repeat(43),state:'S'.repeat(43)
  };
  return {service,redis,data,input,
    advance:ms=>{now+=ms;},setPortalActive:v=>{sessionActive=v;}}
};
function response(){
  return {code:200,headers:{},body:null,
    set(k,v){this.headers[k]=v;return this;},
    status(code){this.code=code;return this;},
    json(body){this.body=body;return this;}
  };
}
test('default OFF mounts zero token routes even without Redis',()=>{
  const paths=[];const app={post:p=>paths.push(p),get:p=>paths.push(p)};
  assert.deepEqual(registerDesktopOwnerTokenRoutes(app),{enabled:false,routes:0});
  assert.deepEqual(paths,[]);
});
test('T06 signed Owner snapshot stays native-only and rechecks current Portal family',async()=>{
  const calls=[];
  const x=setup({operatorCall:async(method,path,body)=>{
    calls.push({method,path,body});
    return {ok:true,accountId:ACCOUNT,asOf:1234,
      account:{email:'owner@example.test',plan:'pro',status:'active',emailVerified:true},
      devices:[],sessions:[],grants:[],jobs:[],events:[]};
  }});
  const issued=await x.service.exchange(x.input);
  const req={method:'POST',headers:{'content-type':'application/json',
    authorization:'Bearer '+issued.access_token},body:{},query:{}};
  const res=response();
  await x.service.routeSnapshot(req,res);
  assert.equal(res.code,200);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],{
    method:'POST',path:'/v1/accounts/desktop-v4/snapshot',
    body:{accountId:ACCOUNT,accountSessionId:SESSION}
  });
  assert.equal(JSON.stringify(res.body).includes(SESSION),false);
  const cookie=response();
  await x.service.routeSnapshot({...req,headers:{...req.headers,cookie:'browser=bad'}},cookie);
  assert.equal(cookie.code,403);
  assert.equal(calls.length,1);
  x.setPortalActive(false);
  const revoked=response();
  await x.service.routeSnapshot(req,revoked);
  assert.equal(revoked.code,401);
  assert.equal(calls.length,1);
});
test('opaque Desktop read-only exchange, PKCE one-use caller, refresh rotation and access projection',async()=>{
  const {service,input}=setup();
  const issued=await service.exchange(input);
  assert.equal(issued.token_type,'Bearer');
  assert.equal(issued.resource,DESKTOP_OWNER_RESOURCE);
  assert.equal(issued.scope,'desktop:read');
  assert.equal(issued.account_id,ACCOUNT);
  assert.equal(issued.expires_in,DESKTOP_ACCESS_TTL_MS/1000);
  assert.equal(issued.access_token.length,43);
  assert.equal(issued.refresh_token.length,43);
  assert.ok(!JSON.stringify(issued).includes('acctsess_'));
  const status=await service.inspect(issued.access_token);
  assert.equal(status.accountId,ACCOUNT);
  assert.equal('email' in status,false);
  assert.equal('refresh_token' in status,false);
  const renewed=await service.refresh(issued.refresh_token);
  assert.notEqual(renewed.access_token,issued.access_token);
  assert.notEqual(renewed.refresh_token,issued.refresh_token);
  await assert.rejects(service.refresh(issued.refresh_token),/desktop_token_invalid/);
  assert.equal((await service.inspect(renewed.access_token)).verified,true);
});
test('expired access cannot be inspected, unexpired refresh can renew; family never exceeds original session lifetime',async()=>{
  const x=setup();
  const issued=await x.service.exchange(x.input);
  x.advance(DESKTOP_ACCESS_TTL_MS+1000);
  await assert.rejects(x.service.inspect(issued.access_token),/desktop_token_invalid/);
  const renewed=await x.service.refresh(issued.refresh_token);
  assert.equal((await x.service.inspect(renewed.access_token)).accountId,ACCOUNT);
  x.advance(DESKTOP_SESSION_TTL_MS);
  await assert.rejects(x.service.refresh(renewed.refresh_token));
});
test('source Account Portal logout instantly invalidates access and rotating refresh',async()=>{
  const x=setup();
  const issued=await x.service.exchange(x.input);
  x.setPortalActive(false);
  await assert.rejects(x.service.inspect(issued.access_token),/desktop_session_revoked/);
  await assert.rejects(x.service.refresh(issued.refresh_token),/desktop_session_revoked/);
});
test('explicit Desktop logout removes family for all previous and current access tokens',async()=>{
  const x=setup();
  const a=await x.service.exchange(x.input);
  const b=await x.service.refresh(a.refresh_token);
  assert.deepEqual(await x.service.logout(b.refresh_token),{ok:true,revoked:true});
  await assert.rejects(x.service.inspect(a.access_token),/desktop_token_invalid|desktop_session_revoked/);
  await assert.rejects(x.service.inspect(b.access_token),/desktop_token_invalid|desktop_session_revoked/);
  await assert.rejects(x.service.refresh(b.refresh_token));
});
test('refuse issue when Operator portal session revoked, even if browser consent code is otherwise valid',async()=>{
  const x=setup({verified:false});
  await assert.rejects(x.service.exchange(x.input),/desktop_owner_verification_required/);
  assert.equal(x.data.size,0);
});
test('invalid one-use code and malformed install nonce issue no token',async()=>{
  const x=setup();
  await assert.rejects(x.service.exchange({...x.input,verifier:'wrong'}));
  await assert.rejects(x.service.exchange({...x.input,installNonce:'bad'}));
  assert.equal(x.data.size,0);
});
test('native HTTPS routes reject Origin, cookies and cross-site browser submissions',async()=>{
  const registered={};
  const app={
    get(path,handler){registered['GET '+path]=handler;},
    post(path,handler){registered['POST '+path]=handler;}
  };
  const x=setup();
  const result=registerDesktopOwnerTokenRoutes(app,{
    enabled:true,redis:x.redis,prefix:PREFIX,
    consumeCode:async()=>({
      purpose:'desktop_owner_verified_once',accountId:ACCOUNT,
      accountSessionId:SESSION,accountSessionExpiresAt:1_000_000+DESKTOP_SESSION_TTL_MS,
      resource:DESKTOP_OWNER_RESOURCE,scope:'desktop:read'
    }),
    verifyPortalSession:async()=>true,
    clock:()=>1_000_000
  });
  assert.equal(result.routes,4);
  for(const headers of [
    {origin:'https://attacker.example','content-type':'application/json'},
    {cookie:'__Host-light_remote_account=leak','content-type':'application/json'},
    {'sec-fetch-site':'cross-site','content-type':'application/json'},
    {'content-type':'text/plain'}
  ]){
    const res=response();
    await registered['POST /account/desktop/v4/token']({
      method:'POST',headers,body:{
        code:token,code_verifier:'right-verifier',
        redirect_uri:x.input.redirectUri,
        install_nonce:x.input.installNonce,state:x.input.state
      }
    },res);
    assert.equal(res.code,403);
    assert.equal(res.body.error,'desktop_native_client_required');
  }
});
test('invalid or already-used authorization code maps to 401, never false 503',async()=>{
  for(const code of ['desktop_consent_missing','desktop_consent_invalid',
    'desktop_code_invalid']){
    const x=setup();
    const service=createDesktopOwnerTokenService({
      redis:x.redis,prefix:PREFIX,
      consumeCode:async()=>{throw Object.assign(new Error(code),{code});},
      verifyPortalSession:async()=>true
    });
    const res=response();
    await service.routeExchange({
      method:'POST',headers:{'content-type':'application/json'},
      body:{code:'Q'.repeat(43),code_verifier:'V'.repeat(43),
        redirect_uri:x.input.redirectUri,install_nonce:x.input.installNonce,
        state:x.input.state}
    },res);
    assert.equal(res.code,401,code);
    assert.equal(res.body.error,'desktop_owner_verification_required',code);
    assert.equal(x.data.size,0,code);
  }
});
test('Account Registry verifies exact active Owner browser session by id, logout and disable deny',()=>{
  const registry=new AccountRegistry({bootstrapAccountId:'owner_v4_42',stateFile:null});
  registry.accounts.set(ACCOUNT,{accountId:ACCOUNT,status:'active'});
  registry.sessions.set('dummyhash',{
    accountId:ACCOUNT,sessionId:SESSION,expiresAt:Date.now()+60_000
  });
  assert.equal(registry.desktopOwnerSessionActive(ACCOUNT,SESSION),true);
  assert.equal(registry.desktopOwnerSessionActive(ACCOUNT,'acctsess_other'),false);
  assert.equal(registry.desktopOwnerSessionActive('other_account',SESSION),false);
  registry.accounts.get(ACCOUNT).status='admin_disabled';
  assert.equal(registry.desktopOwnerSessionActive(ACCOUNT,SESSION),false);
  registry.accounts.get(ACCOUNT).status='active';
  // Existing browser sessions never authorize an ex-Owner after a transfer,
  // nor during a pending Owner commit.
  registry.ownerAccountId='different_current_owner';
  assert.equal(registry.desktopOwnerSessionActive(ACCOUNT,SESSION),false);
  registry.ownerAccountId=ACCOUNT;
  registry.ownerTransferPending=true;
  assert.equal(registry.desktopOwnerSessionActive(ACCOUNT,SESSION),false);
});

test('T04b2 internal Owner family proof is exact and never exposed by WebView session projection',async()=>{
  const x=setup();
  const issued=await x.service.exchange(x.input);
  const view=await x.service.inspect(issued.access_token);
  assert.equal(Object.hasOwn(view,'familyId'),false);
  const internal=await x.service.inspectForWallSso(issued.access_token);
  assert.deepEqual(Object.keys(internal).sort(),[
    'accountId','familyId','isOwner','resource','scope','verified'
  ]);
  assert.equal(internal.verified,true);
  assert.equal(internal.isOwner,true);
  assert.equal(internal.accountId,ACCOUNT);
  assert.equal(internal.resource,DESKTOP_OWNER_RESOURCE);
  assert.equal(internal.familyId.length,43);
  assert.equal(await x.service.familyCurrentForWallSso(ACCOUNT,internal.familyId),true);
  assert.equal(await x.service.familyCurrentForWallSso('acct_attacker',internal.familyId),false);
  assert.equal(await x.service.familyCurrentForWallSso(ACCOUNT,'invalid'),false);
  assert.equal(JSON.stringify(view).includes(internal.familyId),false);
  await x.service.logout(issued.refresh_token);
  assert.equal(await x.service.familyCurrentForWallSso(ACCOUNT,internal.familyId),false);
  await assert.rejects(x.service.inspectForWallSso(issued.access_token));
});

test('T04b2 Portal logout/Owner transfer revokes server-internal Wall principal',async()=>{
  const x=setup();
  const issued=await x.service.exchange(x.input);
  const proof=await x.service.inspectForWallSso(issued.access_token);
  x.setPortalActive(false);
  assert.equal(await x.service.familyCurrentForWallSso(ACCOUNT,proof.familyId),false);
  await assert.rejects(x.service.inspectForWallSso(issued.access_token),
    /desktop_session_revoked/);
});

test('T04b2 expired native access can never mint a Wall SSO ticket',async()=>{
  const x=setup();
  const issued=await x.service.exchange(x.input);
  const proof=await x.service.inspectForWallSso(issued.access_token);
  x.advance(DESKTOP_ACCESS_TTL_MS+1000);
  await assert.rejects(x.service.inspectForWallSso(issued.access_token),
    /desktop_token_invalid/);
  assert.equal(await x.service.familyCurrentForWallSso(ACCOUNT,proof.familyId),true,
    'valid Owner family remains independently revocable after access expires');
});

test('F14 native Owner page forwards only kind/cursor while binding live family',async()=>{
 const calls=[];
 const x=setup({operatorCall:async(method,path,body)=>{
   calls.push({method,path,body});
   return {ok:true,kind:'devices',accountId:ACCOUNT,asOf:1234,rows:[],
     coverage:{returned:0,total:0,hasMore:false,nextCursor:null,source:'owner_live_membership_revision'}};
 }});
 const issued=await x.service.exchange(x.input);
 const authorized={method:'POST',headers:{'content-type':'application/json',
   authorization:'Bearer '+issued.access_token},query:{},
   body:{page:{kind:'devices',cursor:null,limit:100}}};
 const ok=response();
 await x.service.routeSnapshot(authorized,ok);
 assert.equal(ok.code,200);
 assert.deepEqual(calls,[{method:'POST',path:'/v1/accounts/desktop-v4/snapshot',
   body:{accountId:ACCOUNT,accountSessionId:SESSION,page:{kind:'devices',limit:100}}}]);
 for(const illegal of [
   {page:{kind:'devices',limit:101}},
   {page:{kind:'other'}},
   {page:{kind:'devices',cursor:'BAD!'}},
   {page:{kind:'devices',accountId:'other'}},
   {page:{kind:'devices'},accountId:'other'}
 ]){
   const denied=response();
   await x.service.routeSnapshot({...authorized,body:illegal},denied);
   assert.notEqual(denied.code,200,'foreign/invalid client page must be rejected');
 }
 assert.equal(calls.length,1,'untrusted inputs never forwarded');
 const forbidden=response();
 await x.service.routeSnapshot({...authorized,headers:{...authorized.headers,origin:'https://evil.example'}},forbidden);
 assert.notEqual(forbidden.code,200,'browser-origin requests stay rejected');
 x.setPortalActive(false);
 const revoked=response();
 await x.service.routeSnapshot(authorized,revoked);
 assert.equal(revoked.code,401,'revoked Owner family cannot query another page');
 assert.equal(calls.length,1);
});

test('F15 usage/jobs/sessions remain native-only verified family, with source-specific coverage',async()=>{
 let calls=[];
 const x=setup({operatorCall:async(method,path,body)=>{
  calls.push({method,path,body});
  const kind=body.page.kind;
  return {ok:true,accountId:ACCOUNT,kind,asOf:1234,rows:[],
   coverage:{returned:0,total:0,hasMore:false,nextCursor:null,
     source:kind==='usage'?'owner_current_month_usage':'in_memory_current_window'},
   ...(kind==='usage'?{month:'2026-11'}:{})};
 }});
 const issued=await x.service.exchange(x.input);
 const auth={method:'POST',headers:{'content-type':'application/json',
  authorization:'Bearer '+issued.access_token},query:{},body:{}};
 for(const kind of ['usage','jobs','sessions']){
  const responseBody=response();
  await x.service.routeSnapshot({...auth,body:{page:{kind,limit:100,cursor:null}}},responseBody);
  assert.equal(responseBody.code,200,'expected Owner native page '+kind);
 }
 assert.equal(calls.length,3);
 assert.ok(calls.every(call=>call.body.accountId===ACCOUNT&&
   call.body.accountSessionId===SESSION&&!('accountId' in call.body.page)));
 const invalid=response();
 await x.service.routeSnapshot({...auth,body:{page:{kind:'usage',deviceId:'foreign'}}},invalid);
 assert.notEqual(invalid.code,200);
 assert.equal(calls.length,3);
 const browser=response();
 await x.service.routeSnapshot({...auth,headers:{...auth.headers,origin:'https://evil.test'},
   body:{page:{kind:'jobs'}}},browser);
 assert.notEqual(browser.code,200);
 x.setPortalActive(false);
 const logout=response();
 await x.service.routeSnapshot({...auth,body:{page:{kind:'sessions'}}},logout);
 assert.equal(logout.code,401);
 assert.equal(calls.length,3);
});

test('F15-H2 Owner HTTPS accepts only PG jobs/Redis sessions source markers',async()=>{
 const calls=[];
 let forged=null;
 const x=setup({operatorCall:async(method,path,body)=>{
  calls.push({method,path,body});
  const kind=body.page.kind;
  return {ok:true,accountId:ACCOUNT,kind,asOf:1234,rows:[],
   coverage:{returned:0,total:0,hasMore:false,nextCursor:null,
    source:forged|| (kind==='jobs'?'postgresql_owner_job_history':
      'redis_retained_session_window'),
    ...(kind==='sessions'&&!forged?{retention:{snapshotTtlSeconds:604800,terminalPruneAfterMs:604800000,immutableAudit:false}}:{})}};
 }});
 const token=(await x.service.exchange(x.input)).access_token;
 const auth={method:'POST',headers:{'content-type':'application/json',
  authorization:'Bearer '+token},query:{}};
 for(const kind of ['jobs','sessions']){
  const accepted=response();
  await x.service.routeSnapshot({...auth,body:{page:{kind,limit:100}}},accepted);
  assert.equal(accepted.code,200);
 }
 assert.equal(calls.length,2);
 assert.ok(calls.every(call=>call.body.accountId===ACCOUNT&&
   call.body.accountSessionId===SESSION&&!('accountId' in call.body.page)));
 forged='postgresql_owner_job_history';
 const wrong=response();
 await x.service.routeSnapshot({...auth,body:{page:{kind:'sessions'}}},wrong);
 assert.notEqual(wrong.code,200,'session must not impersonate PostgreSQL job source');
 forged='some_untrusted_source';
 const invalid=response();
 await x.service.routeSnapshot({...auth,body:{page:{kind:'jobs'}}},invalid);
 assert.notEqual(invalid.code,200,'unknown source must be rejected');
 x.setPortalActive(false);
 const revoked=response();
 await x.service.routeSnapshot({...auth,body:{page:{kind:'jobs'}}},revoked);
 assert.equal(revoked.code,401);
 assert.equal(calls.length,4,'revoked family never reaches the Operator read');
});

test('F15-H3 Owner HTTPS rejects forged/omitted Redis retention, never confuses PG metadata',async()=>{
 const allowed={snapshotTtlSeconds:604800,terminalPruneAfterMs:86400000,immutableAudit:false};
 let retention=allowed,source='redis_retained_session_window',calls=0;
 const x=setup({operatorCall:async(_method,_path,body)=>{
  calls++;
  return {ok:true,accountId:ACCOUNT,kind:body.page.kind,asOf:1234,
   rows:[],coverage:{returned:0,total:0,hasMore:false,nextCursor:null,source,
    ...(retention!==undefined?{retention}:{})}};
 }});
 const issued=await x.service.exchange(x.input);
 const request={method:'POST',headers:{'content-type':'application/json',
  authorization:'Bearer '+issued.access_token},query:{},body:{page:{kind:'sessions'}}};
 const valid=response();
 await x.service.routeSnapshot(request,valid);
 assert.equal(valid.code,200);
 assert.deepEqual(valid.body.coverage.retention,allowed);
 for(const fake of [undefined,{...allowed,immutableAudit:true},
   {...allowed,snapshotTtlSeconds:0},
   {...allowed,terminalPruneAfterMs:366*86400000},
   {...allowed,terminalPruneAfterMs:'86400000'}]){
  retention=fake;
  const rejected=response();
  await x.service.routeSnapshot(request,rejected);
  assert.notEqual(rejected.code,200);
 }
 retention=allowed;source='in_memory_current_window';
 const mixed=response();
 await x.service.routeSnapshot(request,mixed);
 assert.notEqual(mixed.code,200);
 source='postgresql_owner_job_history';retention=undefined;
 const pg=response();
 await x.service.routeSnapshot({...request,body:{page:{kind:'jobs'}}},pg);
 assert.equal(pg.code,200);
 x.setPortalActive(false);
 const expired=response();
 await x.service.routeSnapshot(request,expired);
 assert.equal(expired.code,401);
 assert.equal(calls,8,'revoked Owner never dispatches an Operator read');
});
