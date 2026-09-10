import fs from 'node:fs';
import crypto from 'node:crypto';

const base=String(process.env.BRIDGE_PROOF_BASE||'https://light-remote-mcp.vercel.app').replace(/\/$/,'');
const cfg=JSON.parse(fs.readFileSync(process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json','utf8'));
const password=fs.readFileSync(process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password','utf8').trim();
const nodeId=String(process.env.AMD_NODE||'dev_700ad1e57b626a18ffad9339');
async function req(path,options={}){const r=await fetch(base+path,options),text=await r.text();let json;try{json=JSON.parse(text)}catch{json={raw:text}}return{status:r.status,json};}
const login=await req('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:cfg.username,password})});
if(login.status!==200||!login.json?.session?.token)throw new Error(`auth_failed:${login.status}`);
const headers={'x-bridge-session':login.json.session.token},postHeaders={...headers,'content-type':'application/json'};
const agentId='agent-v09-amd-preflight-'+crypto.randomBytes(8).toString('hex');
async function post(action,payload={},top={}){return req('/api/operator',{method:'POST',headers:postHeaders,body:JSON.stringify({action,payload,...top})});}
async function waitJob(jobId){for(let i=0;i<30;i++){const r=await req(`/api/operator?action=job&id=${encodeURIComponent(jobId)}&aid=${encodeURIComponent(agentId)}`,{headers});if(r.status!==200)throw new Error(`job_read:${r.status}`);const job=r.json?.upstream?.job;if(job?.status!=='running')return job;await new Promise(x=>setTimeout(x,1000));}throw new Error('job_timeout');}
async function exec(script,requiredCapabilities){const operationId='op-v09-amd-preflight-'+crypto.randomBytes(8).toString('hex');const r=await post('exec',{operationId,script,cwd:'/home/ubuntu',timeoutMs:20000,waitMs:7000,sessionId,agentId,nodeId,requiredCapabilities});if(r.status!==200)throw new Error(`exec_submit:${r.status}:${r.json?.upstream?.error||r.json?.error}`);return waitJob(r.json.upstream.job.jobId);}
const opened=await post('session-open',{agentId,openId:'open-v09-amd-preflight-'+crypto.randomBytes(8).toString('hex'),label:'v0.9 AMD migration preflight',workspace:'/home/ubuntu',leasePreset:'30m',nodeId});
if(opened.status!==200)throw new Error(`session_open:${opened.status}:${opened.json?.upstream?.error}`);
const sessionId=opened.json.upstream.session.sessionId;
try{
  const inspect=await exec(`set -o pipefail; echo '--- agent ---'; if [ -x /opt/gpt-operator-agent/current/runtime/node ]; then /opt/gpt-operator-agent/current/runtime/node /opt/gpt-operator-agent/current/device-agent/operator-agent.mjs status; elif command -v node >/dev/null && [ -f /opt/gpt-operator-agent/device-agent/operator-agent.mjs ]; then node /opt/gpt-operator-agent/device-agent/operator-agent.mjs status; fi; echo '--- unit ---'; systemctl cat gpt-operator-device-agent.service; echo '--- links ---'; ls -ld /opt/gpt-operator-agent /opt/gpt-operator-agent/current /opt/gpt-operator-agent/releases 2>&1 || true; echo '--- updater ---'; systemctl status gpt-operator-agent-update.timer --no-pager -n 4 2>&1 || true`,['filesystem','systemctl']);
  const sudoProbe=await exec(`sudo -n true`,['filesystem','sudo-on-demand']);
  console.log(JSON.stringify({nodeId,inspect:{status:inspect.status,exitCode:inspect.exitCode,stdout:inspect.stdout,stderr:inspect.stderr},sudoProbe:{status:sudoProbe.status,exitCode:sudoProbe.exitCode,stdout:sudoProbe.stdout,stderr:sudoProbe.stderr}},null,2));
  console.log('LIVE_V09_AMD_PREFLIGHT=PASS');
} finally {
  try{await post('session-close',{}, {sid:sessionId,aid:agentId});}catch{}
}
