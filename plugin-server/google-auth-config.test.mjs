import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PUBLIC_ORIGIN} from './config.mjs';
import {initializeGoldGoogleAuth,initializeGoogleRedis,googleAuthStatus,
  saveGoogleAuthConfig,beginGoogleAuth,finishGoogleAuth} from './google-auth.mjs';

// In-memory PG/Redis plus an intercepted token endpoint only. No provider call,
// real account, credential file, browser, or Google Cloud config is touched.
const ID='synthetic_testing_oauth_user.apps.googleusercontent.com';
const OTHER_ID='synthetic_second_oauth_user.apps.googleusercontent.com';
const SECRET='synthetic_nonproduction_secret_12345';
const REDIRECT=PUBLIC_ORIGIN+'/account/google/callback';
const PREFIX='lr:gold:google_config_fixture:';
function fixture(row=null){
  let stored=row&&structuredClone(row),writes=0;
  const flows=new Map();
  const pool={async query(sql,args=[]){
    if(sql.startsWith('SELECT client_id,client_secret,redirect_uri'))return {rows:stored?[structuredClone(stored)]:[]};
    assert.ok(sql.startsWith('INSERT INTO lr_gold_google_oauth_config'));
    writes++;stored={client_id:args[0],client_secret:args[1],redirect_uri:args[2]};
    return {rows:[],rowCount:1};
  }};
  const redis={async set(key,value,options){
    assert.deepEqual(options,{EX:600,NX:true});
    if(flows.has(key))return null;flows.set(key,value);return 'OK';
  },async getDel(key){const value=flows.get(key)??null;flows.delete(key);return value;}};
  return {pool,redis,flows,get row(){return stored;},get writes(){return writes;}};
}
async function setup(row){
  const f=fixture(row);await initializeGoldGoogleAuth(f.pool);initializeGoogleRedis(f.redis,PREFIX);return f;
}
function flowKey(state){return PREFIX+'google:flow:'+crypto.createHash('sha256').update(state).digest('hex');}
async function begin(){
  const result=await beginGoogleAuth({returnTo:'/account/desktop/v4/authorize?synthetic=1'});
  return {result,url:new URL(result.url),state:new URL(result.url).searchParams.get('state')};
}
const codeIs=(code,status)=>error=>error?.message===code&&error.status===status;

test('Google OAuth profile config uses only the current callback and fails closed across rotation',async t=>{
  const originalFetch=globalThis.fetch;let fetches=0;
  globalThis.fetch=async()=>{fetches++;throw Error('Unexpected network request in config fixture');};
  t.after(()=>{globalThis.fetch=originalFetch;});

  await t.test('unconfigured and invalid stored credentials stay unavailable without disclosing them',async()=>{
    for(const row of [null,{client_id:'bad',client_secret:SECRET},
      {client_id:ID,client_secret:'short'},{client_id:ID,client_secret:'invalid embedded whitespace secret'}]){
      await setup(row);const status=googleAuthStatus();
      assert.equal(status.configured,false);assert.equal(status.credentialsSource,null);
      assert.equal(status.redirectUri,REDIRECT);assert.equal(status.callbackRegistration,'unverified');
      await assert.rejects(beginGoogleAuth(),codeIs('google_oauth_not_configured',503));
      assert.doesNotMatch(JSON.stringify(status),/client_secret|clientSecret|synthetic_nonproduction/);
    }
    assert.equal(fetches,0);
  });
  await t.test('admin saves validate inputs before a PG write and return no client secret',async()=>{
    const f=await setup(null);
    for(const clientId of ['bad','https://example.invalid/',{},ID+' ' +'x'])
      await assert.rejects(saveGoogleAuthConfig({clientId,clientSecret:SECRET}),codeIs('invalid_google_client_id',400));
    for(const clientSecret of ['', 'short', 'a'.repeat(513), 'invalid embedded whitespace secret',{}])
      await assert.rejects(saveGoogleAuthConfig({clientId:ID,clientSecret}),codeIs('invalid_google_client_secret',400));
    assert.equal(f.writes,0);
    const status=await saveGoogleAuthConfig({clientId:ID,clientSecret:SECRET});
    assert.equal(f.writes,1);assert.equal(f.row.redirect_uri,REDIRECT);
    assert.equal(status.configured,true);assert.equal(status.credentialsSource,'postgres');
    assert.equal(status.callbackRegistration,'unverified');
    assert.equal(JSON.stringify(status).includes(SECRET),false);
    assert.equal(Object.hasOwn(status,'clientSecret'),false);
  });
  await t.test('preserved production callback stages credentials without routing Lab to the former origin',async()=>{
    const other='https://production-role.example.invalid/account/google/callback';
    const f=await setup({client_id:ID,client_secret:SECRET,redirect_uri:other});
    const status=googleAuthStatus();
    assert.equal(status.redirectUri,other);assert.equal(status.configured,false);
    assert.equal(status.credentialsSaved,true);assert.equal(status.pendingDomainSwitch,true);
    assert.equal(status.callbackOriginMatches,false);
    await assert.rejects(beginGoogleAuth(),codeIs('google_oauth_not_configured',503));
    assert.equal(f.flows.size,0);assert.equal(f.writes,0);
    await saveGoogleAuthConfig({clientId:ID,clientSecret:SECRET+'_rotated'});
    assert.equal(f.row.redirect_uri,other,'saving credentials must retain the registered callback');
    // After explicit origin/domain rotation, the same row matches this profile.
    const active=await setup({client_id:ID,client_secret:SECRET,redirect_uri:REDIRECT});
    assert.equal(googleAuthStatus().pendingDomainSwitch,false);
    const {url,state}=await begin();
    assert.equal(url.searchParams.get('redirect_uri'),REDIRECT);
    assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    const flow=JSON.parse(active.flows.get(flowKey(state)));
    assert.equal(flow.redirectUri,REDIRECT);assert.match(flow.configBinding,/^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(flow).includes(SECRET),false);
  });
  await t.test('client ID or secret rotation burns a pending flow before token exchange',async()=>{
    for(const change of [{clientId:OTHER_ID,clientSecret:SECRET},{clientId:ID,clientSecret:SECRET+'_rotated'}]){
      const f=await setup({client_id:ID,client_secret:SECRET,redirect_uri:REDIRECT});
      const {state}=await begin();
      await saveGoogleAuthConfig(change);
      const before=fetches;
      await assert.rejects(finishGoogleAuth({state,code:'synthetic_code'}),codeIs('google_oauth_config_changed',409));
      assert.equal(fetches,before);assert.equal(f.flows.size,0);
      await assert.rejects(finishGoogleAuth({state,code:'synthetic_code'}),codeIs('google_oauth_state_invalid',401));
    }
  });
  await t.test('malformed, expired and old-profile flow records never reach Google',async()=>{
    for(const mutate of [flow=>({...flow,expiresAt:0}),
      flow=>({...flow,redirectUri:'https://other-profile.example.invalid/account/google/callback'}),
      flow=>{const copy={...flow};delete copy.configBinding;return copy;}]){
      const f=await setup({client_id:ID,client_secret:SECRET,redirect_uri:REDIRECT});
      const {state}=await begin(),key=flowKey(state);
      f.flows.set(key,JSON.stringify(mutate(JSON.parse(f.flows.get(key)))));
      const before=fetches;
      await assert.rejects(finishGoogleAuth({state,code:'synthetic_code'}),
        error=>/^google_oauth_(state_invalid|config_changed)$/.test(error.message));
      assert.equal(fetches,before);assert.equal(f.flows.size,0);
    }
    const f=await setup({client_id:ID,client_secret:SECRET,redirect_uri:REDIRECT});
    const {state}=await begin();f.flows.set(flowKey(state),'{bad JSON');
    await assert.rejects(finishGoogleAuth({state,code:'synthetic_code'}),codeIs('google_oauth_state_invalid',401));
  });
  await t.test('same credentials survive reload but token exchange uses the current callback only',async()=>{
    const f=await setup({client_id:ID,client_secret:SECRET,redirect_uri:REDIRECT});
    const {state}=await begin();await initializeGoldGoogleAuth(f.pool);
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(options.redirect,'error');
      assert.equal(options.credentials,'omit');assert.equal(options.body.get('redirect_uri'),REDIRECT);
      assert.equal(options.body.get('client_id'),ID);assert.equal(options.body.get('client_secret'),SECRET);
      return new Response(JSON.stringify({error:'synthetic_rejection'}),{status:400});
    };
    await assert.rejects(finishGoogleAuth({state,code:'synthetic_code'}),codeIs('google_oauth_token_exchange_failed',401));
    assert.equal(f.flows.size,0);
  });
  await t.test('rotation while token exchange is pending cannot finish with stale authority',async()=>{
    await setup({client_id:ID,client_secret:SECRET,redirect_uri:REDIRECT});
    const {state}=await begin();
    globalThis.fetch=async()=>{
      await saveGoogleAuthConfig({clientId:ID,clientSecret:SECRET+'_changed_inflight'});
      return new Response('{}',{status:400});
    };
    await assert.rejects(finishGoogleAuth({state,code:'synthetic_code'}),codeIs('google_oauth_config_changed',409));
  });
});
