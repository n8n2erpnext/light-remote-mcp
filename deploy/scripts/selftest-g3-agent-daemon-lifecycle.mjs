/**
 * Bounded *real Agent daemon* lifecycle soak. No enrollment, account,
 * production, or external endpoint is touched. Real Agent and Local Wall
 * are spawned as child processes, private loopback only.
 *
 * node deploy/scripts/selftest-g3-agent-daemon-lifecycle.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {writeLocalWallAuthConfig} from '../../device-agent/local-wall-auth.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const agent=path.join(root,'device-agent/operator-agent.mjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sessionDir=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-g3-daemon-'));
fs.chmodSync(sessionDir,0o700);
const authFile=path.join(sessionDir,'wall-auth.json');
const password='g3test-'+crypto.randomBytes(12).toString('base64url');
writeLocalWallAuthConfig(authFile,{username:'g3fixture',password});
const markerMax=120000;
let child=null,peakRssKiB=0,rssSamples=0,totalProbeChecks=0;
let signalCycles=0,starts=0,shutdowns=0;
function rssKiB(pid){
  if(process.platform!=='linux'||!pid)return null;
  try{const match=/^VmRSS:\s*(\d+)\s*kB/m.exec(fs.readFileSync('/proc/'+pid+'/status','utf8'));return match?Number(match[1]):null;}catch{return null;}
}
const measure=()=>{const value=rssKiB(child?.pid);if(value!==null){peakRssKiB=Math.max(peakRssKiB,value);rssSamples++;}};
async function freePort(){
  const s=net.createServer();
  await new Promise((resolve,reject)=>s.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=s.address().port;
  await new Promise(resolve=>s.close(resolve));
  return port;
}
async function awaitUntil(fn,timeoutMs=6000){
  const end=performance.now()+timeoutMs;
  while(performance.now()<end){
    try{const value=await fn();if(value)return value;}catch{}
    await sleep(90);
  }
  throw Error('g3_agent_lifecycle_bounded_wait_expired');
}
async function get(base,target,{cookie,timeoutMs=1200}={}){
  const response=await fetch(base+target,{redirect:'manual',headers:cookie?{cookie}:{},signal:AbortSignal.timeout(timeoutMs)});
  return response;
}
async function login(base){
  const page=await get(base,'/login');
  assert.equal(page.status,200);
  const csrf=(await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf,'local wall login must enforce CSRF');
  const body=new URLSearchParams({username:'g3fixture',password,csrf});
  const response=await fetch(base+'/auth/login',{method:'POST',redirect:'manual',body,
    headers:{'content-type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(1200)});
  assert.equal(response.status,303);
  const cookie=response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('lr_wall_session='),'authenticated local wall session missing');
  return cookie;
}
async function status(base,cookie){
  const response=await get(base,'/api/status',{cookie});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.ok,true);
  return data.local;
}
const rounds=2;
const begin=performance.now();
try{
  for(let round=1;round<=rounds;round++){
    const port=await freePort(),base='http://127.0.0.1:'+port;
    const state=path.join(sessionDir,'node-'+round+'.json');
    const env={...process.env,
      OPERATOR_AGENT_STATE:state,
      OPERATOR_AGENT_BASE_URL:'http://127.0.0.1:1',
      OPERATOR_AGENT_HUB_URL:'http://127.0.0.1:1',
      OPERATOR_AGENT_WALL_PORT:String(port),
      OPERATOR_AGENT_WALL_HOST:'127.0.0.1',
      OPERATOR_AGENT_WALL_AUTH_FILE:authFile,
      OPERATOR_AGENT_EXECUTOR_PROBE_INTERVAL_MS:'5000',
      OPERATOR_AGENT_EXECUTOR_PROBE_TIMEOUT_MS:'1000',
      OPERATOR_FLEET_WALL_HOST:'127.0.0.1',
      OPERATOR_FLEET_WALL_PORT:'0',
    };
    let stdout='',stderr='',exited=false,exitCode=null;
    child=spawn(process.execPath,[agent,'daemon'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    starts++;
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>markerMax)stdout=stdout.slice(-markerMax);});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>markerMax)stderr=stderr.slice(-markerMax);});
    const exitPromise=new Promise(resolve=>{
      child.once('error',error=>{stderr+='spawn_error:'+String(error.message);});
      child.once('exit',(code,signal)=>{exited=true;exitCode=code;resolve({code,signal});});
    });
    try{
      await awaitUntil(async()=>!exited&&(await get(base,'/login',{timeoutMs:500})).status===200,8000);
      const cookie=await login(base);
      let s=await awaitUntil(async()=>{
        const current=await status(base,cookie);
        return current?.executorProbe?.ready===true&&current.executorReady===true?current:null;
      },8000);
      assert.equal(s.enrolled,false);
      const checksBefore=s.executorProbe.checks;
      measure();
      console.log('G3_REAL_DAEMON_AUTHENTICATED_WALL_PROBE=PASS round='+round+' checks='+checksBefore);

      // SIGSTOP is a test-only, OS-native process suspension on POSIX,
      // applied strictly to the new child PID (never a system service).
      if(process.platform!=='win32'){
        process.kill(child.pid,'SIGSTOP');
        try{
          await sleep(850);
          await assert.rejects(async()=>get(base,'/api/status',{cookie,timeoutMs:350}),
            error=>error?.name==='TimeoutError'||error?.name==='AbortError');
        }finally{process.kill(child.pid,'SIGCONT');}
        s=await awaitUntil(async()=>await status(base,cookie),7000);
        assert.equal(s.executorReady,true);
        assert.equal(s.executorProbe.state,'healthy');
        signalCycles++;
        console.log('G3_REAL_DAEMON_SIGSTOP_SIGCONT_WALL_RECOVERY=PASS round='+round);
      }

      const minimumChecks=Math.max(2,checksBefore+1);
      s=await awaitUntil(async()=>{
        measure();
        const current=await status(base,cookie);
        return current.executorProbe.checks>=minimumChecks?current:null;
      },9000);
      assert.equal(s.executorReady,true);
      assert.equal(s.executorProbe.state,'healthy');
      assert.equal(s.executorProbe.probeTimeouts,0);
      totalProbeChecks+=s.executorProbe.checks;
      console.log('G3_REAL_DAEMON_PERIODIC_PROCESS_CANARY=PASS round='+round+' checks='+s.executorProbe.checks);

      const html=await (await get(base,'/',{cookie})).text();
      assert.ok(html.includes('spawn probe '));
      console.log('G3_REAL_DAEMON_WALL_VISIBLE_DIAGNOSTICS=PASS round='+round);
    }finally{
      if(!exited){
        if(process.platform!=='win32'){try{process.kill(child.pid,'SIGCONT');}catch{}}
        child.kill('SIGTERM');
        const stopped=await Promise.race([exitPromise,sleep(6000).then(()=>null)]);
        if(stopped===null){child.kill('SIGKILL');throw Error('g3_agent_daemon_shutdown_timeout');}
      }
      assert.equal(exitCode,0,'daemon must exit cleanly: '+stderr.slice(-1300));
      assert.ok(stdout.includes('device_agent_started'));
      assert.ok(stdout.includes('device_agent_stopped'));
      shutdowns++;
      child=null;
      console.log('G3_REAL_DAEMON_CLEAN_STOP=PASS round='+round);
    }
  }
  assert.equal(starts,rounds);
  assert.equal(shutdowns,rounds);
  assert.ok(totalProbeChecks>=rounds*2);
  console.log('G3_REAL_DAEMON_RESTART_NO_ORPHAN=PASS');
  console.log('G3_REAL_DAEMON_LIFECYCLE_SUMMARY='+JSON.stringify({
    platform:process.platform,arch:process.arch,node:process.version,starts,shutdowns,
    signalCycles,totalProbeChecks,peakSampledRssKiB:peakRssKiB,rssSamples,durationMs:Math.round(performance.now()-begin),
    limitations:'dormant unenrolled genuine Agent, independent local process canary and Wall only; no authenticated Gold Operator enrollment or remote command effects'
  }));
}finally{
  if(child?.pid){try{if(process.platform!=='win32')process.kill(child.pid,'SIGCONT');}catch{}try{child.kill('SIGKILL');}catch{}}
  fs.rmSync(sessionDir,{force:true,recursive:true});
}
