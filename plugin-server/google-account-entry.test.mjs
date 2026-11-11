import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeGoldGoogleAuth} from './google-auth.mjs';
import {registerAccountPortal} from './account-portal.mjs';

test('unconfigured Google keeps the bounded native return intent for password fallback',async()=>{
  await initializeGoldGoogleAuth({query:async()=>({rows:[]})});
  const routes=new Map(),app={};
  for(const method of ['get','post','all'])app[method]=(paths,handler)=>{
    for(const path of Array.isArray(paths)?paths:[paths])routes.set(method+' '+path,handler);
  };
  registerAccountPortal(app);
  const begin=routes.get('get /account/google');assert.equal(typeof begin,'function');
  const intent='/account/desktop/v4/authorize?client_id=light-remote-desktop-v4&state=synthetic&login_provider=google';
  for(const [next,expected] of [[intent,intent],['https://evil.example','/account'],['//evil.example','/account'],[undefined,'/account']]){
    let location,status;
    await begin({query:{next}},{redirect:(code,url)=>{status=code;location=url;}});
    assert.equal(status,303);
    const url=new URL(location,'https://goldabv2.light-remote.thaiduy.digital');
    assert.equal(url.pathname,'/account/login');
    assert.equal(url.searchParams.get('error'),'google_unavailable');
    assert.equal(url.searchParams.get('next'),expected);
  }
});
