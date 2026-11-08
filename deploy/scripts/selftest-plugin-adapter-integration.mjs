import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
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
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-plugin-adapter-integration-'));
const socket=ipcEndpoint('lr-plugin-adapter-integration');
const stateDir=path.join(dir,'state'),logDir=path.join(dir,'log');
fs.mkdirSync(logDir,{recursive:true});removeIpcEndpoint(socket);
const fixture=createOperatorCryptoFixture(stateDir);
process.env.OPERATOR_SOCKET=socket;
const { AccountOperatorAdapter }=await import('../../plugin-server/operator-adapter.mjs');
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
async function createDevice(accountId,label){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
  const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
  let r=await request('POST','/v1/enrollments/begin',{
    publicIdentityKey,displayName:label,platform:'win32',architecture:'x64',agentVersion:version,
    fingerprintSummary:`${label}-fingerprint`,capabilities:['filesystem','desktop','desktop-input'],policyProfile:'test'
  });
  assert.ok(r.status===200||r.status===201,`enrollment_begin_${label}`);
  const enrollment=r.json.enrollment;
  r=await request('POST','/v1/enrollments/approve',{
    code:enrollment.deviceCode,accountId,approvedCapabilities:['filesystem','desktop','desktop-input'],policyProfile:'test'
  });
  assert.equal(r.status,200,`enrollment_approve_${label}`);
  const deviceId=r.json.approval.deviceId;
  const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');
  const payload={nodeId:deviceId,agentVersion:version,requestedLeaseMs:3600000,reconnectGraceMs:900000};
  const signature=crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,action:'connect',timestamp,nonce,payload})),privateKey).toString('base64url');
  r=await request('POST','/v1/device-channel/connect',{deviceId,timestamp,nonce,signature,payload});
  assert.equal(r.status,200,`connect_${label}`);
  assert.equal(r.json.connection?.accountId,accountId,`connect_account_${label}`);
  const pollTimestamp=Date.now(),pollNonce=crypto.randomBytes(18).toString('base64url');
  const pollPayload={nodeId:deviceId,agentVersion:version,sessionCeiling:3,draining:false,capabilities:['filesystem','desktop','desktop-input'],policyRevision:1,waitMs:0};
  const pollSignature=crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,action:'poll',timestamp:pollTimestamp,nonce:pollNonce,payload:pollPayload})),privateKey).toString('base64url');
  r=await request('POST','/v1/device-channel/poll',{deviceId,timestamp:pollTimestamp,nonce:pollNonce,signature:pollSignature,payload:pollPayload});
  assert.equal(r.status,200,`poll_${label}`);
  return {deviceId,privateKey,version};
}
async function issuePairingCode(device){
  const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url'),payload={nodeId:device.deviceId,agentVersion:device.version,rotate:true};
  const signature=crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId:device.deviceId,action:'pairing-code',timestamp,nonce,payload})),device.privateKey).toString('base64url');
  const r=await request('POST','/v1/device-channel/pairing-code',{deviceId:device.deviceId,timestamp,nonce,signature,payload});
  assert.equal(r.status,200,'pairing_code_issue');return r.json.pairing.code;
}
async function approveAdapterPair(adapter,device){
  const aCode=await issuePairingCode(device),pending=await adapter.pairBegin(aCode,'Plugin adapter test');
  assert.match(pending.userCode,/^[A-Z2-9]{4}-[A-Z2-9]{4}$/,'pairing_b_code');
  const r=await request('POST',`/v1/device-access/requests/${encodeURIComponent(pending.requestId)}/approve`,{});
  assert.equal(r.status,200,'pairing_b_approve');
  const ready=await adapter.pairPoll({requestId:pending.requestId,pollToken:pending.pollToken});
  assert.equal(ready.state,'approved','pairing_ready');assert.equal(ready.device.deviceId,device.deviceId,'pairing_device');
  return ready;
}
async function approveAdapterPairViaRecovery(adapter,device){
  const staleCode=await issuePairingCode(device),stale=await adapter.pairBegin(staleCode,'Plugin stale recovery test');
  let r=await request('POST',`/v1/device-access/requests/${encodeURIComponent(stale.requestId)}/approve`,{});
  assert.equal(r.status,200,'pairing_recovery_stale_b_approve');
  const aCode=await issuePairingCode(device),pending=await adapter.pairBegin(aCode,'Plugin recovery test');
  assert.match(pending.userCode,/^[A-Z2-9]{4}-[A-Z2-9]{4}$/,'pairing_recovery_b_code');
  const before=await adapter.pairRecover();
  assert.equal(before.state,'pending','pairing_recovery_pending_before_approval');
  assert.equal(before.request?.requestId,pending.requestId,'pairing_recovery_latest_intent');
  r=await request('POST',`/v1/device-access/requests/${encodeURIComponent(pending.requestId)}/approve`,{});
  assert.equal(r.status,200,'pairing_recovery_b_approve');
  const ready=await adapter.pairRecover();
  assert.equal(ready.state,'approved','pairing_recovery_ready');
  assert.equal(ready.device.deviceId,device.deviceId,'pairing_recovery_device');
  const after=await adapter.pairRecover();
  assert.equal(after,null,'pairing_recovery_consumed_no_stale_fallback');
  r=await request('GET',`/v1/device-access/requests/${encodeURIComponent(stale.requestId)}`,null);
  assert.equal(r.status,200,'pairing_recovery_stale_request_visible');
  assert.equal(r.json.authorization?.consumedAt,null,'pairing_recovery_stale_remains_unconsumed_but_ignored');
  return ready;
}

try{
  await waitForIpc(socket,{attempts:100,delayMs:40,error:'executor_not_ready',details:()=>logs});
  let r=await request('POST','/v1/accounts/register',{ownerProofVerified:true,email:'owner-adapter@example.test',password:'Owner adapter password 12345'});
  assert.equal(r.status,201,'bootstrap_register');

  r=await request('POST','/v1/plugin/accounts/register',{email:'adapter-a@example.test',password:'Adapter A password 12345'});
  assert.equal(r.status,201,'tenant_a_pending');r=await request('POST','/v1/plugin/accounts/registration/verify',{pendingId:r.json.pending.pendingId,token:r.json.token,issueSession:false});assert.equal(r.status,200,'tenant_a_verify');const accountA=r.json.account.accountId;
  r=await request('POST','/v1/plugin/accounts/register',{email:'adapter-b@example.test',password:'Adapter B password 12345'});
  assert.equal(r.status,201,'tenant_b_pending');r=await request('POST','/v1/plugin/accounts/registration/verify',{pendingId:r.json.pending.pendingId,token:r.json.token,issueSession:false});assert.equal(r.status,200,'tenant_b_verify');const accountB=r.json.account.accountId;
  assert.notEqual(accountA,accountB,'hosted_ids_unique');

  const stateFile=path.join(stateDir,'accounts.json');
  const sessionsBeforeVerify=JSON.parse(fs.readFileSync(stateFile,'utf8')).sessions.length;
  r=await request('POST','/v1/plugin/auth/verify',{email:'adapter-a@example.test',password:'Adapter A password 12345'});
  assert.equal(r.status,200,'plugin_verify');
  assert.equal(r.json.account?.accountId,accountA,'plugin_verify_account');
  const sessionsAfterVerify=JSON.parse(fs.readFileSync(stateFile,'utf8')).sessions.length;
  assert.equal(sessionsAfterVerify,sessionsBeforeVerify,'plugin_verify_no_portal_session');

  const deviceA=await createDevice(accountA,'Adapter-A-Device');
  const deviceB=await createDevice(accountB,'Adapter-B-Device');
  const adapterA=new AccountOperatorAdapter({accountId:accountA,clientId:'integration-client-a'});
  const adapterB=new AccountOperatorAdapter({accountId:accountB,clientId:'integration-client-b'});

  assert.deepEqual(await adapterA.devices(),[],'adapter_a_pre_pair_hidden');
  assert.deepEqual(await adapterB.devices(),[],'adapter_b_pre_pair_hidden');
  await assert.rejects(()=>adapterA.openSession({deviceId:deviceA.deviceId,workspace:'A'}),e=>e?.message==='agent_client_required','pre_pair_session_denied');
  await approveAdapterPairViaRecovery(adapterA,deviceA);await approveAdapterPair(adapterB,deviceB);
  const devicesA=await adapterA.devices(),devicesB=await adapterB.devices();
  assert.deepEqual(devicesA.map(x=>x.deviceId),[deviceA.deviceId],'adapter_a_device_scope');
  assert.deepEqual(devicesB.map(x=>x.deviceId),[deviceB.deviceId],'adapter_b_device_scope');

  const sessionA=await adapterA.openSession({deviceId:deviceA.deviceId,workspace:'A',gracePreset:'60m'});
  const sessionB=await adapterB.openSession({deviceId:deviceB.deviceId,workspace:'B',gracePreset:'60m'});
  assert.notEqual(sessionA.sessionId,sessionB.sessionId,'session_ids_unique');
  assert.deepEqual((await adapterA.sessions()).map(x=>x.sessionId),[sessionA.sessionId],'adapter_a_session_scope');
  assert.deepEqual((await adapterB.sessions()).map(x=>x.sessionId),[sessionB.sessionId],'adapter_b_session_scope');

  await assert.rejects(()=>adapterB.sessionRaw(sessionA.sessionId),e=>[403,404,409].includes(e?.status),'cross_account_get_denied');
  await assert.rejects(()=>adapterB.closeSession(sessionA.sessionId),e=>[403,404,409].includes(e?.status),'cross_account_close_denied');
  await assert.rejects(()=>adapterB.desktopLiveRead(sessionA.sessionId,{semanticSessionId:'sem-test'}),e=>[403,404,409].includes(e?.status),'cross_account_live_read_denied');
  await assert.rejects(()=>adapterB.desktop(sessionA.sessionId,{op:'status'}),e=>[403,404,409].includes(e?.status),'cross_account_desktop_denied');

  const closed=await adapterA.closeSession(sessionA.sessionId);
  assert.equal(closed.sessionId,sessionA.sessionId,'owner_close_session');
  console.log(JSON.stringify({ok:true,accountIsolation:true,deviceIsolation:true,sessionIsolation:true,rmOwnershipGuard:true,oauthVerifyNoPortalSession:true,pairingServerRecovery:true},null,2));
} finally {
  await cleanup();
}
