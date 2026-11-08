// Owner account portal proxy for session nickname metadata, default OFF.
// Browser cannot choose accountId, Agent or any grant identity.
const ID=/^[A-Za-z0-9._:-]{1,128}$/;
export function createGoldSessionNameAccountProxy({enabled=false,origin,
 sessionToken,callOperatorJson}={}){
 if(enabled&&(!/^https:\/\/[^/]+$/.test(String(origin||''))||
  typeof sessionToken!=='function'||typeof callOperatorJson!=='function'))
  throw Error('session_name_portal_dependencies_missing');
 return async(req,res,action)=>{
  if(!['sessions-list','session-rename'].includes(action))return false;
  const reply=(status,data)=>res.status(status).set('Cache-Control','no-store').json(data);
  if(!enabled)return reply(404,{ok:false,error:'not_found'});
  const mutation=action==='session-rename';
  if(req.method!==(mutation?'POST':'GET'))
   return reply(405,{ok:false,error:'method_not_allowed'});
  const token=sessionToken(req);
  if(typeof token!=='string'||token.length<20)
   return reply(401,{ok:false,error:'account_session_required'});
  const headers={'x-light-account-session':token};
  let path='/v1/accounts/session-names',body=null;
  if(mutation){
   if(req.headers?.origin!==origin||req.headers?.['sec-fetch-site']==='cross-site')
    return reply(403,{ok:false,error:'session_name_cross_origin_denied'});
   const sessionId=String(req.body?.sessionId||'');
   const displayName=req.body?.displayName;
   if(!ID.test(sessionId)||typeof displayName!=='string'||
      displayName.length<3||displayName.length>96)
    return reply(400,{ok:false,error:'session_name_payload_invalid'});
   const csrf=String(req.headers?.['x-light-session-name-csrf']||'');
   if(!/^[A-Za-z0-9_-]{43}$/.test(csrf))
    return reply(403,{ok:false,error:'session_name_csrf_required'});
   headers['origin']=origin;headers['sec-fetch-site']='same-origin';
   headers['x-light-session-name-csrf']=csrf;
   path+='/'+encodeURIComponent(sessionId);
   body={displayName};
  }
  return reply(200,await callOperatorJson(req.method,path,body,headers));
 };
}
