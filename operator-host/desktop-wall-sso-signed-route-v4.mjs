/**
 * T04b4 — bounded signed device-channel SSO redemption boundary.
 *
 * FEATURE DEFAULT OFF. The real Operator does not supply signedRedeem.
 * This is not a browser route, Account Portal session, Agent A/B grant,
 * Wall cookie, or native Desktop token exchange.
 *
 * IMPORTANT: the injected signedRedeem MUST validate the enrolled
 * Ed25519 device signature exactly ONCE using EnrollmentRegistry.verifyChannel.
 * Calling verifiedChannelContext before signedRedeem would consume the
 * anti-replay nonce and make a valid request fail the second verification.
 */
const TICKET=/^[A-Za-z0-9_-]{43}$/;
const HEX=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const FAMILY=/^[A-Za-z0-9_-]{43}$/;
const exact=(obj,fields)=>{
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return false;
  const keys=Object.keys(obj);
  return keys.length===fields.length&&keys.every(k=>fields.includes(k));
};
const denied={ok:false,error:'desktop_wall_sso_denied'};

export async function handleDesktopWallSsoSignedRedeemV4(
  req,res,{readJson,sendJson,signedRedeem}={}
){
  if(typeof sendJson!=='function')throw new TypeError('sendJson_required');
  // 404 before reading request body when feature disabled.
  if(typeof signedRedeem!=='function')
    return sendJson(res,404,{ok:false,error:'not_found'});
  if(typeof readJson!=='function')throw new TypeError('readJson_required');
  res.setHeader?.('Cache-Control','no-store');
  let input;
  try{input=await readJson(req)}catch{
    return sendJson(res,400,{ok:false,error:'desktop_wall_sso_request_invalid'});
  }
  if(!exact(input,['ticket','signedEnvelope'])||
     !TICKET.test(String(input.ticket||''))||
     !exact(input.signedEnvelope,[
       'deviceId','timestamp','nonce','signature','payload'
     ])||!exact(input.signedEnvelope.payload,['ticketDigest'])||
     !HEX.test(String(input.signedEnvelope.payload.ticketDigest||'')))
    return sendJson(res,400,{ok:false,error:'desktop_wall_sso_request_invalid'});

  // Only the injected backend (T04a authority + enrolled device proof)
  // may return a verified principal. The caller cannot set accountId or
  // deviceId as a source of truth. One-use ticket is atomically consumed
  // by that backend using Redis GETDEL.
  try{
    const principal=await signedRedeem({
      ticket:input.ticket,signedEnvelope:input.signedEnvelope
    });
    if(principal?.verified!==true||
       principal.purpose!=='wall_local_session_authority_v1'||
       !ID.test(String(principal.accountId||''))||
       !ID.test(String(principal.deviceId||''))||
       !FAMILY.test(String(principal.familyId||'')))
      return sendJson(res,403,denied);
    return sendJson(res,200,{
      ok:true,
      authority:{
        purpose:'wall_local_session_authority_v1',
        accountId:principal.accountId,deviceId:principal.deviceId,
        familyId:principal.familyId
      }
    });
  }catch{
    return sendJson(res,403,denied);
  }
}
