/**
 * T04b1 — revocable, device-local Desktop Owner -> Wall session.
 * SOURCE ONLY. This does not register HTTP routes or activate a feature.
 *
 * Separate namespace from lr_wall_session (password/account Wall login).
 * A verified signed-device ticket redemption supplies authority. Each Wall
 * request independently checks live Owner family AND current device binding;
 * an unreachable cloud fails closed instead of extending a login. No Desktop
 * access/refresh credential is ever accepted or stored.
 */
import crypto from 'node:crypto';

export const DESKTOP_WALL_SSO_COOKIE='lr_wall_desktop_sso_v4';
export const DESKTOP_WALL_SSO_SESSION_TTL_MS=10*60_000;
const SSO_TICKET=/^[A-Za-z0-9_-]{43}$/;
const ACCOUNT=/^[A-Za-z0-9._:-]{1,128}$/;
const DEVICE=/^[A-Za-z0-9._:-]{1,160}$/;
const SECRET=/^[A-Za-z0-9_-]{43}$/;
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
const constantEqual=(a,b)=>{
  const l=Buffer.from(String(a)),r=Buffer.from(String(b));
  return l.length===r.length && crypto.timingSafeEqual(l,r);
};
const valid=(regex,v)=>regex.test(String(v||''));
const cookieToken=req=>{
  const all=String(req?.headers?.cookie||'');
  for(const part of all.split(';')){
    const [key,value]=part.trim().split('=',2);
    if(key===DESKTOP_WALL_SSO_COOKIE)return String(value||'');
  }
  return '';
};
function cookieHeader(token,maxAge,secure){
  return `${DESKTOP_WALL_SSO_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; ${secure?'Secure; ':''}SameSite=Strict; Priority=High`;
}
export function createDesktopWallSsoSession({
  redeemSignedTicket,verifyLiveOwnerFamily,clock=Date.now,
  random=crypto.randomBytes,ttlMs=DESKTOP_WALL_SSO_SESSION_TTL_MS
}={}){
  if(typeof redeemSignedTicket!=='function'||
     typeof verifyLiveOwnerFamily!=='function'||typeof clock!=='function'||
     typeof random!=='function'||!Number.isSafeInteger(ttlMs)||
     ttlMs<60000||ttlMs>DESKTOP_WALL_SSO_SESSION_TTL_MS)
    throw fail('desktop_wall_sso_session_unavailable');
  const secret=random(32);
  if(!Buffer.isBuffer(secret)||secret.length!==32)
    throw fail('desktop_wall_sso_session_unavailable');
  // Memory-only bounded ring: restart invalidates all SSO sessions, and
  // even a burst of valid ticket redemptions cannot grow device RAM forever.
  const sessions=new Map();
  const MAX_SESSIONS=64;
  const hmac=body=>crypto.createHmac('sha256',secret)
    .update('desktop-wall-sso-v4:'+body).digest('base64url');
  const mint=()=>{
    const b=random(32);
    if(!Buffer.isBuffer(b)||b.length!==32)
      throw fail('desktop_wall_sso_session_unavailable');
    return b.toString('base64url');
  };
  const parse=req=>{
    const value=cookieToken(req),parts=value.split('.');
    if(parts.length!==3||parts[0]!=='v1'||!valid(SECRET,parts[1])||
       !valid(SECRET,parts[2])||
       !constantEqual(parts[2],hmac(parts[1])))return null;
    return {key:sha(value),value};
  };
  function csrfForRequest(req){
    const parsed=parse(req);
    if(!parsed||!req.desktopWallSsoVerified)return '';
    const nonce=mint(),expiresAt=clock()+5*60_000;
    const body=`v1.${nonce}.${expiresAt}.${parsed.key}`;
    return `${body}.${hmac('csrf:'+body)}`;
  }
  function verifyRequestCsrf(req,csrf){
    const parsed=parse(req);
    if(!parsed||!req.desktopWallSsoVerified)return false;
    const parts=String(csrf||'').split('.');
    if(parts.length!==5||parts[0]!=='v1'||!valid(SECRET,parts[1])||
       !Number.isSafeInteger(Number(parts[2]))||Number(parts[2])<=clock()||
       Number(parts[2])>clock()+5*60_000||parts[3]!==parsed.key||
       !valid(SECRET,parts[4]))return false;
    return constantEqual(parts[4],hmac('csrf:'+parts.slice(0,4).join('.')));
  }
  // The caller must enforce JSON/form provenance (same origin + no referrer)
  // and never return ticket or signed proof to a browser response.
  async function redeem(ticket,{secure=false}={}){
    if(!valid(SSO_TICKET,ticket))throw fail('desktop_wall_sso_ticket_invalid');
    const principal=await redeemSignedTicket(ticket);
    if(principal?.verified!==true||
       principal?.purpose!=='wall_local_session_authority_v1'||
       !valid(ACCOUNT,principal?.accountId)||!valid(DEVICE,principal?.deviceId)||
       !valid(SECRET,principal?.familyId))
      throw fail('desktop_wall_sso_principal_invalid');
    const now=clock(),expiresAt=now+ttlMs;
    if(!Number.isSafeInteger(now)||!Number.isSafeInteger(expiresAt))
      throw fail('desktop_wall_sso_session_unavailable');
    const nonce=mint();
    const value=`v1.${nonce}.${hmac(nonce)}`;
    const key=sha(value);
    for(const [k,row] of sessions){if(row.expiresAt<=now)sessions.delete(k);}
    while(sessions.size>=MAX_SESSIONS)sessions.delete(sessions.keys().next().value);
    sessions.set(key,Object.freeze({
      accountId:principal.accountId,deviceId:principal.deviceId,
      familyId:principal.familyId,expiresAt
    }));
    return Object.freeze({
      cookie:cookieHeader(value,Math.ceil(ttlMs/1000),secure===true),
      expiresAt,accountId:principal.accountId
    });
  }
  async function identity(req){
    req.desktopWallSsoVerified=null;
    const parsed=parse(req);
    if(!parsed)return null;
    const row=sessions.get(parsed.key);
    if(!row)return null; // A service restart invalidates all SSO cookies.
    if(row.expiresAt<=clock()){sessions.delete(parsed.key);return null;}
    let verified=false;
    try{
      verified=(await verifyLiveOwnerFamily({
        accountId:row.accountId,deviceId:row.deviceId,familyId:row.familyId
      }))===true;
    }catch{verified=false}
    if(!verified){sessions.delete(parsed.key);return null;}
    // This is only a verified Owner identity, not an A/B grant or
    // privileged capability; routes still require their own consent.
    const principal=Object.freeze({
      username:row.accountId,accountId:row.accountId,
      deviceId:row.deviceId,desktopOwnerSso:true,
      expiresAt:row.expiresAt
    });
    req.desktopWallSsoVerified=principal;
    return principal;
  }
  function logout(req,{secure=false}={}){
    const parsed=parse(req);
    if(parsed)sessions.delete(parsed.key);
    req.desktopWallSsoVerified=null;
    return cookieHeader('',0,secure===true);
  }
  return Object.freeze({
    redeem,identity,csrfForRequest,verifyRequestCsrf,logout,
    cookieName:DESKTOP_WALL_SSO_COOKIE
  });
}
