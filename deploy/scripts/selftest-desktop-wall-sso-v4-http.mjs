import assert from 'node:assert/strict';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

// T04b9c3b1: runtime loopback regression after retiring the old browser
// ticket POST. The only browser handoff is challenge + HttpOnly cookie; the
// transfer ticket is seen by the trusted in-process Device Agent callback.
const TICKET='T'.repeat(43),FAMILY='F'.repeat(43);
let active=true,redeemCalls=0,liveChecks=0;
const auth={
  enabled:true,identity:()=>null,csrfForRequest:()=>'',verifyRequestCsrf:()=>false,
  issueLoginCsrf:()=>'',verifyLoginCsrf:()=>false
};
const start=desktopWallSso=>startLocalWall({
  host:'127.0.0.1',port:0,auth,desktopWallSso,
  getLocalStatus:async()=>({deviceId:'dev_01',deviceName:'Local SSO QA',
    enrolled:true,cloudState:'connected'})
});
const origin=wall=>'http://127.0.0.1:'+wall.server.address().port;
const whenListening=async wall=>{
  if(!wall.server.listening)
    await new Promise(resolve=>wall.server.once('listening',resolve));
};
const post=(base,route,headers={},payload='{}')=>fetch(base+route,{
  method:'POST',
  headers:{'content-type':'application/json',...headers},body:payload,
  redirect:'manual'
});
const browserCookie=res=>(res.headers.get('set-cookie')||'').split(';')[0];
async function run(){
  const off=start();
  try{
    await whenListening(off);
    const base=origin(off);
    for(const route of ['/auth/desktop/sso/redeem',
      '/auth/desktop/sso/browser/begin','/auth/desktop/sso/browser/finish']){
      const res=await post(base,route,{origin:base});
      assert.equal(res.status,404,'default OFF remains invisible: '+route);
      assert.equal(res.headers.get('set-cookie'),null);
    }
  }finally{await off.close();}

  const wall=start({
    enabled:true,
    redeemSignedTicket:async ticket=>{
      redeemCalls++;
      assert.equal(ticket,TICKET);
      return {verified:true,purpose:'wall_local_session_authority_v1',
        accountId:'acct_01',deviceId:'dev_01',familyId:FAMILY};
    },
    verifyLiveOwnerFamily:async({accountId,deviceId,familyId})=>{
      liveChecks++;
      assert.deepEqual([accountId,deviceId,familyId],
        ['acct_01','dev_01',FAMILY]);
      return active;
    }
  });
  try{
    await whenListening(wall);
    const base=origin(wall);
    const legacy=await post(base,'/auth/desktop/sso/redeem',{
      origin:base,'sec-fetch-site':'same-origin'
    },JSON.stringify({ticket:TICKET}));
    assert.equal(legacy.status,404,'legacy browser POST cannot issue SSO');
    assert.equal(legacy.headers.get('set-cookie'),null);
    assert.equal(redeemCalls,0);
    const begin='/auth/desktop/sso/browser/begin';
    const finish='/auth/desktop/sso/browser/finish';
    assert.equal((await post(base,begin)).status,403,'Origin mandatory');
    assert.equal((await post(base,begin,{
      origin:'https://evil.invalid','sec-fetch-site':'cross-site'
    })).status,403,'foreign Origin denied');
    assert.equal((await post(base,begin,{
      origin:base.replace('http:','https:'),
      'x-forwarded-proto':'https','sec-fetch-site':'same-origin'
    })).status,403,'forwarded TLS spoof denied');
    assert.equal((await post(base,begin,{
      origin:base
    },JSON.stringify({ticket:TICKET}))).status,400,'browser ticket body denied');

    const opened=await post(base,begin,{
      origin:base,'sec-fetch-site':'same-origin'
    });
    assert.equal(opened.status,200);
    const challenge=await opened.json();
    assert.deepEqual(Object.keys(challenge).sort(),['challenge','expiresAt','ok']);
    const browser=browserCookie(opened);
    assert.match(browser,/^lr_wall_sso_bootstrap_v4=v1\./);
    assert.match(opened.headers.get('set-cookie'),/HttpOnly/);
    assert.equal(JSON.stringify(challenge).includes(TICKET),false);
    const premature=await post(base,finish,{
      origin:base,cookie:browser,'sec-fetch-site':'same-origin'
    });
    assert.equal(premature.status,403,'browser cannot self-approve');

    assert.deepEqual(await wall.desktopSsoBootstrap.approveTrustedNative({
      challenge:challenge.challenge,ticket:TICKET
    }),{ready:true});
    assert.equal(redeemCalls,1,'trusted Device Agent only');
    const claimed=await post(base,finish,{
      origin:base,cookie:browser,'sec-fetch-site':'same-origin'
    });
    assert.equal(claimed.status,200);
    assert.deepEqual(Object.keys(await claimed.json()).sort(),['expiresAt','ok']);
    const cookieHeader=claimed.headers.get('set-cookie');
    assert.match(cookieHeader,/lr_wall_desktop_sso_v4=v1\./);
    assert.match(cookieHeader,/HttpOnly/);
    assert.match(cookieHeader,/SameSite=Strict/);
    assert.ok(!cookieHeader.includes(TICKET)&&!cookieHeader.includes(FAMILY));
    assert.equal((await post(base,finish,{
      origin:base,cookie:browser
    })).status,403,'one-time browser cookie cannot be replayed');
    const ssoCookie=cookieHeader.match(/lr_wall_desktop_sso_v4=[^;]+/)[0];
    const home=await fetch(base+'/',{
      headers:{cookie:ssoCookie},redirect:'manual'
    });
    assert.equal(home.status,200);
    assert.ok(liveChecks>=1);
    active=false;
    const revoked=await fetch(base+'/',{
      headers:{cookie:ssoCookie},redirect:'manual'
    });
    assert.equal(revoked.status,303,'revoked Owner denied on next request');
    assert.match(revoked.headers.get('location'),/^\/login\?/);
    assert.equal((await fetch(base+'/api/status',{
      headers:{cookie:ssoCookie}
    })).status,401);
    console.log('DESKTOP_WALL_SSO_T04B9C3B1_LOOPBACK_CHALLENGE_LEGACY_404_OWNER_REVOKE_PASS');
  }finally{await wall.close();}
}
await run();
