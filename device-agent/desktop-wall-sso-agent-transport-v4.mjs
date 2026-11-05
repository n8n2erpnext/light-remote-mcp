/**
 * T04b9c1 — GoldABV2 Lab-only Agent HTTPS signed ticket redemption.
 *
 * PRIVATE Agent module, not imported by the live Agent runtime. A caller must
 * be the existing enrolled Device Agent, never a web page. The URL is an
 * immutable HTTPS Lab endpoint, NOT supplied by the Owner, browser or Agent
 * request. TLS certificate verification is performed by Node fetch.
 *
 * Neither this transport nor its caller can mint the Ed25519 proof. The
 * enrolled signer supplies it; the Operator verifies it exactly ONCE.
 */
import {createDesktopWallSsoAgentRedemptionV4}
  from './desktop-wall-sso-agent-redemption-v4.mjs';
import crypto from 'node:crypto';

export const GOLDABV2_AGENT_SSO_REDEEM_URL=
  'https://goldabv2.light-remote.thaiduy.digital/device-channel/desktop-wall-sso-redeem';
const TICKET=/^[A-Za-z0-9_-]{43}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const DEVICE=/^[A-Za-z0-9._:-]{1,160}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{64,128}$/;
const NONCE=/^[A-Za-z0-9_-]{16,128}$/;
const MAX_BODY=2048;
const TIMEOUT_MS=8000;
const fail=()=>Object.assign(new Error('desktop_wall_sso_agent_transport_denied'),{
  code:'desktop_wall_sso_agent_transport_denied'
});
const exact=(row,keys)=>row&&typeof row==='object'&&
  !Array.isArray(row)&&Object.keys(row).length===keys.length&&
  Object.keys(row).every(k=>keys.includes(k));
const valid=(re,v)=>typeof v==='string'&&re.test(v);

export function createDesktopWallSsoAgentHttpsTransportV4({
  fetchImpl=fetch
}={}){
  if(typeof fetchImpl!=='function')throw fail();
  async function sendSignedRedeem(request){
    if(!exact(request,['ticket','signedEnvelope'])||
       !valid(TICKET,request.ticket)||
       !exact(request.signedEnvelope,[
         'deviceId','timestamp','nonce','signature','payload'
       ])||
       !valid(DEVICE,request.signedEnvelope.deviceId)||
       !Number.isSafeInteger(request.signedEnvelope.timestamp)||
       !valid(NONCE,request.signedEnvelope.nonce)||
       !valid(SIGNATURE,request.signedEnvelope.signature)||
       !exact(request.signedEnvelope.payload,['ticketDigest'])||
       !valid(DIGEST,request.signedEnvelope.payload.ticketDigest)||
       crypto.createHash('sha256').update(request.ticket,'utf8')
         .digest('hex')!==request.signedEnvelope.payload.ticketDigest)
      throw fail();
    const serialized=JSON.stringify(request);
    if(Buffer.byteLength(serialized,'utf8')>MAX_BODY)throw fail();
    try{
      const response=await fetchImpl(GOLDABV2_AGENT_SSO_REDEEM_URL,{
        method:'POST',headers:{
          'content-type':'application/json',
          'accept':'application/json'
        },
        body:serialized,
        redirect:'error',
        credentials:'omit',
        cache:'no-store',
        referrerPolicy:'no-referrer',
        signal:AbortSignal.timeout(TIMEOUT_MS)
      });
      if(response?.status!==200||response?.ok!==true||
         response.redirected===true||
         !String(response.headers?.get('content-type')||'')
           .toLowerCase().startsWith('application/json')||
         Number(response.headers?.get('content-length')||0)>MAX_BODY||
         !response.body||typeof response.body[Symbol.asyncIterator]!=='function')
        throw fail();
      const chunks=[];let total=0;
      for await (const part of response.body) {
        total+=part.length;
        if(total>MAX_BODY)throw fail();
        chunks.push(Buffer.from(part));
      }
      const value=JSON.parse(Buffer.concat(chunks,total).toString('utf8'));
      if(!exact(value,['ok','authority'])||value.ok!==true||
         !exact(value.authority,['purpose','accountId','deviceId','familyId']))
        throw fail();
      return value;
    }catch{throw fail();}
  }
  return Object.freeze({sendSignedRedeem});
}

// This composition is not wired into operator-agent.mjs or Local Wall yet:
// no browser can trigger it and no live Owner ticket is requested.
export function createGoldAbv2AgentWallSsoBridgeV4({
  readEnrollment,signChannel,fetchImpl,clock=Date.now
}={}){
  const transport=createDesktopWallSsoAgentHttpsTransportV4({fetchImpl});
  return createDesktopWallSsoAgentRedemptionV4({
    readEnrollment,signChannel,clock,
    sendSignedRedeem:transport.sendSignedRedeem
  });
}
