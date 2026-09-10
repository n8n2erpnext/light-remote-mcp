import fs from 'node:fs';
import crypto from 'node:crypto';
const base=String(process.env.BRIDGE_PROOF_BASE||'https://light-remote-mcp.vercel.app').replace(/\/$/,'');
const cfg=JSON.parse(fs.readFileSync(process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json','utf8'));
const password=fs.readFileSync(process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password','utf8').trim();
const nodeId=String(process.env.V09_WINDOWS_NODE||'');
const workspace=String(process.env.V09_WINDOWS_WORKSPACE||'C:\\Users\\Public');
if(!nodeId)throw new Error('V09_WINDOWS_NODE_required');
async function req(path,options={}){const r=await fetch(base+path,options);const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}}return{status:r.status,json:j};}
const login=await req('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:cfg.username,password})});
if(login.status!==200||!login.json?.session?.token)throw new Error(`auth_failed:${login.status}`);
const token=login.json.session.token,headers={'x-bridge-session':token},postHeaders={...headers,'content-type':'application/json'};
const agentId='agent-v09-win-'+crypto.randomBytes(10).toString('hex');let sessionId=null;
async function post(action,payload={},top={}){return req('/api/operator',{method:'POST',headers:postHeaders,body:JSON.stringify({action,payload,...top})});}
async function waitJob(jobId){for(let i=0;i<30;i++){const r=await req(`/api/operator?action=job&id=${encodeURIComponent(jobId)}&aid=${encodeURIComponent(agentId)}`,{headers});if(r.status!==200)throw new Error(`job_read:${r.status}`);const j=r.json?.upstream?.job;if(j?.status!=='running')return j;await new Promise(r=>setTimeout(r,1000));}throw new Error('job_timeout');}
async function exec(script,requiredCapabilities){const op='op-v09-win-'+crypto.randomBytes(8).toString('hex');const r=await post('exec',{operationId:op,script,cwd:workspace,timeoutMs:20000,waitMs:7000,sessionId,agentId,nodeId,requiredCapabilities});if(r.status!==200)throw new Error(`exec_submit:${r.status}:${r.json?.upstream?.error||r.json?.error}`);const j=await waitJob(r.json.upstream.job.jobId);if(j.status!=='ok')throw new Error(`exec_failed:${j.status}:${j.stderr||''}`);return j;}
try{
  const fleet=await req('/api/operator?action=fleet',{headers});const win=fleet.json?.upstream?.nodes?.find(n=>n.nodeId===nodeId);
  if(fleet.status!==200||!win||win.state!=='online')throw new Error(`windows_not_online:${fleet.status}:${win?.state}`);
  const opened=await post('session-open',{agentId,openId:'open-v09-win-'+crypto.randomBytes(8).toString('hex'),label:'v0.9 Windows acceptance',workspace,leasePreset:'30m',nodeId});
  if(opened.status!==200)throw new Error(`session_open:${opened.status}:${opened.json?.upstream?.error}`);sessionId=opened.json.upstream.session.sessionId;
  const host=await exec(`Write-Output ("HOST:"+$env:COMPUTERNAME+":"+[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture+":PS"+$PSVersionTable.PSVersion.ToString())`,['filesystem','powershell']);
  const file=await exec(`$p=Join-Path $env:TEMP 'gpt-operator-v09-proof.txt'; 'windows-fs-ok' | Set-Content -LiteralPath $p -Encoding utf8; $v=(Get-Content -LiteralPath $p -Raw).Trim(); Remove-Item -LiteralPath $p -Force; Write-Output ("FS:"+$v)`,['filesystem','powershell']);
  const build=await exec(`git --version; & "$env:LOCALAPPDATA\\GPTOperatorAgent\\runtime\\node.exe" -e "console.log('NODE:'+process.arch)"`,['filesystem','powershell','git','build-test']);
  const proc=await exec(`$p=Get-Process -Id $PID | Select-Object -First 1 ProcessName,Id; $n=Get-NetTCPConnection | Select-Object -First 1 LocalAddress,LocalPort,State; Write-Output ('PROC:' + ($p | ConvertTo-Json -Compress)); Write-Output ('NET:' + ($n | ConvertTo-Json -Compress))`,['filesystem','powershell','windows-process-network']);
  const svc=await exec(`$s=Get-Service | Select-Object -First 3 Name,Status; Write-Output ('SVC:' + ($s | ConvertTo-Json -Compress))`,['filesystem','powershell','windows-services']);
  const evt=await exec(`$e=Get-WinEvent -LogName Application -MaxEvents 1 | Select-Object Id,ProviderName,LevelDisplayName; Write-Output ('EVENT:' + ($e | ConvertTo-Json -Compress))`,['filesystem','powershell','windows-eventlog']);
  const pkg=await exec(`if(Get-Command winget -ErrorAction SilentlyContinue){Write-Output ('PKG:winget:'+(winget --version))}elseif(Get-Command choco -ErrorAction SilentlyContinue){Write-Output ('PKG:choco:'+(choco --version))}else{throw 'package_manager_missing'}`,['filesystem','powershell','package-manager']);
  console.log(JSON.stringify({node:{nodeId:win.nodeId,state:win.state,capabilities:win.capabilities},host:host.stdout.trim(),filesystem:file.stdout.trim(),build:build.stdout.trim().split(/\r?\n/),processNetwork:proc.stdout.trim().split(/\r?\n/),services:svc.stdout.trim(),eventlog:evt.stdout.trim(),packageManager:pkg.stdout.trim()},null,2));
  console.log('LIVE_V09_WINDOWS_PROOF=PASS');
} finally {
  if(sessionId){try{await post('session-close',{}, {sid:sessionId,aid:agentId});}catch{}}
}
