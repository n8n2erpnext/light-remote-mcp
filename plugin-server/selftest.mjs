import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-plugin-selftest-'));
const socket=path.join(tmp,'operator.sock');
const secretFile=path.join(tmp,'oauth-secret');
fs.writeFileSync(secretFile,crypto.randomBytes(48).toString('base64url'),{mode:0o600});

const reviewerPassword=`Reviewer-${crypto.randomBytes(12).toString('hex')}`;
let reviewSessionState='active',reviewHoldReason=null;
console.log('plugin_account_isolation=covered_by_rc30_selftests');
const operator=http.createServer(async(req,res)=>{
  const chunks=[]; for await(const c of req) chunks.push(c);
  let body={}; try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{}
  res.setHeader('content-type','application/json');
  if(req.method==='POST'&&req.url==='/v1/plugin/auth/verify'){
    if(body.email==='reviewer@example.test'&&body.password===reviewerPassword) return res.end(JSON.stringify({ok:true,account:{accountId:'reviewer',email:'reviewer@example.test'}}));
    res.statusCode=401; return res.end(JSON.stringify({ok:false,error:'invalid_account_credentials'}));
  }
  const reviewDevice={deviceId:'dev_review',nodeId:'dev_review',accountId:'reviewer',displayName:'review-demo',platform:'linux',architecture:'arm64',state:'online',capabilities:['filesystem','terminal'],effectiveCapabilities:['filesystem','terminal'],policyProfile:'review',routing:{mode:'local',state:'online',draining:false,sessionCeiling:2,queuedCommands:0,inFlightCommands:0},connection:{state:'connected',plan:'vip',enforced:true,reconnectGraceMs:1800000},updateStatus:{state:'managed',currentVersion:'0.9.0-rc.30',helperVersion:'server-managed',mode:'server-managed'}};
  if(req.method==='GET'&&req.url==='/v1/plugin/accounts/reviewer/devices') return res.end(JSON.stringify({ok:true,account:{accountId:'reviewer',plan:'vip',mainDeviceId:'dev_review'},devices:[reviewDevice]}));
  if(req.method==='GET'&&req.url.startsWith('/v1/agent-client/by-agent?')){const u=new URL(req.url,'http://local');const agentId=u.searchParams.get('agentId');return res.end(JSON.stringify({ok:true,client:{clientSessionId:'lrc_review',accountId:'reviewer',agentId,expiresAt:Date.now()+3600000,defaultDeviceId:'dev_review',bindings:[{deviceId:'dev_review'}]}}));}
  if(req.method==='GET'&&req.url.startsWith('/v1/agent-client/lrc_review/devices?')) return res.end(JSON.stringify({ok:true,client:{clientSessionId:'lrc_review'},devices:[reviewDevice]}));
  if(req.method==='POST'&&req.url==='/v1/agent-client/resolve') return res.end(JSON.stringify({ok:true,binding:{deviceId:'dev_review',clientSessionId:'lrc_review'},device:reviewDevice,connection:{state:'connected'}}));
  if(req.method==='POST'&&req.url==='/v1/agent-client/context') return res.end(JSON.stringify({ok:true,context:{deviceId:'dev_review',sessionId:'s_review',agentId:body.agentId,nodeId:'dev_review',workspace:body.workspace||'/review',gracePreset:body.gracePreset||'60m',platform:'linux',architecture:'arm64',deviceState:'online',connectionState:'connected'},session:{accountId:'reviewer',deviceId:'dev_review',sessionId:'s_review',agentId:body.agentId,nodeId:'dev_review',state:'active',workspace:body.workspace||'/review',gracePreset:body.gracePreset||'60m',reconnectCount:0}}));
  if(req.method==='GET'&&req.url.startsWith('/v1/plugin/sessions/s_review?')){const u=new URL(req.url,'http://local');return res.end(JSON.stringify({ok:true,session:{accountId:'reviewer',deviceId:'dev_review',sessionId:'s_review',agentId:u.searchParams.get('agentId'),nodeId:'dev_review',state:reviewSessionState,workspace:'/review',gracePreset:'60m',holdReason:reviewHoldReason,reconnectCount:0}}));}
  if(req.method==='POST'&&req.url==='/v1/plugin/sessions/s_review/hold'){reviewSessionState='hold';reviewHoldReason=String(body.reason||'transport_lost');return res.end(JSON.stringify({ok:true,session:{accountId:'reviewer',deviceId:'dev_review',sessionId:'s_review',agentId:body.agentId,nodeId:'dev_review',state:reviewSessionState,workspace:'/review',gracePreset:'60m',holdReason:reviewHoldReason,reconnectCount:0}}));}
  if(req.method==='POST'&&req.url==='/v1/plugin/sessions/s_review/resume'){reviewSessionState='active';reviewHoldReason=null;return res.end(JSON.stringify({ok:true,session:{accountId:'reviewer',deviceId:'dev_review',sessionId:'s_review',agentId:body.agentId,nodeId:'dev_review',state:reviewSessionState,workspace:'/review',gracePreset:'60m',holdReason:null,reconnectCount:1}}));}
  if(req.method==='GET'&&req.url==='/v1/devices/dev_review') return res.end(JSON.stringify({ok:true,device:reviewDevice}));
  if(req.method==='GET'&&req.url==='/v1/plugin/accounts/reviewer') return res.end(JSON.stringify({ok:true,account:{accountId:'reviewer',email:'reviewer@example.test',plan:'vip',mainDeviceId:'dev_review',fleetProvisioning:{deviceId:'dev_review',state:'online',moduleVersion:'0.9.0-rc.30',port:5492}}}));
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
const postMcp=async(body,token='')=>{const r=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});const text=await r.text();assert.ok(r.status<500,`mcp_http_${r.status}:${text}`);return JSON.parse(text)};
const init=await postMcp({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'selftest',version:'1'}}});
assert.equal(init.result.serverInfo.name,'light-remote');assert.equal(init.result.serverInfo.version,'0.1.4');
assert.match(init.result.instructions,/A\/B approval authorizes each exact device/i);
assert.doesNotMatch(init.result.instructions,/helperGroup=|tool-family menu|detailed syntax/i);
const listed=await postMcp({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
assert.equal(listed.result.tools.length,67);
const toolNames=new Set(listed.result.tools.map(t=>t.name));
for(const name of [
  'light_remote_context','light_remote_session_control','light_remote_hold_session',
  'light_remote_search_files','light_remote_search_results','light_remote_cancel_search',
  'light_remote_filesystem','light_remote_copy_path','light_remote_move_path','light_remote_delete_path',
  'light_remote_process','light_remote_process_input','light_remote_process_output','light_remote_list_processes','light_remote_stop_process',
  'light_remote_terminal','light_remote_terminal_input','light_remote_terminal_output','light_remote_resize_terminal','light_remote_signal_terminal','light_remote_list_terminals','light_remote_stop_terminal',
  'light_remote_scp_download','light_remote_scp_download_chunk','light_remote_scp_download_status','light_remote_scp_download_cancel',
  'light_remote_scp','light_remote_scp_upload_chunk','light_remote_scp_upload_commit','light_remote_scp_upload_status','light_remote_scp_upload_cancel',
  'light_remote_desktop','light_remote_desktop_attach','light_remote_desktop_resume','light_remote_desktop_detach','light_remote_desktop_windows','light_remote_desktop_frame','light_remote_desktop_observe',
  'light_remote_semantic_attach','light_remote_semantic_snapshot','light_remote_semantic_events','light_remote_semantic_detach',
  'light_remote_desktop_live_open','light_remote_desktop_live_read','light_remote_desktop_live_close',
  'light_remote_desktop_input','light_remote_desktop_input_batch','light_remote_desktop_action_await'
])assert.ok(toolNames.has(name),name+'_present');
for(const tool of listed.result.tools){
  assert.ok(Array.isArray(tool.securitySchemes)&&tool.securitySchemes.length===1,tool.name+'_securitySchemes');
  assert.equal(tool.securitySchemes[0].type,'oauth2');
  assert.ok(tool.annotations,tool.name+'_annotations');
  for(const hint of ['readOnlyHint','destructiveHint','openWorldHint'])assert.equal(typeof tool.annotations[hint],'boolean',tool.name+'_'+hint+'_boolean');
  assert.equal(tool.inputSchema?.properties?.operation,undefined,tool.name+'_must_not_multiplex_operations');
}
const execTool=listed.result.tools.find(t=>t.name==='light_remote_exec');
const processTool=listed.result.tools.find(t=>t.name==='light_remote_process');
const processOutputTool=listed.result.tools.find(t=>t.name==='light_remote_process_output');
const termTool=listed.result.tools.find(t=>t.name==='light_remote_terminal');
const termInputTool=listed.result.tools.find(t=>t.name==='light_remote_terminal_input');
const searchTool=listed.result.tools.find(t=>t.name==='light_remote_search_files');
const outputTool=listed.result.tools.find(t=>t.name==='light_remote_output');
const helperTool=listed.result.tools.find(t=>t.name==='light_remote_connection_helper');
const mainTool=listed.result.tools.find(t=>t.name==='light_remote_set_main_device');
const revokeTool=listed.result.tools.find(t=>t.name==='light_remote_revoke_device');
const removeTool=listed.result.tools.find(t=>t.name==='light_remote_remove_device');
const scpDownloadTool=listed.result.tools.find(t=>t.name==='light_remote_scp_download');
const scpTool=listed.result.tools.find(t=>t.name==='light_remote_scp');
const scpCommitTool=listed.result.tools.find(t=>t.name==='light_remote_scp_upload_commit');
const desktopTool=listed.result.tools.find(t=>t.name==='light_remote_desktop');
const desktopAttachTool=listed.result.tools.find(t=>t.name==='light_remote_desktop_attach');
const desktopFrameTool=listed.result.tools.find(t=>t.name==='light_remote_desktop_frame');
const semanticAttachTool=listed.result.tools.find(t=>t.name==='light_remote_semantic_attach');
const desktopInputTool=listed.result.tools.find(t=>t.name==='light_remote_desktop_input');
const desktopInputBatchTool=listed.result.tools.find(t=>t.name==='light_remote_desktop_input_batch');
for(const tool of [execTool,processTool,termInputTool]){assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.annotations.destructiveHint,true);assert.equal(tool.annotations.openWorldHint,true)}
assert.equal(termTool.annotations.readOnlyHint,false);assert.equal(termTool.annotations.destructiveHint,false);assert.equal(termTool.annotations.openWorldHint,false);
assert.equal(processOutputTool.annotations.readOnlyHint,true);assert.equal(processOutputTool.annotations.destructiveHint,false);assert.equal(processOutputTool.annotations.openWorldHint,false);
assert.equal(helperTool.annotations.readOnlyHint,false);assert.equal(helperTool.annotations.destructiveHint,false);assert.equal(helperTool.annotations.openWorldHint,false);
assert.deepEqual(helperTool.inputSchema?.properties?.helperGroup?.enum,['workspace','files','shell','transfer','desktop']);
for(const key of ['shell','requiredCapabilities'])assert.ok(execTool.inputSchema?.properties?.[key],'exec_'+key+'_present');
for(const key of ['shell','requiredCapabilities'])assert.ok(processTool.inputSchema?.properties?.[key],'process_'+key+'_present');
assert.ok(termTool.inputSchema?.properties?.term,'terminal_term_present');
for(const key of ['contextLines','maxResults'])assert.ok(searchTool.inputSchema?.properties?.[key],'search_'+key+'_present');
assert.ok(outputTool.inputSchema?.properties?.full,'output_full_present');
assert.equal(outputTool.inputSchema?.properties?.limit?.maximum,8388608);
assert.equal(desktopTool.annotations.readOnlyHint,true);assert.equal(desktopTool.securitySchemes[0].scopes[0],'remote:read');
assert.equal(desktopAttachTool.annotations.readOnlyHint,false);assert.equal(desktopAttachTool.annotations.destructiveHint,false);
assert.equal(desktopFrameTool.inputSchema?.properties?.screen?.minimum,-1);
for(const key of ['cdpEndpoint','targetId','urlMatch'])assert.ok(semanticAttachTool.inputSchema?.properties?.[key],'semantic_attach_'+key+'_present');
for(const tool of [desktopInputTool,desktopInputBatchTool]){assert.equal(tool.annotations.destructiveHint,true);assert.equal(tool.annotations.openWorldHint,true);assert.equal(tool.securitySchemes[0].scopes[0],'remote:execute')}
const liveReadTool=listed.result.tools.find(t=>t.name==='light_remote_desktop_live_read');assert.equal(liveReadTool.annotations.readOnlyHint,true);assert.equal(liveReadTool.securitySchemes[0].scopes[0],'remote:read');
assert.equal(scpDownloadTool.annotations.readOnlyHint,false);assert.equal(scpDownloadTool.annotations.destructiveHint,false);assert.equal(scpDownloadTool.securitySchemes[0].scopes[0],'remote:read');
assert.equal(scpTool.annotations.destructiveHint,false);assert.equal(scpTool.securitySchemes[0].scopes[0],'remote:write');
assert.equal(scpCommitTool.annotations.destructiveHint,true);
assert.equal(mainTool.annotations.readOnlyHint,false);assert.equal(mainTool.annotations.destructiveHint,false);
for(const tool of [revokeTool,removeTool]){assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.annotations.destructiveHint,true);assert.equal(tool.annotations.openWorldHint,false)}
console.log('plugin_tool_metadata=PASS');

const unauth=await postMcp({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'light_remote_list_devices',arguments:{}}});
assert.equal(unauth.result.isError,true);assert.ok(unauth.result._meta?.['mcp/www_authenticate']?.[0]?.includes('oauth-protected-resource/mcp'));
console.log('plugin_auth_challenge=PASS');
const meta=await (await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/.well-known/oauth-authorization-server`)).json();
assert.deepEqual(meta.code_challenge_methods_supported,['S256']);
assert.ok(meta.registration_endpoint.endsWith('/oauth/register'));assert.ok(meta.userinfo_endpoint.endsWith('/userinfo'));assert.equal(meta.authorization_response_iss_parameter_supported,true);assert.equal(meta.client_id_metadata_document_supported,false);assert.ok(meta.scopes_supported.includes('openid'));assert.ok(meta.scopes_supported.includes('email'));
const resource=await (await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/.well-known/oauth-protected-resource/mcp`)).json();
assert.equal(resource.resource,`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`);
assert.ok(resource.scopes_supported.includes('remote:terminal'));assert.ok(resource.scopes_supported.includes('openid'));assert.ok(resource.scopes_supported.includes('email'));

const redirect='https://client.example.invalid/callback';
const regResp=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'OpenAI selftest',redirect_uris:[redirect],token_endpoint_auth_method:'none',scope:'remote:read remote:write offline_access openid email'})});
assert.equal(regResp.status,201);const reg=await regResp.json();assert.ok(reg.client_id);
const verifier=crypto.randomBytes(48).toString('base64url');
const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
const authUrl=new URL(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/authorize`);
authUrl.search=new URLSearchParams({client_id:reg.client_id,redirect_uri:redirect,response_type:'code',code_challenge:challenge,code_challenge_method:'S256',resource:`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`,scope:'remote:read remote:write',state:'state123'}).toString();
const authPage=await fetch(authUrl);assert.equal(authPage.status,200);assert.match(String(authPage.headers.get('content-security-policy')||''),/form-action 'self' https:\/\/chatgpt\.com/);assert.match(await authPage.text(),/Requested permissions:<\/strong>\s*remote:read/);
console.log('plugin_oauth_discovery_dcr_pkce=PASS');
const authBody=new URLSearchParams({client_id:reg.client_id,redirect_uri:redirect,response_type:'code',code_challenge:challenge,code_challenge_method:'S256',resource:`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`,scope:'remote:read remote:write offline_access openid email',state:'state123',email:'reviewer@example.test',password:reviewerPassword});
const authSubmit=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/authorize`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:authBody,redirect:'manual'});
assert.equal(authSubmit.status,303);const callback=new URL(authSubmit.headers.get('location'));assert.equal(callback.searchParams.get('state'),'state123');assert.equal(callback.searchParams.get('iss'),env.LIGHT_REMOTE_PLUGIN_ORIGIN);const code=callback.searchParams.get('code');assert.ok(code);
const tokenBody=new URLSearchParams({grant_type:'authorization_code',client_id:reg.client_id,code,redirect_uri:redirect,code_verifier:verifier,resource:`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`});
const tokenResp=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:tokenBody});assert.equal(tokenResp.status,200);const tokens=await tokenResp.json();assert.ok(tokens.access_token);assert.ok(tokens.refresh_token);assert.match(tokens.scope,/remote:read/);assert.match(tokens.scope,/remote:write/);assert.match(tokens.scope,/openid/);assert.match(tokens.scope,/email/);const userinfoResp=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/userinfo`,{headers:{authorization:`Bearer ${tokens.access_token}`}});assert.equal(userinfoResp.status,200);const userinfo=await userinfoResp.json();assert.equal(userinfo.sub,'reviewer');assert.equal(userinfo.email,'reviewer@example.test');assert.equal(userinfo.email_verified,true);
const authDevices=await postMcp({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'light_remote_list_devices',arguments:{}}},tokens.access_token);assert.equal(authDevices.result.isError,undefined);assert.equal(authDevices.result.structuredContent.items.length,1);assert.equal(authDevices.result.structuredContent.items[0].name,'review-demo');assert.equal(authDevices.result.structuredContent.items[0].accountId,undefined);
const helper=await postMcp({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'light_remote_connection_helper',arguments:{}}},tokens.access_token);assert.equal(helper.result.structuredContent.product,'Light Remote');assert.equal(helper.result.structuredContent.account.plan,'vip');assert.equal(helper.result.structuredContent.topology[0].role,'main');assert.equal(helper.result.structuredContent.topology[0].accountId,undefined);assert.equal(helper.result.structuredContent.context.sessionId,'s_review');assert.equal(helper.result.structuredContent.toolHelper.helperMode,'index-only');assert.deepEqual(Object.keys(helper.result.structuredContent.toolHelper.groups),['workspace','files','shell','transfer','desktop']);
const filesHelper=await postMcp({jsonrpc:'2.0',id:51,method:'tools/call',params:{name:'light_remote_connection_helper',arguments:{helperGroup:'files'}}},tokens.access_token);assert.equal(filesHelper.result.structuredContent.toolHelper.helperMode,'group-detail');assert.equal(filesHelper.result.structuredContent.toolHelper.group,'files');assert.equal(filesHelper.result.structuredContent.toolHelper.tools.read_many.name,'light_remote_read_multiple_files');
const legacyHeld=await postMcp({jsonrpc:'2.0',id:52,method:'tools/call',params:{name:'light_remote_session_control',arguments:{sessionId:'s_review',operation:'hold',reason:'legacy-selftest'}}},tokens.access_token);assert.equal(legacyHeld.result.isError,undefined);assert.equal(legacyHeld.result.structuredContent.state,'hold');assert.equal(legacyHeld.result.structuredContent.holdReason,'legacy-selftest');
const resumed=await postMcp({jsonrpc:'2.0',id:53,method:'tools/call',params:{name:'light_remote_session_control',arguments:{sessionId:'s_review'}}},tokens.access_token);assert.equal(resumed.result.isError,undefined);assert.equal(resumed.result.structuredContent.state,'active');assert.equal(resumed.result.structuredContent.holdReason,null);
const held=await postMcp({jsonrpc:'2.0',id:54,method:'tools/call',params:{name:'light_remote_hold_session',arguments:{sessionId:'s_review',reason:'focused-selftest'}}},tokens.access_token);assert.equal(held.result.isError,undefined);assert.equal(held.result.structuredContent.state,'hold');assert.equal(held.result.structuredContent.holdReason,'focused-selftest');
const legacyResumed=await postMcp({jsonrpc:'2.0',id:55,method:'tools/call',params:{name:'light_remote_session_control',arguments:{sessionId:'s_review',operation:'resume'}}},tokens.access_token);assert.equal(legacyResumed.result.isError,undefined);assert.equal(legacyResumed.result.structuredContent.state,'active');console.log('plugin_session_control_focused_and_legacy=PASS');
const inspected=await postMcp({jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'light_remote_inspect_device',arguments:{deviceId:'dev_review'}}},tokens.access_token);assert.equal(inspected.result.structuredContent.device.name,'review-demo');assert.equal(inspected.result.structuredContent.policy.localFinalDeny,true);
const activity=await postMcp({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'light_remote_recent_activity',arguments:{deviceId:'dev_review',limit:10}}},tokens.access_token);assert.equal(activity.result.structuredContent.events[0].type,'job_started');assert.equal(activity.result.structuredContent.events[0].jobId,undefined);
console.log('plugin_product_discovery=PASS');
const refreshBody=new URLSearchParams({grant_type:'refresh_token',client_id:reg.client_id,refresh_token:tokens.refresh_token,resource:`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/mcp`});
const refreshResp=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:refreshBody});assert.equal(refreshResp.status,200);const rotated=await refreshResp.json();assert.ok(rotated.access_token);assert.ok(rotated.refresh_token);assert.notEqual(rotated.refresh_token,tokens.refresh_token);
const replayResp=await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:refreshBody});assert.equal(replayResp.status,400);assert.equal((await replayResp.json()).error,'invalid_grant');
const privacyText=await (await fetch(`${env.LIGHT_REMOTE_PLUGIN_ORIGIN}/privacy`)).text();for(const term of ['Data used to provide the service','Purpose and sharing','Retention and controls','Restricted secrets'])assert.match(privacyText,new RegExp(term,'i'));
const rootManifest=JSON.parse(fs.readFileSync(path.join(root,'plugin.json'),'utf8'));assert.equal(rootManifest.$schema,'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');assert.equal(rootManifest.version,'0.1.3');assert.equal(rootManifest.extensions?.['com.openai']?.interface?.displayName,'Light Remote');
const codexManifest=JSON.parse(fs.readFileSync(path.join(root,'.codex-plugin','plugin.json'),'utf8'));assert.equal(codexManifest.name,'light-remote');assert.equal(codexManifest.interface?.displayName,'Light Remote');
const portableMcp=JSON.parse(fs.readFileSync(path.join(root,'mcp.json'),'utf8'));assert.equal(portableMcp.$schema,'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');assert.equal(portableMcp.mcpServers?.['light-remote']?.type,'streamable-http');assert.equal(portableMcp.mcpServers?.['light-remote']?.url,'https://light-remote.thaiduy.digital/mcp');
console.log('plugin_oauth_authenticated_refresh_portable_privacy=PASS');

child.kill('SIGTERM');
await new Promise(resolve=>child.once('exit',resolve));
await new Promise(resolve=>operator.close(resolve));
fs.rmSync(tmp,{recursive:true,force:true});
console.log('plugin_selftest=PASS');
