// Gold P2-I2e: owner account portal -> Operator A/B V2 pending, source only.
// Cookie session stays server-side. Optional owner B approval is gated OFF.
// No Helper-ready or independent A issuance.
// Separate feature gate (OFF by default) from Operator's own allowlist.
import {AB_V2_B_RE} from '../lib/gold-ab-v2-pending-redis.mjs';
const DEVICE_RE=/^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_RE=/^av2_[a-f0-9]{32}$/;
const CSRF_RE=/^[A-Za-z0-9_-]{43}$/;
const ACTIONS=new Map([
 ['abv2-csrf',{verb:'GET',resource:'csrf'}],
 ['abv2-pending',{verb:'GET',resource:'pending'}],
 ['abv2-view',{verb:'GET',resource:'pending',request:true}],
 ['abv2-refresh',{verb:'POST',resource:'pending',request:true,verbAction:'refresh'}],
 ['abv2-deny',{verb:'POST',resource:'pending',request:true,verbAction:'deny'}],
 ['abv2-approve',{verb:'POST',resource:'pending',request:true,verbAction:'approve'}]
]);
export function isGoldAbV2PortalAction(value){return ACTIONS.has(String(value||''));}
export function createGoldAbV2AccountPortalProxy({
 enabled=false,approveEnabled=false,publicOrigin,sessionToken,callOperatorJson
}={}){
 if(typeof sessionToken!=='function'||typeof callOperatorJson!=='function'||
   (enabled&&!(typeof publicOrigin==='string'&&/^https:\/\/[^/]+$/.test(publicOrigin))))
  throw Error('abv2_account_portal_dependencies_invalid');
 return async(req,res,action)=>{
  const route=ACTIONS.get(String(action||''));
  if(!route)return false;
  const reply=(status,payload)=>res.status(status).set('Cache-Control','no-store').json(payload);
  if(!enabled||(route.verbAction==='approve'&&!approveEnabled))
   return reply(404,{ok:false,error:'not_found'});
  if(req.method!==route.verb)return reply(405,{ok:false,error:'method_not_allowed'});
  const deviceId=String(route.verb==='GET'?req.query?.deviceId:req.body?.deviceId||'');
  if(!DEVICE_RE.test(deviceId))return reply(400,{ok:false,error:'abv2_device_invalid'});
  const requestId=route.request?String(route.verb==='GET'?req.query?.requestId:req.body?.requestId||''):'';
  if(route.request&&!REQUEST_RE.test(requestId))
   return reply(400,{ok:false,error:'abv2_request_invalid'});
  if(route.verbAction){
   // Force an actual browser Origin; legacy sameOriginMutation permits it
   // to be absent for CLI callers and is NOT adequate for this owner flow.
   if(req.headers?.origin!==publicOrigin||
     req.headers?.['sec-fetch-site']==='cross-site')
    return reply(403,{ok:false,error:'abv2_cross_origin_denied'});
  }
  const token=sessionToken(req);
  if(typeof token!=='string'||token.length<20||token.length>4096)
   return reply(401,{ok:false,error:'account_session_required'});
  const target='/v1/accounts/ab-v2/devices/'+encodeURIComponent(deviceId)+'/'+route.resource+
   (route.request?'/'+encodeURIComponent(requestId):'')+
   (route.verbAction?'/'+route.verbAction:'');
  const headers={
   'x-light-account-session':token,
   ...(route.verbAction?{'origin':publicOrigin,'sec-fetch-site':'same-origin'}:{})
  };
  let body=null;
  if(route.verbAction){
   const csrf=String(req.headers?.['x-light-abv2-csrf']||'');
   if(!CSRF_RE.test(csrf))return reply(403,{ok:false,error:'abv2_csrf_required'});
   headers['x-light-abv2-csrf']=csrf;
   if(route.verbAction==='approve'){
    const attempt=req.body?.expectedAttempt,bCode=String(req.body?.bCode||'');
    if(!Number.isSafeInteger(attempt)||attempt<1||
       !AB_V2_B_RE.test(bCode))
     return reply(400,{ok:false,error:'abv2_owner_b_invalid'});
    body={expectedAttempt:attempt,bCode};
   }else if(route.verbAction==='refresh'){
    const expectedAttempt=req.body?.expectedAttempt;
    if(!Number.isSafeInteger(expectedAttempt)||expectedAttempt<1)
     return reply(400,{ok:false,error:'abv2_attempt_invalid'});
    body={expectedAttempt};
   }else body={};
  }
  // No client-supplied accountId, agentId, connectionId, ownerId or policy
  // forwarded. The Operator reauthenticates the cookie-derived session.
  const data=await callOperatorJson(route.verb,target,body,headers);
  return reply(200,route.verbAction?data:{...data,
   ...(action==='abv2-pending'?{ownerApproveEnabled:Boolean(approveEnabled)}:{})});
 };
}
