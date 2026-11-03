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
const setup=({verified=true}={})=>{
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
