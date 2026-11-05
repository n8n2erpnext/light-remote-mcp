import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDesktopWallSsoBrowserBootstrapV4,
  WALL_SSO_BOOTSTRAP_COOKIE_V4,WALL_SSO_BOOTSTRAP_MAX_AGE_MS_V4}
  from './desktop-wall-sso-browser-bootstrap-v4.mjs';
import {startLocalWall} from './local-wall.mjs';

const TICKET='T'.repeat(43),FAMILY='F'.repeat(43);
const auth={
  enabled:true,identity:()=>null,csrfForRequest:()=>'',verifyRequestCsrf:()=>false,
  issueLoginCsrf:()=>'',verifyLoginCsrf:()=>false
};
function wallFixture(){
  let active=true,redeems=0,liveChecks=0;
  const wall=startLocalWall({
    host:'127.0.0.1',port:0,auth,
    desktopWallSso:{
      enabled:true,
      redeemSignedTicket:async ticket=>{
        redeems++;
        assert.equal(ticket,TICKET);
        return {verified:true,purpose:'wall_local_session_authority_v1',
          accountId:'acct_test',deviceId:'dev_test',familyId:FAMILY};
      },
      verifyLiveOwnerFamily:async()=>{liveChecks++;return active;}
    },
    getLocalStatus:async()=>({deviceId:'dev_test',enrolled:true,
      cloudDesiredConnected:true,cloudState:'connected'})
  });
  async function start(){
    if(!wall.server.listening)
      await new Promise(resolve=>wall.server.once('listening',resolve));
    const base='http://127.0.0.1:'+wall.server.address().port;
    const url='/auth/desktop/sso/browser';
    const post=(route,options={})=>fetch(base+url+route,{
      method:'POST',headers:{
        origin:base,'content-type':'application/json',
        ...(options.headers||{})
      },
      body:options.body??'{}',redirect:'manual'
    });
    return {base,url,post,wall,
      counts:()=>({redeems,liveChecks}),
      revokeOwner:()=>{active=false;},
      close:()=>wall.close()};
  }
  return start();
}
const firstCookie=res=>(res.headers.get('set-cookie')||'').split(';',1)[0];

test('T04b9c3a browser only receives public challenge and opaque HttpOnly cookie',async()=>{
  const x=await wallFixture();
  try{
    const res=await x.post('/begin');
    assert.equal(res.status,200);
    const body=await res.json();
    assert.deepEqual(Object.keys(body).sort(),['challenge','expiresAt','ok']);
    assert.match(body.challenge,/^[A-Za-z0-9_-]{43}$/);
    assert.equal(body.ok,true);
    assert.equal(res.headers.get('cache-control'),'no-store');
    assert.equal(res.headers.get('referrer-policy'),'no-referrer');
    assert.match(res.headers.get('set-cookie'),/HttpOnly/);
    assert.match(res.headers.get('set-cookie'),/SameSite=Strict/);
    assert.match(res.headers.get('set-cookie'),/Max-Age=60/);
    assert.match(firstCookie(res),/^lr_wall_sso_bootstrap_v4=v1\./);
    assert.equal(JSON.stringify(body).includes(TICKET),false);
    assert.equal(JSON.stringify(body).includes(FAMILY),false);
    assert.deepEqual(x.counts(),{redeems:0,liveChecks:0});
  }finally{await x.close();}
});

test('T04b9c3a trusted native approves; browser claim mints Wall cookie only once',async()=>{
  const x=await wallFixture();
  try{
    const begun=await x.post('/begin'),init=await begun.json();
    const cookie=firstCookie(begun);
    const notReady=await x.post('/finish',{headers:{cookie}});
    assert.equal(notReady.status,403);
    // This private Node method is NOT an HTTP endpoint or Tauri IPC.
    const result=await x.wall.desktopSsoBootstrap.approveTrustedNative({
      challenge:init.challenge,ticket:TICKET
    });
    assert.deepEqual(result,{ready:true});
    assert.equal(x.counts().redeems,1);
    const finished=await x.post('/finish',{headers:{cookie}});
    assert.equal(finished.status,200);
    assert.deepEqual(Object.keys(await finished.json()).sort(),['expiresAt','ok']);
    const set=finished.headers.get('set-cookie');
    assert.match(set,/lr_wall_desktop_sso_v4=v1\./);
    assert.match(set,/HttpOnly/);
    assert.match(set,/SameSite=Strict/);
    assert.equal(set.includes(TICKET),false);
    assert.equal(set.includes(FAMILY),false);
    const sessionCookie=set.match(/lr_wall_desktop_sso_v4=[^;]+/)[0];
    const home=await fetch(x.base+'/',{
      headers:{cookie:sessionCookie},redirect:'manual'
    });
    assert.equal(home.status,200,'session accepted after fresh Owner check');
    const replay=await x.post('/finish',{headers:{cookie}});
    assert.equal(replay.status,403);
    const again=await assert.rejects(
      x.wall.desktopSsoBootstrap.approveTrustedNative({
        challenge:init.challenge,ticket:TICKET
      }),e=>e.code==='desktop_wall_sso_bootstrap_denied'
    );
    assert.equal(again,undefined);
    x.revokeOwner();
    const revoked=await fetch(x.base+'/',{
      headers:{cookie:sessionCookie},redirect:'manual'
    });
    assert.equal(revoked.status,303);
    assert.equal((await fetch(x.base+'/api/status',{headers:{cookie:sessionCookie}})).status,401);
    assert.ok(x.counts().liveChecks>=2);
  }finally{await x.close();}
});

test('T04b9c3a another browser cookie cannot claim a different challenge',async()=>{
  const x=await wallFixture();
  try{
    const a=await x.post('/begin'),b=await x.post('/begin');
    const av=await a.json(),bc=firstCookie(b);
    await x.wall.desktopSsoBootstrap.approveTrustedNative({
      challenge:av.challenge,ticket:TICKET
    });
    const foreign=await x.post('/finish',{headers:{cookie:bc}});
    assert.equal(foreign.status,403);
    const actual=await x.post('/finish',{headers:{cookie:firstCookie(a)}});
    assert.equal(actual.status,200);
  }finally{await x.close();}
});

test('T04b9c3a cross-origin, missing Origin, query, body token and spoofed TLS fail',async()=>{
  const x=await wallFixture();
  try{
    for(const options of [
      {headers:{origin:'https://evil.example'}},
      {headers:{origin:''}},
      {headers:{'sec-fetch-site':'cross-site'}},
      {headers:{'sec-fetch-site':'same-site'}},
      {headers:{'content-type':'text/plain'}},
      {body:JSON.stringify({ticket:TICKET})}
    ]){
      const res=await x.post('/begin',options);
      assert.ok(res.status===400||res.status===403);
      assert.equal(res.headers.get('set-cookie'),null);
    }
    const q=await x.post('/begin?ticket=prohibited');
    assert.equal(q.status,403);
    const spoof=await x.post('/begin',{headers:{
      origin:x.base.replace('http:','https:'),
      'x-forwarded-proto':'https'
    }});
    assert.equal(spoof.status,403);
    assert.deepEqual(x.counts(),{redeems:0,liveChecks:0});
  }finally{await x.close();}
});

test('T04b9c3a bootstrap expiry and forged browser cookie fail closed',async()=>{
  let now=1000;
  let seed=1;
  const make=()=>Buffer.alloc(32,seed++);
  const fake={
    async redeem(){return {cookie:'lr_wall_desktop_sso_v4=v1.'+
      'R'.repeat(43)+'; HttpOnly; SameSite=Strict'};},
    async identity(){return {desktopOwnerSso:true,expiresAt:110000}}
  };
  const svc=createDesktopWallSsoBrowserBootstrapV4({
    wallSession:fake,clock:()=>now,random:make
  });
  const started=svc.begin();
  assert.equal(started.expiresAt,1000+WALL_SSO_BOOTSTRAP_MAX_AGE_MS_V4);
  const wrong={headers:{cookie:WALL_SSO_BOOTSTRAP_COOKIE_V4+'=invalid'}};
  await assert.rejects(svc.finish(wrong),
    e=>e.code==='desktop_wall_sso_bootstrap_denied');
  now=61_001;
  await assert.rejects(svc.approveTrustedNative({
    challenge:started.challenge,ticket:TICKET
  }),e=>e.code==='desktop_wall_sso_bootstrap_denied');
});

test('T04b9c3a parallel native approvals cannot redeem same browser challenge twice',async()=>{
  let release,called=0;
  const pending=new Promise(resolve=>release=resolve);
  const fake={
    redeem:async()=>{called++;await pending;return{
      cookie:'lr_wall_desktop_sso_v4=v1.'+
      'R'.repeat(43)+'; HttpOnly; SameSite=Strict'
    }},
    identity:async()=>({desktopOwnerSso:true,expiresAt:600000})
  };
  const svc=createDesktopWallSsoBrowserBootstrapV4({wallSession:fake});
  const begin=svc.begin();
  const one=svc.approveTrustedNative({challenge:begin.challenge,ticket:TICKET});
  const two=svc.approveTrustedNative({challenge:begin.challenge,ticket:TICKET});
  release();
  const all=await Promise.allSettled([one,two]);
  assert.equal(all.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(all.filter(x=>x.status==='rejected').length,1);
  assert.equal(called,1);
});

test('T04b9c3a Owner revoked after native approval prevents cookie claim',async()=>{
  const x=await wallFixture();
  try{
    const res=await x.post('/begin'),data=await res.json();
    await x.wall.desktopSsoBootstrap.approveTrustedNative({
      challenge:data.challenge,ticket:TICKET
    });
    x.revokeOwner();
    const outcome=await x.post('/finish',{headers:{cookie:firstCookie(res)}});
    assert.equal(outcome.status,403);
    assert.equal(outcome.headers.get('set-cookie'),null);
  }finally{await x.close();}
});

test('T04b9c3a default OFF and native approval never exposed as HTTP route',async()=>{
  const x=startLocalWall({
    host:'127.0.0.1',port:0,auth,
    getLocalStatus:async()=>({deviceId:'dev_test'})
  });
  try{
    if(!x.server.listening)
      await new Promise(resolve=>x.server.once('listening',resolve));
    assert.equal(x.desktopSsoBootstrap,null);
    const base='http://127.0.0.1:'+x.server.address().port;
    for(const method of ['begin','finish','approveTrustedNative']){
      const res=await fetch(base+'/auth/desktop/sso/browser/'+method,{
        method:'POST',
        headers:{origin:base,'content-type':'application/json'},
        body:'{}'
      });
      assert.equal(res.status,404);
    }
  }finally{await x.close();}
  const src=fs.readFileSync(new URL('./local-wall.mjs',import.meta.url),'utf8');
  assert.ok(src.includes('desktopSsoBootstrap.approveTrustedNative')===false);
  assert.ok(src.includes('desktopSsoBootstrap.finish(req)'));
});
test('T04b9c3c private pending lookup is single-choice and non-bearer',async()=>{
  const svc=createDesktopWallSsoBrowserBootstrapV4({
    wallSession:{
      redeem:async()=>({cookie:'lr_wall_desktop_sso_v4=v1.A'}),
      identity:async()=>null
    }
  });
  assert.equal(svc.pendingForNative(),null);
  const first=svc.begin();
  assert.deepEqual(svc.pendingForNative(),{
    challenge:first.challenge,expiresAt:first.expiresAt
  });
  svc.begin();
  assert.equal(svc.pendingForNative(),null,'multiple browser tabs cannot be silently approved');
});


test('T04b9c3c local Wall renders challenge page only when native SSO opted in',async()=>{
  const x=await wallFixture();
  try{
    const page=await fetch(x.base+'/auth/desktop/sso/browser');
    assert.equal(page.status,200);
    const html=await page.text();
    assert.match(html,/Sign in with Desktop V4/);
    assert.match(html,/app\.js/);
    assert.equal(html.includes(TICKET),false);
    assert.equal(html.includes(FAMILY),false);
    const csp=page.headers.get('content-security-policy');
    assert.match(csp,/script-src 'self'/);
    assert.doesNotMatch(csp,/script-src[^;]*unsafe-inline/);
    const js=await fetch(x.base+'/auth/desktop/sso/browser/app.js');
    assert.equal(js.status,200);
    const script=await js.text();
    assert.match(script,/challenge\.slice\(0,8\)/);
    assert.match(script,/browser\/begin/);
    assert.match(script,/browser\/finish/);
    assert.equal(script.includes(TICKET),false);
    const login=await fetch(x.base+'/login');
    assert.equal(login.status,200);
    assert.match(await login.text(),/href="\/auth\/desktop\/sso\/browser"/);
  }finally{await x.close();}
});
