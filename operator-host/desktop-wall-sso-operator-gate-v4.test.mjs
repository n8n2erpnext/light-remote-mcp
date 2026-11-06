import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS,
  desktopWallSsoOperatorEnabledV4,
  createDesktopWallSsoOperatorGateV4
} from './desktop-wall-sso-operator-gate-v4.mjs';
import {handleDeviceChannelRoutes} from './executor-routes-device-channel.mjs';

const allFlags=()=>Object.fromEntries(
  DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS.map(name=>[name,'1'])
);
function fakeDependencies(){
  let activity=0;
  const store=new Map();
  const storage={
    prefix:'lr:gold:goldabv2lab:',
    redis:{
      async get(k){activity++;return store.get(k)??null;},
      async set(k,v,{NX}={}){activity++;if(NX&&store.has(k))return null;store.set(k,v);return 'OK';},
      async getDel(k){activity++;const value=store.get(k);store.delete(k);return value??null;}
    }
  };
  const accounts={desktopOwnerSessionActive(){activity++;return false;}};
  const enrollments={
    binding(){activity++;throw Error('not_enrolled');},
    verifyChannel(){activity++;throw Error('not_enrolled');}
  };
  return {storage,accounts,enrollments,activity:()=>activity};
}

test('T04b6 default environment does not enable any T04 redemption callback',()=>{
  assert.equal(desktopWallSsoOperatorEnabledV4({}),false);
  const result=createDesktopWallSsoOperatorGateV4();
  assert.deepEqual(result,{
    enabled:false,signedRedeem:undefined,internalIssue:undefined,authority:null
  });
});

test('T04b6 each independently required feature flag fails closed if absent',()=>{
  for(const flag of DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS){
    const env=allFlags();delete env[flag];
    assert.equal(desktopWallSsoOperatorEnabledV4(env),false,flag);
    const result=createDesktopWallSsoOperatorGateV4({env});
    assert.equal(result.enabled,false,flag);
    assert.equal(result.signedRedeem,undefined,flag);
  }
});

test('T04b6 rejects truthy, malformed, empty, disabled or partial flags',()=>{
  for(const flag of DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS){
    for(const value of ['true','yes','on','0','01','1 ','',true,1,null]){
      const env={...allFlags(),[flag]:value};
      assert.equal(desktopWallSsoOperatorEnabledV4(env),false,
        flag+': '+String(value));
    }
  }
  assert.equal(desktopWallSsoOperatorEnabledV4(null),false);
  assert.equal(desktopWallSsoOperatorEnabledV4([]),false);
});

test('T04b6 missing flags never even inspect Redis, owner account or enrollment',()=>{
  const deps=fakeDependencies();
  const result=createDesktopWallSsoOperatorGateV4({
    ...deps,env:{LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4:'1'}
  });
  assert.equal(result.enabled,false);
  assert.equal(deps.activity(),0);
  assert.equal(result.authority,null);
});

test('T04b6 both Desktop Auth/Token ON alone do not enable Wall SSO',()=>{
  const env={
    LIGHT_REMOTE_GOLD_INDEPENDENT:'1',
    LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4:'1',
    LR_GOLD_ABV2_DESKTOP_TOKEN_V4:'1'
  };
  assert.equal(desktopWallSsoOperatorEnabledV4(env),false);
  assert.equal(createDesktopWallSsoOperatorGateV4({env}).enabled,false);
});

test('T04b6 enabling without full trusted storage/enrollment FAILS startup',()=>{
  const env=allFlags();
  assert.equal(desktopWallSsoOperatorEnabledV4(env),true);
  assert.throws(()=>createDesktopWallSsoOperatorGateV4({env}),
    /desktop_wall_owner_authority_unavailable/);
  assert.throws(()=>createDesktopWallSsoOperatorGateV4({
    env,storage:{prefix:'lr:gold:goldabv2lab:',redis:{}},
    accounts:{},enrollments:{}
  }));
});

test('T04b6 exact opt-in exports only a trusted signed redemption callback',()=>{
  const env=allFlags(),deps=fakeDependencies();
  const gate=createDesktopWallSsoOperatorGateV4({env,...deps});
  assert.equal(gate.enabled,true);
  assert.equal(typeof gate.signedRedeem,'function');
  assert.equal(gate.authority.enabled,true);
  assert.equal(deps.activity(),0);
  assert.ok(Object.isFrozen(gate));
  assert.equal('accessToken' in gate,false);
  assert.equal('refreshToken' in gate,false);
});

test('T04b6 default OFF returns 404 before parsing a signed route request',async()=>{
  const gate=createDesktopWallSsoOperatorGateV4({env:{}});
  let bodyReads=0,code=0;
  await handleDeviceChannelRoutes(
    {method:'POST'}, {},
    new URL('http://operator.internal/v1/device-channel/desktop-wall-sso-redeem'),
    {
      desktopWallSsoSignedRedeem:gate.signedRedeem,
      readJson:async()=>{bodyReads++;throw Error('should not parse');},
      sendJson:(_res,status,data)=>{code=status;return data;}
    }
  );
  assert.equal(code,404);
  assert.equal(bodyReads,0);
});

test('T04b6 exact opt-in uses Ed25519 verifier, never browser token fields',async()=>{
  const gate=createDesktopWallSsoOperatorGateV4({
    env:allFlags(),...fakeDependencies()
  });
  let code=0;
  const output=await handleDeviceChannelRoutes(
    {method:'POST'},{setHeader(){}},
    new URL('http://operator.internal/v1/device-channel/desktop-wall-sso-redeem'),
    {
      desktopWallSsoSignedRedeem:gate.signedRedeem,
      readJson:async()=>({
        ticket:'T'.repeat(43),
        signedEnvelope:{
          deviceId:'dev_fake',timestamp:1700000000000,
          nonce:'N'.repeat(24),
          signature:'S'.repeat(86),
          payload:{ticketDigest:'a'.repeat(64)}
        }
      }),
      sendJson:(_res,status,data)=>{code=status;return data;}
    }
  );
  assert.equal(code,403);
  assert.deepEqual(output,{ok:false,error:'desktop_wall_sso_denied'});
});

test('T04b6 Operator startup is explicitly gated and does not mount native issue route',()=>{
  const host=fs.readFileSync(new URL('./executor.mjs',import.meta.url),'utf8');
  assert.ok(host.includes('createDesktopWallSsoOperatorGateV4({'));
  assert.ok(host.includes('env:process.env,storage:goldStorage,accounts,enrollments'));
  assert.ok(host.includes('desktopWallSsoSignedRedeem:desktopWallSsoOperatorGate.signedRedeem'));
  const dispatcher=fs.readFileSync(
    new URL('./executor-routes-device-channel.mjs',import.meta.url),'utf8'
  );
  assert.ok(dispatcher.includes(
    "url.pathname==='/v1/device-channel/desktop-wall-sso-redeem'"
  ));
  assert.ok(!dispatcher.includes('desktop-wall-sso-issue'));
  const plugin=fs.readFileSync(
    new URL('../plugin-server/server.mjs',import.meta.url),'utf8'
  );
  assert.ok(!plugin.includes('desktop-wall-sso-issue'));
});

test('T04b7b a sixth exact issuer flag is required in addition to redemption',()=>{
  const env=allFlags(),deps=fakeDependencies();
  let gate=createDesktopWallSsoOperatorGateV4({env,...deps});
  assert.equal(gate.enabled,true);
  assert.equal(typeof gate.signedRedeem,'function');
  assert.equal(gate.internalIssue,undefined);
  assert.equal(gate.familyCurrent,undefined);
  for(const bad of ['true','yes','01','1 ',true,1]){
    const badEnv={...env,LR_GOLD_ABV2_DESKTOP_WALL_SSO_ISSUER_V4:bad};
    gate=createDesktopWallSsoOperatorGateV4({env:badEnv,...deps});
    assert.equal(gate.internalIssue,undefined);
    assert.equal(gate.familyCurrent,undefined);
  }
  gate=createDesktopWallSsoOperatorGateV4({
    env:{...env,LR_GOLD_ABV2_DESKTOP_WALL_SSO_ISSUER_V4:'1'},...deps
  });
  assert.equal(gate.enabled,true);
  assert.equal(typeof gate.signedRedeem,'function');
  assert.equal(typeof gate.internalIssue,'function');
  assert.equal(typeof gate.familyCurrent,'function');
  assert.equal(deps.activity(),0);
});
test('T04b7b enabling only issuer flag cannot activate Operator or read Redis',()=>{
  const deps=fakeDependencies(),env={LR_GOLD_ABV2_DESKTOP_WALL_SSO_ISSUER_V4:'1'};
  const gate=createDesktopWallSsoOperatorGateV4({env,...deps});
  assert.equal(gate.enabled,false);
  assert.equal(gate.internalIssue,undefined);
  assert.equal(gate.signedRedeem,undefined);
  assert.equal(deps.activity(),0);
});
