// P2-I3b: authenticated owner nickname override, source-only and default OFF.
// Not a new authority: the existing /account HttpOnly session is verified
// server-side; display metadata never changes sessionId, Agent or grant.
import crypto from 'node:crypto';
const PATH='/v1/accounts/session-names';
const SESSION=/^[A-Za-z0-9._:-]{1,128}$/;
const deny=(message,status=403)=>{throw Object.assign(Error(message),{status})};
function tokenCsrf(token){
 if(typeof token!=='string'||token.length<20)deny('session_name_owner_session_required',401);
 return crypto.createHmac('sha256',Buffer.from(token))
  .update('light-remote:owner:session-display-name:v1').digest('base64url');
}
export function createGoldSessionOwnerHttp({env=process.env,requireAccount,
 accountSessionToken,sessions,flushSessions,readJson,sendJson}={}){
 const enabled=env.LR_GOLD_SESSION_OWNER_RENAME==='1';
 if(enabled&&(env.LR_GOLD_SESSION_AGENT_NICKNAME!=='1'||!requireAccount||
    !accountSessionToken||!sessions||typeof flushSessions!=='function'||
    typeof readJson!=='function'||typeof sendJson!=='function'))
  deny('session_owner_rename_dependencies_unavailable',503);
 const origin=String(env.LR_GOLD_SESSION_OWNER_ORIGIN||'');
 if(enabled&&(!/^https:\/\/[^/]+$/.test(origin)))deny('session_owner_origin_required',503);
 return async(req,res,url)=>{
  const matched=url.pathname===PATH||
   url.pathname.startsWith(PATH+'/');
  if(!matched)return false;
  if(!enabled){sendJson(res,404,{ok:false,error:'not_found'});return true;}
  const id=url.pathname===PATH?null:decodeURIComponent(url.pathname.slice(PATH.length+1));
  if(id&&!SESSION.test(id)){sendJson(res,400,{ok:false,error:'session_id_invalid'});return true;}
  if((id&&req.method!=='POST')||(!id&&req.method!=='GET')){
   sendJson(res,405,{ok:false,error:'method_not_allowed'});return true;
  }
  try{
   const identity=requireAccount(req);
   const ownerId=identity?.account?.accountId;
   if(!ownerId)deny('session_name_owner_session_required',401);
   const token=accountSessionToken(req),csrf=tokenCsrf(token);
   if(!id){
    const owned=sessions.list().filter(x=>x.accountId===ownerId)
     .map(x=>({sessionId:x.sessionId,deviceId:x.deviceId,
      displayName:x.displayName||null,label:x.label||null,
      nameSource:x.nameSource||null,state:x.state,agentId:x.agentId}));
    sendJson(res,200,{ok:true,sessions:owned,csrf});return true;
   }
   if(req.headers?.origin!==origin||
      req.headers?.['sec-fetch-site']==='cross-site')
    deny('session_name_cross_origin_denied',403);
   const received=String(req.headers?.['x-light-session-name-csrf']||'');
   if(!/^[A-Za-z0-9_-]{43}$/.test(received)||
      !crypto.timingSafeEqual(Buffer.from(received),Buffer.from(csrf)))
    deny('session_name_csrf_denied',403);
   const body=await readJson(req);
   const session=sessions.get(id);
   if(session.accountId!==ownerId)deny('session_name_account_mismatch',403);
   const updated=sessions.setDisplayName(id,{accountId:ownerId,
    displayName:body?.displayName,source:'owner'});
   await flushSessions();
   sendJson(res,200,{ok:true,session:{sessionId:updated.sessionId,
    displayName:updated.displayName,nameSource:updated.nameSource,
    deviceId:updated.deviceId}});
  }catch(error){
   const status=[400,401,403,404,409,410,503].includes(error.status)?error.status:503;
   sendJson(res,status,{ok:false,error:status===503?'session_name_unavailable':error.message});
  }
  return true;
 };
}
