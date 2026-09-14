import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';

const root=new URL('../..',import.meta.url).pathname,dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-fleet-wall-'));
const stateFile=path.join(dir,'device.json'),identityFile=path.join(dir,'device-identity.json');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
const privateEncoded=privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
const publicKeySha256=crypto.createHash('sha256').update(Buffer.from(publicIdentityKey,'base64')).digest('hex');
const deviceId='dev_fleet_wall_test';
fs.writeFileSync(stateFile,JSON.stringify({identity:{publicIdentityKey,publicKeySha256},enrollment:{deviceId,accountId:'self-hosted-local'}}));
fs.writeFileSync(identityFile,JSON.stringify({privateKey:privateEncoded,publicKey:publicIdentityKey}),{mode:0o600});
let authorityAllowed=true,authorityCalls=0,statusCalls=0,signedCalls=0,policyCalls=0,updateCalls=0,activityCalls=0;
const hub=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text||'{}'),action=String(req.url||'').split('/').pop();
  const expected=deviceChannelMessage({deviceId:body.deviceId,action,timestamp:body.timestamp,nonce:body.nonce,payload:body.payload});
  if(body.deviceId!==deviceId||!crypto.verify(null,Buffer.from(expected),publicKey,Buffer.from(String(body.signature||''),'base64url'))){res.writeHead(401,{'content-type':'application/json'});return res.end(JSON.stringify({error:'invalid_signature'}));}
  signedCalls++;
  if(action==='fleet-authority'){authorityCalls++;if(!authorityAllowed){res.writeHead(403,{'content-type':'application/json'});return res.end(JSON.stringify({error:'fleet_main_device_required'}));}
    return reply(res,200,{ok:true,authority:{token:'fleet-test-token',lease:{leaseId:'fl_test',deviceId,expiresAt:Date.now()+1400}},entitlements:{fleetWall:true,multiDeviceConsole:true}});}
  if(action==='fleet-status'){statusCalls++;if(body.payload?.status!=='online'||Number(body.payload?.port)!==Number(process.env.TEST_FLEET_PORT||body.payload?.port))return reply(res,400,{ok:false,error:'invalid_fleet_status'});return reply(res,200,{ok:true,fleet:{desired:true,status:'online',port:Number(body.payload.port)}});}
  if(body.payload?.fleetToken!=='fleet-test-token')return reply(res,401,{ok:false,error:'fleet_authority_required'});
  if(action==='fleet-devices')return reply(res,200,{ok:true,mainDeviceId:deviceId,devices:[{accountId:'self-hosted-local',deviceId,nodeId:deviceId,displayName:'Fleet Main',state:'online',platform:'linux',architecture:'x64',agentVersion:'0.9.0-rc.6',activeSessions:0,connection:{state:'connected',remainingMs:60000}}]});
  if(action==='fleet-sessions')return reply(res,200,{ok:true,mainDeviceId:deviceId,sessions:[]});
  if(action==='fleet-activity'){activityCalls++;return reply(res,200,{ok:true,mainDeviceId:deviceId,events:[{id:activityCalls,at:new Date().toISOString(),type:'device_online',deviceId,accountId:'self-hosted-local'}]});}
  return reply(res,404,{ok:false,error:'not_found'});
});
function reply(res,status,value){const data=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(data)});res.end(data);}
const listen=(server,port=0)=>new Promise((resolve,reject)=>server.once('error',reject).listen(port,'127.0.0.1',()=>resolve(server.address().port)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function get(port,target='/'){return new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port,path:target},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);});}
function openSse(port){return new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port,path:'/events'},res=>resolve({req,res,close:()=>{try{res.destroy();}catch{}try{req.destroy();}catch{}}}));req.on('error',reject);});}
async function waitHttp(port,timeout=4000){const until=Date.now()+timeout;while(Date.now()<until){try{const r=await get(port,'/healthz');if(r.status===200)return r;}catch{}await sleep(50);}throw new Error('fleet_wall_not_listening');}
async function waitClosed(port,timeout=5000){const until=Date.now()+timeout;while(Date.now()<until){try{await get(port,'/healthz');}catch{return true;}await sleep(80);}throw new Error('fleet_wall_port_still_open');}
async function freePort(){const s=http.createServer();const p=await listen(s);await new Promise(r=>s.close(r));return p;}
const hubPort=await listen(hub),fleetPort=await freePort();
function spawnFleet(port){return spawn(process.execPath,[`${root}/device-agent/fleet-wall-runtime.mjs`],{cwd:root,env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_IDENTITY_FILE:identityFile,OPERATOR_AGENT_HUB_URL:`http://127.0.0.1:${hubPort}`,OPERATOR_FLEET_WALL_HOST:'127.0.0.1',OPERATOR_FLEET_WALL_PORT:String(port),OPERATOR_FLEET_AUTHORITY_CHECK_MS:'1000',OPERATOR_FLEET_AUTHORITY_RENEW_SKEW_MS:'1000'},stdio:['ignore','pipe','pipe']});}
function exitOf(child,timeout=5000){if(child.exitCode!==null||child.signalCode!==null)return Promise.resolve({code:child.exitCode,signal:child.signalCode});return Promise.race([new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal}))),sleep(timeout).then(()=>{throw new Error('fleet_wall_exit_timeout');})]);}
let child=spawnFleet(fleetPort);let stderr='';child.stderr.on('data',d=>stderr+=d);
await waitHttp(fleetPort);
let r=await get(fleetPort,'/');if(r.status!==200||!r.text.includes('Fleet Wall · Main device')||!r.text.includes('const surfaceFleet=true')||!r.text.includes('if(!sseLive)probeActivityHead()')||!r.text.includes('visibilitychange'))throw new Error('fleet_wall_dashboard_contract_failed');
r=await get(fleetPort,'/api/devices');if(r.status!==200||!JSON.parse(r.text).devices?.some(d=>d.deviceId===deviceId))throw new Error('fleet_wall_devices_failed');
r=await get(fleetPort,'/api/sessions');if(r.status!==200||!Array.isArray(JSON.parse(r.text).sessions))throw new Error('fleet_wall_sessions_failed');
r=await get(fleetPort,'/api/activity?limit=10');if(r.status!==200||JSON.parse(r.text).events?.[0]?.deviceId!==deviceId)throw new Error('fleet_wall_activity_failed');
const beforeSse=activityCalls,sseA=await openSse(fleetPort),sseB=await openSse(fleetPort);await sleep(2200);const sseDelta=activityCalls-beforeSse;sseA.close();sseB.close();await sleep(100);if(sseDelta<2||sseDelta>4)throw new Error(`fleet_wall_sse_must_share_upstream_pump:${sseDelta}`);const afterClose=activityCalls;await sleep(1200);if(activityCalls!==afterClose)throw new Error(`fleet_wall_idle_pump_must_stop:${activityCalls-afterClose}`);
console.log('v09-fleet-wall-shared-activity-pump=PASS');
console.log('v09-fleet-wall-idle-pump-stop=PASS');
if(authorityCalls<1||statusCalls<1||signedCalls<5)throw new Error('fleet_wall_signed_channel_not_used');
authorityAllowed=false;await waitClosed(fleetPort,5000);const firstExit=await exitOf(child);if(firstExit.code!==0)throw new Error(`fleet_wall_authority_shutdown_failed:${firstExit.code}:${stderr}`);
console.log('v09-fleet-wall-authority-loss-closes-port=PASS');
const deniedPort=await freePort();child=spawnFleet(deniedPort);stderr='';child.stderr.on('data',d=>stderr+=d);const deniedExit=await exitOf(child,4000);if(deniedExit.code===0||!stderr.includes('fleet_main_device_required'))throw new Error('unauthorized_fleet_wall_start_not_rejected');
let listened=false;try{await get(deniedPort,'/healthz');listened=true;}catch{}if(listened)throw new Error('unauthorized_fleet_wall_bound_port');
console.log('v09-fleet-wall-unauthorized-start=PASS');
console.log('v09-fleet-wall-device-signature=PASS');
console.log('v09-fleet-wall-dashboard=PASS');
await new Promise(r=>hub.close(r));fs.rmSync(dir,{recursive:true,force:true});
