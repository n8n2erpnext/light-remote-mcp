/**
 * T04b3: adapters for the REAL enrolled Ed25519 device channel.
 * Source-only. Not mounted as an HTTP route and no agent auth is granted.
 * This code runs with the trusted Operator enrollment registry, never
 * with caller-supplied device/account identity.
 */
import crypto from 'node:crypto';

export const WALL_SSO_SIGNED_ACTION='desktop-wall-sso-redeem';
const HEX64=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const safeDigest=(a,b)=>{
  if(!HEX64.test(String(a||''))||!HEX64.test(String(b||'')))return false;
  return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
};
const deny=()=>Object.assign(new Error('wall_sso_signed_device_required'),{
  code:'wall_sso_signed_device_required'
});
const strictObject=(value,allowed)=>value&&typeof value==='object'&&
  !Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k));

export function createDesktopWallSsoDeviceProofV4({enrollments}={}){
  if(!enrollments||typeof enrollments.binding!=='function'||
     typeof enrollments.verifyChannel!=='function')
    throw Object.assign(new Error('wall_sso_enrollment_registry_required'),{
      code:'wall_sso_enrollment_registry_required'
    });

  async function verifyEnrolledDevice(accountId,deviceId){
    if(!ID.test(String(accountId||''))||!ID.test(String(deviceId||'')))
      return {verified:false,enrolled:false,revoked:true};
    try{
      const binding=enrollments.binding(deviceId);
      const eligible=binding.deviceId===deviceId &&
        binding.accountId===accountId && !binding.revokedAt;
      return Object.freeze({
        verified:Boolean(eligible),enrolled:Boolean(eligible),
        revoked:!eligible,accountId:binding.accountId,deviceId:binding.deviceId
      });
    }catch{return {verified:false,enrolled:false,revoked:true}}
  }
  // The envelope MUST be signed by the enrolled device Ed25519 identity.
  // EnrollmentRegistry.verifyChannel checks canonical action+payload hash,
  // timestamp skew, nonce replay, revocation and signature authenticity.
  async function verifySignedWallDevice({signedEnvelope,ticketDigest}={}){
    if(!strictObject(signedEnvelope,[
      'deviceId','timestamp','nonce','signature','payload'
    ])||!HEX64.test(String(ticketDigest||''))||
      !strictObject(signedEnvelope.payload,['ticketDigest'])||
      Object.keys(signedEnvelope.payload).length!==1||
      !safeDigest(signedEnvelope.payload.ticketDigest,ticketDigest))
      throw deny();
    try{
      const verified=enrollments.verifyChannel(
        signedEnvelope,WALL_SSO_SIGNED_ACTION,
        {ticketDigest}
      );
      const binding=verified?.binding;
      if(binding?.deviceId!==signedEnvelope.deviceId||
         !ID.test(String(binding?.accountId||''))||binding.revokedAt)
        throw deny();
      return Object.freeze({
        verified:true,authentication:'device_signed',
        accountId:binding.accountId,deviceId:binding.deviceId,ticketDigest
      });
    }catch{throw deny()}
  }
  return Object.freeze({verifyEnrolledDevice,verifySignedWallDevice});
}
