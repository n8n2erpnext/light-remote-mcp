import { fileURLToPath } from 'node:url';
import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';import { ipcEndpoint, removeIpcEndpoint, waitForIpc } from './selftest-ipc.mjs';import { deviceChannelMessage } from '../../lib/device-proof.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url)),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-multi-account-channel-')),socket=ipcEndpoint('lr-multi-account-channel'),stateDir=path.join(dir,'state'),logDir=path.join(dir,'log');
fs.mkdirSync(logDir,{recursive:true});removeIpcEndpoint(socket);const fixture=createOperatorCryptoFixture(stateDir);
const child=spawn(process.execPath,[path.join(root,'operator-host','executor.mjs')],{cwd:root,env:{...process.env,OPERATOR_SOCKET:socket,OPERATOR_STATE_DIR:stateDir,OPERATOR_LOG_DIR:logDir,OPERATOR_KEY_FILE:fixture.privateFile,OPERATOR_CONNECTION_LEASE_ENFORCE:'1'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
function request(method,target,body){return new Promise((resolve,reject)=>{const raw=body==null?null:Buffer.from(JSON.stringify(body));const req=http.request({socketPath:socket,method,path:target,headers:raw?{'content-type':'application/json','content-length':raw.length}:{}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json={raw:text}}resolve({status:res.statusCode,json});});});req.on('error',reject);if(raw)req.write(raw);req.end();});}
try{await waitForIpc(socket,{attempts:100,delayMs:40,error:'executor_not_ready',details:()=>logs});
 const pa='BootstrapPass-1234567890!',pb='TenantBPass-1234567890!';
 let r=await request('POST','/v1/accounts/register',{ownerProofVerified:true,email:'bootstrap@example.test',password:pa});if(r.status!==201)throw new Error('bootstrap_register_failed:'+JSON.stringify(r));
 r=await request('POST','/v1/plugin/accounts/register',{email:'tenant-b@example.test',password:pb,issueSession:false});if(r.status!==201)throw new Error('tenant_b_register_failed:'+JSON.stringify(r));const accountB=r.json.account.accountId;if(!accountB||accountB==='self-hosted-local'||r.json.account.plan!=='free')throw new Error('tenant_b_id_invalid');
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64'),version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
 r=await request('POST','/v1/enrollments/begin',{publicIdentityKey,displayName:'Tenant B Leaf',platform:'linux',architecture:'x64',agentVersion:version,fingerprintSummary:'tenant-b-test',capabilities:['filesystem'],policyProfile:'test'});const enrollment=r.json.enrollment;
 r=await request('POST','/v1/enrollments/approve',{code:enrollment.deviceCode,accountId:accountB,approvedCapabilities:['filesystem'],policyProfile:'test'});if(r.status!==200)throw new Error('tenant_b_approve_failed:'+JSON.stringify(r));const deviceId=r.json.approval.deviceId;
 function signed(action,payload){const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url'),signature=crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,action,timestamp,nonce,payload})),privateKey).toString('base64url');return{deviceId,timestamp,nonce,signature,payload};}
 r=await request('POST','/v1/device-channel/connect',signed('connect',{nodeId:deviceId,agentVersion:version,requestedLeaseMs:3600000,reconnectGraceMs:900000}));if(r.status!==200||r.json.connection?.accountId!==accountB)throw new Error('tenant_b_connect_failed:'+JSON.stringify(r));
 r=await request('POST','/v1/device-channel/poll',signed('poll',{nodeId:deviceId,agentVersion:version,sessionCeiling:3,draining:false,capabilities:['filesystem'],policyRevision:1,waitMs:0}));if(r.status!==200||r.json.channel?.node?.accountId!==accountB)throw new Error('tenant_b_poll_failed:'+JSON.stringify(r));
 const aid='agent-tenant-b-channel-aaaa';r=await request('POST','/v1/sessions/open',{accountId:accountB,agentId:aid,openId:'open-tenant-b-channel-aaaa',nodeId:deviceId});if(r.status!==200||r.json.session?.accountId!==accountB)throw new Error('tenant_b_session_failed:'+JSON.stringify(r));
 const denied=await request('POST','/v1/sessions/open',{accountId:'self-hosted-local',agentId:'agent-cross-tenant-denied-aa',openId:'open-cross-tenant-denied-aa',nodeId:deviceId});if(denied.status!==403||denied.json.error!=='target_node_account_mismatch')throw new Error('cross_tenant_route_not_denied:'+JSON.stringify(denied));
 const access=await request('POST','/v1/device-access/request',{accountId:accountB,agentId:aid,deviceId,label:'Tenant B Agent'});if(access.status!==201||access.json.access?.request?.accountId!==accountB)throw new Error('tenant_b_access_failed:'+JSON.stringify(access));
 const wrong=await request('POST','/v1/device-access/request',{agentId:'agent-default-wrong-tenant-aa',deviceId,label:'Wrong Tenant'});if(wrong.status!==403||wrong.json.error!=='device_access_account_mismatch')throw new Error('default_account_access_not_denied');
 console.log(JSON.stringify({ok:true,accountB,deviceId,crossTenantStatus:denied.status,accessAccount:access.json.access.accountId},null,2));
}finally{
  if(child.exitCode==null){
    try{child.kill('SIGTERM');}catch{}
    await Promise.race([
      new Promise(resolve=>child.once('exit',resolve)),
      new Promise(resolve=>setTimeout(resolve,1000))
    ]);
  }
  if(child.exitCode==null){try{child.kill('SIGKILL');}catch{}}
  removeIpcEndpoint(socket);
  for(let i=0;i<20;i++){
    try{fs.rmSync(dir,{recursive:true,force:true});break;}
    catch(error){if(i===19)throw error;await new Promise(resolve=>setTimeout(resolve,25));}
  }
}
