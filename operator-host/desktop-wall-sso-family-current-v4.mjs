/**
 * T04b9c2 — enrolled-device Ed25519 live Owner-family verification.
 * SOURCE-ONLY until explicitly enabled by the existing SSO Operator gate.
 *
 * Device signature only authenticates the current enrollment; Owner-family
 * authority comes from the independent Redis+Portal-session backend.
 * Never return a family identifier, Owner token, or A/B grant to the caller.
 */
export const WALL_SSO_FAMILY_CURRENT_ACTION_V4=
  'desktop-wall-sso-family-current';
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const ACCOUNT=/^[A-Za-z0-9._:-]{1,128}$/;
const FAMILY=/^[A-Za-z0-9_-]{43}$/;
const NONCE=/^[A-Za-z0-9_-]{16,128}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{64,128}$/;
const deny=()=>Object.assign(
  new Error('desktop_wall_sso_family_current_denied'),
  {code:'desktop_wall_sso_family_current_denied'}
);
const exact=(value,names)=>value&&typeof value==='object'&&
  !Array.isArray(value)&&Object.keys(value).length===names.length&&
  Object.keys(value).every(k=>names.includes(k));
const match=(reg,value)=>typeof value==='string'&&reg.test(value);

export function createDesktopWallSsoFamilyCurrentV4({
  enabled=false,enrollments,assertWallSessionCurrent
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,check:undefined});
  if(typeof enrollments?.verifyChannel!=='function'||
     typeof enrollments?.binding!=='function'||
     typeof assertWallSessionCurrent!=='function')
    throw new Error('desktop_wall_sso_family_current_unavailable');

  async function check(signedEnvelope){
    if(!exact(signedEnvelope,[
      'deviceId','timestamp','nonce','signature','payload'
    ])||!match(ID,signedEnvelope.deviceId)||
       !Number.isSafeInteger(signedEnvelope.timestamp)||
       !match(NONCE,signedEnvelope.nonce)||
       !match(SIGNATURE,signedEnvelope.signature)||
       !exact(signedEnvelope.payload,['accountId','deviceId','familyId'])||
       !match(ACCOUNT,signedEnvelope.payload.accountId)||
       !match(ID,signedEnvelope.payload.deviceId)||
       !match(FAMILY,signedEnvelope.payload.familyId)||
       signedEnvelope.payload.deviceId!==signedEnvelope.deviceId)
      throw deny();
    try{
      // One and ONLY one anti-replay verification. A second call to
      // verifiedChannelContext would consume the nonce incorrectly.
      const result=enrollments.verifyChannel(
        signedEnvelope,WALL_SSO_FAMILY_CURRENT_ACTION_V4,
        signedEnvelope.payload
      );
      const binding=result?.binding;
      if(binding?.revokedAt||
         binding?.deviceId!==signedEnvelope.deviceId||
         binding?.accountId!==signedEnvelope.payload.accountId)
        throw deny();
      const acceptedPublicKey=binding.publicIdentityKey;
      if(await assertWallSessionCurrent(signedEnvelope.payload)!==true)
        throw deny();
      // Avoid promoting an Owner-family status from a device that is
      // revoked/relinked while the asynchronous Owner lookup is in flight.
      const current=enrollments.binding(signedEnvelope.deviceId);
      if(current.revokedAt||current.deviceId!==binding.deviceId||
         current.accountId!==binding.accountId||
         current.publicIdentityKey!==acceptedPublicKey)
        throw deny();
      return Object.freeze({
        ok:true,current:true,deviceId:binding.deviceId
      });
    }catch{throw deny()}
  }
  return Object.freeze({enabled:true,check});
}
