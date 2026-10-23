/* Dedicated Projects WebUI for isolated Linux Server UAT.
 * Local HTTP listener only; LXD proxy binds the host's NetBird interface.
 * No cloud registration and no direct SQLite or privileged shell endpoints.
 */
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {loadLocalWallAuth,LOCAL_WALL_COOKIE} from './local-wall-auth.mjs';
import {continuityProjectsPage} from './project-continuity-page.mjs';
import {projectContinuityRequest,projectContinuityOwnerConsent} from './project-continuity-client.mjs';

const PORT=Number(process.env.LIGHT_REMOTE_CONTINUITY_UAT_WEB_PORT||5587);
const AUTH_FILE=process.env.LIGHT_REMOTE_CONTINUITY_UAT_AUTH_FILE;
if(!AUTH_FILE||!Number.isInteger(PORT)||PORT<1024||PORT>65535)throw Error('continuity_uat_web_config_invalid');
if(process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER!=='1')throw Error('continuity_uat_requires_isolated_broker');
const auth=loadLocalWallAuth(AUTH_FILE,{required:true});
if(auth.mode!=='local')throw Error('continuity_uat_requires_local_owner_auth');
const failures=new Map();
const headers={
 'cache-control':'no-store, private',
 'pragma':'no-cache',
 'x-content-type-options':'nosniff',
 'x-frame-options':'DENY',
 'referrer-policy':'no-referrer',
 'content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
};
function respond(res,status,type,value,extra={}){
 res.writeHead(status,{...headers,'content-type':type,...extra});
 res.end(value);
}
function json(res,status,result){respond(res,status,'application/json; charset=utf-8',JSON.stringify(result));}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));}
function readBody(req,limit=24*1024){
 return new Promise((resolve,reject)=>{
  let bytes=0,buffers=[];
  req.on('data',b=>{
   bytes+=b.length;
   if(bytes>limit){reject(Error('continuity_uat_request_too_large'));req.destroy();return;}
   buffers.push(b);
  });
  req.on('end',()=>resolve(Buffer.concat(buffers).toString('utf8')));
  req.on('error',reject);
 });
}
function principal(req){return auth.identity(req)?.username||null;}
const cookie=token=>LOCAL_WALL_COOKIE+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+auth.ttlSeconds;
const allowedActions={
 listProjects:()=>projectContinuityRequest('listProjects'),
 createProject:d=>projectContinuityRequest('createProject',{name:d.name,workspace:d.workspace||''}),
 setModules:d=>projectContinuityRequest('setModules',d),
 createTask:d=>projectContinuityRequest('createTask',d),
 addSection:d=>projectContinuityRequest('addSection',d),
 checkpoint:d=>projectContinuityRequest('checkpoint',d),
 memoryPut:d=>projectContinuityRequest('memoryPut',d),
 memoryRecent:d=>projectContinuityRequest('memoryRecent',d),
 memorySearch:d=>projectContinuityRequest('memorySearch',d),
 contextBrief:d=>projectContinuityRequest('contextBrief',d)
};
function loginPage(failed=false){
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Light Remote Continuity UAT</title><style>:root{color-scheme:dark;font-family:system-ui;background:#090f1b;color:#e3effd}body{min-height:100vh;display:grid;place-items:center;margin:0}.card{width:min(400px,calc(100vw - 35px));padding:25px;background:#111e30;border:1px solid #2d435c;border-radius:12px}input,button{font:inherit;box-sizing:border-box;width:100%;padding:12px;border-radius:7px;margin:6px 0 17px;background:#071526;border:1px solid #425974;color:#fff}button{background:#0964a8;cursor:pointer}.muted{color:#99adc8;font-size:13px}.err{color:#ffb0b0}</style></head><body><main class="card"><h2>Light Remote / Projects</h2><p class="muted">Isolated Linux Server UAT · NetBird-only access</p>'+
 (failed?'<p class="err">Login unsuccessful.</p>':'')+
 '<form method="post" action="/auth/login"><input type="hidden" name="csrf" value="'+esc(auth.issueLoginCsrf())+'"><label>UAT owner</label><input name="username" autocomplete="username" required><label>Password</label><input type="password" name="password" autocomplete="current-password" required><button>Sign in</button></form></main></body></html>';
}
let stopping=false;
const server=http.createServer(async(req,res)=>{
 try{
  if(stopping)return json(res,503,{ok:false,error:'shutting_down'});
  const host=String(req.headers.host||'');
  if(!['100.94.184.141:'+PORT,'127.0.0.1:'+PORT,'localhost:'+PORT].includes(host))
   return json(res,400,{ok:false,error:'invalid_host'});
  const url=new URL(req.url||'/', 'http://localhost');
  const pathname=url.pathname;
  if(pathname==='/healthz'&&req.method==='GET')return json(res,200,{ok:true,mode:'isolated_continuity_web_ua'});
  if(pathname==='/auth/login'&&req.method==='POST'){
   const form=new URLSearchParams(await readBody(req,4096));
   const username=form.get('username')||'',password=form.get('password')||'';
   const key=String(req.socket.remoteAddress||'loopback');
   const now=Date.now(),recent=(failures.get(key)||[]).filter(t=>now-t<900000);
   if(recent.length>=5)return respond(res,429,'text/plain; charset=utf-8','Too many failed logins');
   const accepted=auth.verifyLoginCsrf(form.get('csrf'))&&auth.verifyCredentials(username,password);
   if(!accepted){recent.push(now);failures.set(key,recent);return respond(res,403,'text/html; charset=utf-8',loginPage(true));}
   failures.delete(key);
   const token=auth.issue(username).token;
   return respond(res,303,'text/plain','Redirecting',{location:'/projects','set-cookie':cookie(token)});
  }
  if(pathname==='/login'&&req.method==='GET')
   return respond(res,200,'text/html; charset=utf-8',loginPage());
  if(pathname==='/auth/logout'&&req.method==='POST'){
   if(!principal(req)||!auth.verifyRequestCsrf(req,String(req.headers['x-light-remote-csrf']||'')))
    return json(res,403,{ok:false,error:'csrf_denied'});
   return respond(res,303,'text/plain','Signed out',{location:'/login','set-cookie':LOCAL_WALL_COOKIE+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});
  }
  if(!principal(req)){
   if(pathname.startsWith('/api/'))return json(res,401,{ok:false,error:'owner_auth_required'});
   return respond(res,303,'text/plain','Login required',{location:'/login'});
  }
  if((pathname==='/'||pathname==='/projects')&&req.method==='GET'){
   let page=continuityProjectsPage(auth.csrfForRequest(req));
   page=page.replace('Experimental P1','Isolated Linux Server UAT').replace('href="/permissions"','href="/projects"').replace('<a href="/">Wall</a>','<a href="/projects">Projects</a>');
   // Password-rotation flow is not enabled for the disposable UAT owner.
   page=page.replace('<form id="ownerRekeyForm"','<form id="ownerRekeyForm" hidden');
   return respond(res,200,'text/html; charset=utf-8',page);
  }
  const prefix='/api/project-continuity/';
  if(!pathname.startsWith(prefix))return json(res,404,{ok:false,error:'not_found'});
  const action=pathname.slice(prefix.length);
  if(!Object.hasOwn(allowedActions,action)&&action!=='setRemoteReadConsent')
   return json(res,404,{ok:false,error:'action_denied'});
  if(req.method!=='GET'&&req.method!=='POST')return json(res,405,{ok:false,error:'method_denied'});
  if(req.method==='GET'&&action!=='listProjects')return json(res,405,{ok:false,error:'method_denied'});
  if(req.method==='POST'){
   const origin=String(req.headers.origin||'');
   if(origin&&origin!==('http://'+host))return json(res,403,{ok:false,error:'origin_denied'});
   if(!auth.verifyRequestCsrf(req,String(req.headers['x-light-remote-csrf']||'')))
    return json(res,403,{ok:false,error:'csrf_denied'});
  }
  const data=req.method==='POST'?JSON.parse(await readBody(req)):{};
  if(action==='setRemoteReadConsent'){
   if(!Number.isInteger(data.expectedRevision)||typeof data.enabled!=='boolean')
    return json(res,400,{ok:false,error:'consent_invalid'});
   if(!auth.verifyCredentials(principal(req),data.password))
    return json(res,403,{ok:false,error:'owner_stepup_failed'});
   const result=await projectContinuityOwnerConsent({
    principal:principal(req),password:data.password,projectId:data.projectId,
    enabled:data.enabled,expectedRevision:data.expectedRevision
   });
   return json(res,200,{ok:true,result});
  }
  const result=await allowedActions[action](data);
  return json(res,200,{ok:true,result});
 }catch(error){
  const message=String(error?.message||'');
  if(message.startsWith('continuity_')||message.startsWith('invalid_'))
   return json(res,400,{ok:false,error:message});
  return json(res,500,{ok:false,error:'uat_request_failed'});
 }
});
server.listen(PORT,'127.0.0.1',()=>console.log('CONTINUITY_UAT_WEB_READY loopback:'+PORT));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;server.close(()=>process.exit(0));});
