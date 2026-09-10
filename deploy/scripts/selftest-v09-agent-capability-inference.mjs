import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { deviceChannelMessage } from '../../lib/device-proof.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt-v09-capability-'));
const stateFile=path.join(dir,'device.json');
const commandDir=path.join(dir,'commands');
const cli=new URL('../../device-agent/operator-agent.mjs',import.meta.url).pathname;
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
const deviceId='dev_1234567890abcdef12345678';
const state={
  identity:{algorithm:'Ed25519',privateKey:privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),publicIdentityKey},
  enrollment:{deviceId,nodeId:deviceId,accountId:'self-hosted-local',approvedCapabilities:['filesystem','git','sudo-on-demand']},
  policy:{deniedCapabilities:['sudo-on-demand'],localFinalDenyBoundary:true}
};
fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
let pollCount=0;const results=[];
function send(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
function verify(action,body){const message=deviceChannelMessage({deviceId:body.deviceId,action,timestamp:body.timestamp,nonce:body.nonce,payload:body.payload});return crypto.verify(null,Buffer.from(message),publicKey,Buffer.from(body.signature,'base64url'));}
const commands=[
  {commandId:'cmd_v09git123456789012345',payload:{type:'exec',operationId:'op-v09-git-inference',script:'git --version',cwd:dir,timeoutMs:5000,requiredCapabilities:['filesystem']}},
  {commandId:'cmd_v09sudo12345678901234',payload:{type:'exec',operationId:'op-v09-sudo-inference',script:'sudo -n true',cwd:dir,timeoutMs:5000,requiredCapabilities:['filesystem']}}
];
const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||'{}')}catch{}
  if(req.url==='/device-channel/poll'){
    if(!verify('poll',body))return send(res,401,{ok:false,error:'bad_signature'});
    const command=commands[pollCount]||null;pollCount++;
    return send(res,200,{ok:true,channel:{node:{state:'online',draining:false},state:command?'command':'idle',command}});
  }
  if(req.url==='/device-channel/result'){
    if(!verify('result',body))return send(res,401,{ok:false,error:'bad_signature'});
    results.push(body.payload);return send(res,200,{ok:true,accepted:true});
  }
  return send(res,404,{ok:false,error:'not_found'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const hub=`http://127.0.0.1:${server.address().port}`;
const child=spawn(process.execPath,[cli,'daemon'],{env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_COMMAND_DIR:commandDir,OPERATOR_AGENT_HUB_URL:hub,OPERATOR_AGENT_CHANNEL_WAIT_MS:'1000'},stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
const deadline=Date.now()+8000;
while(results.length<2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
child.kill('SIGTERM');
const exitCode=await new Promise(resolve=>child.on('exit',resolve));
if(exitCode!==0)throw new Error(`daemon_failed:${exitCode}:${stderr}`);
if(results.length<2)throw new Error(`result_count_failed:${results.length}:${stderr}`);
const gitResult=results.find(item=>item.commandId===commands[0].commandId);
const sudoResult=results.find(item=>item.commandId===commands[1].commandId);
if(gitResult?.status!=='ok'||gitResult.exitCode!==0||!/git version/i.test(gitResult.stdout||''))throw new Error(`git_inference_execute_failed:${JSON.stringify(gitResult)}`);
if(sudoResult?.exitCode!==126||!/local capability denied: sudo-on-demand/.test(sudoResult.stderr||''))throw new Error(`sudo_inference_guard_failed:${JSON.stringify(sudoResult)}`);
if(!stdout.includes('device_agent_started')||!stdout.includes('device_agent_stopped'))throw new Error('daemon_lifecycle_missing');
console.log('v09-agent-inferred-git-capability=PASS');
console.log('v09-agent-local-sudo-deny-before-spawn=PASS');
server.close();fs.rmSync(dir,{recursive:true,force:true});
