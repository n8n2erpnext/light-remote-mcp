import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';
import { ipcEndpoint, removeIpcEndpoint, waitForIpc } from './selftest-ipc.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt-vps-idem-'+String(process.pid)+'-'));
const socket=ipcEndpoint('gpt-vps-idem'),logDir=path.join(dir,'log'),marker=path.join(dir,'marker'),stateDir=path.join(dir,'state');
removeIpcEndpoint(socket);fs.mkdirSync(logDir,{recursive:true});
const cryptoFixture=createOperatorCryptoFixture(stateDir);
const child=spawn(process.execPath,[path.join(root,'operator-host','executor.mjs')],{cwd:root,env:{...process.env,OPERATOR_SOCKET:socket,OPERATOR_LOG_DIR:logDir,OPERATOR_STATE_DIR:stateDir,OPERATOR_KEY_FILE:cryptoFixture.privateFile},stdio:['ignore','pipe','pipe']});
let childLog='';child.stdout.on('data',d=>childLog+=d);child.stderr.on('data',d=>childLog+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function raw(method,target,body){return new Promise((resolve,reject)=>{const b=body==null?null:Buffer.from(JSON.stringify(body));const q=http.request({socketPath:socket,path:target,method,headers:b?{'content-type':'application/json','content-length':b.length}:{}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{resolve({status:r.statusCode,json:JSON.parse(d)})}catch(error){reject(error)}});});q.on('error',reject);q.setTimeout(15000,()=>q.destroy(new Error('request_timeout:'+method+':'+target)));if(b)q.end(b);else q.end();});}
function req(body){return raw('POST','/v1/execute',body);}
async function stopChild(){if(child.exitCode!=null)return;try{child.kill('SIGTERM')}catch{}await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(1000)]);if(child.exitCode==null){try{child.kill('SIGKILL')}catch{}}}

try{
  await waitForIpc(socket,{attempts:80,delayMs:50,error:'socket_not_ready',details:()=>childLog});
  const agentId='agent-idempotency-v05-aaaaaaaa';
  const opened=await raw('POST','/v1/sessions/open',{agentId,openId:'idempotency-open-v05'});
  if(opened.status!==200)throw new Error('session_open_failed:'+opened.status);
  const sessionId=opened.json.session.sessionId,operationId='idempotency-selftest-v05';
  const psMarker=marker.replace(/'/g,"''");
  const appendScript=value=>process.platform==='win32'?"[IO.File]::AppendAllText('"+psMarker+"','"+value+"')":"printf '"+value+"' >> "+JSON.stringify(marker);
  const payload={action:'exec_batch',operationId,cwd:dir,script:appendScript('x'),sessionId,agentId,note:'same logical operation',waitMs:5000,timeoutMs:10000};
  const a=await req(cryptoFixture.seal(payload));
  const b=await req(cryptoFixture.seal(payload));
  if(a.status!==200||b.status!==200||a.json.job?.jobId!==b.json.job?.jobId)throw new Error('dedupe_failed:'+a.status+':'+b.status);
  if(fs.readFileSync(marker,'utf8')!=='x')throw new Error('side_effect_ran_more_than_once');
  const conflictPayload={...payload,script:appendScript('y')};
  const c=await req(cryptoFixture.seal(conflictPayload));
  if(c.status!==409||c.json.error!=='operation_id_conflict')throw new Error('conflict_guard_failed:'+c.status+':'+c.json.error);
  let audit='';for(let i=0;i<50;i++){try{audit=fs.readFileSync(path.join(logDir,'operations.jsonl'),'utf8')}catch{}if(audit.includes(operationId))break;await sleep(20)}
  const starts=audit.split('\n').filter(line=>line.includes('"type":"job_started"')&&line.includes(operationId)).length;
  if(starts!==1)throw new Error('expected_one_job_started_got_'+starts);
  console.log(JSON.stringify({ok:true,operationId,jobId:a.json.job.jobId,dedupedJobId:b.json.job.jobId,marker:fs.readFileSync(marker,'utf8'),conflict:c.json.error,jobStarts:starts},null,2));
}finally{
  await stopChild();
  removeIpcEndpoint(socket);
  fs.rmSync(dir,{recursive:true,force:true});
}
