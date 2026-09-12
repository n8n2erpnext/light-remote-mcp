import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { deviceChannelMessage, deviceHeartbeatMessage } from '../../lib/device-proof.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt-device-agent-cli-'));
const stateFile=path.join(dir,'device.json');
const cli=new URL('../../device-agent/operator-agent.mjs',import.meta.url).pathname;
const signer=crypto.generateKeyPairSync('ed25519');
const signerPublic=signer.publicKey.export({format:'der',type:'spki'}).toString('base64');
const enrollmentId='enr_12345678-1234-1234-1234-123456789abc';
const pollToken='p'.repeat(43),deviceCode='ABCD-EFGH';
let beginPayload=null,heartbeatCount=0,channelPollCount=0,revokeChannel=false;
function send(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
function deviceIdFromBegin(){const pubDer=Buffer.from(beginPayload.publicIdentityKey,'base64');const hash=crypto.createHash('sha256').update(pubDer).digest('hex');return `dev_${hash.slice(0,24)}`;}
function verifyWithDevice(message,signature){const key=crypto.createPublicKey({key:Buffer.from(beginPayload.publicIdentityKey,'base64'),format:'der',type:'spki'});return crypto.verify(null,Buffer.from(message),key,Buffer.from(signature,'base64url'));}
const server=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;let body={};try{body=JSON.parse(raw||'{}')}catch{}
  if(req.url==='/device-channel/poll'){
    const message=deviceChannelMessage({deviceId:body.deviceId,action:'poll',timestamp:body.timestamp,nonce:body.nonce,payload:body.payload});
    if(!beginPayload||!verifyWithDevice(message,body.signature))return send(res,401,{ok:false,error:'bad_channel_signature'});
    channelPollCount++;
    if(revokeChannel)return send(res,403,{ok:false,error:'device_revoked'});
    return send(res,200,{ok:true,channel:{node:{state:'online',draining:false},state:'idle',command:null}});
  }
  if(req.url!=='/api/operator')return send(res,404,{ok:false,error:'not_found'});
  const {action,payload}=body;
  if(action==='enrollment-begin'){
    beginPayload=payload;
    return send(res,200,{ok:true,upstream:{enrollment:{enrollmentId,pollToken,deviceCode,activationUrl:`http://example.invalid/enroll?id=${enrollmentId}`,expiresAt:Date.now()+600000,expiresInSeconds:600,requestedCapabilities:payload.capabilities,requestedPolicy:payload.policyProfile}}});
  }
  if(action==='enrollment-poll'){
    if(payload.enrollmentId!==enrollmentId||payload.pollToken!==pollToken)return send(res,401,{ok:false,error:'bad_poll'});
    const deviceId=deviceIdFromBegin(),publicKeySha256=deviceId.slice(4).padEnd(64,'0');
    const realHash=crypto.createHash('sha256').update(Buffer.from(beginPayload.publicIdentityKey,'base64')).digest('hex');
    const approvedCapabilities=beginPayload.capabilities.slice();
    const cert={version:1,certificateId:'cert_12345678-1234-1234-1234-123456789abc',deviceId,accountId:'self-hosted-local',publicKeySha256:realHash,publicIdentityKey:beginPayload.publicIdentityKey,approvedCapabilities,policyProfile:beginPayload.policyProfile,issuedAt:Date.now(),notAfter:Date.now()+86400000};
    const certificateSignature=crypto.sign(null,Buffer.from(JSON.stringify(cert)),signer.privateKey).toString('base64url');
    return send(res,200,{ok:true,upstream:{enrollment:{enrollmentId,state:'approved',deviceId,accountId:'self-hosted-local',approvedCapabilities,policyProfile:beginPayload.policyProfile,certificate:cert,certificateSignature,signer:{algorithm:'Ed25519',publicKey:signerPublic}}}});
  }
  if(action==='device-heartbeat'){
    if(!verifyWithDevice(deviceHeartbeatMessage(payload),payload.signature))return send(res,401,{ok:false,error:'bad_device_signature'});
    heartbeatCount++;
    return send(res,200,{ok:true,upstream:{device:{deviceId:payload.deviceId,state:'online',capabilities:payload.capabilities}}});
  }
  return send(res,400,{ok:false,error:'unexpected_action'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
function run(args,extraEnv={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,...args],{env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_BASE_URL:base,OPERATOR_AGENT_HUB_URL:base,...extraEnv},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));});}
function wallReq(port,method,target,payload){return new Promise((resolve,reject)=>{const data=payload==null?null:Buffer.from(JSON.stringify(payload));const headers=data?{'content-type':'application/json','content-length':data.length}:{};const r=http.request({host:'127.0.0.1',port,method,path:target,headers},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json=null;try{json=JSON.parse(text)}catch{}resolve({status:res.statusCode,text,json});});});r.on('error',reject);if(data)r.write(data);r.end();});}
const login=await run(['login','--no-wait','--name','CLI Test Device','--policy','cli-test','--deny','sudo-on-demand']);
if(login.code!==0||!login.stdout.includes('Activation URL:')||!login.stdout.includes(`Device code: ${deviceCode}`))throw new Error(`cli_login_failed:${login.stderr}`);
const pending=JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(!pending.identity?.privateKey||pending.pendingEnrollment?.pollToken!==pollToken)throw new Error('cli_pending_state_missing');
if((fs.statSync(stateFile).mode&0o777)!==0o600)throw new Error('cli_state_permissions_not_0600');
if(login.stdout.includes(pending.identity.privateKey)||login.stdout.includes(pollToken))throw new Error('cli_login_secret_output');
const status1=await run(['status']);
if(status1.code!==0||status1.stdout.includes(pending.identity.privateKey)||status1.stdout.includes(pollToken))throw new Error('cli_status_leaks_secret');
const poll=await run(['poll']);
if(poll.code!==0||heartbeatCount<1)throw new Error(`cli_poll_or_heartbeat_failed:${poll.stderr}`);
const enrolled=JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(!enrolled.enrollment?.deviceId||enrolled.pendingEnrollment||!Array.isArray(enrolled.effectiveCapabilities))throw new Error('cli_enrolled_state_invalid');
if(enrolled.policy?.deniedCapabilities?.includes('sudo-on-demand')!==true)throw new Error('cli_local_deny_missing');
if(enrolled.cloud?.state!=='dormant'||enrolled.cloud?.desiredConnected!==false)throw new Error('fresh_enrollment_must_wait_for_explicit_connect');
const status2=await run(['status']);
if(status2.stdout.includes(enrolled.identity.privateKey)||status2.stdout.includes(pollToken)||!status2.stdout.includes('"enrolled": true'))throw new Error('cli_enrolled_status_invalid');
const daemonState=JSON.parse(fs.readFileSync(stateFile,'utf8'));daemonState.cloud={...(daemonState.cloud||{}),desiredConnected:true,state:'connected',hardExpiresAt:Date.now()+600000,lastError:null};fs.writeFileSync(stateFile,JSON.stringify(daemonState,null,2)+'\n',{mode:0o600});
const wallPort=26000+(process.pid%5000);
const daemonChild=spawn(process.execPath,[cli,'daemon'],{env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_BASE_URL:base,OPERATOR_AGENT_HUB_URL:base,OPERATOR_AGENT_CHANNEL_WAIT_MS:'1000',OPERATOR_AGENT_WALL_PORT:String(wallPort)},stdio:['ignore','pipe','pipe']});
let daemonOut='',daemonErr='';daemonChild.stdout.on('data',c=>daemonOut+=c);daemonChild.stderr.on('data',c=>daemonErr+=c);
const deadline=Date.now()+5000;while(channelPollCount<2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
if(channelPollCount<2){daemonChild.kill('SIGTERM');throw new Error(`daemon_channel_loop_failed:${daemonErr}`);}
let wallReady=false;for(let i=0;i<30&&!wallReady;i++){try{const st=await wallReq(wallPort,'GET','/api/status');wallReady=st.status===200;}catch{}if(!wallReady)await new Promise(r=>setTimeout(r,100));}
if(!wallReady){daemonChild.kill('SIGTERM');throw new Error('daemon_local_wall_not_ready');}
revokeChannel=true;
let revokedLocal=null;for(let i=0;i<40;i++){revokedLocal=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(revokedLocal.cloud?.lastError==='device_revoked')break;await new Promise(r=>setTimeout(r,100));}
if(revokedLocal?.cloud?.lastError!=='device_revoked'||revokedLocal.cloud?.state!=='dormant'||revokedLocal.cloud?.desiredConnected!==false||revokedLocal.cloud?.connectionId!=null||revokedLocal.cloud?.hardExpiresAt!=null){daemonChild.kill('SIGTERM');throw new Error('daemon_revoked_state_not_persisted');}
const revokedStatus=await wallReq(wallPort,'GET','/api/status');
if(revokedStatus.status!==200||revokedStatus.json?.local?.lastCloudError!=='device_revoked'){daemonChild.kill('SIGTERM');throw new Error('local_wall_revoked_state_missing');}
revokeChannel=false;
const reBegin=await wallReq(wallPort,'POST','/api/enrollment/begin',{});
if(reBegin.status!==200||reBegin.json?.enrollment?.mode!=='reenroll'||!beginPayload.capabilities.includes('sudo-on-demand')){daemonChild.kill('SIGTERM');throw new Error('daemon_reenroll_begin_failed');}
const rePending=JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(!rePending.policy?.deniedCapabilities?.includes('sudo-on-demand')){daemonChild.kill('SIGTERM');throw new Error('reenroll_local_deny_lost_at_begin');}
const rePoll=await wallReq(wallPort,'POST','/api/enrollment/poll',{});
if(rePoll.status!==200||rePoll.json?.enrollment?.state!=='approved'){daemonChild.kill('SIGTERM');throw new Error('daemon_reenroll_poll_failed');}
const reenrolled=JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(!reenrolled.enrollment?.approvedCapabilities?.includes('sudo-on-demand')||!reenrolled.policy?.deniedCapabilities?.includes('sudo-on-demand')||reenrolled.effectiveCapabilities?.includes('sudo-on-demand')){daemonChild.kill('SIGTERM');throw new Error('reenroll_local_policy_not_preserved');}
if(reenrolled.cloud?.state!=='dormant'||reenrolled.cloud?.desiredConnected!==false||reenrolled.cloud?.lastError!=null){daemonChild.kill('SIGTERM');throw new Error('reenroll_connection_state_not_reset');}
daemonChild.kill('SIGTERM');const daemonCode=await new Promise(resolve=>daemonChild.on('exit',resolve));
if(daemonCode!==0||!daemonOut.includes('device_agent_started')||!daemonOut.includes('device_agent_stopped'))throw new Error(`daemon_shutdown_failed:${daemonCode}:${daemonErr}`);
console.log('device-agent-fresh-enrollment-dormant=PASS');
console.log('device-agent-daemon-channel=PASS');
console.log('device-agent-daemon-clean-shutdown=PASS');
console.log('device-agent-local-key-0600=PASS');
console.log('device-agent-secret-output=PASS');
console.log('device-agent-certificate-verify=PASS');
console.log('device-agent-signed-heartbeat=PASS');
console.log('device-agent-local-deny-boundary=PASS');
console.log('device-agent-revoked-state-persists-for-wall-reenroll=PASS');
console.log('device-agent-reenroll-full-grantable-local-deny-preserved=PASS');
console.log('device-agent-reenroll-returns-dormant=PASS');
server.close();fs.rmSync(dir,{recursive:true,force:true});
