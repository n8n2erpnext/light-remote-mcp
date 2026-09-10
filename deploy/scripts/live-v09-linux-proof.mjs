import fs from 'node:fs';
import crypto from 'node:crypto';
const base=String(process.env.BRIDGE_PROOF_BASE||'https://light-remote-mcp.vercel.app').replace(/\/$/,'');
const cfg=JSON.parse(fs.readFileSync(process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json','utf8'));
const password=fs.readFileSync(process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password','utf8').trim();
const nodeId=String(process.env.V09_LINUX_NODE||'');
const workspace=String(process.env.V09_LINUX_WORKSPACE||'/home/ubuntu');
if(!nodeId)throw new Error('V09_LINUX_NODE_required');
async function req(path,options={}){const r=await fetch(base+path,options);const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}}return{status:r.status,json:j};}
const login=await req('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:cfg.username,password})});
if(login.status!==200||!login.json?.session?.token)throw new Error(`auth_failed:${login.status}`);
const token=login.json.session.token,headers={'x-bridge-session':token},postHeaders={...headers,'content-type':'application/json'};
const agentId='agent-v09-linux-'+crypto.randomBytes(10).toString('hex');let sessionId=null;
async function post(action,payload={},top={}){return req('/api/operator',{method:'POST',headers:postHeaders,body:JSON.stringify({action,payload,...top})});}
async function waitJob(jobId){for(let i=0;i<30;i++){const r=await req(`/api/operator?action=job&id=${encodeURIComponent(jobId)}&aid=${encodeURIComponent(agentId)}`,{headers});if(r.status!==200)throw new Error(`job_read:${r.status}`);const j=r.json?.upstream?.job;if(j?.status!=='running')return j;await new Promise(r=>setTimeout(r,1000));}throw new Error('job_timeout');}
async function exec(script,requiredCapabilities=['filesystem']){const op='op-v09-linux-'+crypto.randomBytes(8).toString('hex');const r=await post('exec',{operationId:op,script,cwd:workspace,timeoutMs:20000,waitMs:7000,sessionId,agentId,nodeId,requiredCapabilities});if(r.status!==200)throw new Error(`exec_submit:${r.status}:${r.json?.upstream?.error||r.json?.error}`);const j=await waitJob(r.json.upstream.job.jobId);if(j.status!=='ok')throw new Error(`exec_failed:${j.status}:${j.stderr||''}`);return j;}
try{
  const fleet=await req('/api/operator?action=fleet',{headers});const node=fleet.json?.upstream?.nodes?.find(n=>n.nodeId===nodeId);
  if(fleet.status!==200||!node||node.state!=='online')throw new Error(`linux_not_online:${fleet.status}:${node?.state}`);
  const opened=await post('session-open',{agentId,openId:'open-v09-linux-'+crypto.randomBytes(8).toString('hex'),label:'v0.9 Linux adapter acceptance',workspace,leasePreset:'30m',nodeId});
  if(opened.status!==200)throw new Error(`session_open:${opened.status}:${opened.json?.upstream?.error}`);sessionId=opened.json.upstream.session.sessionId;
  const status=await exec(`node /opt/gpt-operator-agent/device-agent/operator-agent.mjs status`,['filesystem']);
  const git=await exec(`git --version`,['filesystem']);
  const sudo=await exec(`sudo -n systemctl is-active gpt-operator-device-agent.service`,['filesystem']);
  console.log(JSON.stringify({node:{nodeId:node.nodeId,state:node.state,capabilities:node.capabilities},agentStatus:status.stdout.trim(),gitInference:git.stdout.trim(),sudoSystemctlInference:sudo.stdout.trim()},null,2));
  console.log('LIVE_V09_LINUX_PROOF=PASS');
} finally {
  if(sessionId){try{await post('session-close',{}, {sid:sessionId,aid:agentId});}catch{}}
}
