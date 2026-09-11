import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashWallPassword } from '../../gateway/wall-auth.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const port=Number(process.env.LRM_DOGFOOD_PORT||18080);
const wallPort=port+1;
const externalBase=String(process.env.LRM_DOGFOOD_BASE||'').replace(/\/$/,'');
const external=Boolean(externalBase);
const base=external?externalBase:`http://127.0.0.1:${port}`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lrm-oauth-dogfood-'));
let username,password,configFile='';
if(external){
  const authFile=process.env.WALL_AUTH_FILE||path.join(os.homedir(),'.config/gpt-vps-operator/wall-auth.json');
  const passwordFile=process.env.WALL_BOOTSTRAP_PASSWORD_FILE||path.join(os.homedir(),'.config/gpt-vps-operator/wall-bootstrap-password');
  const cfg=JSON.parse(fs.readFileSync(authFile,'utf8'));
  username=String(cfg.username||''); password=fs.readFileSync(passwordFile,'utf8').trim();
  if(!username||!password)throw new Error('external_owner_credentials_unavailable');
}else{
  username='oauth-dogfood'; password=crypto.randomBytes(24).toString('base64url');
  configFile=path.join(temp,'wall-auth.json');
  fs.writeFileSync(configFile,JSON.stringify({mode:'local',username,passwordHash:hashWallPassword(password),
    cookieSecret:crypto.randomBytes(32).toString('base64url'),sessionTtlSeconds:3600}),{mode:0o600});
}
const operatorSocket=process.env.OPERATOR_SOCKET || path.join(os.homedir(),'.local/run/gpt-vps-operator/operator.sock');
const publicKeys=process.env.OPERATOR_PUBLIC_KEYS_FILE || path.join(root,'operator-public-keys.json');
let child=null,childLog='';
if(!external){
  if(!fs.existsSync(operatorSocket)) throw new Error(`operator_socket_missing:${operatorSocket}`);
  if(!fs.existsSync(publicKeys)) throw new Error(`operator_public_keys_missing:${publicKeys}`);
  child=spawn(process.execPath,['gateway/server.mjs'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,
    PORT:String(port),WALL_PORT:String(wallPort),WALL_AUTH_CONFIG_FILE:configFile,WALL_COOKIE_SECURE:'false',OPERATOR_SOCKET:operatorSocket,
    OPERATOR_PUBLIC_KEYS_FILE:publicKeys,MCP_PUBLIC_ORIGIN:base,MCP_ALLOWED_HOSTS:`127.0.0.1:${port},localhost:${port}`}});
  child.stdout.on('data',d=>{childLog+=d}); child.stderr.on('data',d=>{childLog+=d});
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitReady(){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    if(child?.exitCode!=null) throw new Error(`gateway_exited:${child.exitCode}:${childLog}`);
    try{const r=await fetch(`${base}/healthz`);if(r.ok)return;}catch{}
    await sleep(150);
  }
  throw new Error(`gateway_not_ready:${childLog}`);
}
async function jsonRequest(url,{method='GET',body,headers={},redirect='follow'}={}){
  const r=await fetch(url,{method,headers,body,redirect});
  const text=await r.text();
  let json;try{json=JSON.parse(text)}catch{json={raw:text}};
  return {r,json,text};
}
function form(values){return new URLSearchParams(Object.entries(values).map(([k,v])=>[k,String(v)])).toString();}
function parseTool(result){
  const text=result?.result?.content?.[0]?.text;
  if(typeof text!=='string') throw new Error(`tool_result_missing:${JSON.stringify(result).slice(0,500)}`);
  try{return JSON.parse(text)}catch{return {text}};
}
async function mcp(access,id,method,params={}){
  const {r,json,text}=await jsonRequest(`${base}/mcp`,{method:'POST',headers:{
    'content-type':'application/json','accept':'application/json, text/event-stream',authorization:`Bearer ${access}`
  },body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
  if(!r.ok) throw new Error(`mcp_${method}_${r.status}:${text.slice(0,500)}`);
  return json;
}
function pickSession(value){return value?.session||value?.upstream?.session||value?.result?.session||null;}
function pickJob(value){return value?.job||value?.upstream?.job||value?.result?.job||null;}
async function runNodeProof(access,device,{label,script,requiredCapabilities}){
  const agentId=`agent-${label}-${crypto.randomBytes(8).toString('hex')}`;
  const openId=`open-${label}-${crypto.randomBytes(8).toString('hex')}`;
  const opened=parseTool(await mcp(access,100+Math.floor(Math.random()*1000),'tools/call',{name:'light_remote_open_session',arguments:{
    agentId,openId,label:`OAuth fleet dogfood ${label}`,nodeId:device.nodeId,leasePreset:'30m'
  }}));
  const session=pickSession(opened);
  if(!session?.sessionId)throw new Error(`${label}_session_open_failed:${JSON.stringify(opened).slice(0,600)}`);
  try{
    const op=`op-${label}-${crypto.randomBytes(8).toString('hex')}`;
    const submitted=parseTool(await mcp(access,120+Math.floor(Math.random()*1000),'tools/call',{name:'light_remote_exec',arguments:{
      sessionId:session.sessionId,agentId,operationId:op,script,timeoutMs:30000,waitMs:7000,requiredCapabilities,note:`OAuth fleet dogfood ${label}`
    }}));
    let job=pickJob(submitted); if(!job?.jobId)throw new Error(`${label}_submit_failed`);
    for(let i=0;i<40&&job.status==='running';i++){await sleep(500);const state=parseTool(await mcp(access,140+i+Math.floor(Math.random()*1000),'tools/call',{name:'light_remote_job',arguments:{jobId:job.jobId,agentId}}));job=pickJob(state)||state;}
    if(job.status!=='ok')throw new Error(`${label}_job_failed:${JSON.stringify(job).slice(0,800)}`);
    const output=parseTool(await mcp(access,180+Math.floor(Math.random()*1000),'tools/call',{name:'light_remote_output',arguments:{jobId:job.jobId,agentId,stream:'stdout',full:true,limit:131072}}));
    const text=String(output?.stdout??output?.output??output?.text??'');
    if(!text.includes(`LIGHT_REMOTE_${label.toUpperCase()}_DOGFOOD`))throw new Error(`${label}_output_marker_missing:${JSON.stringify(output).slice(0,800)}`);
    console.log(`mcp-${label}-fleet-proof=PASS`);
  }finally{await mcp(access,220+Math.floor(Math.random()*1000),'tools/call',{name:'light_remote_close_session',arguments:{sessionId:session.sessionId,agentId}}).catch(()=>{});}
}


async function waitToolJob(access,agentId,name,args){
  const submitted=parseTool(await mcp(access,300+Math.floor(Math.random()*10000),'tools/call',{name,arguments:args}));
  let job=pickJob(submitted); if(!job?.jobId)throw new Error(`${name}_submit_failed:${JSON.stringify(submitted).slice(0,700)}`);
  for(let i=0;i<40&&job.status==='running';i++){
    await sleep(400);
    const state=parseTool(await mcp(access,400+i+Math.floor(Math.random()*10000),'tools/call',{name:'light_remote_job',arguments:{jobId:job.jobId,agentId}}));
    job=pickJob(state)||state;
  }
  if(job.status!=='ok')throw new Error(`${name}_job_failed:${JSON.stringify(job).slice(0,900)}`);
  const output=parseTool(await mcp(access,500+Math.floor(Math.random()*10000),'tools/call',{name:'light_remote_output',arguments:{jobId:job.jobId,agentId,stream:'stdout',full:true,limit:262144}}));
  return {job,text:String(output?.stdout??output?.output??output?.text??'')};
}
async function runConvenienceProof(access,device,label){
  const agentId=`agent-convenience-${label}-${crypto.randomBytes(8).toString('hex')}`;
  const opened=parseTool(await mcp(access,600+Math.floor(Math.random()*10000),'tools/call',{name:'light_remote_open_session',arguments:{
    agentId,openId:`open-convenience-${label}-${crypto.randomBytes(8).toString('hex')}`,label:`Convenience dogfood ${label}`,nodeId:device.nodeId,leasePreset:'30m'
  }}));
  const session=pickSession(opened); if(!session?.sessionId)throw new Error(`${label}_convenience_open_failed`);
  const sessionId=session.sessionId, marker=`LRM_CONVENIENCE_${label.toUpperCase()}_${crypto.randomBytes(5).toString('hex')}`;
  const suffix=crypto.randomBytes(5).toString('hex');
  const parent=device.platform==='win32'?`C:\\Users\\Public\\lrm-${suffix}`:`/tmp/lrm-${suffix}`;
  const file=device.platform==='win32'?`${parent}\\proof.txt`:`${parent}/proof.txt`;
  const createDir=device.platform==='win32'?`New-Item -ItemType Directory -Force -Path '${parent}' | Out-Null`:`mkdir -p -- '${parent}'`;
  try{
    await waitToolJob(access,agentId,'light_remote_exec',{sessionId,agentId,operationId:`op-mkdir-${crypto.randomBytes(8).toString('hex')}`,script:createDir,requiredCapabilities:['filesystem'],waitMs:7000});
    await waitToolJob(access,agentId,'light_remote_write_text_file',{sessionId,agentId,operationId:`op-write-${crypto.randomBytes(8).toString('hex')}`,path:file,content:`${marker}\nsecond-line\n`,mode:'rewrite'});
    const read=await waitToolJob(access,agentId,'light_remote_read_text_file',{sessionId,agentId,path:file,startLine:1,maxLines:10});
    if(!read.text.includes(marker))throw new Error(`${label}_convenience_read_marker_missing`);
    const list=await waitToolJob(access,agentId,'light_remote_list_directory',{sessionId,agentId,path:parent,maxEntries:500});
    if(!list.text.includes(file.split(/[\\/]/).pop()))throw new Error(`${label}_convenience_list_missing`);
    const search=await waitToolJob(access,agentId,'light_remote_search_text',{sessionId,agentId,path:parent,query:marker,maxResults:10});
    if(!search.text.includes(marker))throw new Error(`${label}_convenience_search_missing`);
    const processes=await waitToolJob(access,agentId,'light_remote_process_list',{sessionId,agentId,limit:30});
    if(!processes.text.trim())throw new Error(`${label}_convenience_process_empty`);
    const spawnScript=device.platform==='win32'
      ? "$p=Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 120' -WindowStyle Hidden -PassThru; $p.Id"
      : "nohup sleep 120 >/dev/null 2>&1 & echo $!";
    const spawned=await waitToolJob(access,agentId,'light_remote_exec',{sessionId,agentId,operationId:`op-spawn-${crypto.randomBytes(8).toString('hex')}`,script:spawnScript,requiredCapabilities:device.platform==='win32'?['filesystem','powershell']:['filesystem'],waitMs:7000});
    const pid=Number((spawned.text.match(/\b\d+\b/)||[])[0]); if(!Number.isInteger(pid)||pid<2)throw new Error(`${label}_spawn_pid_missing`);
    await waitToolJob(access,agentId,'light_remote_kill_process',{sessionId,agentId,operationId:`op-kill-${crypto.randomBytes(8).toString('hex')}`,pid,force:true});
    const verifyScript=device.platform==='win32'?`if(Get-Process -Id ${pid} -ErrorAction SilentlyContinue){throw 'still-running'}; 'KILLED'`:`if kill -0 ${pid} 2>/dev/null; then exit 9; else echo KILLED; fi`;
    const verified=await waitToolJob(access,agentId,'light_remote_exec',{sessionId,agentId,operationId:`op-verify-kill-${crypto.randomBytes(8).toString('hex')}`,script:verifyScript,requiredCapabilities:device.platform==='win32'?['filesystem','powershell','windows-process-network']:['filesystem'],waitMs:7000});
    if(!verified.text.includes('KILLED'))throw new Error(`${label}_kill_verify_missing`);
    console.log(`mcp-${label}-convenience-file-process-kill=PASS`);
  } finally {
    const cleanup=device.platform==='win32'?`Remove-Item -LiteralPath '${parent.replaceAll("'","''")}' -Recurse -Force -ErrorAction SilentlyContinue`:`rm -rf -- '${parent.replaceAll("'","'\\''")}'`;
    try{await waitToolJob(access,agentId,'light_remote_exec',{sessionId,agentId,operationId:`op-clean-${crypto.randomBytes(8).toString('hex')}`,script:cleanup,requiredCapabilities:['filesystem'],waitMs:7000});}catch{}
    await mcp(access,700+Math.floor(Math.random()*10000),'tools/call',{name:'light_remote_close_session',arguments:{sessionId,agentId}}).catch(()=>{});
  }
}

try{
  await waitReady();
  console.log('oauth-dogfood-gateway=PASS');
  const prm=await jsonRequest(`${base}/.well-known/oauth-protected-resource`);
  const asm=await jsonRequest(`${base}/.well-known/oauth-authorization-server`);
  if(!prm.r.ok||!asm.r.ok)throw new Error('oauth_metadata_unavailable');
  console.log('oauth-discovery=PASS');
  const unauth=await jsonRequest(`${base}/mcp`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
  if(unauth.r.status!==401||!String(unauth.r.headers.get('www-authenticate')||'').includes('resource_metadata='))throw new Error('mcp_oauth_challenge_missing');
  console.log('oauth-mcp-challenge=PASS');
  const redirect=`http://127.0.0.1:${port+20}/callback`;
  const reg=await jsonRequest(`${base}/oauth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:[redirect],client_name:'Light Remote OAuth dogfood'})});
  if(reg.r.status!==201)throw new Error(`oauth_register_failed:${reg.text}`);
  const clientId=reg.json.client_id;
  console.log('oauth-dcr=PASS');
  const verifier=crypto.randomBytes(48).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const state=crypto.randomBytes(18).toString('base64url');
  const q=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirect,
    code_challenge:challenge,code_challenge_method:'S256',scope:'mcp:operator offline_access',resource:`${base}/mcp`,state});
  const page=await fetch(`${base}/oauth/authorize?${q}`);
  if(!page.ok || !(await page.text()).includes('Authorize Light Remote MCP'))throw new Error('oauth_authorize_page_failed');
  console.log('oauth-authorize-page=PASS');
  const auth=await fetch(`${base}/oauth/authorize`,{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:form(Object.fromEntries([...q.entries(),['username',username],['password',password]]))});
  if(auth.status!==303)throw new Error(`oauth_authorize_failed:${auth.status}`);
  const location=auth.headers.get('location');
  const callback=new URL(location);
  if(callback.searchParams.get('state')!==state||callback.searchParams.get('iss')!==base)throw new Error('oauth_state_or_issuer_mismatch');
  const code=callback.searchParams.get('code');
  console.log('oauth-authorization-code=PASS');
  const token=await jsonRequest(`${base}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:redirect,code_verifier:verifier})});
  if(!token.r.ok||!token.json.access_token||!token.json.refresh_token)throw new Error(`oauth_token_failed:${token.text}`);
  let access=token.json.access_token;
  const replay=await jsonRequest(`${base}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:redirect,code_verifier:verifier})});
  if(replay.r.status!==400)throw new Error('oauth_code_replay_accepted');
  console.log('oauth-pkce-and-replay=PASS');
  const refresh=await jsonRequest(`${base}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form({grant_type:'refresh_token',client_id:clientId,refresh_token:token.json.refresh_token})});
  if(!refresh.r.ok||!refresh.json.access_token)throw new Error(`oauth_refresh_failed:${refresh.text}`);
  access=refresh.json.access_token;
  console.log('oauth-refresh=PASS');

  await mcp(access,10,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'light-remote-oauth-dogfood',version:'1'}});
  const listed=await mcp(access,11,'tools/list');
  const names=(listed.result?.tools||[]).map(tool=>tool.name);
  for(const required of ['light_remote_devices','light_remote_open_session','light_remote_exec','light_remote_job','light_remote_output','light_remote_close_session','light_remote_read_text_file','light_remote_list_directory','light_remote_write_text_file','light_remote_search_text','light_remote_process_list','light_remote_kill_process'])if(!names.includes(required))throw new Error(`missing_tool:${required}`);
  console.log(`mcp-tools-list=PASS count=${names.length}`);
  const devices=parseTool(await mcp(access,12,'tools/call',{name:'light_remote_devices',arguments:{}}));
  if(!devices||devices.error)throw new Error(`devices_failed:${JSON.stringify(devices).slice(0,500)}`);
  console.log('mcp-devices-live=PASS');
  const agentId=`agent-oauth-dogfood-${crypto.randomBytes(10).toString('hex')}`;
  const openId=`open-oauth-dogfood-${crypto.randomBytes(10).toString('hex')}`;
  const opened=parseTool(await mcp(access,13,'tools/call',{name:'light_remote_open_session',arguments:{
    agentId,openId,label:'OAuth dogfood ARM',workspace:'/home/ubuntu/n8n2erpnext/gpt-vps-bridge',leasePreset:'30m'
  }}));
  const session=pickSession(opened);
  if(!session?.sessionId)throw new Error(`session_open_failed:${JSON.stringify(opened).slice(0,700)}`);
  const sessionId=session.sessionId;
  console.log(`mcp-session-open=PASS id=${sessionId}`);
  const op=`op-oauth-dogfood-${crypto.randomBytes(10).toString('hex')}`;
  const submitted=parseTool(await mcp(access,14,'tools/call',{name:'light_remote_exec',arguments:{
    sessionId,agentId,operationId:op,
    cwd:'/home/ubuntu/n8n2erpnext/gpt-vps-bridge',
    script:"printf 'LIGHT_REMOTE_OAUTH_DOGFOOD\\n'; git rev-parse --short HEAD; node --version",
    timeoutMs:20000,waitMs:7000,requiredCapabilities:['filesystem'],note:'OAuth dogfood execution proof'
  }}));
  const initialJob=pickJob(submitted);
  if(!initialJob?.jobId)throw new Error(`exec_submit_failed:${JSON.stringify(submitted).slice(0,700)}`);
  const jobId=initialJob.jobId;
  console.log(`mcp-exec-submit=PASS job=${jobId}`);
  let finalJob=initialJob;
  for(let i=0;i<30 && finalJob.status==='running';i++){
    await sleep(500);
    const state=parseTool(await mcp(access,15+i,'tools/call',{name:'light_remote_job',arguments:{jobId,agentId}}));
    finalJob=pickJob(state)||state?.job||state;
  }
  if(finalJob.status!=='ok')throw new Error(`job_failed:${JSON.stringify(finalJob).slice(0,700)}`);
  console.log('mcp-job-durable=PASS');
  const output=parseTool(await mcp(access,60,'tools/call',{name:'light_remote_output',arguments:{jobId,agentId,stream:'stdout',full:true,limit:65536}}));
  const stdout=String(output?.stdout??output?.output??output?.text??'');
  if(!stdout.includes('LIGHT_REMOTE_OAUTH_DOGFOOD'))throw new Error(`output_missing_marker:${JSON.stringify(output).slice(0,700)}`);
  console.log('mcp-output-read=PASS');
  const resumed=parseTool(await mcp(access,61,'tools/call',{name:'light_remote_resume_session',arguments:{sessionId,agentId}}));
  if(!pickSession(resumed)?.sessionId)throw new Error(`session_resume_failed:${JSON.stringify(resumed).slice(0,500)}`);
  console.log('mcp-session-resume=PASS');
  const closed=parseTool(await mcp(access,62,'tools/call',{name:'light_remote_close_session',arguments:{sessionId,agentId}}));
  if(!pickSession(closed)?.sessionId)throw new Error(`session_close_failed:${JSON.stringify(closed).slice(0,500)}`);
  console.log('mcp-session-close=PASS');
  const online=(devices.devices||[]).filter(device=>device.state==='online');
  const arm=online.find(device=>device.nodeId==='arm');
  const amd=online.find(device=>device.displayName==='VPS-AMD');
  const win=online.find(device=>device.platform==='win32');
  if(arm) await runConvenienceProof(access,arm,'arm'); else throw new Error('arm_convenience_target_missing');
  if(amd){
    await runNodeProof(access,amd,{label:'amd',requiredCapabilities:['filesystem','git','docker','systemctl'],script:
      "set -e; f=$(mktemp); printf 'LIGHT_REMOTE_AMD_DOGFOOD\n' > \"$f\"; cat \"$f\"; rm -f \"$f\"; uname -m; git --version; docker --version; systemctl --version | head -1"});
  } else console.log('mcp-amd-fleet-proof=SKIP offline');
  if(amd) await runConvenienceProof(access,amd,'amd');
  if(win){
    await runNodeProof(access,win,{label:'windows',requiredCapabilities:['filesystem','powershell','git','package-manager','windows-process-network','windows-services'],script:
      "$ErrorActionPreference='Stop'; $f=Join-Path $env:TEMP 'lrm-oauth-dogfood.txt'; Set-Content -LiteralPath $f -Value 'LIGHT_REMOTE_WINDOWS_DOGFOOD'; Get-Content -LiteralPath $f; Remove-Item -LiteralPath $f -Force; git --version; Get-Process -Id $PID | Select-Object -ExpandProperty ProcessName; Get-Service | Select-Object -First 1 -ExpandProperty Name; winget --version"});
  } else console.log('mcp-windows-fleet-proof=SKIP offline');
  if(win) await runConvenienceProof(access,win,'windows');
  console.log('LIVE_V09_OAUTH_DOGFOOD=PASS');
} finally {
  if(child){ child.kill('SIGTERM'); await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(3000)]).catch(()=>{}); }
}
