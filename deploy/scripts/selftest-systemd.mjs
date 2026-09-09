import http from 'node:http';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url); const {sealOperatorPayload}=require('../../lib/operator-crypto');
const socketPath='/home/ubuntu/.local/run/gpt-vps-operator/operator.sock', agentId='agent-systemd-v05-aaaaaaaa';
function request(method,path,body){return new Promise((resolve,reject)=>{const b=body==null?null:Buffer.from(JSON.stringify(body));const req=http.request({socketPath,path,method,headers:b?{'content-type':'application/json','content-length':b.length}:{}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,json:JSON.parse(d)}));});req.on('error',reject);if(b)req.end(b);else req.end();});}
const opened=await request('POST','/v1/sessions/open',{agentId,openId:'systemd-selftest-open-v05',label:'systemd proof',workspace:'/home/ubuntu'}); if(opened.status!==200) throw new Error(JSON.stringify(opened)); const sessionId=opened.json.session.sessionId;
const body=sealOperatorPayload({action:'exec_batch',operationId:'selftest-systemd-v05',cwd:'/home/ubuntu',sessionId,agentId,waitMs:7000,timeoutMs:20000,note:'Prove host operator capabilities without mutation',script:"id; sudo -n true && echo sudo-ok; docker version --format 'docker={{.Server.Version}}'; lxc version | head -4; git --version; node --version"});
const result=await request('POST','/v1/execute',body); if(result.status!==200||result.json.job?.exitCode!==0) throw new Error(JSON.stringify(result));
console.log(result.json.job.stdout); console.log(JSON.stringify({sessionId,agentId,jobId:result.json.job.jobId,status:result.json.job.status,exitCode:result.json.job.exitCode,outputTruncated:result.json.job.outputTruncated}));
