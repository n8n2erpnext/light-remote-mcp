/**
 * T04b9c1: explicit Gold Plugin public -> Operator signed Wall SSO redeem bridge.
 *
 * Deliberately NOT in the generic /device-channel/:action whitelist.
 * Gate is checked before JSON parsing, so OFF returns 404 without consuming
 * a caller-controlled body. ON is only possible with all six independent
 * GoldABV2 Desktop SSO flags. Even ON, the real Operator validates enrolled
 * Ed25519 signature once, current Owner family and Redis GETDEL ticket.
 * This route NEVER issues tickets, Wall cookies, A/B grants or Owner tokens.
 */
import crypto from 'node:crypto';
import {desktopWallSsoIssuerEnabledV4}
  from './desktop-wall-sso-native-router-v4.mjs';

export const DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4=
  '/device-channel/desktop-wall-sso-redeem';
export const DESKTOP_WALL_SSO_OPERATOR_REDEEM_PATH_V4=
  '/v1/device-channel/desktop-wall-sso-redeem';
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const NONCE=/^[A-Za-z0-9_-]{16,128}$/;
const SIG=/^[A-Za-z0-9_-]{64,128}$/;
const SHA=/^[a-f0-9]{64}$/;
const FAMILY=/^[A-Za-z0-9_-]{43}$/;
const PURPOSE='wall_local_session_authority_v1';
const exact=(value,keys)=>value&&typeof value==='object'&&
  !Array.isArray(value)&&Object.keys(value).length===keys.length&&
  Object.keys(value).every(k=>keys.includes(k));
const valid=(re,value)=>typeof value==='string'&&re.test(value);
const unavailable=(res,status=403)=>res.status(status).json({
  ok:false,error:'desktop_wall_sso_denied'
});
const safeEqual=(left,right)=>valid(SHA,left)&&valid(SHA,right)&&
  crypto.timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'));

export function publicWallSsoSignedRequestV4(value){
  if(!exact(value,['ticket','signedEnvelope'])||!valid(TOKEN,value.ticket))return false;
  const e=value.signedEnvelope;
  if(!exact(e,['deviceId','timestamp','nonce','signature','payload'])||
     !valid(ID,e.deviceId)||!Number.isSafeInteger(e.timestamp)||
     !valid(NONCE,e.nonce)||!valid(SIG,e.signature)||
     !exact(e.payload,['ticketDigest'])||!valid(SHA,e.payload.ticketDigest))
    return false;
  return safeEqual(
    crypto.createHash('sha256').update(value.ticket,'utf8').digest('hex'),
    e.payload.ticketDigest
  );
}
export function registerDesktopWallSsoPublicRedeemV4(app,{
  env={},operatorCall,rateAllow
}={}){
  if(typeof app?.post!=='function')throw new TypeError('sso_router_required');
  const enabled=desktopWallSsoIssuerEnabledV4(env);
  if(enabled&&(typeof operatorCall!=='function'||typeof rateAllow!=='function'))
    throw new Error('desktop_wall_sso_public_transport_unavailable');
  // The Plugin server applies the exact route's 2-KiB parser BEFORE its
  // global JSON middleware. OFF is also rejected before any body read.
  app.post(DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4,
    async(req,res)=>{
      res.set('Cache-Control','no-store');
      res.set('Referrer-Policy','no-referrer');
      res.set('X-Content-Type-Options','nosniff');
      if(!enabled)return res.status(404).json({ok:false,error:'not_found'});
      const headers=req.headers||{};
      const length=String(headers['content-length']||'');
      // No browser-origin/cookie request, content-encoding, streaming bodies
      // or URL query. Native Agent sends fixed-length JSON over verified TLS.
      if(req.method!=='POST'||String(req.originalUrl||req.url||'').includes('?')||
         headers.origin||headers.cookie||headers.referer||
         headers['sec-fetch-site']||headers['sec-fetch-mode']||
         headers['sec-fetch-dest']||headers['transfer-encoding']||
         headers['content-encoding']||
         String(headers['content-type']||'').trim()!=='application/json'||
         !/^\d{1,4}$/.test(length)||Number(length)>2048)
        return unavailable(res);
      if(!publicWallSsoSignedRequestV4(req.body))
        return unavailable(res,400);
      try{
        if(await rateAllow(req)!==true)return unavailable(res,429);
        // Operator authenticates device+Owner; Plugin must never verify its
        // signed nonce a second time or it would incorrectly burn replay.
        const out=await operatorCall('POST',
          DESKTOP_WALL_SSO_OPERATOR_REDEEM_PATH_V4,req.body);
        if(!exact(out,['ok','authority'])||out.ok!==true||
           !exact(out.authority,['purpose','accountId','deviceId','familyId'])||
           out.authority.purpose!==PURPOSE||
           !valid(ID,out.authority.accountId)||
           out.authority.deviceId!==req.body.signedEnvelope.deviceId||
           !valid(FAMILY,out.authority.familyId))
          return unavailable(res);
        return res.status(200).json(out);
      }catch{return unavailable(res);}
    }
  );
  return Object.freeze({enabled,routes:enabled?1:0});
}
