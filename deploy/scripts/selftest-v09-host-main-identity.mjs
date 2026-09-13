import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createOperatorCryptoFixture} from './selftest-crypto-fixture.mjs';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';

const root=new URL('../..',import.meta.url).pathname;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-host-main-'));
const socket=path.join(dir,'operator.sock'),logDir=path.join(dir,'log'),stateDir=path.join(dir,'state');
fs.mkdirSync(logDir,{recursive:true});fs.mkdirSync(stateDir,{recursive:true});
const fixture=createOperatorCryptoFixture(stateDir);
const env={...process.env,OPERATOR_SOCKET:socket,OPERATOR_LOG_DIR:logDir,OPERATOR_STATE_DIR:stateDir,OPERATOR_KEY_FILE:fixture.privateFile,OPERATOR_ACCOUNT_PLAN:'vip'};
const child=spawn(process.execPath,[`${root}/operator-host/executor.mjs`],{cwd:root,env,stdio:['ignore','pipe','pipe']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<100&&!fs.existsSync(socket);i++)await sleep(40);
if(!fs.existsSync(socket))throw new Error('operator_not_ready');
function req(method,target,body){return new Promise((resolve,reject)=>{
  const data=body==null?null:Buffer.from(JSON.stringify(body)),headers={};
  if(data){headers['content-type']='application/json';headers['content-length']=data.length;}
  const r=http.request({socketPath:socket,method,path:target,headers},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json={};try{json=JSON.parse(text)}catch{}resolve({status:res.statusCode,json});});});
  r.on('error',reject);if(data)r.write(data);r.end();
});}
try{
  const devices=await req('GET','/v1/devices'),host=devices.json.devices?.find(x=>x.deviceId==='arm-local');
  if(devices.status!==200||!host?.publicIdentityKey||host.nodeId!=='arm')throw new Error('trusted_host_device_missing');
  const identity=JSON.parse(fs.readFileSync(path.join(stateDir,'host-device-identity.json'),'utf8'));
  const companion=JSON.parse(fs.readFileSync(path.join(stateDir,'host-companion-device.json'),'utf8'));
  if(companion.identity?.privateKey)throw new Error('companion_state_must_not_store_private_key');
  if(companion.enrollment?.deviceId!=='arm-local'||companion.identity?.publicIdentityKey!==identity.publicKey)throw new Error('companion_identity_mismatch');
  const key=crypto.createPrivateKey({key:Buffer.from(identity.privateKey,'base64'),format:'der',type:'pkcs8'});
  const signed=(action,payload)=>{const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');return{deviceId:'arm-local',timestamp,nonce,signature:crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId:'arm-local',action,timestamp,nonce,payload})),key).toString('base64url'),payload};};
  let r=await req('POST','/v1/device-channel/connect',signed('connect',{nodeId:'arm',agentVersion:'0.9.0-rc.6',requestedLeaseMs:60*60*1000,reconnectGraceMs:30*60*1000}));
  if(r.status!==200||r.json.connection?.state!=='connected')throw new Error(`host_signed_connect_failed:${r.status}:${r.json.error}`);
  r=await req('POST','/v1/device-channel/status',signed('status',{nodeId:'arm',agentVersion:'0.9.0-rc.6'}));
  if(r.status!==200||r.json.device?.deviceId!=='arm-local')throw new Error('host_signed_status_failed');
  r=await req('POST','/v1/devices/arm-local/revoke',{deviceId:'arm-local',accountId:'self-hosted-local'});
  if(r.status!==409||r.json.error!=='integrated_hub_device_not_revocable')throw new Error('host_operator_revoke_not_blocked');
  const keyBefore=identity.publicKey;
  child.kill('SIGTERM');await sleep(120);try{fs.rmSync(socket,{force:true});}catch{}
  const restarted=spawn(process.execPath,[`${root}/operator-host/executor.mjs`],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  for(let i=0;i<100&&!fs.existsSync(socket);i++)await sleep(40);
  if(!fs.existsSync(socket))throw new Error('operator_restart_not_ready');
  const keyAfter=JSON.parse(fs.readFileSync(path.join(stateDir,'host-device-identity.json'),'utf8')).publicKey;
  if(keyAfter!==keyBefore)throw new Error('host_identity_rotated_on_restart');
  console.log('v09-host-main-trusted-binding=PASS');
  console.log('v09-host-main-signed-channel=PASS');
  console.log('v09-host-main-private-key-isolated=PASS');
  console.log('v09-host-main-non-revocable=PASS');
  console.log('v09-host-main-identity-restart-stable=PASS');
  restarted.kill('SIGTERM');await sleep(100);
}finally{
  try{child.kill('SIGTERM');}catch{}
  fs.rmSync(dir,{recursive:true,force:true});
}
