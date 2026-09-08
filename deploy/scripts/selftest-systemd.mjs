import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sealOperatorPayload } = require('../../lib/operator-crypto');
const body = Buffer.from(JSON.stringify(sealOperatorPayload({
  action:'exec_batch', cwd:'/home/ubuntu', sessionId:'v03-systemd-proof', waitMs:7000, timeoutMs:20000,
  note:'Prove host operator capabilities without mutation',
  script:"id; sudo -n true && echo sudo-ok; docker version --format 'docker={{.Server.Version}}'; lxc version | head -4; git --version; node --version"
})));
const result = await new Promise((resolve,reject) => {
  const req=http.request({socketPath:'/run/gpt-vps-operator/operator.sock',path:'/v1/execute',method:'POST',headers:{'content-type':'application/json','content-length':body.length}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,json:JSON.parse(d)}));});
  req.on('error',reject); req.end(body);
});
if(result.status!==200 || result.json.job?.exitCode!==0) throw new Error(JSON.stringify(result));
console.log(result.json.job.stdout);
console.log(JSON.stringify({jobId:result.json.job.jobId,status:result.json.job.status,exitCode:result.json.job.exitCode,outputTruncated:result.json.job.outputTruncated}));
