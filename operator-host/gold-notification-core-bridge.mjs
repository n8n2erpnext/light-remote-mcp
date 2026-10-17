/**
 * In Gold-independent Operator mode, forward only the canonical notification
 * endpoints to the authoritative Gold Core private socket. The Core checks
 * the PostgreSQL account session and the owner-provided admin verifier.
 * Never accepts a legacy JSON account session as substitute for a Gold token.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const accountPaths=new Set([
 '/v1/accounts/login',
 '/v1/accounts/me',
 '/v1/accounts/logout'
]);
const notificationPaths=new Set([
 '/v1/accounts/notifications',
 '/v1/accounts/notifications/read',
 '/v1/admin/notifications',
 '/v1/admin/notifications/publish'
]);
const cancel=/^\/v1\/admin\/notifications\/sys_[0-9a-f-]{36}\/cancel$/;
const legacyAccountPrefixes=[
 '/v1/plugin/accounts/','/v1/plugin/auth/','/v1/plugin/team/',
 '/v1/admin/overview','/v1/admin/accounts','/v1/admin/groups','/v1/admin/pending-registrations',
 '/v1/admin/upgrades','/v1/admin/dormancy','/v1/admin/licenses'
];
export const isUnmigratedGoldAccountAuthorityRoute=pathname=>
 legacyAccountPrefixes.some(prefix=>pathname===prefix.replace(/\/$/,'')||
  pathname.startsWith(prefix.endsWith('/')?prefix:prefix+'/'));
const send=(res,status,error)=>{
 if(res.headersSent){res.destroy();return}
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(JSON.stringify({ok:false,error}));
};
export function notificationCoreSocket(env=process.env){
 if(env.LIGHT_REMOTE_GOLD_INDEPENDENT!=='1')
  throw Error('gold_notification_bridge_independent_mode_required');
 const root=fs.realpathSync(String(env.LIGHT_REMOTE_GOLD_ROOT||''));
 const socket=String(env.LR_GOLD_CORE_SOCKET||'');
 if(!path.isAbsolute(socket)||socket===root||
   !path.resolve(socket).startsWith(root+path.sep))
  throw Error('gold_notification_core_socket_outside_root');
 const dir=fs.realpathSync(path.dirname(socket));
 if(dir!==root&&!dir.startsWith(root+path.sep))
  throw Error('gold_notification_core_socket_symlink_escape');
 if((fs.statSync(dir).mode&0o077)!==0)
  throw Error('gold_notification_core_parent_not_private');
 const stat=fs.lstatSync(socket);
 if(!stat.isSocket()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)
  throw Error('gold_notification_core_socket_not_private');
 return socket;
}
export function createGoldOperatorNotificationBridge({
 socketPath,transport=http.request,maxBodyBytes=32768,timeoutMs=4000,
 accountRoutes=false,notificationRoutes=true}={}){
 if(!path.isAbsolute(String(socketPath||'')))
  throw Error('gold_notification_bridge_socket_required');
 if(!Number.isSafeInteger(maxBodyBytes)||maxBodyBytes<1024||maxBodyBytes>32768)
  throw Error('gold_notification_bridge_invalid_body_limit');
 return async(req,res,url)=>{
  const pathname=url?.pathname||new URL(req.url||'/', 'http://gold.operator').pathname;
  // Fail closed for every Account route that is not yet migrated to Gold
  // Core. The old AccountRegistry persists for unrelated non-Gold routes,
  // but cannot become a hidden second Account authority in this opt-in mode.
  const matched=(accountRoutes&&accountPaths.has(pathname))||
   (notificationRoutes&&(notificationPaths.has(pathname)||cancel.test(pathname)));
  if(accountRoutes&&pathname.startsWith('/v1/accounts/')&&!matched)
   {send(res,503,'gold_account_route_not_migrated');return true}
  if(!matched)return false;
  // No user-supplied accountId/groupId in query is ever transported.
  // The Core validates Authorization or a signed trusted admin verifier;
  // x-light-account-session is NOT forwarded as trusted legacy identity:
  // only its opaque bytes may be tested as a PostgreSQL bearer by Core.
  let size=0;const chunks=[];
  try{
   for await(const chunk of req){
    size+=chunk.length;
    if(size>maxBodyBytes){send(res,413,'gold_notification_body_too_large');return true}
    chunks.push(chunk);
   }
  }catch{send(res,400,'gold_notification_request_invalid');return true}
  const headers={
   'content-type':String(req.headers['content-type']||'application/json'),
   'content-length':String(size)
  };
  const bearer=String(req.headers.authorization||'').trim();
  // Browser Account Portal currently sends x-light-account-session. In this
  // explicit Gold mode it is treated only as an opaque bearer candidate:
  // Gold Core performs the sole authoritative PostgreSQL token-hash check.
  // A stale JSON token is NOT trusted or looked up in JSON.
  const cookieSession=String(req.headers['x-light-account-session']||'').trim();
  if(bearer)headers.authorization=bearer;
  else if(cookieSession&&pathname!=='/v1/accounts/login')
   headers.authorization='Bearer '+cookieSession;
  // This is merely a transport for an owner-signed proof. The Gold Core's
  // verifyNotificationAdmin MUST validate cryptographic authenticity,
  // audience, scope and freshness; these bytes grant no privilege by themselves.
  const adminProof=String(req.headers['x-light-operator-admin-proof']||'');
  if(adminProof)headers['x-light-operator-admin-proof']=adminProof;
  return new Promise(resolve=>{
   let finished=false;
   const complete=()=>{if(!finished){finished=true;resolve(true)}};
   let upstream;
   try{
    upstream=transport({socketPath,path:pathname,method:req.method,
      headers,timeout:timeoutMs},response=>{
     let bytes=0;const received=[];
     response.on('data',chunk=>{
      bytes+=chunk.length;
      if(bytes>1048576){upstream.destroy(Error('gold_notification_response_too_large'));return}
      received.push(chunk);
     });
     response.on('error',()=>{send(res,503,'gold_notification_core_unavailable');complete()});
     response.on('end',()=>{
      if(finished)return;
      if(bytes>1048576){send(res,503,'gold_notification_core_unavailable');complete();return}
      const sourceType=String(response.headers['content-type']||'');
      const contentType=sourceType.startsWith('application/json')
       ?'application/json; charset=utf-8':'text/plain; charset=utf-8';
      const data=Buffer.concat(received);
      // Native Gold Core auth shapes deliberately differ from old Operator
      // Account Portal responses. Adapt only verified 2xx Core responses;
      // failed/unknown authentication always preserves denial unchanged.
      if(response.statusCode>=200&&response.statusCode<300&&
         contentType.startsWith('application/json')&&
         ['/v1/accounts/login','/v1/accounts/me','/v1/accounts/logout'].includes(pathname)){
       try{
        const parsed=JSON.parse(data.toString('utf8'));
        let output;
        if(pathname==='/v1/accounts/login'){
         if(typeof parsed.token!=='string'||parsed.token.length<20||
            !parsed.account?.accountId||!parsed.sessionId||!Number.isFinite(parsed.expiresAt))
          throw Error('gold_account_core_login_shape_invalid');
         output={ok:true,account:parsed.account,
          session:{sessionId:parsed.sessionId,expiresAt:parsed.expiresAt},
          token:parsed.token};
        }else if(pathname==='/v1/accounts/me'){
         if(!parsed.account?.accountId||!parsed.account?.sessionId)
          throw Error('gold_account_core_me_shape_invalid');
         const {sessionId,expiresAt,...account}=parsed.account;
         output={ok:true,account,session:{sessionId,expiresAt}};
        }else{
         if(typeof parsed.loggedOut!=='boolean')
          throw Error('gold_account_core_logout_shape_invalid');
         output={ok:true,loggedOut:parsed.loggedOut};
        }
        res.writeHead(response.statusCode,{
         'content-type':'application/json; charset=utf-8','cache-control':'no-store',
         'x-content-type-options':'nosniff'});
        res.end(JSON.stringify(output));complete();return;
       }catch{send(res,503,'gold_account_core_contract_invalid');complete();return}
      }
      res.writeHead(response.statusCode||503,{
       'content-type':contentType,'cache-control':'no-store',
       'x-content-type-options':'nosniff'});
      res.end(data);complete();
     });
    });
    upstream.on('timeout',()=>upstream.destroy(Error('gold_notification_core_timeout')));
    upstream.on('error',()=>{send(res,503,'gold_notification_core_unavailable');complete()});
    upstream.end(Buffer.concat(chunks));
   }catch{send(res,503,'gold_notification_core_unavailable');complete()}
  });
 };
}
