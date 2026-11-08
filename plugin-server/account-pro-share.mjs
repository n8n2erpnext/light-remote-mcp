// Owner/guest authenticated account proxy: Pro Share UAT UI, billing OFF.
const ACTIONS=Object.freeze({
 'pro-share-csrf':['GET','csrf'],
 'pro-share-overview':['GET','overview'],
 'pro-share-invite':['POST','invite'],
 'pro-share-accept':['POST','accept'],
 'pro-share-share':['POST','share'],
 'pro-share-revoke':['POST','revoke'],
 'pro-share-guest-pending':['GET','guest-pending'],
 'pro-share-guest-approve':['POST','guest-approve']
});
export const isProShareAccountAction=name=>Object.hasOwn(ACTIONS,name);
export function createGoldProShareAccountProxy({enabled=false,origin,sessionToken,
 callOperatorJson}={}){
 if(enabled&&(!/^https:\/\/[^/]+$/.test(String(origin||''))||
  typeof sessionToken!=='function'||typeof callOperatorJson!=='function'))
  throw Error('pro_share_proxy_configuration_invalid');
 return async(req,res,action)=>{
  if(!isProShareAccountAction(action))return false;
  const reply=(status,value)=>res.status(status).set('Cache-Control','no-store').json(value);
  if(!enabled)return reply(404,{ok:false,error:'not_found'});
  const [method,route]=ACTIONS[action];
  if(req.method!==method)return reply(405,{ok:false,error:'method_not_allowed'});
  const token=sessionToken(req);
  if(typeof token!=='string'||token.length<20)
   return reply(401,{ok:false,error:'account_session_required'});
  const headers={'x-light-account-session':token};
  let payload=null;
  let suffix='';
  if(route==='guest-pending'){
   const id=String(req.query?.deviceId||'');
   if(!/^[A-Za-z0-9._:-]{1,160}$/.test(id))
    return reply(400,{ok:false,error:'pro_share_device_invalid'});
   suffix='?deviceId='+encodeURIComponent(id);
  }
  if(method==='POST'){
   if(req.headers?.origin!==origin||req.headers?.['sec-fetch-site']==='cross-site')
    return reply(403,{ok:false,error:'pro_share_cross_origin_denied'});
   const csrf=String(req.headers?.['x-light-pro-share-csrf']||'');
   if(!/^[A-Za-z0-9_-]{43}$/.test(csrf))
    return reply(403,{ok:false,error:'pro_share_csrf_required'});
   headers.origin=origin;headers['sec-fetch-site']='same-origin';
   headers['x-light-pro-share-csrf']=csrf;
   const body=req.body||{};
   if(route==='invite')payload={guestEmail:body.guestEmail};
   if(route==='accept')payload={ownerAccountId:body.ownerAccountId,inviteCode:body.inviteCode};
   if(route==='share')payload={deviceId:body.deviceId};
   if(route==='revoke')payload={deviceId:body.deviceId,removeGuest:body.removeGuest===true};
   if(route==='guest-approve')payload={deviceId:body.deviceId,
    requestId:body.requestId,expectedAttempt:body.expectedAttempt,bCode:body.bCode};
  }
  const response=await callOperatorJson(method,'/v1/accounts/pro-share/'+route+suffix,
   payload,headers);
  return reply(200,response);
 };
}
