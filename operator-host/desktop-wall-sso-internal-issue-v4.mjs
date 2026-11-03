/**
 * T04b7: internal-only ticket issue over Operator's mode-0660 Unix socket.
 * No browser credential, Agent A/B grant or public token endpoint.
 * Default OFF unless T04b6 explicitly injects the trusted issue callback.
 */
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const DEVICE=/^[A-Za-z0-9._:-]{1,160}$/;
const PURPOSE='desktop_wall_sso_v4';
const exact=(value,names)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const keys=Object.keys(value);
  return keys.length===names.length&&keys.every(k=>names.includes(k));
};
export async function handleDesktopWallSsoInternalIssueV4(
  req,res,{readJson,sendJson,issueTrusted}={}
){
  if(typeof sendJson!=='function')throw new TypeError('sendJson_required');
  if(typeof issueTrusted!=='function')
    return sendJson(res,404,{ok:false,error:'not_found'});
  // The Operator's Unix-socket request has no TCP remote peer. Even if a
  // future listener exposes the same dispatcher over TCP, deny fail-closed.
  if(req?.socket?.remoteAddress||req?.headers?.origin||
     req?.headers?.cookie||req?.headers?.referer||
     req?.headers?.['sec-fetch-site'])
    return sendJson(res,403,{ok:false,error:'wall_sso_internal_required'});
  res.setHeader?.('Cache-Control','no-store');
  let value;
  try{value=await readJson(req)}catch{
    return sendJson(res,400,{ok:false,error:'wall_sso_request_invalid'});
  }
  if(!exact(value,['accessToken','deviceId'])||
     !TOKEN.test(String(value.accessToken||''))||
     !DEVICE.test(String(value.deviceId||'')))
    return sendJson(res,400,{ok:false,error:'wall_sso_request_invalid'});
  try{
    const issued=await issueTrusted({
      accessToken:value.accessToken,deviceId:value.deviceId
    });
    if(!exact(issued,['ticket','expiresAt','deviceId','purpose'])||
       !TOKEN.test(String(issued.ticket||''))||
       !Number.isSafeInteger(issued.expiresAt)||
       issued.expiresAt<=Date.now()||
       issued.deviceId!==value.deviceId||issued.purpose!==PURPOSE)
      throw Error('invalid_issued_ticket');
    return sendJson(res,200,{
      ok:true,ticket:issued.ticket,expiresAt:issued.expiresAt,
      deviceId:issued.deviceId,purpose:issued.purpose
    });
  }catch{
    return sendJson(res,403,{ok:false,error:'wall_sso_issue_denied'});
  }
}
