import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url); const {sealOperatorPayload}=require('../../lib/operator-crypto');
const root=new URL('../..',import.meta.url).pathname, socket='/tmp/gpt-vps-idem.sock', logDir='/tmp/gpt-vps-idem-log', marker='/tmp/gpt-vps-idem-marker';
for(const p of [socket,marker]) fs.rmSync(p,{force:true}); fs.rmSync(logDir,{recursive:true,force:true}); fs.mkdirSync(logDir,{recursive:true});
const child=spawn(process.execPath,[`${root}/operator-host/executor.mjs`],{cwd:root,env:{...process.env,OPERATOR_SOCKET:socket,OPERATOR_LOG_DIR:logDir,OPERATOR_KEY_FILE:'/home/ubuntu/.config/gpt-vps-operator/operator.private.json'},stdio:['ignore','pipe','pipe']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); for(let i=0;i<80&&!fs.existsSync(socket);i++) await sleep(50); if(!fs.existsSync(socket)) throw new Error('socket_not_ready');
function raw(method,path,body){return new Promise((resolve,reject)=>{const b=body==null?null:Buffer.from(JSON.stringify(body));const q=http.request({socketPath:socket,path,method,headers:b?{'content-type':'application/json','content-length':b.length}:{}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>resolve({status:r.statusCode,json:JSON.parse(d)}));});q.on('error',reject);if(b)q.end(b);else q.end();});}
function req(body){return raw('POST','/v1/execute',body);}
const agentId='agent-idempotency-v05-aaaaaaaa'; const opened=await raw('POST','/v1/sessions/open',{agentId,openId:'idempotency-open-v05'}); if(opened.status!==200) throw new Error('session_open_failed'); const sessionId=opened.json.session.sessionId;
const operationId='idempotency-selftest-v05';
const payload={action:'exec_batch',operationId,cwd:'/tmp',script:`printf x >> ${marker}`,sessionId,agentId,note:'same logical operation',waitMs:5000,timeoutMs:10000};
const a=await req(sealOperatorPayload(payload)); const b=await req(sealOperatorPayload(payload));
if(a.status!==200||b.status!==200||a.json.job?.jobId!==b.json.job?.jobId) throw new Error('dedupe_failed');
if(fs.readFileSync(marker,'utf8')!=='x') throw new Error('side_effect_ran_more_than_once');
const conflictPayload={...payload,script:`printf y >> ${marker}`};
const c=await req(sealOperatorPayload(conflictPayload));
if(c.status!==409||c.json.error!=='operation_id_conflict') throw new Error(`conflict_guard_failed:${c.status}:${c.json.error}`);
const audit=fs.readFileSync(`${logDir}/operations.jsonl`,'utf8');
const starts=audit.split('\n').filter(line=>line.includes('"type":"job_started"')&&line.includes(operationId)).length;
if(starts!==1) throw new Error(`expected_one_job_started_got_${starts}`);
console.log(JSON.stringify({ok:true,operationId,jobId:a.json.job.jobId,dedupedJobId:b.json.job.jobId,marker:fs.readFileSync(marker,'utf8'),conflict:c.json.error,jobStarts:starts},null,2));
child.kill('SIGTERM'); await sleep(100);
