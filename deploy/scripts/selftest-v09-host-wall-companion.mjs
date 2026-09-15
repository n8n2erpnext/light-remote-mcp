import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';

const root=new URL('../..',import.meta.url).pathname;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-host-wall-'));
const stateFile=path.join(dir,'device.json'),authFile=path.join(dir,'wall-auth.json');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
const publicKeySha256=crypto.createHash('sha256').update(Buffer.from(publicIdentityKey,'base64')).digest('hex');
fs.writeFileSync(stateFile,JSON.stringify({identity:{privateKey:privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),publicIdentityKey,publicKeySha256},enrollment:{enrollmentId:'trusted-host',deviceId:'arm-local',nodeId:'arm',accountId:'self-hosted-local',grantableCapabilities:['filesystem','terminal'],approvedCapabilities:['filesystem'],policyProfile:'self-hosted-owner',displayName:'VPS-ARM'},policy:{deniedCapabilities:[],localProfile:'full'},effectiveCapabilities:['filesystem','terminal'],cloud:{desiredConnected:false,state:'dormant'}}));
let fleetIntent=0,polls=0,badSignature=0;
const hub=http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);let body={};try{body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{}
  const action=req.url?.split('/').pop()||'';
  if(action==='poll')polls++;
  if(action==='fleet-intent'){
    fleetIntent++;const payload=body.payload||{},message=deviceChannelMessage({deviceId:'arm-local',action,timestamp:body.timestamp,nonce:body.nonce,payload});
    if(!crypto.verify(null,Buffer.from(message),publicKey,Buffer.from(String(body.signature||''),'base64url')))badSignature++;
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,fleet:{desired:false,port:5492,reason:'not_main_device'}}));return;
  }
  res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'not_found'}));
});
await new Promise(r=>hub.listen(0,'127.0.0.1',r));
const hubUrl=`http://127.0.0.1:${hub.address().port}`,wallPort=26000+(process.pid%10000);
const child=spawn(process.execPath,[`${root}/device-agent/operator-agent.mjs`,'wall-only'],{cwd:root,env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_WALL_AUTH_FILE:authFile,OPERATOR_AGENT_HUB_URL:hubUrl,OPERATOR_AGENT_WALL_HOST:'127.0.0.1',OPERATOR_AGENT_WALL_PORT:String(wallPort),OPERATOR_FLEET_RECONCILE_MS:'60000'},stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ready=false;for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${wallPort}/login`);if(r.status===200){ready=true;break;}}catch{}await sleep(50);}
if(!ready)throw new Error(`host_wall_not_ready:${stderr}`);
for(let i=0;i<40&&fleetIntent<1;i++)await sleep(50);
if(fleetIntent<1||badSignature)throw new Error(`host_wall_fleet_intent_invalid:${fleetIntent}:${badSignature}`);
await sleep(250);if(polls!==0)throw new Error(`host_wall_must_not_poll:${polls}`);
const auth=JSON.parse(fs.readFileSync(authFile,'utf8'));
if(auth.mode!=='account-only'||auth.passwordHash)throw new Error('host_wall_account_only_auth_failed');
if((fs.statSync(authFile).mode&0o777)!==0o600)throw new Error('host_wall_auth_permissions');
const statusChild=spawn(process.execPath,[`${root}/device-agent/operator-agent.mjs`,'status'],{cwd:root,env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_WALL_AUTH_FILE:authFile},stdio:['ignore','pipe','pipe']});let statusOut='';statusChild.stdout.on('data',d=>statusOut+=d);await new Promise(r=>statusChild.once('exit',r));const statusJson=JSON.parse(statusOut);if(statusJson.policyAuthority!=='local-main'||!statusJson.effectiveCapabilities?.includes('terminal'))throw new Error('trusted_host_local_authority_status_failed');
child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));
if(!stdout.includes('host_wall_companion_started')||!stdout.includes('host_wall_companion_stopped'))throw new Error('host_wall_lifecycle_markers_missing');
console.log('v09-host-wall-account-only-auth=PASS');
console.log('v09-host-wall-signed-fleet-intent=PASS');
console.log('v09-host-wall-zero-poll=PASS');
console.log('v10-host-main-local-authority=PASS');
await new Promise(r=>hub.close(r));fs.rmSync(dir,{recursive:true,force:true});
