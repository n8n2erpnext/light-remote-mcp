/**
 * T04b9b — private enrolled-Agent signed SSO redemption adapter.
 *
 * Source-only. It MUST be wired exclusively inside a trusted Device Agent,
 * where the Ed25519 signing key already lives. This module does not expose
 * HTTP, UI, Tauri IPC, cookies, credentials, or device policies.
 *
 * The transport callback must target ONLY the private Operator signed SSO
 * route through an independently authenticated Unix socket or verified HTTPS.
 * It is not a normal channelRequest() call: the Operator expects the exact
 * {ticket,signedEnvelope} envelope and verifies Ed25519 ONCE.
 */
import crypto from 'node:crypto';

const TICKET=/^[A-Za-z0-9_-]{43}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const FAMILY=/^[A-Za-z0-9_-]{43}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const NONCE=/^[A-Za-z0-9_-]{16,128}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{64,128}$/;
const ACTION='desktop-wall-sso-redeem';
const PURPOSE='wall_local_session_authority_v1';
const deny=()=>Object.assign(new Error('desktop_wall_sso_agent_redeem_denied'),{
  code:'desktop_wall_sso_agent_redeem_denied'
});
const exact=(item,fields)=>item!==null&&typeof item==='object'&&
  !Array.isArray(item)&&Object.keys(item).length===fields.length&&
  Object.keys(item).every(k=>fields.includes(k));
const valid=(pattern,value)=>typeof value==='string'&&pattern.test(value);

export function createDesktopWallSsoAgentRedemptionV4({
  readEnrollment,signChannel,sendSignedRedeem,clock=Date.now
}={}){
  if(typeof readEnrollment!=='function'||typeof signChannel!=='function'||
     typeof sendSignedRedeem!=='function'||typeof clock!=='function')
    throw deny();

  async function redeem(ticket){
    if(!valid(TICKET,ticket))throw deny();
    try {
    const enrollment=readEnrollment();
    const accountId=enrollment?.accountId,deviceId=enrollment?.deviceId;
    if(enrollment?.revoked===true||!valid(ID,accountId)||!valid(ID,deviceId))
      throw deny();
    const ticketDigest=crypto.createHash('sha256').update(ticket,'utf8').digest('hex');
    const payload=Object.freeze({ticketDigest});
    const envelope=await signChannel(ACTION,payload);
    // Signer is the existing private enrollment identity. Any attempt to
    // alter its payload, inject Agent/B grants or use another device fails.
    const now=clock();
    if(!Number.isSafeInteger(now)||now<0||
       !exact(envelope,['deviceId','timestamp','nonce','signature','payload'])||
       envelope.deviceId!==deviceId||
       !Number.isSafeInteger(envelope.timestamp)||
       Math.abs(now-envelope.timestamp)>60_000||
       !valid(NONCE,envelope.nonce)||!valid(SIGNATURE,envelope.signature)||
       !exact(envelope.payload,['ticketDigest'])||
       !valid(DIGEST,envelope.payload.ticketDigest)||
       envelope.payload.ticketDigest!==ticketDigest)
      throw deny();
    const response=await sendSignedRedeem({ticket,signedEnvelope:envelope});
    if(!exact(response,['ok','authority'])||response.ok!==true||
       !exact(response.authority,['purpose','accountId','deviceId','familyId'])||
       response.authority.purpose!==PURPOSE||
       response.authority.accountId!==accountId||
       response.authority.deviceId!==deviceId||
       !valid(FAMILY,response.authority.familyId))
      throw deny();
    // An enrollment changed/revoked during the async one-time redemption
    // cannot become a stale Wall session authority.
    const current=readEnrollment();
    if(current?.revoked===true||current?.accountId!==accountId||
       current?.deviceId!==deviceId)
      throw deny();
    // Only the trusted Local Wall may receive this principal. The browser
    // must NEVER receive ticket, nonce, signature, familyId or raw proof.
    return Object.freeze({
      verified:true,purpose:PURPOSE,
      accountId,deviceId,familyId:response.authority.familyId
    });
    }catch { throw deny(); }
  }
  return Object.freeze({redeem});
}
