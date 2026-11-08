import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
if(process.platform!=='linux'){console.log('M5_ISOLATED_WORKER_CORE_NON_LINUX_SKIP');process.exit(0);}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-m5-isolated-core-'));fs.chmodSync(root,0o700);
const id='lp_'+crypto.randomBytes(18).toString('base64url'),job=path.join(root,id);fs.mkdirSync(job,{mode:0o700});
const requestFile=path.join(job,'request.json');
const owner={accountId:'fixture',deviceId:'fixture',sessionId:'fixture_sess',agentId:'fixture_agent'};
fs.writeFileSync(requestFile,JSON.stringify({owner,processId:id,script:"printf 'M5_DURABLE_STDOUT_TEST\\n'; sleep 1; printf 'M5_DURABLE_EXIT_TEST\\n'",shell:'sh',cwd:job,unitName:'lr-m5w-'+'0'.repeat(24)+'.service',timeoutMs:5000}),{mode:0o600});
let proc;
try{
 proc=spawn(process.execPath,['device-agent/isolated-process-worker.mjs',requestFile],{cwd:path.resolve('.'),stdio:['ignore','pipe','pipe']});
 let stderr='';proc.stderr.on('data',d=>stderr+=d.toString());
 const result=await Promise.race([new Promise(resolve=>proc.on('close',code=>resolve(code))),new Promise((_,reject)=>setTimeout(()=>reject(Error('worker_timeout')),8000))]);
 assert.equal(result,0,stderr);
 assert.equal(fs.existsSync(requestFile),false,'worker must unlink command script before child spawn');
 const state=JSON.parse(fs.readFileSync(path.join(job,'status.json'),'utf8'));
 assert.equal(state.state,'finished');assert.equal(state.exitCode,0);assert.ok(state.finishedAt);
 assert.equal(state.outputAvailable,true);assert.equal(state.processId,id);
 const out=fs.readFileSync(path.join(job,'stdout.bin'),'utf8');
 assert.match(out,/M5_DURABLE_STDOUT_TEST/);assert.match(out,/M5_DURABLE_EXIT_TEST/);
 assert.equal(fs.statSync(path.join(job,'status.json')).mode&0o077,0);
 assert.equal(fs.statSync(path.join(job,'stdout.bin')).mode&0o077,0);
 assert.ok(!fs.readFileSync(path.join(job,'status.json'),'utf8').includes('printf'));
 console.log('M5_ISOLATED_WORKER_REAL_OS_EXIT_RECEIPT=PASS');
 console.log('M5_ISOLATED_WORKER_DURABLE_STDOUT_AND_SECRET_REQUEST_CLEAN=PASS');
}finally{if(proc?.exitCode===null)proc.kill('SIGKILL');fs.rmSync(root,{recursive:true,force:true});}
