import fs from 'node:fs';
import crypto from 'node:crypto';

const base=String(process.env.BRIDGE_PROOF_BASE||'https://light-remote-mcp.vercel.app').replace(/\/$/,'');
const cfg=JSON.parse(fs.readFileSync(process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json','utf8'));
const password=fs.readFileSync(process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password','utf8').trim();
const nodeId=String(process.env.V09_AMD_NODE||'dev_700ad1e57b626a18ffad9339');
const manifestUrl='https://github.com/n8n2erpnext/light-remote-mcp/releases/latest/download/client-update.json';
const signatureUrl='https://github.com/n8n2erpnext/light-remote-mcp/releases/latest/download/client-update.json.sig';
const shellQuote=value=>`'${String(value).replace(/'/g,"'\\''")}'`;
async function req(path,options={}){const r=await fetch(base+path,options),t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}}return{status:r.status,json:j};}
const login=await req('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:cfg.username,password})});
if(login.status!==200||!login.json?.session?.token)throw new Error(`auth_failed:${login.status}`);
const headers={'x-bridge-session':login.json.session.token},postHeaders={...headers,'content-type':'application/json'};
const agentId='agent-v09-channel-cutover-'+crypto.randomBytes(8).toString('hex');let sessionId=null;
async function post(action,payload={},top={}){return req('/api/operator',{method:'POST',headers:postHeaders,body:JSON.stringify({action,payload,...top})});}
async function waitJob(jobId){for(let i=0;i<45;i++){const r=await req(`/api/operator?action=job&id=${encodeURIComponent(jobId)}&aid=${encodeURIComponent(agentId)}`,{headers});if(r.status!==200)throw new Error(`job_read:${r.status}`);const j=r.json?.upstream?.job;if(j?.status!=='running')return j;await new Promise(r=>setTimeout(r,1000));}throw new Error('job_timeout');}
async function exec(script,caps,timeoutMs=30000){const r=await post('exec',{operationId:'op-v09-channel-'+crypto.randomBytes(8).toString('hex'),script,cwd:'/home/ubuntu',timeoutMs,waitMs:7000,sessionId,agentId,nodeId,requiredCapabilities:caps});if(r.status!==200)throw new Error(`exec_submit:${r.status}:${r.json?.upstream?.error||r.json?.error}`);return waitJob(r.json.upstream.job.jobId);}
try{
  const opened=await post('session-open',{agentId,openId:'open-v09-channel-'+crypto.randomBytes(8).toString('hex'),label:'v0.9 release channel cutover',workspace:'/home/ubuntu',leasePreset:'30m',nodeId});
  if(opened.status!==200)throw new Error(`session_open:${opened.status}:${opened.json?.upstream?.error}`);sessionId=opened.json.upstream.session.sessionId;
  const stamp=Date.now(),unit='/etc/systemd/system/gpt-operator-agent-update.service';
  const rootTask=`set -e; backup=/home/ubuntu/backups/light-remote-mcp/update-channel-${stamp}; mkdir -p "$backup"; cp -a ${unit} "$backup/"; sed -i 's#^Environment=GPT_OPERATOR_UPDATE_MANIFEST_URL=.*#Environment=GPT_OPERATOR_UPDATE_MANIFEST_URL=${manifestUrl}#' ${unit}; sed -i 's#^Environment=GPT_OPERATOR_UPDATE_SIGNATURE_URL=.*#Environment=GPT_OPERATOR_UPDATE_SIGNATURE_URL=${signatureUrl}#' ${unit}; chown root:root ${unit}; chmod 0644 ${unit}; systemctl daemon-reload; echo ROOT_CHANNEL_CUTOVER_OK; echo BACKUP=$backup`;
  const unitName='lrm-v09-channel-cutover-'+crypto.randomBytes(5).toString('hex');
  const mutate=`sudo systemd-run --wait --collect --quiet --unit=${shellQuote(unitName)} /bin/bash -lc ${shellQuote(rootTask)}; echo CHANNEL_CUTOVER_OK`;
  const changed=await exec(mutate,['filesystem','sudo-on-demand','systemctl']);
  if(changed.status!=='ok'||!changed.stdout?.includes('CHANNEL_CUTOVER_OK'))throw new Error(`channel_mutation_failed:${changed.status}:${changed.stderr||changed.stdout}`);
  const verify=`set -e; grep -Fx 'Environment=GPT_OPERATOR_UPDATE_MANIFEST_URL=${manifestUrl}' ${unit}; grep -Fx 'Environment=GPT_OPERATOR_UPDATE_SIGNATURE_URL=${signatureUrl}' ${unit}; ! grep -q '100.94.184.141:5590' ${unit}; systemctl is-active gpt-operator-device-agent.service; systemctl is-active gpt-operator-agent-update.timer; readlink -f /opt/gpt-operator-agent/current; systemctl show gpt-operator-device-agent.service -p ActiveState -p SubState -p MainPID -p NRestarts; echo CHANNEL_VERIFY_OK`;
  const checked=await exec(verify,['filesystem','systemctl']);
  if(checked.status!=='ok'||!checked.stdout?.includes('CHANNEL_VERIFY_OK'))throw new Error(`channel_verify_failed:${checked.status}:${checked.stderr||checked.stdout}`);
  console.log(JSON.stringify({proof:'LIVE_V09_RELEASE_CHANNEL_CUTOVER_PASS',nodeId,mutationJob:changed.jobId,verifyJob:checked.jobId,mutation:changed.stdout.trim(),verification:checked.stdout.trim()},null,2));
  console.log('LIVE_V09_RELEASE_CHANNEL_CUTOVER=PASS');
} finally {
  if(sessionId){try{await post('session-close',{}, {sid:sessionId,aid:agentId});}catch{}}
}
