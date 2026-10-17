/**
 * In Gold-independent Operator mode, forward only the canonical notification
 * endpoints to the authoritative Gold Core private socket. The Core checks
 * the PostgreSQL account session and the owner-provided admin verifier.
 * Never accepts a legacy JSON account session as substitute for a Gold token.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const paths=new Set([
 '/v1/accounts/notifications',
 '/v1/accounts/notifications/read',
 '/v1/admin/notifications',
 '/v1/admin/notifications/publish'
]);
const cancel=/^\/v1\/admin\/notifications\/sys_[0-9a-f-]{36}\/cancel$/;
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
 socketPath,transport=http.request,maxBodyBytes=32768,timeoutMs=4000}={}){
 if(!path.isAbsolute(String(socketPath||'')))
  throw Error('gold_notification_bridge_socket_required');
 if(!Number.isSafeInteger(maxBodyBytes)||maxBodyBytes<1024||maxBodyBytes>32768)
  throw Error('gold_notification_bridge_invalid_body_limit');
 return async(req,res,url)=>{
  const pathname=url?.pathname||new URL(req.url||'/', 'http://gold.operator').pathname;
  if(!paths.has(pathname)&&!cancel.test(pathname))return false;
  // No user-supplied accountId/groupId in query is ever transported.
  // The Core validates Authorization or a signed trusted admin verifier;
  // x-light-account-session (JSON legacy credential) is never forwarded.
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
  const bearer=String(req.headers.authorization||'');
  if(bearer)headers.authorization=bearer;
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
      res.writeHead(response.statusCode||503,{
       'content-type':contentType,'cache-control':'no-store',
       'x-content-type-options':'nosniff'});
      res.end(Buffer.concat(received));complete();
     });
    });
    upstream.on('timeout',()=>upstream.destroy(Error('gold_notification_core_timeout')));
    upstream.on('error',()=>{send(res,503,'gold_notification_core_unavailable');complete()});
    upstream.end(Buffer.concat(chunks));
   }catch{send(res,503,'gold_notification_core_unavailable');complete()}
  });
 };
}
