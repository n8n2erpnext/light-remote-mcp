import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createOperatorCryptoFixture} from './selftest-crypto-fixture.mjs';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';
import {ipcEndpoint,removeIpcEndpoint,waitForIpc} from './selftest-ipc.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-host-main-'));
const socket=ipcEndpoint('lr-host-main'),logDir=path.join(dir,'log'),stateDir=path.join(dir,'state');
fs.mkdirSync(logDir,{recursive:true});fs.mkdirSync(stateDir,{recursive:true});
const fixture=createOperatorCryptoFixture(stateDir);
const env={...process.env,OPERATOR_SOCKET:socket,OPERATOR_LOG_DIR:logDir,OPERATOR_STATE_DIR:stateDir,OPERATOR_KEY_FILE:fixture.privateFile,OPERATOR_ACCOUNT_PLAN:'vip'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const spawnOperator=()=>spawn(process.execPath,[path.join(root,'operator-host','executor.mjs')],{cwd:root,env,stdio:['ignore','pipe','pipe']});
let child=spawnOperator(),restarted=null,childLog='';
child.stdout.on('data',d=>childLog+=d);child.stderr.on('data',d=>childLog+=d);
function req(method,target,body){return new Promise((resolve,reject)=>{const data=body==null?null:Buffer.from(JSON.stringify(body)),headers={};if(data){headers['content-type']='application/json';headers['content-length']=data.length;}const r=http.request({socketPath:socket,method,path:target,headers},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json={};try{json=JSON.parse(text)}catch{}resolve({status:res.statusCode,json});});});r.on('error',reject);r.setTimeout(15000,()=>r.destroy(new Error('request_timeout:'+method+':'+target)));if(data)r.write(data);r.end();});}
async function stopProcess(proc){if(!proc||proc.exitCode!=null)return;try{proc.kill('SIGTERM')}catch{}await Promise.race([new Promise(resolve=>proc.once('exit',resolve)),sleep(1000)]);if(proc.exitCode==null){try{proc.kill('SIGKILL')}catch{}}}

try{
  await waitForIpc(socket,{attempts:100,delayMs:40,error:'operator_not_ready',details:()=>childLog});
  const devices=await req('GET','/v1/devices'),host=devices.json.devices?.find(x=>x.deviceId==='arm-local');
  if(devices.status!==200||!host?.publicIdentityKey||host.nodeId!=='arm')throw new Error('trusted_host_device_missing');
  const identity=JSON.parse(fs.readFileSync(path.join(stateDir,'host-device-identity.json'),'utf8'));
  const companion=JSON.parse(fs.readFileSync(path.join(stateDir,'host-companion-device.json'),'utf8'));
  if(companion.identity?.privateKey)throw new Error('companion_state_must_not_store_private_key');
  if(companion.enrollment?.deviceId!=='arm-local'||companion.identity?.publicIdentityKey!==identity.publicKey)throw new Error('companion_identity_mismatch');
  if(!companion.enrollment?.grantableCapabilities?.includes('terminal'))throw new Error('host_terminal_not_grantable');
  if(!companion.effectiveCapabilities?.includes('terminal'))throw new Error('host_main_must_use_local_authority_for_new_capability');
  const key=crypto.createPrivateKey({key:Buffer.from(identity.privateKey,'base64'),format:'der',type:'pkcs8'});
  const signed=(action,payload)=>{const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');return{deviceId:'arm-local',timestamp,nonce,signature:crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId:'arm-local',action,timestamp,nonce,payload})),key).toString('base64url'),payload};};
  let r=await req('POST','/v1/device-channel/connect',signed('connect',{nodeId:'arm',agentVersion:'0.9.0-rc.6',requestedLeaseMs:60*60*1000,reconnectGraceMs:30*60*1000}));
  if(r.status!==200||r.json.connection?.state!=='connected')throw new Error('host_signed_connect_failed:'+r.status+':'+r.json.error);
  r=await req('POST','/v1/device-channel/status',signed('status',{nodeId:'arm',agentVersion:'0.9.0-rc.6'}));
  if(r.status!==200||r.json.device?.deviceId!=='arm-local')throw new Error('host_signed_status_failed');
  r=await req('POST','/v1/devices/arm-local/revoke',{deviceId:'arm-local',accountId:'self-hosted-local'});
  if(r.status!==409||r.json.error!=='integrated_hub_device_not_revocable')throw new Error('host_operator_revoke_not_blocked');
  const keyBefore=identity.publicKey;
  await stopProcess(child);removeIpcEndpoint(socket);
  let restartLog='';restarted=spawnOperator();restarted.stdout.on('data',d=>restartLog+=d);restarted.stderr.on('data',d=>restartLog+=d);
  await waitForIpc(socket,{attempts:100,delayMs:40,error:'operator_restart_not_ready',details:()=>restartLog});
  const keyAfter=JSON.parse(fs.readFileSync(path.join(stateDir,'host-device-identity.json'),'utf8')).publicKey;
  if(keyAfter!==keyBefore)throw new Error('host_identity_rotated_on_restart');
  console.log('v09-host-main-trusted-binding=PASS');
  console.log('v09-host-main-signed-channel=PASS');
  console.log('v09-host-main-private-key-isolated=PASS');
  console.log('v09-host-main-non-revocable=PASS');
  console.log('v09-host-main-identity-restart-stable=PASS');
  console.log('v10-host-main-local-authority=PASS');
}finally{
  await stopProcess(restarted);
  await stopProcess(child);
  removeIpcEndpoint(socket);
  fs.rmSync(dir,{recursive:true,force:true});
}
