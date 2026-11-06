/**
 * T04a: isolated Desktop Owner -> Local Wall SSO ticket authority.
 *
 * SOURCE ONLY: not registered as an HTTP route, feature DEFAULT OFF.
 * Deployment must provide independent trusted adapters for: native HTTPS
 * Owner access inspection, enrolled-device binding, device-signed redemption,
 * and live Owner-family revocation. None of these are accepted from caller JSON.
 *
 * Desktop access/refresh tokens never travel to the HTTP Wall. A 256-bit,
 * hashed-in-Redis, 45-second, one-use transfer ticket is only an intermediary;
 * the Local Wall must independently issue a separate HttpOnly SameSite cookie
 * and check revocation on EVERY authenticated request before T04 can ship.
 */
import crypto from 'node:crypto';
import {DESKTOP_OWNER_RESOURCE,DESKTOP_OWNER_SCOPE} from './desktop-auth-v4-contract.mjs';

export const DESKTOP_WALL_TICKET_TTL_MS=45_000;
const TICKET=/^[A-Za-z0-9_-]{43}$/;
const ACCOUNT=/^[A-Za-z0-9._:-]{1,128}$/;
const DEVICE=/^[A-Za-z0-9._:-]{1,160}$/;
const HASH=/^[0-9a-f]{64}$/;
const PREFIX=/^lr:gold:[a-z0-9_-]+:$/;
const PURPOSE='desktop_wall_sso_v4';
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const error=code=>Object.assign(new Error(code),{code});
const valid=(pattern,value)=>pattern.test(String(value||''));

function keysOnly(input,allowed){
  return input && typeof input==='object' && !Array.isArray(input) &&
    Object.keys(input).every(k=>allowed.includes(k));
}
function nativePrincipal(row){
  if(row?.verified!==true||row?.isOwner!==true ||
     row?.resource!==DESKTOP_OWNER_RESOURCE ||row?.scope!==DESKTOP_OWNER_SCOPE ||
     !valid(ACCOUNT,row?.accountId)||!valid(TICKET,row?.familyId))
    throw error('wall_sso_owner_required');
  return row;
}
function deviceBinding(row,accountId,deviceId){
  if(row?.verified!==true||row?.enrolled!==true||row?.revoked===true ||
      row?.accountId!==accountId||row?.deviceId!==deviceId)
    throw error('wall_sso_device_mismatch');
}
export function createDesktopWallSsoV4({
  redis,prefix,inspectNativeAccess,verifyEnrolledDevice,verifySignedWallDevice,
  verifyOwnerFamilyCurrent,clock=Date.now,random=crypto.randomBytes
}={}){
  if(!redis||typeof redis.set!=='function'||typeof redis.getDel!=='function'||
     !valid(PREFIX,prefix)||![inspectNativeAccess,verifyEnrolledDevice,
       verifySignedWallDevice,verifyOwnerFamilyCurrent].every(fn=>typeof fn==='function')||
     typeof clock!=='function'||typeof random!=='function')
    throw error('wall_sso_authority_unavailable');
  const key=ticket=>prefix+'desktop-v4:wall-sso:'+digest(ticket);
  const now=()=>Number(clock());
  const token=()=>random(32).toString('base64url');

  // Called ONLY over native Desktop -> Gold HTTPS with an active Desktop
  // bearer. The device is validated in the authoritative enrollment registry.
  async function issue(input){
    if(!keysOnly(input,['accessToken','deviceId']) ||
       !valid(TICKET,input.accessToken)||!valid(DEVICE,input.deviceId))
      throw error('wall_sso_request_invalid');
    const owner=nativePrincipal(await inspectNativeAccess(input.accessToken));
    deviceBinding(await verifyEnrolledDevice(owner.accountId,input.deviceId),
      owner.accountId,input.deviceId);
    const ticket=token();
    if(!valid(TICKET,ticket))throw error('wall_sso_authority_unavailable');
    const expiresAt=now()+DESKTOP_WALL_TICKET_TTL_MS;
    const record={
      purpose:PURPOSE,accountId:owner.accountId,
      familyId:owner.familyId,deviceId:input.deviceId,expiresAt
    };
    const result=await redis.set(key(ticket),JSON.stringify(record),{
      EX:Math.ceil(DESKTOP_WALL_TICKET_TTL_MS/1000),NX:true
    });
    if(result!=='OK')throw error('wall_sso_authority_unavailable');
    return Object.freeze({
      ticket,expiresAt,deviceId:input.deviceId,
      purpose:PURPOSE
    });
  }

  // Called ONLY by a device-signed, server-verified channel. The signed
  // envelope MUST cover SHA256(ticket) and an anti-replay channel nonce.
  // The ticket is atomically consumed, even on principal mismatch.
  async function redeem(input){
    if(!keysOnly(input,['ticket','signedEnvelope'])||
       !valid(TICKET,input.ticket)||!input.signedEnvelope)
      throw error('wall_sso_request_invalid');
    const ticketHash=digest(input.ticket);
    const signed=await verifySignedWallDevice({
      signedEnvelope:input.signedEnvelope,ticketDigest:ticketHash
    });
    if(signed?.verified!==true||signed?.authentication!=='device_signed'||
       !valid(DEVICE,signed?.deviceId)||!valid(ACCOUNT,signed?.accountId)||
       !valid(HASH,signed?.ticketDigest)||signed.ticketDigest!==ticketHash)
      throw error('wall_sso_device_proof_required');
    const raw=await redis.getDel(key(input.ticket));
    if(!raw)throw error('wall_sso_ticket_expired_or_used');
    let row;
    try{row=JSON.parse(raw)}catch{throw error('wall_sso_ticket_invalid')}
    if(row?.purpose!==PURPOSE||row?.accountId!==signed.accountId||
       row?.deviceId!==signed.deviceId||!valid(TICKET,row?.familyId)||
       !Number.isSafeInteger(row?.expiresAt)||row.expiresAt<=now())
      throw error('wall_sso_ticket_invalid');
    deviceBinding(await verifyEnrolledDevice(row.accountId,row.deviceId),
      row.accountId,row.deviceId);
    if(await verifyOwnerFamilyCurrent(row.accountId,row.familyId)!==true)
      throw error('wall_sso_owner_revoked');
    // This is NOT a cookie or bearer. The Wall must mint its own scoped
    // session. Avoid access/refresh credentials in the response entirely.
    return Object.freeze({
      verified:true,purpose:'wall_local_session_authority_v1',
      accountId:row.accountId,deviceId:row.deviceId,familyId:row.familyId
    });
  }

  // Call this on EVERY protected Wall request, not only during redemption.
  // A Desktop logout or revoked Portal session then invalidates Wall access.
  async function assertWallSessionCurrent(input){
    if(!keysOnly(input,['accountId','deviceId','familyId']) ||
       !valid(ACCOUNT,input.accountId)||!valid(DEVICE,input.deviceId)||
       !valid(TICKET,input.familyId))
      throw error('wall_sso_session_invalid');
    deviceBinding(await verifyEnrolledDevice(input.accountId,input.deviceId),
      input.accountId,input.deviceId);
    if(await verifyOwnerFamilyCurrent(input.accountId,input.familyId)!==true)
      throw error('wall_sso_owner_revoked');
    return true;
  }
  return Object.freeze({issue,redeem,assertWallSessionCurrent});
}
