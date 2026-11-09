// Runs only inside the disposable exact-source DEV container, with synthetic
// accounts/devices. Exercises public OAuth/MCP, real Wall HTTP and Agent IPC.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';

export async function verifyDeviceFlows({request,cookie,tokens,deviceId,credentials,record,nativeApiRequired=true,strictErrors=true}){
 if(process.env.LR_UNIFIED_DISPOSABLE_DEV!=='1')throw Error('disposable_dev_required');
 const origin=process.env.LIGHT_REMOTE_PLUGIN_ORIGIN;
 const accountId='unified-dev-owner',resource=origin+'/mcp';
 const nativeHeaders={authorization:'Bearer '+tokens.access_token};
 let sequence=0;
 async function oauth(){
  const redirect='http://127.0.0.1:45124/mcp/callback';
  const registered=await request('/oauth/register',{method:'POST',body:{redirect_uris:[redirect],client_name:'Disposable integration Agent',token_endpoint_auth_method:'none'}});
  assert.equal(registered.status,201,'real MCP OAuth client registration: '+String(registered.json?.error||'unknown'));
  const verifier=crypto.randomBytes(32).toString('base64url');
  const fields={client_id:registered.json.client_id,redirect_uri:redirect,resource,response_type:'code',scope:'remote:read remote:write remote:execute remote:terminal',
   code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),state:crypto.randomBytes(16).toString('hex')};
  const authorization=await request('/oauth/authorize',{method:'POST',body:new URLSearchParams({...fields,...credentials.owner}).toString(),headers:{origin,'content-type':'application/x-www-form-urlencoded'}});
  assert.equal(authorization.status,303,'actual account password -> MCP OAuth authorization');
  const callback=new URL(authorization.headers.location);assert.equal(callback.origin,new URL(redirect).origin);assert.equal(callback.searchParams.get('state'),fields.state);
  const token=await request('/oauth/token',{method:'POST',body:{grant_type:'authorization_code',client_id:fields.client_id,resource,redirect_uri:redirect,code:callback.searchParams.get('code'),code_verifier:verifier}});
  assert.equal(token.status,200,'MCP PKCE exchange');assert.equal(typeof token.json.access_token,'string');return token.json.access_token;
 }
 async function mcp(token,name,args={}){
  const answer=await request('/mcp',{method:'POST',headers:{authorization:'Bearer '+token,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-03-26'},body:{jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name,arguments:args}}});
  assert.equal(answer.status,200,'actual MCP tool '+name);
  assert.ok(answer.json?.result&&!answer.json.error,'MCP JSON-RPC result required');
  const result=answer.json.result;
  assert.notEqual(result.isError,true,'MCP tool rejected: '+String(result.structuredContent?.error||result.structuredContent?.status||'unknown'));
  return result.structuredContent;
 }
 const localOrigin='http://127.0.0.1:5491';
 async function wall(route,{method='GET',body,headers={}}={}){
  const response=await fetch(localOrigin+route,{method,redirect:'manual',signal:AbortSignal.timeout(10000),headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...headers},
   ...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
  const text=await response.text();assert.ok(text.length<4*1024*1024,'bounded Wall response');let json;try{json=JSON.parse(text);}catch{}
  return {status:response.status,headers:response.headers,text,json};
 }
 const login=await wall('/login');assert.equal(login.status,200);
 const loginCsrf=/name="csrf" value="([A-Za-z0-9._-]+)"/.exec(login.text)?.[1];assert.ok(loginCsrf,'Wall pre-auth CSRF');
 const signedIn=await wall('/auth/login',{method:'POST',body:new URLSearchParams({csrf:loginCsrf,username:credentials.owner.email,password:credentials.owner.password,next:'/'}).toString(),headers:{origin:localOrigin,'content-type':'application/x-www-form-urlencoded'}});
 assert.equal(signedIn.status,303,'actual Wall -> Operator Owner account login');
 const wallCookie=signedIn.headers.getSetCookie().find(x=>x.startsWith('lr_wall_session='))?.split(';')[0];assert.ok(wallCookie,'Wall HttpOnly session');
 const page=await wall('/',{headers:{cookie:wallCookie}});assert.equal(page.status,200);
 const csrfMatch=/const wallCsrf=("(?:[^"\\]|\\.)*")/.exec(page.text);assert.ok(csrfMatch,'authenticated Wall mutation CSRF');
 const csrf=JSON.parse(csrfMatch[1]);
 const wallHeaders={cookie:wallCookie,origin:localOrigin,'x-light-remote-csrf':csrf};
 const snapshot=await request('/account/desktop/v4/snapshot',{method:'POST',body:{},headers:nativeHeaders});
 assert.equal(snapshot.status,200);const shortId=snapshot.json.devices.find(d=>d.deviceId===deviceId)?.shortId;assert.match(shortId,/^[0-9A-HJKMNP-TV-Z]{6}$/);
 const token=await oauth();
 const before=await mcp(token,'light_remote_list_devices');assert.equal(before.items.length,0,'OAuth login alone grants no device');
 const beforePending=await wall('/api/abv2/pending',{headers:{cookie:wallCookie}});assert.equal(beforePending.status,200);
 const existingIds=new Set(beforePending.json.pending.map(r=>r.requestId));
 const issued=await mcp(token,'light_remote_connection_helper',{targetQuery:shortId,startAbV2:true,requestKey:crypto.randomBytes(16).toString('hex')});
 assert.match(issued.bCode,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);assert.equal(issued.deviceId,deviceId);
 const preview=await wall('/api/abv2/pending',{headers:{cookie:wallCookie}});
 assert.equal(preview.status,200,'signed Agent -> Operator pending');assert.equal(preview.json.ownerApproveEnabled,true);assert.equal(preview.json.ownerConsentRequired,false,'explicit isolated A/B B-only policy');
 // MCP intentionally redacts internal request IDs. The single-threaded
 // disposable fixture observes the exact new Owner row; never choose newest.
 const newRows=preview.json.pending.filter(r=>!existingIds.has(r.requestId));assert.equal(newRows.length,1,'one exact new request in Wall');
 const row=newRows[0];
 assert.equal(JSON.stringify(preview.json).includes(issued.bCode),false,'pending preview never reveals B');
 const payload={requestId:row.requestId,expectedAttempt:row.attempt,bCode:issued.bCode};
 const noCsrf=await wall('/api/abv2/approve',{method:'POST',body:payload,headers:{cookie:wallCookie,origin:localOrigin}});assert.equal(noCsrf.status,403);
 const stale=await wall('/api/abv2/approve',{method:'POST',body:{...payload,expectedAttempt:row.attempt+1},headers:wallHeaders});assert.equal(stale.status,409);
 const wrong=await wall('/api/abv2/approve',{method:'POST',body:{...payload,bCode:(issued.bCode[0]==='A'?'B':'A')+issued.bCode.slice(1)},headers:wallHeaders});
 if(strictErrors)assert.equal(wrong.status,400,'wrong B must be a known rejection, not an unknown network outcome');
 record('real Wall B rejects missing CSRF, stale attempt and wrong B',{csrfStatus:noCsrf.status,staleStatus:stale.status,wrongBStatus:wrong.status});
 const approved=await wall('/api/abv2/approve',{method:'POST',body:payload,headers:wallHeaders});
 assert.equal(approved.status,200,'actual signed Wall B failed: '+String(approved.json?.error||'unknown'));assert.equal(approved.json.state,'granted');
 const attached=await mcp(token,'light_remote_connection_helper',{pollRequestId:row.requestId,pollDeviceId:deviceId,pollShortId:shortId});
 assert.equal(attached.helperReady,true,'MCP attach only after persisted grant');
 const after=await mcp(token,'light_remote_list_devices');assert.ok(after.items.some(d=>d.deviceId===deviceId),'B grant enables only requested device');
 record('MCP OAuth request -> signed Agent Wall B -> durable PG grant -> MCP attach',{statusCode:200});

 // The independent /account approval flow must continue working too.
 const accountAgent=await oauth();
 const previous=await request('/account/api?action=abv2-pending&deviceId='+deviceId,{headers:{cookie}});assert.equal(previous.status,200);
 const priorIds=new Set(previous.json.pending.map(r=>r.requestId));
 const second=await mcp(accountAgent,'light_remote_connection_helper',{targetQuery:shortId,startAbV2:true,requestKey:crypto.randomBytes(16).toString('hex')});
 assert.match(second.bCode,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
 const pending=await request('/account/api?action=abv2-pending&deviceId='+deviceId,{headers:{cookie}});assert.equal(pending.status,200);
 const accountRows=pending.json.pending.filter(r=>!priorIds.has(r.requestId));assert.equal(accountRows.length,1);const accountRow=accountRows[0];
 const accountCsrf=await request('/account/api?action=abv2-csrf&deviceId='+deviceId,{headers:{cookie}});assert.equal(accountCsrf.status,200);
 const secondApproval=await request('/account/api?action=abv2-approve',{method:'POST',body:{deviceId,requestId:accountRow.requestId,expectedAttempt:accountRow.attempt,bCode:second.bCode},headers:{origin,cookie,'x-light-abv2-csrf':accountCsrf.json.csrf}});
 assert.equal(secondApproval.status,200,'independent Account B approval');assert.equal(secondApproval.json.state,'granted');
 const accountAttached=await mcp(accountAgent,'light_remote_connection_helper',{pollRequestId:accountRow.requestId,pollDeviceId:deviceId,pollShortId:shortId});assert.equal(accountAttached.helperReady,true);
 record('independent Account B flow still commits a separate OAuth Agent grant',{statusCode:200});
 if(!nativeApiRequired)return;

 const ipc=(action,payload={},overrides={})=>new Promise((resolve,reject)=>{
  const socket=net.createConnection('/state/home/.light-remote/desktop-device.sock');let data='';
  socket.setTimeout(20000,()=>socket.destroy(Error('candidate_device_ipc_timeout')));
  socket.on('connect',()=>socket.write(JSON.stringify({action,access:tokens.access_token,accountId,deviceId,payload,...overrides})+'\n'));
  socket.on('data',chunk=>{data+=chunk;if(Buffer.byteLength(data)>262144)socket.destroy(Error('candidate_device_response_limit'));});
  socket.on('error',reject);socket.on('end',()=>{try{resolve(JSON.parse(data));}catch{reject(Error('candidate_device_json_invalid'));}});
 });
 const device=await ipc('device.read',{}, {deviceId:null});assert.equal(device.ok,true,'real enrolled Agent device IPC');assert.equal(device.deviceId,deviceId);assert.equal(device.accountId,accountId);
 assert.equal((await ipc('device.read',{}, {accountId:'foreign'})).ok,false);assert.equal((await ipc('settings.read',{}, {deviceId:'foreign'})).ok,false);
 assert.equal((await ipc('memory.read')).view.memory,null,'optional module initially OFF');
 const flags=device.view.modules;
 assert.equal((await ipc('module.configure',{module:'longMemory',enabled:true,expectedRevision:flags.revision})).ok,true);
 const fresh=await ipc('memory.read');assert.equal(fresh.ok,true);assert.ok(fresh.view.memory.localFileBytes>0,'first Memory read initializes actual SQLite schema');
 const created=await ipc('memory.create',{displayName:'Candidate work',captureMode:'manual'});assert.equal(created.ok,true);
 const scopeId=created.view.scope.scopeId;
 assert.equal((await ipc('memory.archive',{scopeId,confirmed:true})).ok,true);
 assert.equal((await ipc('memory.read')).view.memory.scopes.find(s=>s.scopeId===scopeId).status,'archived');
 assert.equal((await ipc('memory.restore',{scopeId,confirmed:true})).ok,true);
 assert.equal((await ipc('module.configure',{module:'codexBridge',enabled:true,expectedRevision:flags.revision})).ok,false,'stale UI CAS denied');
 const current=(await ipc('device.read')).view.modules;
 assert.equal((await ipc('module.configure',{module:'codexBridge',enabled:true,expectedRevision:current.revision})).ok,true);
 const task=await ipc('codex.task-create',{title:'Candidate task'});assert.equal(task.ok,true);
 const codex=await ipc('codex.read');assert.ok(codex.view.codex.tasks.some(t=>t.id===task.view.task.id));assert.equal(codex.view.modules.longMemory,true);
 const settings=await ipc('settings.read');assert.equal(settings.ok,true);assert.equal(typeof settings.view.activityLog.usedBytes,'number');
 const persisted=(await ipc('device.read')).view.modules;
 assert.equal((await ipc('module.configure',{module:'longMemory',enabled:false,expectedRevision:persisted.revision})).ok,true);
 assert.equal((await ipc('memory.read')).view.memory,null);
 assert.equal((await ipc('module.configure',{module:'longMemory',enabled:true,expectedRevision:persisted.revision+1})).ok,true);
 assert.ok((await ipc('memory.read')).view.memory.scopes.some(s=>s.scopeId===scopeId),'disable retains saved work');
 record('native Owner -> real same-device Agent IPC -> module CAS, SQLite Memory, Codex tasks and Settings',{statusCode:200});
}
