import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';
import { deviceChannelMessage } from '../../lib/device-proof.mjs';

const root=new URL('../..',import.meta.url).pathname,currentVersion=fs.readFileSync(`${root}/VERSION`,'utf8').trim();
const gatewaySource=fs.readFileSync(`${root}/gateway/server.mjs`,'utf8');
if(gatewaySource.includes('deviceRateIdentity')||gatewaySource.includes('deviceChannelRateLimit'))throw new Error('gateway_unsigned_device_quota_remains');
if(!gatewaySource.includes("createRateLimit('device-channel-edge',2400"))throw new Error('gateway_edge_rate_limit_missing');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rate-lanes-'));
const socket=path.join(dir,'operator.sock'),logDir=path.join(dir,'log'),stateDir=path.join(dir,'state');
fs.mkdirSync(logDir,{recursive:true});fs.mkdirSync(stateDir,{recursive:true});
const fixture=createOperatorCryptoFixture(stateDir);
const child=spawn(process.execPath,[`${root}/operator-host/executor.mjs`],{cwd:root,env:{...process.env,OPERATOR_SOCKET:socket,OPERATOR_LOG_DIR:logDir,OPERATOR_STATE_DIR:stateDir,OPERATOR_KEY_FILE:fixture.privateFile,OPERATOR_CONNECTION_LEASE_ENFORCE:'1',OPERATOR_DEVICE_CHANNEL_RUNTIME_LIMIT:'1',OPERATOR_DEVICE_CHANNEL_OBSERVER_LIMIT:'1',OPERATOR_DEVICE_CHANNEL_CONTROL_LIMIT:'10'},stdio:['ignore','pipe','pipe']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<100&&!fs.existsSync(socket);i++)await sleep(40);
if(!fs.existsSync(socket))throw new Error('executor_not_ready');
function request(method,target,body){return new Promise((resolve,reject)=>{const payload=body==null?null:Buffer.from(JSON.stringify(body)),headers={};if(payload){headers['content-type']='application/json';headers['content-length']=payload.length;}const req=http.request({socketPath:socket,method,path:target,headers},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json={raw:text}}resolve({status:res.statusCode,headers:res.headers,json});});});req.on('error',reject);if(payload)req.write(payload);req.end();});}
async function enroll(label){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
  let r=await request('POST','/v1/enrollments/begin',{publicIdentityKey,displayName:label,platform:'linux',architecture:'x64',agentVersion:currentVersion,fingerprintSummary:label,capabilities:['filesystem'],policyProfile:'test'});
  if(r.status!==200)throw new Error(`enroll_begin_failed:${r.status}:${r.json.error}`);
  r=await request('POST','/v1/enrollments/approve',{code:r.json.enrollment.deviceCode,accountId:'self-hosted-local',approvedCapabilities:['filesystem'],policyProfile:'test'});
  if(r.status!==200)throw new Error(`enroll_approve_failed:${r.status}:${r.json.error}`);
  const deviceId=r.json.approval.deviceId;
  function signed(action,payload){const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url'),signature=crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,action,timestamp,nonce,payload})),privateKey).toString('base64url');return{deviceId,timestamp,nonce,signature,payload};}
  return {deviceId,signed};
}
const a=await enroll('Rate A'),b=await enroll('Rate B');
async function connect(dev){const r=await request('POST','/v1/device-channel/connect',dev.signed('connect',{nodeId:dev.deviceId,agentVersion:currentVersion,requestedLeaseMs:3600000,reconnectGraceMs:1800000}));if(r.status!==200)throw new Error(`connect_failed:${r.status}:${r.json.error}`);}
await connect(a);await connect(b);
async function ensureMinuteBudget(minRemainingMs=10000){const offset=Date.now()%60000;if(offset>60000-minRemainingMs)await sleep(60050-offset);}
const statusPayload=dev=>({nodeId:dev.deviceId,agentVersion:currentVersion});
await ensureMinuteBudget();
let r=await request('POST','/v1/device-channel/status',a.signed('status',statusPayload(a)));
if(r.status!==200)throw new Error('observer_first_failed');
r=await request('POST','/v1/device-channel/status',a.signed('status',statusPayload(a)));
if(r.status!==429||r.json.scope!=='device-channel-observer'||!Number(r.json.retryAfterSeconds)||!r.headers['retry-after'])throw new Error(`observer_limit_contract_failed:${r.status}:${JSON.stringify(r.json)}`);
const pollPayload=dev=>({nodeId:dev.deviceId,agentVersion:currentVersion,sessionCeiling:2,draining:false,capabilities:['filesystem'],policyRevision:1,waitMs:0});
await ensureMinuteBudget();
r=await request('POST','/v1/device-channel/poll',a.signed('poll',pollPayload(a)));
if(r.status!==200)throw new Error(`observer_starved_runtime:${r.status}:${r.json.error}`);
r=await request('POST','/v1/device-channel/poll',a.signed('poll',pollPayload(a)));
if(r.status!==429||r.json.scope!=='device-channel-runtime')throw new Error('runtime_limit_not_independent');
for(let i=0;i<3;i++){
  const forged=b.signed('status',statusPayload(b));
  forged.signature=forged.signature.slice(0,-2)+'xx';
  const bad=await request('POST','/v1/device-channel/status',forged);
  if(bad.status===429||bad.status<400)throw new Error(`forged_signature_consumed_quota:${bad.status}`);
}
await ensureMinuteBudget();
r=await request('POST','/v1/device-channel/status',b.signed('status',statusPayload(b)));
if(r.status!==200)throw new Error(`forged_signature_starved_valid_observer:${r.status}:${r.json.error}`);
r=await request('POST','/v1/device-channel/status',b.signed('status',statusPayload(b)));
if(r.status!==429)throw new Error('device_b_observer_limit_missing');
r=await request('POST','/v1/device-channel/poll',b.signed('poll',pollPayload(b)));
if(r.status!==200)throw new Error(`device_a_starved_device_b_runtime:${r.status}:${r.json.error}`);
console.log('v10-device-channel-observer-runtime-isolation=PASS');
console.log('v10-device-channel-invalid-signature-no-quota=PASS');
console.log('v10-device-channel-device-isolation=PASS');
console.log('v10-device-channel-retry-after-contract=PASS');
child.kill('SIGTERM');await sleep(100);fs.rmSync(dir,{recursive:true,force:true});
