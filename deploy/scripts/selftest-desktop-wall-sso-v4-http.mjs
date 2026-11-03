import assert from 'node:assert/strict';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

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
async function run(){
  const denied=start();
  try{
    if(!denied.server.listening)await new Promise(r=>denied.server.once('listening',r));
    const base='http://127.0.0.1:'+denied.server.address().port;
    const r=await fetch(base+'/auth/desktop/sso/redeem',{
      method:'POST',headers:{origin:base,'content-type':'application/json'},
      body:JSON.stringify({ticket:TICKET})
    });
    assert.equal(r.status,404,'disabled by default, no SSO route');
    assert.equal(r.headers.get('set-cookie'),null);
  }finally{await denied.close();}

  const wall=start({
    enabled:true,
    redeemSignedTicket:async ticket=>{
      redeemCalls++;assert.equal(ticket,TICKET);
      return {verified:true,purpose:'wall_local_session_authority_v1',
        accountId:'acct_01',deviceId:'dev_01',familyId:FAMILY};
    },
    verifyLiveOwnerFamily:async({accountId,deviceId,familyId})=>{
      liveChecks++;
      assert.deepEqual([accountId,deviceId,familyId],['acct_01','dev_01',FAMILY]);
      return active;
    }
  });
  try{
    if(!wall.server.listening)await new Promise(r=>wall.server.once('listening',r));
    const base='http://127.0.0.1:'+wall.server.address().port;
    const post=(headers,body=JSON.stringify({ticket:TICKET}))=>fetch(
      base+'/auth/desktop/sso/redeem',{
        method:'POST',headers:{'content-type':'application/json',...headers},body
      }
    );
    const noOrigin=await post({});
    assert.equal(noOrigin.status,403);
    const foreign=await post({origin:'https://evil.invalid','sec-fetch-site':'cross-site'});
    assert.equal(foreign.status,403);
    const spoofedTls=await post({origin:base.replace('http:','https:'),
      'x-forwarded-proto':'https','sec-fetch-site':'same-origin'});
    assert.equal(spoofedTls.status,403,'client spoofing X-Forwarded-Proto is not TLS');
    const wrongBody=await post({origin:base},{
      toString:()=>JSON.stringify({ticket:TICKET,agentId:'unauthorized'})
    }.toString());
    assert.equal(wrongBody.status,400);
    assert.equal(redeemCalls,0,'foreign origins cannot consume valid tickets');

    const result=await post({origin:base,'sec-fetch-site':'same-origin'});
    assert.equal(result.status,200);
    assert.equal(redeemCalls,1);
    const value=await result.json();
    assert.deepEqual(Object.keys(value).sort(),['expiresAt','ok']);
    assert.equal(value.ok,true);
    const cookie=result.headers.get('set-cookie');
    assert.match(cookie,/^lr_wall_desktop_sso_v4=v1\./);
    assert.match(cookie,/HttpOnly/);
    assert.match(cookie,/SameSite=Strict/);
    assert.doesNotMatch(cookie,/lr_wall_session=/);
    assert.ok(!cookie.includes(TICKET)&&!cookie.includes(FAMILY));
    const header=cookie.split(';')[0];
    const home=await fetch(base+'/',{headers:{cookie:header},redirect:'manual'});
    assert.equal(home.status,200,'verified new SSO cookie opens Wall');
    assert.ok(liveChecks>=1);
    active=false;
    const revoked=await fetch(base+'/',{headers:{cookie:header},redirect:'manual'});
    assert.equal(revoked.status,303,'revoked Owner does not retain Wall access');
    assert.match(revoked.headers.get('location'),/^\/login\?/);
    const protectedStatus=await fetch(base+'/api/status',{headers:{cookie:header}});
    assert.equal(protectedStatus.status,401);
    console.log('DESKTOP_WALL_SSO_T04B_LOOPBACK_HTTP_DEFAULT_OFF_ORIGIN_COOKIE_LIVE_REVOKE_PASS');
  }finally{await wall.close();}
}
await run();
