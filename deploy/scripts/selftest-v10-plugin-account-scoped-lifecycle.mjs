import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';
import { ipcEndpoint, removeIpcEndpoint, waitForIpc } from './selftest-ipc.mjs';
import { deviceChannelMessage } from '../../lib/device-proof.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-plugin-scoped-lifecycle-'));
const socket=ipcEndpoint('lr-plugin-scoped-lifecycle');
const stateDir=path.join(dir,'state'),logDir=path.join(dir,'log');
fs.mkdirSync(logDir,{recursive:true});removeIpcEndpoint(socket);
const fixture=createOperatorCryptoFixture(stateDir);
const child=spawn(process.execPath,[path.join(root,'operator-host','executor.mjs')],{
  cwd:root,
  env:{...process.env,OPERATOR_SOCKET:socket,OPERATOR_STATE_DIR:stateDir,OPERATOR_LOG_DIR:logDir,OPERATOR_KEY_FILE:fixture.privateFile,OPERATOR_CONNECTION_LEASE_ENFORCE:'1'},
  stdio:['ignore','pipe','pipe']
});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);

function request(method,target,body){
  return new Promise((resolve,reject)=>{
    const raw=body==null?null:Buffer.from(JSON.stringify(body));
    const req=http.request({socketPath:socket,method,path:target,headers:raw?{'content-type':'application/json','content-length':raw.length}:{}},res=>{
      let text='';res.on('data',c=>text+=c);res.on('end',()=>{
        let json;try{json=JSON.parse(text)}catch{json={raw:text}}
        resolve({status:res.statusCode,json});
      });
    });
    req.on('error',reject);if(raw)req.write(raw);req.end();
  });
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function cleanup(){
  if(child.exitCode==null){
    try{child.kill('SIGTERM')}catch{}
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(1000)]);
  }
  if(child.exitCode==null){try{child.kill('SIGKILL')}catch{}}
  removeIpcEndpoint(socket);
  for(let i=0;i<20;i++){
    try{fs.rmSync(dir,{recursive:true,force:true});break}
    catch(error){if(i===19)throw error;await sleep(25)}
  }
}

try{
  await waitForIpc(socket,{attempts:100,delayMs:40,error:'executor_not_ready',details:()=>logs});
  let r=await request('POST','/v1/accounts/register',{ownerProofVerified:true,email:'owner-scoped@example.test',password:'Owner scoped password 12345'});
  if(r.status!==201)throw new Error('bootstrap_register_failed:'+JSON.stringify(r));

  r=await request('POST','/v1/plugin/accounts/register',{email:'tenant-a@example.test',password:'Tenant A route password 12345'});
  if(r.status!==201)throw new Error('tenant_a_register_failed:'+JSON.stringify(r));
  const accountA=r.json.account.accountId;

  r=await request('POST','/v1/plugin/accounts/register',{email:'tenant-b@example.test',password:'Tenant B route password 12345'});
  if(r.status!==201)throw new Error('tenant_b_register_failed:'+JSON.stringify(r));
  const accountB=r.json.account.accountId;
  if(accountA===accountB)throw new Error('hosted_account_ids_not_unique');

  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
  const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();

  r=await request('POST','/v1/enrollments/begin',{
    publicIdentityKey,displayName:'Tenant A Device',platform:'linux',architecture:'x64',agentVersion:version,
    fingerprintSummary:'tenant-a-scoped-test',capabilities:['filesystem'],policyProfile:'test'
  });
  if(r.status!==201&&r.status!==200)throw new Error('enrollment_begin_failed:'+JSON.stringify(r));
  const enrollment=r.json.enrollment;

  r=await request('POST','/v1/enrollments/approve',{
    code:enrollment.deviceCode,accountId:accountA,approvedCapabilities:['filesystem'],policyProfile:'test'
  });
  if(r.status!==200)throw new Error('enrollment_approve_failed:'+JSON.stringify(r));
  const deviceId=r.json.approval.deviceId;

  function signed(action,payload){
    const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');
    const signature=crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,action,timestamp,nonce,payload})),privateKey).toString('base64url');
    return {deviceId,timestamp,nonce,signature,payload};
  }
  const connectPayload={nodeId:deviceId,agentVersion:version,requestedLeaseMs:3600000,reconnectGraceMs:900000};
  r=await request('POST','/v1/device-channel/connect',signed('connect',connectPayload));
  if(r.status!==200||r.json.connection?.accountId!==accountA)throw new Error('signed_connect_failed:'+JSON.stringify(r));

  const pollPayload={nodeId:deviceId,agentVersion:version,sessionCeiling:3,draining:false,capabilities:['filesystem'],policyRevision:1,waitMs:0};
  r=await request('POST','/v1/device-channel/poll',signed('poll',pollPayload));
  if(r.status!==200)throw new Error('signed_poll_failed:'+JSON.stringify(r));

  r=await request('GET',`/v1/plugin/accounts/${accountA}`);
  if(r.status!==200||r.json.account?.accountId!==accountA)throw new Error('scoped_account_get_failed:'+JSON.stringify(r));

  r=await request('GET',`/v1/plugin/accounts/${accountA}/devices`);
  if(r.status!==200||r.json.devices?.length!==1||r.json.devices[0].deviceId!==deviceId)throw new Error('scoped_devices_get_failed:'+JSON.stringify(r));

  r=await request('GET',`/v1/plugin/accounts/${accountB}/devices`);
  if(r.status!==200||r.json.devices?.length!==0)throw new Error('cross_tenant_device_visibility:'+JSON.stringify(r));

  const wrongMain=await request('POST',`/v1/plugin/accounts/${accountB}/main-device`,{deviceId});
  if(wrongMain.status!==403||wrongMain.json.error!=='account_device_mismatch')throw new Error('cross_tenant_main_not_denied:'+JSON.stringify(wrongMain));

  const wrongRevoke=await request('POST',`/v1/plugin/accounts/${accountB}/devices/${deviceId}/revoke`,{reason:'cross-tenant-test'});
  if(wrongRevoke.status!==403||wrongRevoke.json.error!=='account_device_mismatch')throw new Error('cross_tenant_revoke_not_denied:'+JSON.stringify(wrongRevoke));

  const wrongRemove=await request('POST',`/v1/plugin/accounts/${accountB}/devices/${deviceId}/remove`,{reason:'cross-tenant-test'});
  if(wrongRemove.status!==403||wrongRemove.json.error!=='account_device_mismatch')throw new Error('cross_tenant_remove_not_denied:'+JSON.stringify(wrongRemove));

  const main=await request('POST',`/v1/plugin/accounts/${accountA}/main-device`,{deviceId});
  if(main.status!==200||main.json.account?.mainDeviceId!==deviceId||main.json.mainDevice?.deviceId!==deviceId)throw new Error('scoped_main_failed:'+JSON.stringify(main));

  const revoked=await request('POST',`/v1/plugin/accounts/${accountA}/devices/${deviceId}/revoke`,{reason:'plugin-scoped-selftest'});
  if(revoked.status!==200||revoked.json.device?.state!=='revoked'||revoked.json.account?.mainDeviceId!==null)throw new Error('scoped_revoke_failed:'+JSON.stringify(revoked));

  const removed=await request('POST',`/v1/plugin/accounts/${accountA}/devices/${deviceId}/remove`,{reason:'plugin-scoped-selftest-cleanup'});
  if(removed.status!==200||removed.json.removed?.removed!==true)throw new Error('scoped_remove_failed:'+JSON.stringify(removed));

  const missing=await request('GET',`/v1/devices/${deviceId}`);
  if(missing.status!==404)throw new Error('removed_device_still_exists:'+JSON.stringify(missing));

  console.log(JSON.stringify({
    ok:true,scopedAccount:true,scopedDevices:true,crossTenantMain:wrongMain.status,
    crossTenantRevoke:wrongRevoke.status,crossTenantRemove:wrongRemove.status,main:true,revoke:true,remove:true
  },null,2));
}finally{
  await cleanup();
}
