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
let beginPayload=null,heartbeatCount=0,channelPollCount=0;
function send(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
function deviceIdFromBegin(){const pubDer=Buffer.from(beginPayload.publicIdentityKey,'base64');const hash=crypto.createHash('sha256').update(pubDer).digest('hex');return `dev_${hash.slice(0,24)}`;}
function verifyWithDevice(message,signature){const key=crypto.createPublicKey({key:Buffer.from(beginPayload.publicIdentityKey,'base64'),format:'der',type:'spki'});return crypto.verify(null,Buffer.from(message),key,Buffer.from(signature,'base64url'));}
const server=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;let body={};try{body=JSON.parse(raw||'{}')}catch{}
  if(req.url==='/device-channel/poll'){
    const message=deviceChannelMessage({deviceId:body.deviceId,action:'poll',timestamp:body.timestamp,nonce:body.nonce,payload:body.payload});
    if(!beginPayload||!verifyWithDevice(message,body.signature))return send(res,401,{ok:false,error:'bad_channel_signature'});
    channelPollCount++;
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
    const approvedCapabilities=beginPayload.capabilities.slice(0,Math.min(2,beginPayload.capabilities.length));
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
const status2=await run(['status']);
if(status2.stdout.includes(enrolled.identity.privateKey)||status2.stdout.includes(pollToken)||!status2.stdout.includes('"enrolled": true'))throw new Error('cli_enrolled_status_invalid');
const daemonChild=spawn(process.execPath,[cli,'daemon'],{env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_BASE_URL:base,OPERATOR_AGENT_HUB_URL:base,OPERATOR_AGENT_CHANNEL_WAIT_MS:'1000'},stdio:['ignore','pipe','pipe']});
let daemonOut='',daemonErr='';daemonChild.stdout.on('data',c=>daemonOut+=c);daemonChild.stderr.on('data',c=>daemonErr+=c);
const deadline=Date.now()+5000;while(channelPollCount<2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
if(channelPollCount<2){daemonChild.kill('SIGTERM');throw new Error(`daemon_channel_loop_failed:${daemonErr}`);}
daemonChild.kill('SIGTERM');const daemonCode=await new Promise(resolve=>daemonChild.on('exit',resolve));
if(daemonCode!==0||!daemonOut.includes('device_agent_started')||!daemonOut.includes('device_agent_stopped'))throw new Error(`daemon_shutdown_failed:${daemonCode}:${daemonErr}`);
console.log('device-agent-daemon-channel=PASS');
console.log('device-agent-daemon-clean-shutdown=PASS');
console.log('device-agent-local-key-0600=PASS');
console.log('device-agent-secret-output=PASS');
console.log('device-agent-certificate-verify=PASS');
console.log('device-agent-signed-heartbeat=PASS');
console.log('device-agent-local-deny-boundary=PASS');
server.close();fs.rmSync(dir,{recursive:true,force:true});
