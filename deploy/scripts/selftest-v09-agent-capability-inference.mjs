import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deviceChannelMessage } from '../../lib/device-proof.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt-v09-capability-'));
const stateFile=path.join(dir,'device.json');
const commandDir=path.join(dir,'commands');
const cli=fileURLToPath(new URL('../../device-agent/operator-agent.mjs',import.meta.url));
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
const deviceId='dev_1234567890abcdef12345678';
const inferredCapability=process.platform==='win32'?'windows-process-network':'sudo-on-demand';
const deniedScript=process.platform==='win32'?'Get-Process':'sudo -n true';
const approvedCapabilities=process.platform==='win32'
  ?['filesystem','git','powershell','windows-process-network']
  :['filesystem','git','sudo-on-demand'];
const state={
  identity:{algorithm:'Ed25519',privateKey:privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),publicIdentityKey},
  enrollment:{deviceId,nodeId:deviceId,accountId:'self-hosted-local',approvedCapabilities},
  policy:{deniedCapabilities:[inferredCapability],localFinalDenyBoundary:true}
};
fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
let pollCount=0;const results=[];
function send(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
function verify(action,body){const message=deviceChannelMessage({deviceId:body.deviceId,action,timestamp:body.timestamp,nonce:body.nonce,payload:body.payload});return crypto.verify(null,Buffer.from(message),publicKey,Buffer.from(body.signature,'base64url'));}
const commands=[
  {commandId:'cmd_v09git123456789012345',payload:{type:'exec',operationId:'op-v09-git-inference',script:'git --version',cwd:dir,timeoutMs:5000,requiredCapabilities:['filesystem']}},
  {commandId:'cmd_v09deny1234567890123',payload:{type:'exec',operationId:'op-v09-policy-inference',script:deniedScript,cwd:dir,timeoutMs:5000,requiredCapabilities:['filesystem']}}
];
const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||'{}')}catch{}
  if(req.url==='/device-channel/poll'){
    if(!verify('poll',body))return send(res,401,{ok:false,error:'bad_signature'});
    const pulse=Boolean(body.payload?.draining);
    const command=pulse?null:(commands[pollCount]||null);if(!pulse)pollCount++;
    return send(res,200,{ok:true,channel:{node:{state:'online',draining:false},state:command?'command':'idle',command}});
  }
  if(req.url==='/device-channel/result'){
    if(!verify('result',body))return send(res,401,{ok:false,error:'bad_signature'});
    results.push(body.payload);return send(res,200,{ok:true,accepted:true});
  }
  return send(res,404,{ok:false,error:'not_found'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const hub='http://127.0.0.1:'+server.address().port;
async function freePort(){const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;}
const wallPort=await freePort(),fleetPort=await freePort(),updateStateDir=path.join(dir,'update-state');
const child=spawn(process.execPath,[cli,'daemon'],{env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_COMMAND_DIR:commandDir,OPERATOR_AGENT_HUB_URL:hub,OPERATOR_AGENT_CHANNEL_WAIT_MS:'1000',OPERATOR_AGENT_WALL_PORT:String(wallPort),OPERATOR_FLEET_WALL_PORT:String(fleetPort),LIGHT_REMOTE_UPDATE_STATE_DIR:updateStateDir},stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
const deadline=Date.now()+10000;
while(results.length<2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
const exitResultPromise=child.exitCode!=null?Promise.resolve({code:child.exitCode,signal:null}):new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
if(child.exitCode==null)child.kill('SIGTERM');
const exitResult=await exitResultPromise;
if(process.platform!=='win32'&&exitResult.code!==0)throw new Error('daemon_failed:'+exitResult.code+':'+stderr);
if(results.length<2)throw new Error('result_count_failed:'+results.length+':'+stderr);
const gitResult=results.find(item=>item.commandId===commands[0].commandId);
const deniedResult=results.find(item=>item.commandId===commands[1].commandId);
if(gitResult?.status!=='ok'||gitResult.exitCode!==0||!/git version/i.test(gitResult.stdout||''))throw new Error('git_inference_execute_failed:'+JSON.stringify(gitResult));
if(deniedResult?.exitCode!==126||!String(deniedResult.stderr||'').includes('local capability denied: '+inferredCapability))throw new Error('capability_inference_guard_failed:'+JSON.stringify(deniedResult));
if(!stdout.includes('device_agent_started')||(process.platform!=='win32'&&!stdout.includes('device_agent_stopped')))throw new Error('daemon_lifecycle_missing');
console.log('v09-agent-inferred-git-capability=PASS');
console.log('v09-agent-local-capability-deny-before-spawn=PASS capability='+inferredCapability);
server.close();fs.rmSync(dir,{recursive:true,force:true});
