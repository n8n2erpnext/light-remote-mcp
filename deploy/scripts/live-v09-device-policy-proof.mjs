import fs from 'node:fs';
import crypto from 'node:crypto';

const base=String(process.env.BRIDGE_PROOF_BASE||'https://light-remote-mcp.vercel.app').replace(/\/$/,'');
const cfg=JSON.parse(fs.readFileSync(process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json','utf8'));
const password=fs.readFileSync(process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password','utf8').trim();
const nodeId=String(process.env.V09_POLICY_NODE||'dev_ffc2a5da8b9e0f75fd9f3508');
const workspace=String(process.env.V09_POLICY_WORKSPACE||'C:\\Users\\Public');
const targetCapability=String(process.env.V09_POLICY_CAPABILITY||'package-manager');

async function req(path,options={}){
  const r=await fetch(base+path,options), text=await r.text();
  let json; try{json=JSON.parse(text)}catch{json={raw:text}}
  return {status:r.status,json};
}

const login=await req('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:cfg.username,password})});
if(login.status!==200||!login.json?.session?.token)throw new Error(`auth_failed:${login.status}`);
const token=login.json.session.token, headers={'x-bridge-session':token}, postHeaders={...headers,'content-type':'application/json'};
const agentId='agent-v09-policy-'+crypto.randomBytes(10).toString('hex');
let sessionId=null, originalPolicy=null, changed=false;

async function post(action,payload={},top={}){
  return req('/api/operator',{method:'POST',headers:postHeaders,body:JSON.stringify({action,payload,...top})});
}
async function waitJob(jobId){
  for(let i=0;i<30;i++){
    const r=await req(`/api/operator?action=job&id=${encodeURIComponent(jobId)}&aid=${encodeURIComponent(agentId)}`,{headers});
    if(r.status!==200)throw new Error(`job_read:${r.status}`);
    const job=r.json?.upstream?.job;
    if(job?.status!=='running')return job;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('job_timeout');
}

async function exec(script,requiredCapabilities,expectOk=true){
  const operationId='op-v09-policy-'+crypto.randomBytes(8).toString('hex');
  const r=await post('exec',{operationId,script,cwd:workspace,timeoutMs:20000,waitMs:7000,sessionId,agentId,nodeId,requiredCapabilities});
  if(r.status!==200)throw new Error(`exec_submit:${r.status}:${r.json?.upstream?.error||r.json?.error}`);
  const job=await waitJob(r.json.upstream.job.jobId);
  if(expectOk&&job.status!=='ok')throw new Error(`exec_failed:${job.status}:${job.stderr||''}`);
  return job;
}

async function device(){
  const r=await req(`/api/operator?action=device&id=${encodeURIComponent(nodeId)}`,{headers});
  if(r.status!==200)throw new Error(`device_read:${r.status}`);
  return r.json?.upstream?.device;
}

async function setPolicy(policyProfile,approvedCapabilities){
  const r=await post('device-policy',{deviceId:nodeId,policyProfile,approvedCapabilities});
  if(r.status!==200)throw new Error(`policy_update:${r.status}:${r.json?.upstream?.error||r.json?.error}`);
  return r.json?.upstream?.policy;
}
async function readAgentStatus(){
  const script=`$root=Join-Path $env:LOCALAPPDATA 'Programs\\Light Remote MCP'; & (Join-Path $root 'runtime\\node.exe') (Join-Path $root 'agent\\device-agent\\operator-agent.mjs') status`;
  const job=await exec(script,['filesystem','powershell']);
  const line=(job.stdout||'').trim();
  let value; try{value=JSON.parse(line)}catch{throw new Error(`agent_status_parse:${line}`)}
  return {job,value};
}

async function waitAgentRevision(revision,capabilityExpected){
  for(let i=0;i<20;i++){
    const {value}=await readAgentStatus();
    const effective=Array.isArray(value.effectiveCapabilities)?value.effectiveCapabilities:[];
    if(Number(value.policyRevision)===Number(revision)&&effective.includes(targetCapability)===capabilityExpected)return value;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error(`agent_policy_revision_timeout:${revision}`);
}

try{
  const d=await device();
  if(!d||d.state!=='online')throw new Error(`policy_target_not_online:${d?.state}`);
  if(!d.policy)throw new Error('policy_view_missing');
  originalPolicy={policyProfile:d.policy.policyProfile,approvedCapabilities:[...d.policy.approvedCapabilities]};
  if(!d.policy.grantableCapabilities.includes(targetCapability))throw new Error(`capability_not_grantable:${targetCapability}`);
  if(!originalPolicy.approvedCapabilities.includes(targetCapability))throw new Error(`capability_not_currently_approved:${targetCapability}`);

  const opened=await post('session-open',{agentId,openId:'open-v09-policy-'+crypto.randomBytes(8).toString('hex'),label:'v0.9 Device Policy acceptance',workspace,leasePreset:'30m',nodeId});
  if(opened.status!==200)throw new Error(`session_open:${opened.status}:${opened.json?.upstream?.error}`);
  sessionId=opened.json.upstream.session.sessionId;
  const restrictedCaps=originalPolicy.approvedCapabilities.filter(cap=>cap!==targetCapability);
  const restricted=await setPolicy(originalPolicy.policyProfile,restrictedCaps);
  changed=true;
  const restrictedStatus=await waitAgentRevision(restricted.policyRevision,false);

  const denied=await exec('winget --version',['filesystem','powershell'],false);
  if(denied.exitCode!==126||!/local capability denied: package-manager/.test(denied.stderr||'')){
    throw new Error(`local_policy_deny_missing:${JSON.stringify({status:denied.status,exitCode:denied.exitCode,stderr:denied.stderr})}`);
  }

  const restored=await setPolicy(originalPolicy.policyProfile,originalPolicy.approvedCapabilities);
  changed=false;
  const restoredStatus=await waitAgentRevision(restored.policyRevision,true);
  const allowed=await exec('winget --version',['filesystem','powershell']);

  console.log(JSON.stringify({
    proof:'LIVE_V09_DEVICE_POLICY_PASS',nodeId,targetCapability,
    restrictedRevision:restricted.policyRevision,
    restrictedEffective:restrictedStatus.effectiveCapabilities,
    denied:{jobId:denied.jobId,exitCode:denied.exitCode,stderr:(denied.stderr||'').trim()},
    restoredRevision:restored.policyRevision,
    restoredEffective:restoredStatus.effectiveCapabilities,
    allowed:{jobId:allowed.jobId,exitCode:allowed.exitCode,stdout:(allowed.stdout||'').trim()}
  },null,2));
  console.log('LIVE_V09_DEVICE_POLICY_PROOF=PASS');
} finally {
  if(changed&&originalPolicy){try{await setPolicy(originalPolicy.policyProfile,originalPolicy.approvedCapabilities);}catch(error){console.error(`POLICY_RESTORE_FAILED:${error.message}`);}}
  if(sessionId){try{await post('session-close',{}, {sid:sessionId,aid:agentId});}catch{}}
}
