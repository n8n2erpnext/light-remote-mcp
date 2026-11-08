import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';
import { ipcEndpoint, removeIpcEndpoint, waitForIpc } from './selftest-ipc.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-connection-endpoints-'+String(process.pid)+'-'));
const socketPath=ipcEndpoint('lr-connection-endpoints'),logDir=path.join(dir,'log'),stateDir=path.join(dir,'state');
fs.mkdirSync(logDir,{recursive:true});
const fixture=createOperatorCryptoFixture(stateDir);
const child=spawn(process.execPath,[path.join(root,'operator-host','executor.mjs')],{cwd:root,env:{...process.env,OPERATOR_SOCKET:socketPath,OPERATOR_LOG_DIR:logDir,OPERATOR_STATE_DIR:stateDir,OPERATOR_KEY_FILE:fixture.privateFile,OPERATOR_CONNECTION_LEASE_ENFORCE:'1',OPERATOR_ACCOUNT_PLAN:'free',OPERATOR_SESSION_IDLE_MS:'900000',OPERATOR_SESSION_MIN_IDLE_MS:'900000',OPERATOR_SESSION_MAX_IDLE_MS:'3600000'},stdio:['ignore','pipe','pipe']});
let childLog='';child.stdout.on('data',d=>childLog+=d);child.stderr.on('data',d=>childLog+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function request(method,target,body){return new Promise((resolve,reject)=>{const payload=body==null?null:Buffer.from(JSON.stringify(body));const req=http.request({socketPath,method,path:target,headers:payload?{'content-type':'application/json','content-length':payload.length}:{}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json={raw:text}}resolve({status:res.statusCode,json});});});req.on('error',reject);req.setTimeout(15000,()=>req.destroy(new Error('request_timeout:'+method+':'+target)));if(payload)req.write(payload);req.end();});}
async function stopChild(){if(child.exitCode!=null)return;try{child.kill('SIGTERM')}catch{}await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(1000)]);if(child.exitCode==null){try{child.kill('SIGKILL')}catch{}}}

try{
  await waitForIpc(socketPath,{attempts:80,delayMs:50,error:'socket_not_ready',details:()=>childLog});
  const deviceId='arm-local',aid='agent-device-connection-endpoint-test';
  let r=await request('GET','/v1/devices/'+deviceId+'/connection');
  if(r.status!==200||r.json.connection.state!=='dormant')throw new Error('initial_connection_not_dormant');
  r=await request('POST','/v1/sessions/open',{openId:'open-device-connection-test',agentId:aid,nodeId:'arm'});
  if(r.status!==409||r.json.error!=='device_connection_required')throw new Error('session_open_not_gated');
  r=await request('POST','/v1/devices/'+deviceId+'/connection/connect',{requestedLeaseMs:2*60*60*1000,reconnectGraceMs:30*60*1000});
  if(r.status!==200||r.json.connection.state!=='connected'||r.json.connection.plan!=='free')throw new Error('connection_open_failed');
  r=await request('POST','/v1/sessions/open',{openId:'open-device-connection-test',agentId:aid,nodeId:'arm'});
  if(r.status!==200||r.json.session.deviceId!==deviceId)throw new Error('session_open_after_connect_failed');
  const sid=r.json.session.sessionId;
  r=await request('POST','/v1/devices/'+deviceId+'/connection/grace',{reconnectGraceMs:45*60*1000});
  if(r.status!==200||r.json.connection.reconnectGraceMs!==45*60*1000)throw new Error('connection_grace_update_failed');
  r=await request('POST','/v1/devices/'+deviceId+'/connection/disconnect',{reason:'selftest'});
  if(r.status!==200||r.json.connection.state!=='dormant'||r.json.connection.closeReason!=='selftest')throw new Error('disconnect_failed');
  r=await request('GET','/v1/sessions/'+sid+'?agentId='+aid);
  if(r.status!==200||r.json.session.state!=='closed')throw new Error('device_disconnect_did_not_close_sessions');
  r=await request('POST','/v1/devices/'+deviceId+'/connection/connect',{requestedLeaseMs:5*60*60*1000});
  if(r.status!==400||r.json.error!=='invalid_device_connection_lease')throw new Error('free_cap_not_enforced');
  console.log(JSON.stringify({ok:true,enforcement:true,plan:'free',capHours:4,sessionClosedOnDisconnect:true},null,2));
}finally{
  await stopChild();
  removeIpcEndpoint(socketPath);
  fs.rmSync(dir,{recursive:true,force:true});
}
