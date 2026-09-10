import fs from 'node:fs';
import crypto from 'node:crypto';

const base=String(process.env.BRIDGE_PROOF_BASE||'https://light-remote-mcp.vercel.app').replace(/\/$/,'');
const cfg=JSON.parse(fs.readFileSync(process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json','utf8'));
const password=fs.readFileSync(process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password','utf8').trim();
const AMD_NODE=String(process.env.V08_AMD_NODE||'dev_700ad1e57b626a18ffad9339');
async function request(path,options={}){
  const response=await fetch(base+path,options); const text=await response.text();
  let json; try{json=JSON.parse(text);}catch{json={raw:text};}
  return {status:response.status,json};
}
const login=await request('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:cfg.username,password})});
if(login.status!==200||!login.json?.session?.token) throw new Error(`auth_failed:${login.status}`);
const token=login.json.session.token;
const headers={'x-bridge-session':token};
const postHeaders={...headers,'content-type':'application/json'};
const agentArm='agent-v08-arm-'+crypto.randomBytes(12).toString('hex');
const agentAmd='agent-v08-amd-'+crypto.randomBytes(12).toString('hex');
const cleanup=[];
async function post(action,payload={},top={}){
  return request('/api/operator',{method:'POST',headers:postHeaders,body:JSON.stringify({action,payload,...top})});
}
async function waitJob(jobId,agentId){
  for(let i=0;i<20;i++){
    const row=await request(`/api/operator?action=job&id=${encodeURIComponent(jobId)}&aid=${encodeURIComponent(agentId)}`,{headers});
    if(row.status!==200) throw new Error(`job_read_failed:${row.status}`);
    if(row.json?.upstream?.job?.status!=='running') return row.json.upstream.job;
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error('job_wait_timeout');
}
async function closeSession(sessionId,agentId){
  return post('session-close',{}, {sid:sessionId,aid:agentId});
}
try{
  const caps=await request('/api/operator?action=capabilities',{headers});
  if(caps.status!==200||caps.json?.upstream?.version!=='0.8.0-dev') throw new Error(`caps_failed:${caps.status}`);
  const fleet=await request('/api/operator?action=fleet',{headers});
  const nodes=fleet.json?.upstream?.nodes||[];
  if(fleet.status!==200||!nodes.find(n=>n.nodeId==='arm'&&n.state==='online')||!nodes.find(n=>n.nodeId===AMD_NODE&&n.state==='online')) throw new Error('fleet_not_ready');
  const arm=await post('session-open',{agentId:agentArm,openId:'open-v08-arm-'+crypto.randomBytes(8).toString('hex'),label:'v0.8 ARM acceptance',workspace:'/home/ubuntu',leasePreset:'30m',nodeId:'arm'});
  if(arm.status!==200) throw new Error(`arm_open_failed:${arm.status}:${arm.json?.error}`);
  const armSid=arm.json.upstream.session.sessionId; cleanup.push(()=>closeSession(armSid,agentArm));
  const amd=await post('session-open',{agentId:agentAmd,openId:'open-v08-amd-'+crypto.randomBytes(8).toString('hex'),label:'v0.8 AMD acceptance',workspace:'/home/ubuntu',leasePreset:'30m',nodeId:AMD_NODE});
  if(amd.status!==200) throw new Error(`amd_open_failed:${amd.status}:${amd.json?.error}`);
  const amdSid=amd.json.upstream.session.sessionId; cleanup.push(()=>closeSession(amdSid,agentAmd));
  const armExec=await post('exec',{operationId:'op-v08-arm-'+crypto.randomBytes(8).toString('hex'),script:`printf 'ARM:%s:%s\\n' "$(hostname)" "$(uname -m)"`,cwd:'/home/ubuntu',timeoutMs:15000,waitMs:7000,sessionId:armSid,agentId:agentArm,nodeId:'arm',requiredCapabilities:['filesystem']});
  if(armExec.status!==200) throw new Error(`arm_exec_failed:${armExec.status}:${armExec.json?.error}`);
  const armJob=await waitJob(armExec.json.upstream.job.jobId,agentArm);
  if(armJob.status!=='ok'||!armJob.stdout?.includes('aarch64')) throw new Error(`arm_output_failed:${armJob.status}`);
  const amdExec=await post('exec',{operationId:'op-v08-amd-'+crypto.randomBytes(8).toString('hex'),script:`printf 'AMD:%s:%s\\n' "$(hostname)" "$(uname -m)"`,cwd:'/home/ubuntu',timeoutMs:15000,waitMs:7000,sessionId:amdSid,agentId:agentAmd,nodeId:AMD_NODE,requiredCapabilities:['filesystem']});
  if(amdExec.status!==200) throw new Error(`amd_exec_failed:${amdExec.status}:${amdExec.json?.error}`);
  const amdJob=await waitJob(amdExec.json.upstream.job.jobId,agentAmd);
  if(amdJob.status!=='ok'||!amdJob.stdout?.includes('x86_64')) throw new Error(`amd_output_failed:${amdJob.status}:${amdJob.stdout}`);
  const closedAmd=await closeSession(amdSid,agentAmd);
  if(closedAmd.status!==200) throw new Error(`amd_close_failed:${closedAmd.status}`);
  cleanup.pop();
  const drained=await post('node-drain',{nodeId:AMD_NODE,draining:true});
  if(drained.status!==200||!drained.json?.upstream?.node?.draining) throw new Error(`drain_failed:${drained.status}`);
  cleanup.push(()=>post('node-drain',{nodeId:AMD_NODE,draining:false}));
  const blocked=await post('session-open',{agentId:'agent-v08-blocked-'+crypto.randomBytes(12).toString('hex'),openId:'open-v08-blocked-'+crypto.randomBytes(8).toString('hex'),label:'must not fallback',workspace:'/home/ubuntu',leasePreset:'30m',nodeId:AMD_NODE});
  if(blocked.status!==409||blocked.json?.upstream?.error!=='target_node_draining'||blocked.json?.upstream?.session) throw new Error(`silent_fallback_guard_failed:${blocked.status}:${blocked.json?.upstream?.error}`);
  const undrained=await post('node-drain',{nodeId:AMD_NODE,draining:false});
  if(undrained.status!==200||undrained.json?.upstream?.node?.draining) throw new Error(`undrain_failed:${undrained.status}`);
  cleanup.pop();
  const closedArm=await closeSession(armSid,agentArm);
  if(closedArm.status!==200) throw new Error(`arm_close_failed:${closedArm.status}`);
  cleanup.shift();
  const finalFleet=await request('/api/operator?action=fleet',{headers});
  const amdFinal=finalFleet.json?.upstream?.nodes?.find(n=>n.nodeId===AMD_NODE);
  if(finalFleet.status!==200||!amdFinal||amdFinal.state!=='online'||amdFinal.draining||amdFinal.activeSessions!==0) throw new Error('fleet_cleanup_failed');
  console.log(JSON.stringify({version:caps.json.upstream.version,arm:{nodeId:armJob.nodeId,output:armJob.stdout.trim()},amd:{nodeId:amdJob.nodeId,output:amdJob.stdout.trim()},drainGuard:{status:blocked.status,error:blocked.json.upstream.error},fleet:{amdState:amdFinal.state,amdActiveSessions:amdFinal.activeSessions,amdDraining:amdFinal.draining}},null,2));
  console.log('LIVE_V08_FLEET_PROOF=PASS');
} finally {
  for(const fn of cleanup.reverse()) { try { await fn(); } catch {} }
}
