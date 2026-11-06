/**
 * T04b7b: independently gated Plugin native HTTPS -> trusted Operator
 * Unix socket Wall SSO ticket issue transport.
 *
 * NOT enabled for Gold Lab/UAT/prod by default. Never mistake a browser
 * User-Agent for native identity. The only authentication is the scoped
 * Owner bearer checked again against Redis/AccountRegistry in Operator.
 */
import crypto from 'node:crypto';
import {createDesktopWallSsoNativeIssueV4}
  from './desktop-wall-sso-native-issue-v4.mjs';
import {DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS,
  DESKTOP_WALL_SSO_ISSUER_FLAG_V4}
  from '../operator-host/desktop-wall-sso-operator-gate-v4.mjs';

export const DESKTOP_WALL_SSO_TICKET_PATH_V4=
  '/account/desktop/v4/wall-sso/ticket';
export const DESKTOP_WALL_SSO_INTERNAL_ISSUE_V4=
  '/v1/internal/desktop-wall-sso/issue';
export const DESKTOP_WALL_SSO_MAX_BODY_BYTES_V4=2048;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const HEX64=/^[0-9a-f]{64}$/;
const TTL=60_000;
const MAX_PER_OWNER_ACCESS=5;
const MAX_GLOBAL=100;
const MAX_TRACKED_TOKENS=512;
const fail=()=>{throw new Error('desktop_wall_sso_issue_denied');};

export function desktopWallSsoIssuerEnabledV4(env={}){
  if(!env||typeof env!=='object'||Array.isArray(env))return false;
  return [...DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS,
    DESKTOP_WALL_SSO_ISSUER_FLAG_V4]
    .every(flag=>env[flag]==='1');
}

/**
 * In-process bounded defense in depth: Gold Plugin has a single-writer
 * lease. Do not persist raw access tokens in memory as map keys.
 * Invalid credentials also consume the capped global budget; fail closed
 * on overload rather than allocating unbounded per-attacker Redis keys.
 */
export function createDesktopWallSsoIssueRateGateV4({clock=Date.now}={}){
  if(typeof clock!=='function')throw new TypeError('clock_required');
  let periodStart=null,overall=0;
  const buckets=new Map();
  function allow(accessToken){
    if(!TOKEN.test(String(accessToken||'')))return false;
    const now=Number(clock());
    if(!Number.isSafeInteger(now)||now<0)return false;
    if(periodStart===null||now<periodStart||now-periodStart>=TTL){
      periodStart=now;overall=0;buckets.clear();
    }
    if(overall>=MAX_GLOBAL)return false;
    const hashed=crypto.createHash('sha256')
      .update(accessToken,'utf8').digest('hex');
    if(!HEX64.test(hashed))return false;
    const calls=buckets.get(hashed)||0;
    if(calls>=MAX_PER_OWNER_ACCESS)return false;
    if(!buckets.has(hashed)&&buckets.size>=MAX_TRACKED_TOKENS)
      return false;
    buckets.set(hashed,calls+1);
    overall++;
    return true;
  }
  return Object.freeze({allow});
}

const exact=(row,keys)=>row&&typeof row==='object'&&
  !Array.isArray(row)&&Object.keys(row).length===keys.length&&
  Object.keys(row).every(key=>keys.includes(key));

export function registerDesktopWallSsoNativeIssuerV4(app,{
  env={},publicOrigin,proxyPeers=[],edgeProofSecret,operatorCall,clock=Date.now
}={}){
  if(!desktopWallSsoIssuerEnabledV4(env))
    return Object.freeze({enabled:false,routes:0});
  if(typeof app?.post!=='function'||typeof operatorCall!=='function')
    throw Error('desktop_wall_sso_issuer_transport_unavailable');
  const throttle=createDesktopWallSsoIssueRateGateV4({clock});
  const native=createDesktopWallSsoNativeIssueV4({
    enabled:true,publicOrigin,proxyPeers,edgeProofSecret,clock,
    issueTrusted:async({accessToken,deviceId})=>{
      if(!throttle.allow(accessToken))fail();
      // This fixed path is NEVER constructed from user input. Unix socket
      // transport and service identity belong to plugin-server/operator-client.
      const result=await operatorCall(
        'POST',DESKTOP_WALL_SSO_INTERNAL_ISSUE_V4,
        {accessToken,deviceId}
      );
      if(!exact(result,['ok','ticket','expiresAt','deviceId','purpose'])||
         result.ok!==true)
        fail();
      const {ticket,expiresAt,purpose}=result;
      return {ticket,expiresAt,deviceId:result.deviceId,purpose};
    }
  });
  app.post(DESKTOP_WALL_SSO_TICKET_PATH_V4,native.handler);
  return Object.freeze({enabled:true,routes:1});
}
