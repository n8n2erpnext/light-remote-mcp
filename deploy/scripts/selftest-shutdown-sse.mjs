import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const root=new URL('../..',import.meta.url).pathname;
const run=`${process.pid}-${Date.now()}`;
const socketPath=`/tmp/gpt-vps-shutdown-${run}.sock`;
const logDir=`/tmp/gpt-vps-shutdown-${run}-log`;
const stateDir=`/tmp/gpt-vps-shutdown-${run}-state`;
fs.mkdirSync(logDir,{recursive:true}); fs.mkdirSync(stateDir,{recursive:true});
const child=spawn(process.execPath,[`${root}/operator-host/executor.mjs`],{
  cwd:root,env:{...process.env,OPERATOR_SOCKET:socketPath,OPERATOR_LOG_DIR:logDir,
    OPERATOR_STATE_DIR:stateDir,OPERATOR_KEY_FILE:'/home/ubuntu/.config/gpt-vps-operator/operator.private.json'},
  stdio:['ignore','pipe','pipe']
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<80&&!fs.existsSync(socketPath);i++) await sleep(50);
if(!fs.existsSync(socketPath)) throw new Error('executor_socket_not_ready');
let sseRes;
await new Promise((resolve,reject)=>{
  const req=http.request({socketPath,path:'/v1/events'},res=>{sseRes=res; res.once('data',()=>resolve());});
  req.on('error',reject); req.end();
});const started=Date.now();
child.kill('SIGTERM');
const result=await Promise.race([
  new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal}))),
  sleep(2500).then(()=>({timeout:true}))
]);
const elapsed=Date.now()-started;
sseRes?.destroy();
if(result.timeout){ child.kill('SIGKILL'); throw new Error('shutdown_timeout_with_sse'); }
if(result.code!==0) throw new Error(`shutdown_exit_not_clean:${result.code}:${result.signal}`);
if(elapsed>2000) throw new Error(`shutdown_too_slow:${elapsed}`);
console.log(`shutdown-sse-clean=PASS elapsedMs=${elapsed}`);
fs.rmSync(socketPath,{force:true}); fs.rmSync(logDir,{recursive:true,force:true}); fs.rmSync(stateDir,{recursive:true,force:true});