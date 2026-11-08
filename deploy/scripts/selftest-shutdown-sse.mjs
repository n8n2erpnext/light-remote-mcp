import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';
import { ipcEndpoint, removeIpcEndpoint, waitForIpc } from './selftest-ipc.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt-vps-shutdown-'+String(process.pid)+'-'));
const socketPath=ipcEndpoint('gpt-vps-shutdown'),logDir=path.join(dir,'log'),stateDir=path.join(dir,'state');
fs.mkdirSync(logDir,{recursive:true});fs.mkdirSync(stateDir,{recursive:true});
const cryptoFixture=createOperatorCryptoFixture(stateDir);
const child=spawn(process.execPath,[path.join(root,'operator-host','executor.mjs')],{cwd:root,env:{...process.env,OPERATOR_SOCKET:socketPath,OPERATOR_LOG_DIR:logDir,OPERATOR_STATE_DIR:stateDir,OPERATOR_KEY_FILE:cryptoFixture.privateFile},stdio:['ignore','pipe','pipe']});
let childLog='';child.stdout.on('data',d=>childLog+=d);child.stderr.on('data',d=>childLog+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let sseRes=null;
try{
  await waitForIpc(socketPath,{attempts:80,delayMs:50,error:'executor_socket_not_ready',details:()=>childLog});
  await new Promise((resolve,reject)=>{const req=http.request({socketPath,path:'/v1/events'},res=>{sseRes=res;res.once('data',()=>resolve());});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('sse_connect_timeout')));req.end();});
  const started=Date.now();
  child.kill('SIGTERM');
  const result=await Promise.race([new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal}))),sleep(2500).then(()=>({timeout:true}))]);
  const elapsed=Date.now()-started;
  sseRes?.destroy();sseRes=null;
  if(result.timeout){try{child.kill('SIGKILL')}catch{}throw new Error('shutdown_timeout_with_sse');}
  if(process.platform!=='win32'&&result.code!==0)throw new Error('shutdown_exit_not_clean:'+result.code+':'+result.signal);
  if(elapsed>2000)throw new Error('shutdown_too_slow:'+elapsed);
  console.log('shutdown-sse-clean=PASS elapsedMs='+elapsed+' platform='+process.platform+' code='+String(result.code)+' signal='+String(result.signal));
}finally{
  sseRes?.destroy();
  if(child.exitCode==null){try{child.kill('SIGKILL')}catch{}}
  removeIpcEndpoint(socketPath);
  fs.rmSync(dir,{recursive:true,force:true});
}
