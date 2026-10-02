import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createOperatorCryptoFixture} from './selftest-crypto-fixture.mjs';
import { ipcEndpoint, waitForIpc } from './selftest-ipc.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url)),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-host-exec-infer-')),socket=ipcEndpoint('lr-host-exec-infer'),logDir=path.join(dir,'log'),stateDir=path.join(dir,'state');
fs.mkdirSync(logDir,{recursive:true});const cryptoFixture=createOperatorCryptoFixture(stateDir);
const child=spawn(process.execPath,[`${root}/operator-host/executor.mjs`],{cwd:root,env:{...process.env,OPERATOR_SOCKET:socket,OPERATOR_LOG_DIR:logDir,OPERATOR_STATE_DIR:stateDir,OPERATOR_KEY_FILE:cryptoFixture.privateFile},stdio:['ignore','pipe','pipe']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));await waitForIpc(socket,{attempts:100,delayMs:40,error:'operator_not_ready'});
function raw(method,target,body){return new Promise((resolve,reject)=>{const b=body==null?null:Buffer.from(JSON.stringify(body)),q=http.request({socketPath:socket,method,path:target,headers:b?{'content-type':'application/json','content-length':b.length}:{}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{let json={};try{json=JSON.parse(d)}catch{}resolve({status:r.statusCode,json});});});q.on('error',reject);if(b)q.write(b);q.end();});}
try{
  const inferredCapability=process.platform==='win32'?'windows-process-network':'sudo-on-demand';
  const inferredScript=process.platform==='win32'?'Get-Process':'sudo -n true';
  const companionFile=path.join(stateDir,'host-companion-device.json'),companion=JSON.parse(fs.readFileSync(companionFile,'utf8'));companion.policy={...(companion.policy||{}),deniedCapabilities:[inferredCapability]};companion.effectiveCapabilities=(companion.effectiveCapabilities||[]).filter(x=>x!==inferredCapability);fs.writeFileSync(companionFile,JSON.stringify(companion));
  const agentId='agent-host-exec-infer-aaaaaaaa',opened=await raw('POST','/v1/sessions/open',{agentId,openId:'host-exec-infer-open'});if(opened.status!==200)throw new Error('session_open_failed');
  const payload={action:'exec_batch',operationId:'op-host-exec-infer-policy-1234',cwd:os.tmpdir(),script:inferredScript,sessionId:opened.json.session.sessionId,agentId,requiredCapabilities:['filesystem'],waitMs:2000,timeoutMs:5000};
  const denied=await raw('POST','/v1/execute',cryptoFixture.seal(payload));if(denied.status!==409||denied.json.error!=='local_host_capability_missing')throw new Error('capability_inference_not_enforced:'+inferredCapability+':'+denied.status+':'+denied.json.error);
  console.log('v10-host-exec-capability-inference-deny=PASS capability='+inferredCapability);
}finally{child.kill('SIGTERM');await sleep(100);fs.rmSync(dir,{recursive:true,force:true});}
