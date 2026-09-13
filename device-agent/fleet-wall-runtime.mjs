#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {deviceChannelMessage} from '../lib/device-proof.mjs';
import {loadLocalWallAuth,LOCAL_WALL_COOKIE} from './local-wall-auth.mjs';
import {dashboardHtml} from '../gateway/dashboard.mjs';
import {devicePolicyHtml} from '../gateway/device-policy-page.mjs';

const VERSION=(()=>{try{return JSON.parse(fs.readFileSync(new URL('../manifest.json',import.meta.url),'utf8')).version||'0.9.0-rc.6';}catch{return '0.9.0-rc.6';}})();
const STATE_FILE=process.env.OPERATOR_AGENT_STATE||path.join(os.homedir(),'.config','gpt-operator-agent','device.json');
const EXTERNAL_IDENTITY_FILE=String(process.env.OPERATOR_AGENT_IDENTITY_FILE||'').trim();
const AUTH_FILE=process.env.OPERATOR_AGENT_WALL_AUTH_FILE||path.join(path.dirname(STATE_FILE),'wall-auth.json');
const HUB=String(process.env.OPERATOR_AGENT_HUB_URL||'https://mcp.dashboard.thaiduy.store').replace(/\/$/,'');
const HOST=process.env.OPERATOR_FLEET_WALL_HOST||process.env.OPERATOR_AGENT_WALL_HOST||'127.0.0.1';
const PORT=Math.max(1,Math.min(Number(process.env.OPERATOR_FLEET_WALL_PORT)||5492,65535));
const RENEW_SKEW_MS=Math.max(1000,Number(process.env.OPERATOR_FLEET_AUTHORITY_RENEW_SKEW_MS)||90_000);
const WATCHDOG_MS=Math.max(1000,Number(process.env.OPERATOR_FLEET_AUTHORITY_CHECK_MS)||30_000);
const PARENT_PID=Math.max(0,Number(process.env.LIGHT_REMOTE_FLEET_PARENT_PID)||0);
const PARENT_CHECK_MS=Math.max(500,Number(process.env.LIGHT_REMOTE_FLEET_PARENT_CHECK_MS)||2000);
let authority=null,server=null,stopping=false,watchdogTimer=null,parentTimer=null;

function privateHost(host){const h=String(host||'').trim();if(['127.0.0.1','::1','localhost'].includes(h))return true;if(net.isIP(h)!==4)return false;const [a,b]=h.split('.').map(Number);return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);}
function readState(){return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}
let externalIdentityCache=null;
function externalIdentity(){if(!EXTERNAL_IDENTITY_FILE)return null;if(externalIdentityCache)return externalIdentityCache;const row=JSON.parse(fs.readFileSync(EXTERNAL_IDENTITY_FILE,'utf8')),privateKey=crypto.createPrivateKey({key:Buffer.from(row.privateKey,'base64'),format:'der',type:'pkcs8'}),publicKey=crypto.createPublicKey({key:Buffer.from(row.publicKey||row.publicIdentityKey,'base64'),format:'der',type:'spki'});if(privateKey.asymmetricKeyType!=='ed25519'||publicKey.asymmetricKeyType!=='ed25519')throw new Error('invalid_external_device_identity');externalIdentityCache={privateKey,publicIdentityKey:publicKey.export({format:'der',type:'spki'}).toString('base64')};return externalIdentityCache;}
function privateKey(state){if(state.identity?.privateKey)return crypto.createPrivateKey({key:Buffer.from(state.identity.privateKey,'base64'),format:'der',type:'pkcs8'});const external=externalIdentity();if(!external||external.publicIdentityKey!==state.identity?.publicIdentityKey)throw new Error('device_private_key_unavailable');return external.privateKey;}
async function channel(action,payload){
  const state=readState();
  if(!state?.enrollment?.deviceId||!state?.identity?.publicIdentityKey)throw Object.assign(new Error('device_not_enrolled'),{status:409});
  const deviceId=state.enrollment.deviceId,timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');
  const signature=crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,action,timestamp,nonce,payload})),privateKey(state)).toString('base64url');
  const response=await fetch(`${HUB}/device-channel/${action}`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({deviceId,timestamp,nonce,signature,payload}),signal:AbortSignal.timeout(15000)});
  let json={};try{json=await response.json();}catch{}
  if(!response.ok)throw Object.assign(new Error(json.error||`http_${response.status}`),{status:response.status,payload:json});
  return json;
}
async function renewAuthority(force=false){
  if(!force&&authority?.token&&Number(authority.lease?.expiresAt)>Date.now()+RENEW_SKEW_MS)return authority;
  const result=await channel('fleet-authority',{moduleVersion:VERSION});
  authority=result.authority;
  if(!authority?.token||!authority?.lease?.expiresAt)throw Object.assign(new Error('fleet_authority_missing'),{status:503});
  return authority;
}
async function fleetCall(action,payload={}){
  const current=await renewAuthority(false);
  try{return await channel(action,{...payload,fleetToken:current.token});}
  catch(error){
    if(!['fleet_authority_required','fleet_authority_binding_mismatch'].includes(error.message))throw error;
    const fresh=await renewAuthority(true);return channel(action,{...payload,fleetToken:fresh.token});
  }
}
async function reportFleetStatus(status='online'){return fleetCall('fleet-status',{status,moduleVersion:VERSION,port:PORT});}
function json(res,status,value){const text=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(text);}
function safeNext(value){const text=String(value||'').trim();return text.startsWith('/')&&!text.startsWith('//')&&text.length<=512?text:'/';}
function secureRequest(req){return Boolean(req.socket?.encrypted)||String(req.headers['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase()==='https';}
function sessionCookie(token,ttl,secure){return `${LOCAL_WALL_COOKIE}=${token}; Path=/; Max-Age=${ttl}; HttpOnly; ${secure?'Secure; ':''}SameSite=Strict; Priority=High`;}
function clearCookie(secure){return `${LOCAL_WALL_COOKIE}=; Path=/; Max-Age=0; HttpOnly; ${secure?'Secure; ':''}SameSite=Strict; Priority=High`;}
function formBody(req,limit=16*1024){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('body_too_large'));req.destroy();return;}chunks.push(c);});req.on('end',()=>resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))));req.on('error',reject);});}
function jsonBody(req,limit=64*1024){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('body_too_large'));req.destroy();return;}chunks.push(c);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch{reject(new Error('invalid_json'));}});req.on('error',reject);});}
function loginPage(message='',next='/',csrf=''){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const note=message?`<div class="error">${esc(message)}</div>`:'';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Light Remote — Fleet Wall login</title><style>:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#080a0c;color:#d8dee7}body{margin:0;min-height:100vh;display:grid;place-items:center}.card{width:min(420px,calc(100vw - 32px));border:1px solid #252d36;border-radius:12px;background:#0a0e12;padding:22px}.muted{color:#718096}.error{color:#ff8e8e;margin-top:12px}label{display:block;margin-top:14px}input,button{width:100%;margin-top:6px;border:1px solid #2b333d;background:#0e1216;color:#d8dee7;border-radius:7px;padding:10px;font:inherit;box-sizing:border-box}button{cursor:pointer;margin-top:18px}</style></head><body><main class="card"><h2>Light Remote</h2><p class="muted">Fleet Wall · Main device</p>${note}<form method="post" action="/auth/login"><input type="hidden" name="next" value="${esc(safeNext(next))}"><input type="hidden" name="csrf" value="${esc(csrf)}"><label>Email / recovery username<input name="username" autocomplete="username" required autofocus></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></main></body></html>`;
}
function pageHeaders(){return {'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};}
function accountAuthenticate(email,password){return channel('account-auth',{email:String(email||'').trim(),password:String(password||'')});}
function shouldTerminateAuthority(error){return [401,403].includes(Number(error?.status))||['fleet_entitlement_required','fleet_main_device_required','fleet_main_device_revoked','device_revoked','device_account_mismatch'].includes(String(error?.message||''));}
async function stop(reason='fleet_wall_stopped'){
  if(stopping)return;stopping=true;console.error(JSON.stringify({event:'fleet_wall_stopping',reason}));
  if(watchdogTimer){clearInterval(watchdogTimer);watchdogTimer=null;}
  if(parentTimer){clearInterval(parentTimer);parentTimer=null;}
  if(server){try{server.closeAllConnections?.();}catch{}await new Promise(resolve=>server.close(()=>resolve()));}
}
async function authorityWatchdog(){
  if(stopping)return;
  try{await renewAuthority(false);await reportFleetStatus('online');}
  catch(error){
    const expiresAt=Number(authority?.lease?.expiresAt)||0;
    if(shouldTerminateAuthority(error)||expiresAt<=Date.now()){await stop(error.message||'fleet_authority_lost');process.exit(0);}
  }
}
async function start(){
  if(!privateHost(HOST))throw Object.assign(new Error('fleet_wall_bind_host_not_private'),{status:400});
  await renewAuthority(true);
  const loopback=['127.0.0.1','::1','localhost'].includes(String(HOST));
  const auth=loadLocalWallAuth(AUTH_FILE,{required:!loopback}),failures=new Map();
  const requireIdentity=req=>!auth.enabled||auth.identity(req);
  const mutationAllowed=req=>!auth.enabled||auth.verifyRequestCsrf(req,String(req.headers['x-light-remote-csrf']||''));
  server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url||'/','http://fleet.wall');
    if(req.method==='GET'&&url.pathname==='/healthz')return json(res,200,{ok:true,service:'light-remote-fleet-wall',version:VERSION});
    if(auth.enabled&&req.method==='GET'&&url.pathname==='/login'){
      if(auth.identity(req)){res.writeHead(303,{location:safeNext(url.searchParams.get('next')),'cache-control':'no-store'});return res.end();}
      res.writeHead(200,pageHeaders());res.end(loginPage('',url.searchParams.get('next'),auth.issueLoginCsrf()));return;
    }
    if(auth.enabled&&req.method==='POST'&&url.pathname==='/auth/login'){
      const data=await formBody(req);
      if(!auth.verifyLoginCsrf(data.csrf)){res.writeHead(403,pageHeaders());res.end(loginPage('Login session expired. Reload and try again.',data.next,auth.issueLoginCsrf()));return;}
      const key=String(req.socket.remoteAddress||'unknown'),now=Date.now(),recent=(failures.get(key)||[]).filter(at=>now-at<10*60*1000);
      if(recent.length>=10){res.writeHead(429,{...pageHeaders(),'retry-after':'600'});res.end(loginPage('Too many failed attempts. Try again later.','/',auth.issueLoginCsrf()));return;}
      let verified=auth.verifyCredentials(data.username,data.password);
      if(!verified&&String(data.username||'').includes('@')){try{const remote=await accountAuthenticate(data.username,data.password);verified=Boolean(remote?.account?.accountId);}catch{verified=false;}}
      if(!verified){recent.push(now);failures.set(key,recent);res.writeHead(401,pageHeaders());res.end(loginPage('Invalid email or password.',data.next,auth.issueLoginCsrf()));return;}
      failures.delete(key);const issued=auth.issue();res.writeHead(303,{location:safeNext(data.next),'set-cookie':sessionCookie(issued.token,issued.ttlSeconds,secureRequest(req)),'cache-control':'no-store'});return res.end();
    }
    if(auth.enabled&&req.method==='POST'&&url.pathname==='/auth/logout'){
      const data=await formBody(req);if(!auth.verifyRequestCsrf(req,data.csrf))return json(res,403,{ok:false,error:'csrf_invalid'});
      res.writeHead(303,{location:'/login','set-cookie':clearCookie(secureRequest(req)),'cache-control':'no-store'});return res.end();
    }
    if(!requireIdentity(req)){
      if(url.pathname.startsWith('/api/')||url.pathname==='/events')return json(res,401,{ok:false,error:'wall_auth_required'});
      res.writeHead(303,{location:`/login?next=${encodeURIComponent(safeNext(req.url||'/'))}`,'cache-control':'no-store'});return res.end();
    }
    if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,pageHeaders());res.end(dashboardHtml({surface:'fleet',showLogout:Boolean(auth.enabled),csrfToken:auth.enabled?auth.csrfForRequest(req)||'':''}));return;}
    if(req.method==='GET'&&url.pathname==='/device-policy'){
      const deviceId=String(url.searchParams.get('id')||'').trim();if(!/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId))return json(res,400,{ok:false,error:'invalid_device_id'});
      res.writeHead(200,pageHeaders());res.end(devicePolicyHtml(deviceId,{csrfToken:auth.enabled?auth.csrfForRequest(req)||'':''}));return;
    }
    if(req.method==='GET'&&url.pathname==='/api/devices'){const value=await fleetCall('fleet-devices');return json(res,200,{ok:true,mainDeviceId:value.mainDeviceId,devices:value.devices||[]});}
    const deviceApi=url.pathname.match(/^\/api\/devices\/([A-Za-z0-9._:-]{1,128})$/);
    if(req.method==='GET'&&deviceApi){const value=await fleetCall('fleet-devices'),device=(value.devices||[]).find(d=>d.deviceId===deviceApi[1]);if(!device)return json(res,404,{ok:false,error:'device_not_found'});return json(res,200,{ok:true,device});}
    const policyApi=url.pathname.match(/^\/api\/devices\/([A-Za-z0-9._:-]{1,128})\/policy$/);
    if(req.method==='POST'&&policyApi){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});const body=await jsonBody(req),value=await fleetCall('fleet-device-policy',{deviceId:policyApi[1],policyProfile:body.policyProfile,approvedCapabilities:body.approvedCapabilities});return json(res,200,value);}
    const updateApi=url.pathname.match(/^\/api\/devices\/([A-Za-z0-9._:-]{1,128})\/maintenance\/update$/);
    if(req.method==='POST'&&updateApi){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});const value=await fleetCall('fleet-device-update',{deviceId:updateApi[1]});return json(res,200,value);}
    if(req.method==='GET'&&url.pathname==='/api/sessions'){const value=await fleetCall('fleet-sessions');return json(res,200,{ok:true,mainDeviceId:value.mainDeviceId,sessions:value.sessions||[]});}
    if(req.method==='GET'&&url.pathname==='/api/activity'){
      const limit=Math.max(1,Math.min(Number(url.searchParams.get('limit'))||500,5000)),value=await fleetCall('fleet-activity',{limit});
      return json(res,200,{ok:true,mainDeviceId:value.mainDeviceId,events:value.events||[]});
    }
    if(req.method==='GET'&&url.pathname==='/events'){
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store',connection:'keep-alive','x-accel-buffering':'no'});
      res.write(`event: hello\ndata: ${JSON.stringify({ok:true,now:new Date().toISOString(),version:VERSION})}\n\n`);
      let closed=false,inFlight=false;const seen=new Set();
      const pump=async()=>{if(closed||inFlight)return;inFlight=true;try{const value=await fleetCall('fleet-activity',{limit:250});for(const event of (value.events||[])){const key=String(event.id??'')+'@'+String(event.at??'');if(seen.has(key))continue;seen.add(key);if(seen.size>2000)seen.delete(seen.values().next().value);res.write(`id: ${String(event.id??'')}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`);}}catch(error){if(shouldTerminateAuthority(error)){res.write(`event: authority_lost\ndata: ${JSON.stringify({error:error.message})}\n\n`);setImmediate(()=>stop(error.message).finally(()=>process.exit(0)));}}finally{inFlight=false;}};
      await pump();const timer=setInterval(pump,1000),keep=setInterval(()=>{if(!closed)res.write(`: keepalive ${Date.now()}\n\n`);},20000);
      req.on('close',()=>{closed=true;clearInterval(timer);clearInterval(keep);});return;
    }
    return json(res,404,{ok:false,error:'not_found'});
  }catch(error){if(shouldTerminateAuthority(error))setImmediate(()=>stop(error.message).finally(()=>process.exit(0)));return json(res,Number(error.status)||400,{ok:false,error:error.message||'fleet_wall_error'});}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,()=>{server.off('error',reject);resolve();});});
  await reportFleetStatus('online');
  watchdogTimer=setInterval(authorityWatchdog,WATCHDOG_MS);watchdogTimer.unref?.();
  if(PARENT_PID>0){parentTimer=setInterval(()=>{try{process.kill(PARENT_PID,0);}catch{stop('fleet_parent_exited').finally(()=>process.exit(0));}},PARENT_CHECK_MS);parentTimer.unref?.();}
  console.log(JSON.stringify({event:'fleet_wall_started',version:VERSION,url:`http://${HOST}:${PORT}/`,deviceId:authority.lease.deviceId,leaseExpiresAt:authority.lease.expiresAt}));
}

process.on('SIGTERM',()=>{stop('sigterm').finally(()=>process.exit(0));});
process.on('SIGINT',()=>{stop('sigint').finally(()=>process.exit(0));});

start().catch(error=>{console.error(JSON.stringify({event:'fleet_wall_start_failed',error:error.message,status:error.status||null}));process.exit(1);});
