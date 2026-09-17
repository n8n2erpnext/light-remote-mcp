import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AccountRegistry } from '../operator-host/account-registry.mjs';

const root=path.resolve(import.meta.dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-plugin-selftest-'));
const socket=path.join(tmp,'operator.sock');
const secretFile=path.join(tmp,'oauth-secret');
fs.writeFileSync(secretFile,crypto.randomBytes(48).toString('base64url'),{mode:0o600});

const ownerPassword=`owner-${crypto.randomBytes(16).toString('hex')}`;
const reviewerPassword=`review-${crypto.randomBytes(16).toString('hex')}`;
const registry=new AccountRegistry({stateFile:path.join(tmp,'accounts.json'),bootstrapAccountId:'owner'});
registry.register({email:'owner@example.test',password:ownerPassword});
const reviewer=registry.provision({accountId:'reviewer',email:'reviewer@example.test',password:reviewerPassword,plan:'free'});
assert.equal(reviewer.accountId,'reviewer');
assert.equal(registry.verifyCredentials({email:'reviewer@example.test',password:reviewerPassword}).accountId,'reviewer');
assert.throws(()=>registry.verifyCredentials({email:'owner@example.test',password:reviewerPassword}));
console.log('plugin_account_isolation=PASS');
const operator=http.createServer(async(req,res)=>{
  const chunks=[]; for await(const c of req) chunks.push(c);
  let body={}; try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{}
  res.setHeader('content-type','application/json');
  if(req.method==='POST'&&req.url==='/v1/plugin/auth/verify'){
    if(body.email==='reviewer@example.test'&&body.password===reviewerPassword) return res.end(JSON.stringify({ok:true,account:{accountId:'reviewer',email:'reviewer@example.test'}}));
    res.statusCode=401; return res.end(JSON.stringify({ok:false,error:'invalid_account_credentials'}));
  }
  const reviewDevice={deviceId:'dev_review',nodeId:'dev_review',accountId:'reviewer',displayName:'review-demo',platform:'linux',architecture:'arm64',state:'online',capabilities:['filesystem','terminal'],effectiveCapabilities:['filesystem','terminal'],policyProfile:'review',routing:{mode:'local',state:'online',draining:false,sessionCeiling:2,queuedCommands:0,inFlightCommands:0},connection:{state:'connected',plan:'vip',enforced:true,reconnectGraceMs:1800000},updateStatus:{state:'managed',currentVersion:'0.9.0-rc.26',helperVersion:'server-managed',mode:'server-managed'}};
  if(req.method==='GET'&&req.url==='/v1/devices') return res.end(JSON.stringify({ok:true,currentDeviceId:'dev_review',devices:[reviewDevice]}));
  if(req.method==='GET'&&req.url==='/v1/devices/dev_review') return res.end(JSON.stringify({ok:true,device:reviewDevice}));
  if(req.method==='GET'&&req.url==='/v1/admin/accounts/reviewer') return res.end(JSON.stringify({ok:true,account:{accountId:'reviewer',email:'reviewer@example.test',plan:'vip',mainDeviceId:'dev_review',fleetProvisioning:{deviceId:'dev_review',state:'online',moduleVersion:'0.9.0-rc.26',port:5492}}}));
  if(req.method==='GET'&&req.url.startsWith('/v1/activity?deviceId=dev_review')) return res.end(JSON.stringify({ok:true,events:[{type:'job_started',deviceId:'dev_review',status:'running',route:'local',requiredCapabilities:['terminal'],script:'PTY START',note:'native-terminal:start'}]}));
  res.statusCode=404; res.end(JSON.stringify({ok:false,error:'not_found'}));
});
await new Promise((resolve,reject)=>{operator.once('error',reject);operator.listen(socket,resolve)});

const basePort=18000+(process.pid%1000)*2;
const env={...process.env,LIGHT_REMOTE_PLUGIN_ORIGIN:`http://127.0.0.1:${basePort}`,LIGHT_REMOTE_PLUGIN_ALLOW_HTTP_LOOPBACK:'1',LIGHT_REMOTE_PLUGIN_HOST:'127.0.0.1',LIGHT_REMOTE_PLUGIN_PORT:String(basePort),LIGHT_REMOTE_PLUGIN_INTERNAL_HOST:'127.0.0.1',LIGHT_REMOTE_PLUGIN_INTERNAL_PORT:String(basePort+1),LIGHT_REMOTE_PLUGIN_INTERNAL_ALLOWED_IP:'127.0.0.1',LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE:secretFile,OPERATOR_SOCKET:socket};
const child=spawn(process.execPath,[path.join(root,'plugin-server/server.mjs')],{cwd:root,env,stdio:['ignore','pipe','pipe']});
let logs=''; child.stdout.on('data',d=>logs+=d); child.stderr.on('data',d=>logs+=d);
async function waitReady(){for(let i=0;i<80;i++){try{const r=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/healthz`);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error(`plugin_server_not_ready\n${logs}`)}
await waitReady();
const postMcp=async(body,token='',accept='application/json, text/event-stream')=>{const r=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`,{method:'POST',headers:{'content-type':'application/json','accept':accept,...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});const text=await r.text();return {status:r.status,headers:r.headers,text,json:text?JSON.parse(text):null}};
const scannerProbe=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`,{method:'POST',headers:{'content-type':'application/octet-stream','accept':'*/*'},body:new Uint8Array()});
assert.equal(scannerProbe.status,401);assert.match(scannerProbe.headers.get('www-authenticate')||'',/oauth-protected-resource\/mcp/);assert.match(scannerProbe.headers.get('www-authenticate')||'',/remote:read/);
console.log('plugin_http_auth_boundary_scanner_probe=PASS');
const meta=await (await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/.well-known/oauth-authorization-server`)).json();
assert.deepEqual(meta.code_challenge_methods_supported,['S256']);
assert.ok(meta.registration_endpoint.endsWith('/oauth/register'));assert.equal(meta.authorization_response_iss_parameter_supported,true);assert.ok(meta.scopes_supported.includes('openid'));assert.ok(meta.scopes_supported.includes('email'));
const oidc=await (await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/.well-known/openid-configuration`)).json();assert.equal(oidc.issuer,env.LIGHT_REMOTE_PLUGIN_ORIGIN);assert.ok(oidc.userinfo_endpoint.endsWith('/userinfo'));assert.deepEqual(oidc.subject_types_supported,['public']);
const resource=await (await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/.well-known/oauth-protected-resource/mcp`)).json();
assert.equal(resource.resource,`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`);
assert.ok(resource.scopes_supported.includes('remote:terminal'));

const redirect='https://client.example.invalid/callback';
const regResp=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'OpenAI selftest',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'remote:read openid email offline_access'})});
assert.equal(regResp.status,201);const reg=await regResp.json();assert.ok(reg.client_id);assert.equal(reg.client_name,'OpenAI selftest');assert.equal(reg.scope,'remote:read openid email offline_access');
const verifier=crypto.randomBytes(48).toString('base64url');
const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
const relayState='x'.repeat(547);
const authUrl=new URL(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/authorize`);
authUrl.search=new URLSearchParams({client_id:reg.client_id,redirect_uri:redirect,response_type:'code',code_challenge:challenge,code_challenge_method:'S256',resource:`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`,scope:'remote:read openid email offline_access',state:relayState}).toString();
const authPage=await fetch(authUrl);assert.equal(authPage.status,200);const authCsp=authPage.headers.get('content-security-policy')||'';assert.doesNotMatch(authCsp,/form-action/i);assert.match(authCsp,/frame-ancestors 'none'/);assert.match(await authPage.text(),/Requested permissions: remote:read openid email offline_access/);
console.log('plugin_oauth_discovery_dcr_pkce=PASS');
const authBody=new URLSearchParams({client_id:reg.client_id,redirect_uri:redirect,response_type:'code',code_challenge:challenge,code_challenge_method:'S256',resource:`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`,scope:'remote:read openid email offline_access',state:relayState,email:'reviewer@example.test',password:reviewerPassword});
const authSubmit=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/authorize`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:authBody,redirect:'manual'});
assert.equal(authSubmit.status,303);const callbackLocation=authSubmit.headers.get('location');const callback=new URL(callbackLocation);assert.equal(callback.searchParams.get('state'),relayState);assert.equal(callback.searchParams.get('iss'),env.LIGHT_REMOTE_PLUGIN_ORIGIN);const code=callback.searchParams.get('code');assert.ok(code);assert.ok(code.length<128,`authorization_code_too_long:${code.length}`);assert.ok(callbackLocation.length<1024,`oauth_callback_too_long:${callbackLocation.length}`);
const tokenBody=new URLSearchParams({grant_type:'authorization_code',client_id:reg.client_id,code,redirect_uri:redirect,code_verifier:verifier,resource:`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`});
const tokenResp=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:tokenBody});assert.equal(tokenResp.status,200);const tokens=await tokenResp.json();const codeReplay=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:tokenBody});assert.equal(codeReplay.status,400);assert.equal((await codeReplay.json()).error,'invalid_grant');assert.ok(tokens.access_token);assert.ok(tokens.refresh_token);assert.match(tokens.scope,/remote:read/);assert.match(tokens.scope,/openid/);assert.match(tokens.scope,/email/);
const userinfoResp=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/userinfo`,{headers:{authorization:`Bearer ${tokens.access_token}`}});assert.equal(userinfoResp.status,200);const userinfo=await userinfoResp.json();assert.equal(userinfo.sub,'reviewer');assert.equal(userinfo.email,'reviewer@example.test');assert.equal(userinfo.email_verified,true);console.log('plugin_oidc_userinfo=PASS');
const initResp=await postMcp({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'selftest',version:'1'}}},tokens.access_token,'*/*');assert.equal(initResp.status,200);const init=initResp.json;assert.equal(init.result.serverInfo.name,'light-remote');assert.match(init.result.instructions,/explicit device/i);
const listedResp=await postMcp({jsonrpc:'2.0',id:2,method:'tools/list',params:{}},tokens.access_token,'*/*');assert.equal(listedResp.status,200);const listed=listedResp.json;assert.equal(listed.result.tools.length,20);
for(const tool of listed.result.tools){assert.ok(Array.isArray(tool.securitySchemes)&&tool.securitySchemes.length===1,`${tool.name}_securitySchemes`);assert.equal(tool.securitySchemes[0].type,'oauth2');assert.ok(tool.annotations,`${tool.name}_annotations`)}
const execTool=listed.result.tools.find(t=>t.name==='light_remote_exec'),termTool=listed.result.tools.find(t=>t.name==='light_remote_terminal'),helperTool=listed.result.tools.find(t=>t.name==='light_remote_connection_helper'),mainTool=listed.result.tools.find(t=>t.name==='light_remote_set_main_device'),revokeTool=listed.result.tools.find(t=>t.name==='light_remote_revoke_device'),removeTool=listed.result.tools.find(t=>t.name==='light_remote_remove_device');
for(const tool of [execTool,termTool]){assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.annotations.destructiveHint,true);assert.equal(tool.annotations.openWorldHint,true)}
assert.equal(helperTool.annotations.readOnlyHint,true);assert.equal(helperTool.annotations.openWorldHint,false);assert.equal(mainTool.annotations.readOnlyHint,false);assert.equal(mainTool.annotations.destructiveHint,false);for(const tool of [revokeTool,removeTool]){assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.annotations.destructiveHint,true);assert.equal(tool.annotations.openWorldHint,false)}
console.log('plugin_tool_metadata=PASS');
const authDevicesResp=await postMcp({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'light_remote_list_devices',arguments:{}}},tokens.access_token);assert.equal(authDevicesResp.status,200);const authDevices=authDevicesResp.json;assert.equal(authDevices.result.isError,undefined);assert.equal(authDevices.result.structuredContent.items.length,1);assert.equal(authDevices.result.structuredContent.items[0].name,'review-demo');assert.equal(authDevices.result.structuredContent.items[0].accountId,undefined);
const helperResp=await postMcp({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'light_remote_connection_helper',arguments:{}}},tokens.access_token);const helper=helperResp.json;assert.equal(helper.result.structuredContent.product,'Light Remote');assert.equal(helper.result.structuredContent.account.plan,'vip');assert.equal(helper.result.structuredContent.topology[0].role,'main');assert.equal(helper.result.structuredContent.topology[0].accountId,undefined);
const inspectedResp=await postMcp({jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'light_remote_inspect_device',arguments:{deviceId:'dev_review'}}},tokens.access_token);const inspected=inspectedResp.json;assert.equal(inspected.result.structuredContent.device.name,'review-demo');assert.equal(inspected.result.structuredContent.policy.localFinalDeny,true);
const activityResp=await postMcp({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'light_remote_recent_activity',arguments:{deviceId:'dev_review',limit:10}}},tokens.access_token);const activity=activityResp.json;assert.equal(activity.result.structuredContent.events[0].type,'job_started');assert.equal(activity.result.structuredContent.events[0].jobId,undefined);
console.log('plugin_product_discovery=PASS');
const refreshBody=new URLSearchParams({grant_type:'refresh_token',client_id:reg.client_id,refresh_token:tokens.refresh_token,resource:`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`});
const refreshResp=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:refreshBody});assert.equal(refreshResp.status,200);const rotated=await refreshResp.json();assert.ok(rotated.access_token);assert.ok(rotated.refresh_token);assert.notEqual(rotated.refresh_token,tokens.refresh_token);
const replayResp=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:refreshBody});assert.equal(replayResp.status,400);assert.equal((await replayResp.json()).error,'invalid_grant');
const privacyText=await (await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/privacy`)).text();for(const term of ['Data categories and purposes','Recipients','Retention','User controls','Restricted data'])assert.match(privacyText,new RegExp(term,'i'));
const rootManifest=JSON.parse(fs.readFileSync(path.join(root,'plugin.json'),'utf8'));assert.equal(rootManifest.$schema,'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');assert.equal(rootManifest.extensions?.['com.openai']?.interface?.displayName,'Light Remote');
const portableMcp=JSON.parse(fs.readFileSync(path.join(root,'mcp.json'),'utf8'));assert.equal(portableMcp.$schema,'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');assert.equal(portableMcp.mcpServers?.['light-remote']?.type,'streamable-http');assert.equal(portableMcp.mcpServers?.['light-remote']?.url,'https://light-remote.thaiduy.digital/mcp');
console.log('plugin_oauth_authenticated_refresh_portable_privacy=PASS');

child.kill('SIGTERM');
await new Promise(resolve=>child.once('exit',resolve));
await new Promise(resolve=>operator.close(resolve));
fs.rmSync(tmp,{recursive:true,force:true});
console.log('plugin_selftest=PASS');
