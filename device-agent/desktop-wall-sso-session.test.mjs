import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDesktopWallSsoSession,DESKTOP_WALL_SSO_COOKIE,
  DESKTOP_WALL_SSO_SESSION_TTL_MS} from './desktop-wall-sso-session.mjs';

const TICKET='T'.repeat(43),FAMILY='F'.repeat(43);
const principal=Object.freeze({verified:true,purpose:'wall_local_session_authority_v1',
  accountId:'acct_01',deviceId:'dev_01',familyId:FAMILY});
function fixture(){
  let now=1000000,seed=1,valid=true,failCloud=false,redeems=0,checks=0;
  const make=()=>createDesktopWallSsoSession({
    redeemSignedTicket:async ticket=>{
      redeems++;assert.equal(ticket,TICKET);return principal;
    },
    verifyLiveOwnerFamily:async({accountId,deviceId,familyId})=>{
      checks++;assert.equal(accountId,principal.accountId);
      assert.equal(deviceId,principal.deviceId);
      assert.equal(familyId,principal.familyId);
      if(failCloud)throw Error('operator_offline');
      return valid;
    },
    clock:()=>now,
    random:size=>Buffer.alloc(size,seed++)
  });
  const svc=make();
  const req=cookie=>({headers:{cookie:cookie||''}});
  const c=async()=> (await svc.redeem(TICKET,{secure:false})).cookie;
  return {svc,make,req,c,advance:ms=>{now+=ms;},
    revoke:()=>{valid=false;},offline:()=>{failCloud=true;},
    checks:()=>checks,redeems:()=>redeems};
}
const naked=value=>`${DESKTOP_WALL_SSO_COOKIE}=${value}`;
const cookieOnly=header=>header.split(';',1)[0];

test('T04b1 mint separate HttpOnly SameSite strict cookie, no desktop bearer',async()=>{
  const f=fixture();const row=await f.svc.redeem(TICKET,{secure:true});
  assert.equal(row.accountId,principal.accountId);
  assert.equal(row.expiresAt,1000000+DESKTOP_WALL_SSO_SESSION_TTL_MS);
  assert.match(row.cookie,/^lr_wall_desktop_sso_v4=v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43};/);
  assert.match(row.cookie,/HttpOnly/);assert.match(row.cookie,/SameSite=Strict/);
  assert.match(row.cookie,/Secure/);assert.match(row.cookie,/Max-Age=600/);
  assert.ok(!row.cookie.includes(FAMILY));
  assert.ok(!row.cookie.includes(TICKET));
  assert.ok(!row.cookie.includes('lr_wall_session='));
  assert.deepEqual(Object.keys(row).sort(),['accountId','cookie','expiresAt']);
});

test('valid new SSO cookie requires live family verification on every request',async()=>{
  const f=fixture(),cookie=cookieOnly(await f.c()),req=f.req(cookie);
  const one=await f.svc.identity(req);
  assert.deepEqual(one,{username:'acct_01',accountId:'acct_01',
    deviceId:'dev_01',desktopOwnerSso:true,expiresAt:1600000});
  assert.equal(f.checks(),1);
  assert.equal(await f.svc.identity(req)!==null,true);
  assert.equal(f.checks(),2);
});

test('Owner logout revokes verified device session immediately',async()=>{
  const f=fixture(),cookie=cookieOnly(await f.c()),req=f.req(cookie);
  assert.ok(await f.svc.identity(req));
  f.revoke();
  assert.equal(await f.svc.identity(req),null);
  assert.equal(req.desktopWallSsoVerified,null);
  assert.equal(await f.svc.identity(req),null);
  assert.equal(f.checks(),2,'revoked session is evicted from memory');
});

test('cloud unavailable cannot keep Wall session verified',async()=>{
  const f=fixture(),req=f.req(cookieOnly(await f.c()));
  assert.ok(await f.svc.identity(req));
  f.offline();
  assert.equal(await f.svc.identity(req),null);
});

test('cookie expires; a restart invalidates every session',async()=>{
  const f=fixture(),cookie=cookieOnly(await f.c()),req=f.req(cookie);
  assert.ok(await f.svc.identity(req));
  f.advance(600000);
  assert.equal(await f.svc.identity(req),null);
  const fresh=f.req(cookieOnly(await f.c()));
  assert.ok(await f.svc.identity(fresh));
  assert.equal(await f.make().identity(fresh),null);
});

test('forged/replayed cookie of wrong signature cannot authenticate',async()=>{
  const f=fixture(),raw=cookieOnly(await f.c());
  const altered=raw.slice(0,-1)+(raw.endsWith('A')?'B':'A');
  assert.equal(await f.svc.identity(f.req(altered)),null);
  assert.equal(await f.svc.identity(f.req(naked('bad'))),null);
  assert.equal(await f.svc.identity(f.req('')),null);
});

test('CSRF is bound to verified local SSO cookie and expires',async()=>{
  const f=fixture(),r=f.req(cookieOnly(await f.c()));
  assert.equal(f.svc.csrfForRequest(r),'','anonymous cannot mint mutation CSRF');
  assert.ok(await f.svc.identity(r));
  const csrf=f.svc.csrfForRequest(r);
  assert.match(csrf,/^v1\.[A-Za-z0-9_-]{43}\.[0-9]+\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(f.svc.verifyRequestCsrf(r,csrf),true);
  assert.equal(f.svc.verifyRequestCsrf(r,csrf.slice(0,-1)+'0'),false);
  const other=f.req(cookieOnly(await f.c()));
  assert.ok(await f.svc.identity(other));
  assert.equal(f.svc.verifyRequestCsrf(other,csrf),false);
  f.advance(300001);
  assert.equal(f.svc.verifyRequestCsrf(r,csrf),false);
});

test('CSRF requires fresh identity on this request, not just cookie value',async()=>{
  const f=fixture(),cookie=cookieOnly(await f.c()),r=f.req(cookie);
  assert.ok(await f.svc.identity(r));
  const csrf=f.svc.csrfForRequest(r);
  assert.equal(f.svc.verifyRequestCsrf(f.req(cookie),csrf),false);
});

test('local sign out destroys SSO cookie and its memory-only session',async()=>{
  const f=fixture(),r=f.req(cookieOnly(await f.c()));
  assert.ok(await f.svc.identity(r));
  const cleared=f.svc.logout(r,{secure:true});
  assert.match(cleared,/Max-Age=0/);
  assert.match(cleared,/Secure/);
  assert.equal(await f.svc.identity(r),null);
});

test('redeem rejects wrong authority even if ticket is syntactically valid',async()=>{
  const f=fixture();
  await assert.rejects(f.svc.redeem('no'),e=>e.code==='desktop_wall_sso_ticket_invalid');
  const service=createDesktopWallSsoSession({
    redeemSignedTicket:async()=>({...principal,verified:false}),
    verifyLiveOwnerFamily:async()=>true
  });
  await assert.rejects(service.redeem(TICKET),e=>e.code==='desktop_wall_sso_principal_invalid');
});

test('untrusted token or family details never ride in signed Wall cookie',async()=>{
  const f=fixture();
  const row=await f.svc.redeem(TICKET,{secure:false});
  assert.ok(!row.cookie.includes(principal.familyId));
  assert.ok(!row.cookie.includes(principal.accountId));
  assert.equal(f.redeems(),1);
});

test('memory sessions remain capped to 64 even after 80 valid redeems',async()=>{
  const f=fixture();let first=null,last=null;
  for(let i=0;i<80;i++){
    const row=await f.svc.redeem(TICKET);
    if(i===0)first=cookieOnly(row.cookie);
    if(i===79)last=cookieOnly(row.cookie);
  }
  assert.equal(await f.svc.identity(f.req(first)),null);
  assert.ok(await f.svc.identity(f.req(last)));
});

test('requires independent signed-ticket and live revocation adapters',()=>{
  assert.throws(()=>createDesktopWallSsoSession({redeemSignedTicket:async()=>principal}),
    e=>e.code==='desktop_wall_sso_session_unavailable');
  assert.throws(()=>createDesktopWallSsoSession({verifyLiveOwnerFamily:async()=>true}),
    e=>e.code==='desktop_wall_sso_session_unavailable');
});

test('T04b1 Wall route requires opt-in trusted agent adapters, not A/B',()=>{
  const wall=fs.readFileSync(new URL('./local-wall.mjs',import.meta.url),'utf8');
  const agent=fs.readFileSync(new URL('./operator-agent.mjs',import.meta.url),'utf8');
  assert.ok(wall.includes('desktopWallSso=null'));
  assert.ok(wall.includes("url.pathname==='/auth/desktop/sso/redeem'"));
  assert.ok(wall.includes('permanently seal legacy browser-ticket redemption'));
  assert.ok(wall.includes("desktopSsoBootstrap.finish(req)"));
  assert.equal(agent.includes('desktopWallSso:'),false);
});
