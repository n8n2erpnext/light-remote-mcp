import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {writeLocalWallAuthConfig,loadLocalWallAuth} from '../../device-agent/local-wall-auth.mjs';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-m5-process-wall-'));
const authFile=path.join(dir,'wall-auth.json');
writeLocalWallAuthConfig(authFile,{username:'operator',password:'fixture-process-owner-pwd-123',sessionTtlSeconds:3600});
const auth=loadLocalWallAuth(authFile,{required:true});
const owner={accountId:'fixture-account',deviceId:'fixture-device',sessionId:'s_fixture-owner',agentId:'a_fixture-owner'};
const runtime=new NativeProcessRegistry({maxProcesses:2});
const shell=process.platform==='win32'?'powershell.exe':'/bin/sh';
const processScript=process.platform==='win32'?'Start-Sleep -Seconds 24':'sleep 24';
const native=runtime.start({...owner,script:processScript,cwd:dir,timeoutMs:30000,
  spawnSpec:()=>process.platform==='win32'?{file:shell,args:['-NoProfile','-Command',processScript]}:{file:shell,args:['-c',processScript]}});
const processId=native.processId;
let stopCalls=0;
const view=p=>({processId:p.processId,sessionId:p.sessionId,pid:p.pid,state:p.state,exitCode:p.exitCode,stdoutBytes:p.stdoutBytes,stderrBytes:p.stderrBytes});
const wall=startLocalWall({host:'127.0.0.1',port:0,auth,
  getLocalStatus:async()=>({deviceName:'fixture',cloudState:'disconnected'}),
  getRemoteStatus:async()=>({sessions:[]}),getRemoteActivity:async()=>({events:[]}),
  getLocalProcesses:async()=>runtime.list().map(view),
  stopLocalProcess:async({processId:target,force})=>{stopCalls++;const p=runtime.list().find(row=>row.processId===target);if(!p)throw Object.assign(new Error('process_not_found'),{status:404});return runtime.stop(target,{accountId:p.accountId,deviceId:p.deviceId,sessionId:p.sessionId,agentId:p.agentId},{force});}
});
await new Promise(resolve=>wall.server.listening?resolve():wall.server.once('listening',resolve));
const port=wall.server.address().port;
const request=(method,url,headers={},payload='')=>new Promise((resolve,reject)=>{
  const r=http.request({host:'127.0.0.1',port,path:url,method,headers:{...headers,...(payload?{'content-length':Buffer.byteLength(payload)}:{})}},res=>{
    const parts=[];res.on('data',v=>parts.push(v));res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(parts).toString(),headers:res.headers}));
  });r.on('error',reject);r.end(payload);
});
try{
  let r=await request('GET','/processes');assert.equal(r.status,303,'redirect login');
  r=await request('GET','/api/processes');assert.equal(r.status,401);
  r=await request('POST','/api/processes/stop',{'content-type':'application/json'},JSON.stringify({processId,force:true}));assert.equal(r.status,401);
  assert.equal(stopCalls,0);
  r=await request('GET','/login');const loginCsrf=r.text.match(/name="csrf" value="([^"]+)"/)?.[1];assert.ok(loginCsrf);
  r=await request('POST','/auth/login',{'content-type':'application/x-www-form-urlencoded'},new URLSearchParams({username:'operator',password:'fixture-process-owner-pwd-123',csrf:loginCsrf,next:'/processes'}).toString());
  assert.equal(r.status,303);const cookie=String(r.headers['set-cookie']?.[0]||'').split(';')[0];assert.ok(cookie);
  r=await request('GET','/processes',{cookie});assert.equal(r.status,200);
  assert.match(r.text,/Managed Processes/);assert.doesNotMatch(r.text,/sleep 24/,'no command embedded');
  const csrf=JSON.parse(r.text.match(/const csrf=("(?:\\.|[^"])*")/)?.[1]||'null');assert.ok(csrf);
  const script=r.text.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert.ok(script);new Function(script);
  r=await request('GET','/api/processes',{cookie});assert.equal(r.status,200);
  let j=JSON.parse(r.text);assert.equal(j.scope,'device_agent_local');assert.equal(j.processes[0].processId,processId);
  assert.equal(j.processes[0].state,'running');
  r=await request('POST','/api/processes/stop',{cookie,'content-type':'application/json'},JSON.stringify({processId,force:false}));
  assert.equal(r.status,403);assert.equal(stopCalls,0,'CSRF must be checked before process stop');
  r=await request('POST','/api/processes/stop',{cookie,'x-light-remote-csrf':csrf,'content-type':'application/json'},JSON.stringify({processId:'lp_bad',force:true}));
  assert.equal(r.status,400);assert.equal(stopCalls,0);
  r=await request('POST','/api/processes/stop',{cookie,'x-light-remote-csrf':csrf,'content-type':'application/json'},JSON.stringify({processId,force:'false'}));
  assert.equal(r.status,400);assert.equal(stopCalls,0);
  r=await request('POST','/api/processes/stop',{cookie,'x-light-remote-csrf':csrf,'content-type':'application/json'},JSON.stringify({processId,force:false}));
  assert.equal(r.status,200);j=JSON.parse(r.text);assert.equal(j.ok,true);assert.equal(stopCalls,1);
  for(let i=0;i<30&&runtime.view(processId,owner).state==='stopping';i++)await new Promise(ok=>setTimeout(ok,70));
  assert.equal(runtime.view(processId,owner).state,'stopped');
  console.log('M5_OWNER_WALL_AUTH_CSRF_STOP_BY_EXACT_PROCESS_ID=PASS');
  console.log('M5_OWNER_WALL_REAL_OS_PROCESS_STOP_CONFIRMED=PASS');
  console.log('M5_OWNER_PROCESS_HTML_ESCAPING_NO_COMMAND_LEAK=PASS');
}finally{runtime.close();await wall.close();fs.rmSync(dir,{recursive:true,force:true});}
