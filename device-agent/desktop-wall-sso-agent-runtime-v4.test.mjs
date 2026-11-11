import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentWallSsoRuntimeV4} from './desktop-wall-sso-agent-runtime-v4.mjs';
import {startLocalWall} from './local-wall.mjs';

const LAB='https://goldabv2.light-remote.thaiduy.digital';
const auth={enabled:true,identity:()=>null,issueLoginCsrf:()=>'',
  verifyLoginCsrf:()=>false,csrfForRequest:()=>'',verifyRequestCsrf:()=>false};
function fixture(overrides={}){
  let state={enrollment:{accountId:'acct_test',deviceId:'dev_test'}},starts=0,closes=0;
  const options={hub:LAB,base:LAB,host:'127.0.0.1',authEnabled:true,
    env:{LR_GOLD_ABV2_DESKTOP_ABV2_NATIVE_V4:'1'},readState:()=>state,
    signChannel:()=>{throw Error('no implicit signing');},
    fetchImpl:()=>{throw Error('no implicit network');},
    startIpc:async()=>{starts++;return {enabled:true,close:async()=>{closes++;}};},...overrides};
  const runtime=createAgentWallSsoRuntimeV4(options);
  return {runtime,counts:()=>({starts,closes}),setState:value=>{state=value;}};
}
test('runtime stays off outside the exact enabled, authenticated loopback Lab profile',async()=>{
  for(const override of [{env:{}},{hub:'https://light-remote.thaiduy.digital'},
    {base:'http://goldabv2.light-remote.thaiduy.digital'},{host:'0.0.0.0'},
    {host:'localhost'},{authEnabled:false}]){
    const x=fixture(override);
    assert.equal(x.runtime.options.enabled,false);
    assert.equal(await x.runtime.start({}),false);
    assert.equal(x.runtime.options.isNativeReady(),false);
    await assert.rejects(async()=>x.runtime.options.redeemSignedTicket('x'));
    await x.runtime.close();assert.deepEqual(x.counts(),{starts:0,closes:0});
  }
});
test('native readiness follows successful bind and live enrollment/revocation',async()=>{
  const x=fixture();
  assert.equal(x.runtime.options.isNativeReady(),false);
  assert.equal(await x.runtime.start({}),true);
  assert.equal(await x.runtime.start({}),true);
  assert.deepEqual(x.counts(),{starts:1,closes:0});
  for(const value of [null,{enrollment:{accountId:'acct_test',deviceId:'dev_test',revokedAt:1}},
    {enrollment:{accountId:'acct_test',deviceId:'dev_test'},cloud:{lastError:'device_removed'}}]){
    x.setState(value);assert.equal(x.runtime.options.isNativeReady(),false);
  }
  await x.runtime.close();await x.runtime.close();
  assert.deepEqual(x.counts(),{starts:1,closes:1});
});
test('failed bind and close during bind cannot advertise a working sign-in',async()=>{
  const failed=fixture({startIpc:async()=>{throw Error('pipe_busy');}});
  assert.equal(await failed.runtime.start({}),false);
  assert.equal(failed.runtime.options.isNativeReady(),false);
  let release,closed=0;
  const raced=fixture({startIpc:()=>new Promise(resolve=>{release=resolve;})});
  const pending=raced.runtime.start({}),closing=raced.runtime.close();
  release({enabled:true,close:async()=>{closed++;}});
  assert.equal(await pending,false);await closing;
  assert.equal(closed,1);assert.equal(raced.runtime.options.isNativeReady(),false);
});
test('Wall exposes Google-via-Desktop only after native IPC is actually ready',async()=>{
  const x=fixture(),wall=startLocalWall({host:'127.0.0.1',port:0,auth,
    desktopWallSso:x.runtime.options});
  try{
    if(!wall.server.listening)await new Promise(resolve=>wall.server.once('listening',resolve));
    const base='http://127.0.0.1:'+wall.server.address().port;
    const page=()=>fetch(base+'/login').then(r=>r.text());
    assert.doesNotMatch(await page(),/Continue with Google via Desktop/);
    assert.equal((await fetch(base+'/auth/desktop/sso/browser')).status,404);
    await x.runtime.start(wall);
    assert.match(await page(),/Continue with Google via Desktop/);
    assert.equal((await fetch(base+'/auth/desktop/sso/browser')).status,200);
    x.setState({enrollment:{accountId:'acct_test',deviceId:'dev_test',revoked:true}});
    assert.doesNotMatch(await page(),/Continue with Google via Desktop/);
    assert.equal((await fetch(base+'/auth/desktop/sso/browser')).status,404);
  }finally{await x.runtime.close();await wall.close();}
});
