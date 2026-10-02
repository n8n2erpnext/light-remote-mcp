import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';
import { ipcEndpoint, removeIpcEndpoint, waitForIpc } from './selftest-ipc.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
const run=String(process.pid)+'-'+Date.now(), dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt-vps-device-endpoints-'+String(process.pid)+'-')), socket=ipcEndpoint('gpt-vps-device-endpoints');
const logDir=path.join(dir,'log'), stateDir=path.join(dir,'state');
  removeIpcEndpoint(socket); fs.rmSync(dir,{recursive:true,force:true});
const cryptoFixture=createOperatorCryptoFixture(stateDir);
const env={...process.env,OPERATOR_SOCKET:socket,OPERATOR_LOG_DIR:logDir,OPERATOR_STATE_DIR:stateDir,
  OPERATOR_KEY_FILE:cryptoFixture.privateFile,OPERATOR_ACCOUNT_ID:'acct-test',
  OPERATOR_DEVICE_ID:'device-test',OPERATOR_NODE_ID:'arm-test',OPERATOR_DEVICE_NAME:'ARM Test',
  OPERATOR_SESSION_IDLE_MS:'2000',OPERATOR_SESSION_MIN_IDLE_MS:'500',OPERATOR_SESSION_MAX_IDLE_MS:'14400000'};
const child=spawn(process.execPath,[`${root}/operator-host/executor.mjs`],{cwd:root,env,stdio:['ignore','pipe','pipe']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await waitForIpc(socket,{attempts:80,delayMs:50,error:'socket_not_ready'});
function request(method,target,body){return new Promise((resolve,reject)=>{const payload=body==null?null:Buffer.from(JSON.stringify(body));
  const req=http.request({socketPath:socket,method,path:target,headers:payload?{'content-type':'application/json','content-length':payload.length}:{}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,json:JSON.parse(text)}));});
  req.on('error',reject); if(payload)req.write(payload); req.end();});}
try {
  const cap=await request('GET','/v1/capabilities'); if(cap.status!==200||cap.json.deviceId!=='device-test'||cap.json.sessionGracePresets?.['60m']!==3600000) throw new Error('capabilities_device_missing');
  const before=await request('GET','/v1/devices'); if(before.status!==200||before.json.devices?.[0]?.state!=='online'||before.json.devices[0].activeSessions!==0) throw new Error('device_list_initial_failed');  const aid='agent-device-endpoint-test-aaaaaaaa', openId='device-endpoint-open-test-aaaaaaaa';
  const opened=await request('POST','/v1/sessions/open',{agentId:aid,openId,label:'device endpoint',workspace:os.tmpdir(),graceMs:1200,gracePreset:'custom'});
  if(opened.status!==200||opened.json.session.graceMs!==1200||opened.json.session.gracePreset!=='custom'||opened.json.session.deviceId!=='device-test') throw new Error('session_device_lease_failed');
  const sid=opened.json.session.sessionId;
  const during=await request('GET','/v1/devices/device-test');
  if(during.status!==200||during.json.device.activeSessions!==1||during.json.device.accountId!=='acct-test') throw new Error('device_active_session_projection_failed');
  const closed=await request('POST',`/v1/sessions/${sid}/close`,{agentId:aid}); if(closed.status!==200||closed.json.session.state!=='closed') throw new Error('close_failed');
  const after=await request('GET','/v1/devices'); if(after.json.devices?.[0]?.activeSessions!==0) throw new Error('device_session_release_projection_failed');
  if(!fs.existsSync(`${stateDir}/devices.json`)) throw new Error('device_state_not_persisted');
  console.log(JSON.stringify({ok:true,deviceId:during.json.device.deviceId,nodeId:during.json.device.nodeId,graceMs:opened.json.session.graceMs,activeDuring:during.json.device.activeSessions,activeAfter:after.json.devices[0].activeSessions,persisted:true},null,2));
} finally {
  child.kill('SIGTERM'); await sleep(100);
  removeIpcEndpoint(socket); fs.rmSync(dir,{recursive:true,force:true});
}
