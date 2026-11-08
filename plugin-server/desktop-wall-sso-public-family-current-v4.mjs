/**
 * T04b9c2 — narrow signed Agent live Owner-family check transport.
 * Independent six-flag OFF -> 404 before body. Owner-family proof is
 * verified ONCE inside Operator; public Plugin only validates shape and
 * forwards to private Unix socket. No cookies, Owner credentials or A/B.
 */
import {desktopWallSsoIssuerEnabledV4}
  from './desktop-wall-sso-native-router-v4.mjs';

export const WALL_SSO_FAMILY_PUBLIC_PATH_V4=
  '/device-channel/desktop-wall-sso-family-current';
export const WALL_SSO_FAMILY_OPERATOR_PATH_V4=
  '/v1/device-channel/desktop-wall-sso-family-current';
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const ACCOUNT=/^[A-Za-z0-9._:-]{1,128}$/;
const FAMILY=/^[A-Za-z0-9_-]{43}$/;
const NONCE=/^[A-Za-z0-9_-]{16,128}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{64,128}$/;
const exact=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===names.length&&
  Object.keys(v).every(k=>names.includes(k));
const match=(re,s)=>typeof s==='string'&&re.test(s);
const denied=(res,status=403)=>res.status(status).json({
  ok:false,error:'desktop_wall_sso_family_current_denied'
});

export function validWallFamilySignedRequestV4(e){
  return exact(e,['deviceId','timestamp','nonce','signature','payload'])&&
    match(ID,e.deviceId)&&Number.isSafeInteger(e.timestamp)&&
    match(NONCE,e.nonce)&&match(SIGNATURE,e.signature)&&
    exact(e.payload,['accountId','deviceId','familyId'])&&
    match(ACCOUNT,e.payload.accountId)&&match(ID,e.payload.deviceId)&&
    match(FAMILY,e.payload.familyId)&&e.payload.deviceId===e.deviceId;
}
export function registerDesktopWallSsoPublicFamilyCurrentV4(app,{
  env={},operatorCall,rateAllow
}={}){
  if(typeof app?.post!=='function')throw TypeError('wall_sso_family_router_required');
  const enabled=desktopWallSsoIssuerEnabledV4(env);
  if(enabled&&(typeof operatorCall!=='function'||typeof rateAllow!=='function'))
    throw Error('wall_sso_family_transport_unavailable');
  app.post(WALL_SSO_FAMILY_PUBLIC_PATH_V4,async(req,res)=>{
    res.set('Cache-Control','no-store');
    res.set('Referrer-Policy','no-referrer');
    res.set('X-Content-Type-Options','nosniff');
    if(!enabled)return res.status(404).json({ok:false,error:'not_found'});
    const headers=req.headers||{},length=String(headers['content-length']||'');
    if(req.method!=='POST'||String(req.originalUrl||req.url||'').includes('?')||
       headers.origin||headers.cookie||headers.referer||
       headers['sec-fetch-site']||headers['sec-fetch-mode']||
       headers['sec-fetch-dest']||headers['transfer-encoding']||
       headers['content-encoding']||
       headers['content-type']!=='application/json'||
       !/^\d{1,4}$/.test(length)||Number(length)>2048||
       !validWallFamilySignedRequestV4(req.body))
      return denied(res,400);
    try{
      if(await rateAllow(req)!==true)return denied(res,429);
      const value=await operatorCall('POST',WALL_SSO_FAMILY_OPERATOR_PATH_V4,req.body);
      if(!exact(value,['ok','current','deviceId'])||value.ok!==true||
         value.current!==true||value.deviceId!==req.body.deviceId)
        return denied(res);
      return res.status(200).json(value);
    }catch{return denied(res);}
  });
  return Object.freeze({enabled,routes:enabled?1:0});
}
