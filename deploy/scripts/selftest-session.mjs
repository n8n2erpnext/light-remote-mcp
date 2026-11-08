import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';
import { ipcEndpoint, removeIpcEndpoint, waitForIpc } from './selftest-ipc.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt-vps-session-selftest-'+String(process.pid)+'-'));
const socketPath=ipcEndpoint('gpt-vps-session-selftest'),logDir=path.join(dir,'log'),stateDir=path.join(dir,'state');
removeIpcEndpoint(socketPath);fs.mkdirSync(logDir,{recursive:true});
const cryptoFixture=createOperatorCryptoFixture(stateDir);
const child=spawn(process.execPath,[path.join(root,'operator-host','executor.mjs')],{cwd:root,env:{...process.env,OPERATOR_SOCKET:socketPath,OPERATOR_LOG_DIR:logDir,OPERATOR_STATE_DIR:stateDir,OPERATOR_KEY_FILE:cryptoFixture.privateFile,OPERATOR_SESSION_IDLE_MS:'800',OPERATOR_SESSION_MIN_IDLE_MS:'100',OPERATOR_SESSION_MAX_IDLE_MS:'5000',OPERATOR_SESSION_ACTIVE_WINDOW_MS:'500',OPERATOR_MAX_ACTIVE_SESSIONS:'3',OPERATOR_SESSION_HISTORY_MS:'10000',OPERATOR_NODE_ID:'arm'},stdio:['ignore','pipe','pipe']});
let childLog='';child.stdout.on('data',d=>childLog+=d);child.stderr.on('data',d=>childLog+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function request(method,target,body){return new Promise((resolve,reject)=>{const payload=body==null?null:Buffer.from(JSON.stringify(body));const req=http.request({socketPath,method,path:target,headers:payload?{'content-type':'application/json','content-length':payload.length}:{}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json={raw:text}}resolve({status:res.statusCode,json})});});req.on('error',reject);req.setTimeout(15000,()=>req.destroy(new Error('request_timeout:'+method+':'+target)));if(payload)req.write(payload);req.end();});}
async function stopChild(){if(child.exitCode!=null)return;try{child.kill('SIGTERM')}catch{}await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(1000)]);if(child.exitCode==null){try{child.kill('SIGKILL')}catch{}}}

try{
  await waitForIpc(socketPath,{attempts:80,delayMs:50,error:'socket_not_ready',details:()=>childLog});
  const aid='agent-selftest-v05-aaaaaaaa',other='agent-selftest-v05-bbbbbbbb',openId='session-open-selftest-v05';
  const opened=await request('POST','/v1/sessions/open',{openId,agentId:aid,label:'long-build',workspace:dir});
  if(opened.status!==200||opened.json.session.leaseMs!==800||!opened.json.session.deviceId||!opened.json.session.accountId)throw new Error('open_failed');
  const sid=opened.json.session.sessionId;
  const sameAgent=await request('POST','/v1/sessions/open',{openId:'session-open-selftest-v05-new',agentId:aid,label:'other'});
  if(sameAgent.status!==200||sameAgent.json.session.sessionId!==sid)throw new Error('one_agent_one_session_failed');
  const wrongResume=await request('POST','/v1/sessions/'+sid+'/resume',{agentId:other});
  if(wrongResume.status!==409||wrongResume.json.error!=='session_owner_mismatch')throw new Error('owner_guard_failed');
  const holdScript=process.platform==='win32'?"Start-Sleep -Milliseconds 1400; Write-Output 'held-ok'":"sleep 1.4; printf 'held-ok\\n'";
  const env=cryptoFixture.seal({action:'exec_batch',operationId:'session-hold-selftest-v05',cwd:dir,script:holdScript,sessionId:sid,agentId:aid,waitMs:0,timeoutMs:5000});
  const exec=await request('POST','/v1/execute',env);
  if(exec.status!==200||exec.json.job.status!=='running')throw new Error('exec_not_running:'+exec.status+':'+exec.json.job?.status);
  await sleep(950);
  const held=await request('GET','/v1/sessions/'+sid+'?agentId='+aid);
  if(held.json.session.state!=='hold'||held.json.session.activeJobs.length!==1)throw new Error('hold_failed');
  let released=null;
  for(let i=0;i<50;i++){await sleep(50);released=await request('GET','/v1/sessions/'+sid+'?agentId='+aid);if(released.json.session.state==='active'&&released.json.session.activeJobs.length===0)break;}
  if(!released||released.json.session.state!=='active'||released.json.session.activeJobs.length!==0)throw new Error('release_failed');
  await sleep(900);
  const expired=await request('GET','/v1/sessions/'+sid+'?agentId='+aid);
  if(expired.json.session.state!=='expired')throw new Error('expiry_failed');
  const a=await request('POST','/v1/sessions/open',{agentId:'agent-cap-a-v05-aaaaaaaa',leaseMs:1600});
  const b=await request('POST','/v1/sessions/open',{agentId:'agent-cap-b-v05-bbbbbbbb'});
  const c=await request('POST','/v1/sessions/open',{agentId:'agent-cap-c-v05-cccccccc'});
  const d=await request('POST','/v1/sessions/open',{agentId:'agent-cap-d-v05-dddddddd'});
  if([a,b,c].some(x=>x.status!==200)||a.json.session.leaseMs!==1600||d.status!==429)throw new Error('capacity_failed');
  const stats=await request('GET','/v1/session-stats?hours=1');
  const row=stats.json.sessions?.find(x=>x.sessionId===sid);
  if(!row||row.execCalls<1||row.holdStarts!==1||row.holdReleases!==1)throw new Error('session_stats_failed');
  console.log(JSON.stringify({ok:true,nodeId:opened.json.session.nodeId,sessionId:sid,agentId:aid,wrongAgentStatus:wrongResume.status,oneAgentOneSession:sameAgent.json.session.sessionId===sid,held:held.json.session.state,released:released.json.session.state,expired:expired.json.session.state,capacityStatus:d.status},null,2));
}finally{
  await stopChild();
  removeIpcEndpoint(socketPath);
  fs.rmSync(dir,{recursive:true,force:true});
}
