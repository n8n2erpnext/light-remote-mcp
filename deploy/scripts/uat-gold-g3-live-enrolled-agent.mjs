// Real Gold UAT acceptance driver: genuine account login, approval, signed
// enrollment, device connection and Agent process. No test secrets in source.
// This file is intentionally NOT run by CI: live UAT only, explicit opt-in.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

const origin='https://gold.light-remote.thaiduy.digital';
if(process.env.GOLD_G3_ENABLE_LIVE!=='1')throw Error('gold_g3_live_acceptance_explicit_opt_in_required');
const email=String(process.env.GOLD_G3_TEST_EMAIL||'').trim().toLowerCase();
const password=String(process.env.GOLD_G3_TEST_PASSWORD||'');
if(!email.endsWith('@example.invalid')||password.length<12)throw Error('gold_g3_synthetic_account_only');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const cli=path.join(root,'device-agent/operator-agent.mjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gold-g3-live-agent-'));
fs.chmodSync(tmp,0o700);
const stateFile=path.join(tmp,'device.json');
const wallAuthFile=path.join(tmp,'wall-auth.json');
let cookie='',deviceId=null,child=null,cleaned=false,passCount=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=async(fn,ms=13000)=>{
 const end=performance.now()+ms;
 while(performance.now()<end){try{const result=await fn();if(result)return result;}catch{}await sleep(130);}
 throw Error('gold_g3_bounded_check_expired');
};
const freePort=async()=>{
 const s=net.createServer();
 await new Promise((resolve,reject)=>s.listen(0,'127.0.0.1',resolve).once('error',reject));
 const port=s.address().port;await new Promise(r=>s.close(r));return port;
};
async function portal(action,body=null){
 const response=await fetch(origin+'/account/api?action='+encodeURIComponent(action),{
  method:body===null?'GET':'POST',
  headers:{origin,accept:'application/json',...(cookie?{cookie}:{}),...(body!==null?{'content-type':'application/json'}:{})},
  ...(body!==null?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)
 });
 const value=await response.json().catch(()=>({}));
 if(!response.ok||value.ok===false)throw Error('gold_g3_'+action+'_http_'+response.status+':'+String(value.error||'unknown'));
 if(action==='login'){
   cookie=response.headers.get('set-cookie')?.split(';')[0]||'';
   assert.ok(cookie,'missing authenticated portal session cookie');
 }
 return value;
}
async function run(args,{timeoutMs=18000}={}){
 return await new Promise((resolve,reject)=>{
  const env={...process.env,
   OPERATOR_AGENT_IDENTITY_FILE:'',
   OPERATOR_AGENT_STATE:stateFile,
   OPERATOR_AGENT_BASE_URL:origin,
   OPERATOR_AGENT_HUB_URL:origin,
   OPERATOR_AGENT_WALL_HOST:'127.0.0.1',
   OPERATOR_FLEET_WALL_HOST:'127.0.0.1',
   OPERATOR_AGENT_WALL_AUTH_FILE:wallAuthFile,
   LIGHT_REMOTE_UPDATE_MODE:'independent-helper',
  };
  let stdout='',stderr='',closed=false;
  const p=spawn(process.execPath,[cli,...args],{env,cwd:root,stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>{p.kill('SIGKILL');},timeoutMs);
  p.stdout.on('data',b=>stdout=(stdout+b).slice(-15000));
  p.stderr.on('data',b=>stderr=(stderr+b).slice(-15000));
  p.once('error',reject);
  p.once('close',code=>{if(closed)return;closed=true;clearTimeout(timer);
    resolve({ok:code===0,code,stdout,stderr});
  });
 });
}
async function fleetNode(){
 // Uses the **installed** Gold UAT Operator over its own Unix IPC.
 const sock='/run/light-remote-gold-uat/operator.sock';
 if(!fs.existsSync(sock))return null;
 return await new Promise(resolve=>{
  const req=http.get({socketPath:sock,path:'/v1/fleet',timeout:1200},res=>{
    let data='';res.on('data',x=>data+=x);res.on('end',()=>{
      try{resolve(JSON.parse(data).nodes?.find(n=>n.deviceId===deviceId)||null);}catch{resolve(null);}
    });
  });req.on('error',()=>resolve(null));req.on('timeout',()=>{req.destroy();resolve(null);});
 });
}
const started=performance.now();
try{
 const account=await portal('login',{email,password});
 assert.equal(account.account?.email,email);
 console.log('G3_GOLD_LIVE_UAT_SYNTHETIC_ACCOUNT_LOGIN=PASS');passCount++;
 const before=await portal('devices');
 const beforeIds=new Set((before.devices||[]).map(d=>d.deviceId));
 const pending=await run(['login','--no-wait','--name','G3 GOLD Disposable Linux UAT','--policy','safe','--deny','sudo-on-demand,desktop-input']);
 assert.equal(pending.ok,true,'device Agent enrollment begin failed: '+pending.stderr.slice(-500));
 assert.ok(pending.stdout.includes('Activation URL:'));
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 assert.ok(state.pendingEnrollment?.enrollmentId);
 const code=pending.stdout.match(/Device code:\s*([^\s]+)/)?.[1];
 assert.ok(code,'device code not provided by actual enrollment API');
 console.log('G3_GOLD_LIVE_UAT_PUBLIC_ENROLLMENT_BEGIN=PASS');passCount++;
 const approve=await portal('enrollment-approve',{enrollmentId:state.pendingEnrollment.enrollmentId,code});
 assert.ok(approve.approval?.deviceId,'normal authenticated owner approval missing');
 deviceId=approve.approval.deviceId;
 assert.ok(!beforeIds.has(deviceId),'fixture device already existed');
 console.log('G3_GOLD_LIVE_UAT_AUTHENTICATED_OWNER_APPROVAL=PASS');passCount++;
 const poll=await run(['poll']);
 assert.equal(poll.ok,true,'enrollment poll failed: '+poll.stderr.slice(-500));
 const enrolled=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 assert.equal(enrolled.enrollment?.deviceId,deviceId);
 assert.equal(enrolled.enrollment?.accountId,account.account?.accountId);
 assert.equal(enrolled.cloud?.state,'dormant');
 console.log('G3_GOLD_LIVE_UAT_CERTIFICATE_VERIFIED_DORMANT=PASS');passCount++;
 const connection=await run(['connect','--lease-hours','1']);
 assert.equal(connection.ok,true,'signed connect failed: '+connection.stderr.slice(-550));
 console.log('G3_GOLD_LIVE_UAT_SIGNED_CONNECTION=PASS');passCount++;

 const {writeLocalWallAuthConfig}=await import('../../device-agent/local-wall-auth.mjs');
 const wallPass='g3-w-'+crypto.randomBytes(14).toString('base64url');
 writeLocalWallAuthConfig(wallAuthFile,{username:'g3uat',password:wallPass});
 const wallPort=await freePort(),env={...process.env,
  OPERATOR_AGENT_IDENTITY_FILE:'',OPERATOR_AGENT_STATE:stateFile,
  OPERATOR_AGENT_BASE_URL:origin,OPERATOR_AGENT_HUB_URL:origin,
  OPERATOR_AGENT_WALL_HOST:'127.0.0.1',OPERATOR_FLEET_WALL_HOST:'127.0.0.1',
  OPERATOR_AGENT_WALL_PORT:String(wallPort),OPERATOR_AGENT_WALL_AUTH_FILE:wallAuthFile,
  OPERATOR_AGENT_EXECUTOR_PROBE_INTERVAL_MS:'5000',
  OPERATOR_AGENT_EXECUTOR_PROBE_TIMEOUT_MS:'1500',
  OPERATOR_AGENT_CHANNEL_WAIT_MS:'1000'
 };
 let stdout='',stderr='';
 child=spawn(process.execPath,[cli,'daemon'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>stdout=(stdout+b).slice(-12000));
 child.stderr.on('data',b=>stderr=(stderr+b).slice(-12000));
 const node=await deadline(async()=>{const item=await fleetNode();return item?.channelFresh?item:null;},15000);
 assert.equal(node.accountId,account.account.accountId);
 console.log('G3_GOLD_LIVE_UAT_REAL_AGENT_FLEET_CHANNEL_FRESH=PASS');passCount++;
 const probe=await deadline(async()=>{
  const r=await fetch('http://127.0.0.1:'+wallPort+'/login',{signal:AbortSignal.timeout(700)});
  return r.status===200;
 },5000);
 assert.equal(probe,true);
 console.log('G3_GOLD_LIVE_UAT_REAL_AGENT_LOCAL_WALL=PASS');passCount++;
 // No user command or remote effect is dispatched. Real service version may
 // lack source G3 executorReady; report it honestly.
 const fresh=await fleetNode();
 console.log('G3_GOLD_LIVE_UAT_AGENT_READINESS_OBSERVED='+JSON.stringify({
  channelFresh:fresh?.channelFresh??null,executorReady:fresh?.executorReady??null,
  dispatchReady:fresh?.dispatchReady??null,readinessReason:fresh?.readinessReason??null,
  note:'installed Operator version may predate G3 independent readiness support'
 }));
 console.log('G3_GOLD_LIVE_UAT_SUMMARY='+JSON.stringify({
  passed:passCount,totalMs:Math.round(performance.now()-started),
  tested:'normal synthetic account login, real public enrollment, authenticated approval, cert claim, signed connect, daemon channel to installed Operator',
  excluded:'owner physical device, remote filesystem effects, stage new Operator release, full 20sec half-open failure'
 }));
}finally{
 if(child){
  try{child.kill('SIGTERM');}catch{}
  await Promise.race([new Promise(r=>child.once('exit',r)),sleep(4000)]);
  try{child.kill('SIGKILL');}catch{}
 }
 if(deviceId&&cookie){
  try{
   const before=await portal('devices');
   if((before.devices||[]).some(x=>x.deviceId===deviceId)){
    await portal('device-remove',{deviceId});
    cleaned=true;
    console.log('G3_GOLD_LIVE_UAT_TEST_DEVICE_REMOVED=PASS');
   }
  }catch(error){console.error('G3_GOLD_UAT_CLEANUP_ERROR='+String(error.message).slice(0,180));}
 }
 if(cookie){try{await portal('logout',{});}catch{}}
 fs.rmSync(tmp,{recursive:true,force:true});
 if(deviceId&&!cleaned)console.error('G3_GOLD_UAT_ATTENTION_TEST_DEVICE_MAY_REQUIRE_MANUAL_REMOVAL');
}
