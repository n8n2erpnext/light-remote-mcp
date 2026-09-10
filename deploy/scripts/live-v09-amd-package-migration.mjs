import fs from 'node:fs';
import crypto from 'node:crypto';

const base=String(process.env.BRIDGE_PROOF_BASE||'https://light-remote-mcp.vercel.app').replace(/\/$/,'');
const cfg=JSON.parse(fs.readFileSync(process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json','utf8'));
const password=fs.readFileSync(process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password','utf8').trim();
const nodeId=String(process.env.AMD_NODE||'dev_700ad1e57b626a18ffad9339');
const artifactUrl=String(process.env.AMD_ARTIFACT_URL||'');
const artifactSha=String(process.env.AMD_ARTIFACT_SHA||'').toLowerCase();
if(!(/^https:\/\//.test(artifactUrl)||/^http:\/\/100\.94\.184\.141(?::\d+)?\//.test(artifactUrl)))throw new Error('AMD_ARTIFACT_URL_required');
if(!/^[a-f0-9]{64}$/.test(artifactSha))throw new Error('AMD_ARTIFACT_SHA_required');
const shellQuote=value=>`'${String(value).replace(/'/g,"'\\''")}'`;
async function req(path,options={}){const r=await fetch(base+path,options),text=await r.text();let json;try{json=JSON.parse(text)}catch{json={raw:text}}return{status:r.status,json};}
const login=await req('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:cfg.username,password})});
if(login.status!==200||!login.json?.session?.token)throw new Error(`auth_failed:${login.status}`);
const headers={'x-bridge-session':login.json.session.token},postHeaders={...headers,'content-type':'application/json'};
const agentId='agent-v09-amd-migrate-'+crypto.randomBytes(8).toString('hex');
let sessionId=null;
async function post(action,payload={},top={}){return req('/api/operator',{method:'POST',headers:postHeaders,body:JSON.stringify({action,payload,...top})});}
async function waitJob(jobId){for(let i=0;i<40;i++){const r=await req(`/api/operator?action=job&id=${encodeURIComponent(jobId)}&aid=${encodeURIComponent(agentId)}`,{headers});if(r.status!==200)throw new Error(`job_read:${r.status}`);const job=r.json?.upstream?.job;if(job?.status!=='running')return job;await new Promise(x=>setTimeout(x,1000));}throw new Error('job_timeout');}
async function exec(script,requiredCapabilities,timeoutMs=120000){const operationId='op-v09-amd-migrate-'+crypto.randomBytes(8).toString('hex');const r=await post('exec',{operationId,script,cwd:'/home/ubuntu',timeoutMs,waitMs:7000,sessionId,agentId,nodeId,requiredCapabilities});if(r.status!==200)throw new Error(`exec_submit:${r.status}:${r.json?.upstream?.error||r.json?.error}`);return waitJob(r.json.upstream.job.jobId);}
const opened=await post('session-open',{agentId,openId:'open-v09-amd-migrate-'+crypto.randomBytes(8).toString('hex'),label:'v0.9 AMD packaged migration',workspace:'/home/ubuntu',leasePreset:'30m',nodeId});
if(opened.status!==200)throw new Error(`session_open:${opened.status}:${opened.json?.upstream?.error}`);
sessionId=opened.json.upstream.session.sessionId;
try{
  const runId=crypto.randomBytes(6).toString('hex');
  const work=`/home/ubuntu/.cache/light-remote-mcp/v09-amd-migrate-${runId}`;
  const zip=`${work}/artifact.zip`;
  const bundle=`${work}/dist/linux/x64/GPT-Operator-Agent-Linux-x64-dev.tar.gz`;
  const installer=`${work}/client/linux/install.sh`;
  const prepare=`set -euo pipefail; rm -rf ${shellQuote(work)}; mkdir -p ${shellQuote(work)}; curl -fsSL ${shellQuote(artifactUrl)} -o ${shellQuote(zip)}; printf '%s  %s\\n' ${shellQuote(artifactSha)} ${shellQuote(zip)} | sha256sum -c -; python3 - ${shellQuote(zip)} ${shellQuote(work)} <<'PY'\nimport sys,zipfile\nz=zipfile.ZipFile(sys.argv[1]); z.extractall(sys.argv[2])\nPY\ncd ${shellQuote(`${work}/dist/linux/x64`)}; sha256sum -c SHA256SUMS.txt; cd ${shellQuote(work)}; tar -tzf ${shellQuote(bundle)} | grep -q 'package/device-agent/linux-service-policy.mjs'; echo PACKAGE_DOWNLOAD_OK`;
  const prepared=await exec(prepare,['filesystem','build-test'],120000);
  if(prepared.status!=='ok'||!prepared.stdout?.includes('PACKAGE_DOWNLOAD_OK'))throw new Error(`prepare_failed:${prepared.status}:${prepared.stderr||prepared.stdout}`);

  const stamp=Date.now();
  const install=`set -euo pipefail; backup=/home/ubuntu/.cache/light-remote-mcp/amd-before-package-${stamp}; mkdir -p "$backup"; cp -a /etc/systemd/system/gpt-operator-device-agent.service "$backup/"; cp -a /opt/gpt-operator-agent/device-agent "$backup/device-agent"; bash ${shellQuote(installer)} --bundle ${shellQuote(bundle)} --user ubuntu; echo INSTALL_OK; readlink -f /opt/gpt-operator-agent/current; systemctl is-enabled gpt-operator-agent-update.timer; grep -E '^(ExecStart|NoNewPrivileges|RestrictSUIDSGID|CapabilityBoundingSet)' /etc/systemd/system/gpt-operator-device-agent.service`;
  const installed=await exec(install,['filesystem','build-test','sudo-on-demand','systemctl'],120000);
  if(installed.status!=='ok'||!installed.stdout?.includes('INSTALL_OK'))throw new Error(`install_failed:${installed.status}:${installed.stderr||installed.stdout}`);
  const restartUnit=`lrm-v09-agent-restart-${crypto.randomBytes(5).toString('hex')}`;
  const scheduled=await exec(`sudo systemd-run --unit=${shellQuote(restartUnit)} --on-active=5s /bin/systemctl restart gpt-operator-device-agent.service`,['filesystem','sudo-on-demand','systemctl']);
  if(scheduled.status!=='ok')throw new Error(`restart_schedule_failed:${scheduled.status}:${scheduled.stderr||scheduled.stdout}`);
  await new Promise(resolve=>setTimeout(resolve,12000));

  const postcheck=await exec(`set -euo pipefail; echo '--- status ---'; /opt/gpt-operator-agent/current/runtime/node /opt/gpt-operator-agent/current/device-agent/operator-agent.mjs status; echo '--- service ---'; systemctl is-active gpt-operator-device-agent.service; systemctl is-active gpt-operator-agent-update.timer; pid=$(systemctl show -p MainPID --value gpt-operator-device-agent.service); echo PID=$pid; tr '\\0' ' ' < /proc/$pid/cmdline; echo; echo '--- unit-policy ---'; grep -E '^(ExecStart|NoNewPrivileges|RestrictSUIDSGID|CapabilityBoundingSet)' /etc/systemd/system/gpt-operator-device-agent.service; echo '--- sudo ---'; sudo -n true; echo SUDO_OK`,['filesystem','build-test','sudo-on-demand','systemctl'],30000);
  if(postcheck.status!=='ok'||!postcheck.stdout?.includes('SUDO_OK')||!postcheck.stdout?.includes('/opt/gpt-operator-agent/current/runtime/node'))throw new Error(`postcheck_failed:${postcheck.status}:${postcheck.stderr||postcheck.stdout}`);

  const cleanup=await exec(`rm -rf ${shellQuote(work)}; echo CLEANUP_OK`,['filesystem']);
  console.log(JSON.stringify({proof:'LIVE_V09_AMD_PACKAGE_MIGRATION_PASS',nodeId,prepared:{jobId:prepared.jobId},installed:{jobId:installed.jobId,stdout:installed.stdout},restart:{jobId:scheduled.jobId,unit:restartUnit},postcheck:{jobId:postcheck.jobId,stdout:postcheck.stdout},cleanup:{jobId:cleanup.jobId,status:cleanup.status}},null,2));
  console.log('LIVE_V09_AMD_PACKAGE_MIGRATION=PASS');
} finally {
  if(sessionId){try{await post('session-close',{}, {sid:sessionId,aid:agentId});}catch{}}
}
