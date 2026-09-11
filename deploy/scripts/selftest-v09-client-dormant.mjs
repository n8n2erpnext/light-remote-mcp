import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const root=new URL('../..',import.meta.url).pathname;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-dormant-'));
const stateFile=path.join(tmp,'device.json');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
const privateIdentityKey=privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
function state(desired){return {identity:{algorithm:'Ed25519',privateKey:privateIdentityKey,publicIdentityKey},
  enrollment:{deviceId:'dev_dormant_test_1234567890',nodeId:'node-dormant-test',accountId:'acct-test',
    approvedCapabilities:['filesystem'],grantableCapabilities:['filesystem'],policyProfile:'default'},
  policy:{serverPolicyRevision:1,localFinalDenyBoundary:true},effectiveCapabilities:['filesystem'],
  cloud:{desiredConnected:desired,state:desired?'connected':'dormant'}};}
fs.writeFileSync(stateFile,JSON.stringify(state(false)),{mode:0o600});
let requests=0,mode='expire',racePollResolve=null;
const server=http.createServer((req,res)=>{requests++;let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  res.setHeader('content-type','application/json');
  if(mode==='race'&&req.url==='/device-channel/poll'){racePollResolve?.();return setTimeout(()=>res.end(JSON.stringify({ok:true,channel:{}})),650);}
  if((mode==='connect'||mode==='race')&&req.url==='/device-channel/connect'){const id=mode==='race'?'dc_race':'dc_test';return res.end(JSON.stringify({ok:true,connection:{connectionId:id,state:'connected',plan:'free',connectedAt:Date.now(),hardExpiresAt:Date.now()+3600000,reconnectGraceMs:1800000}}));}
  res.statusCode=410;res.end(JSON.stringify({ok:false,error:'device_connection_expired'}));
});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const env={...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_HUB_URL:base,OPERATOR_AGENT_DORMANT_CHECK_MS:'250'};
function startDaemon(){return spawn(process.execPath,[`${root}/device-agent/operator-agent.mjs`,'daemon'],{cwd:root,env,stdio:['ignore','pipe','pipe']});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

let daemon=startDaemon();
await sleep(900);
if(requests!==0) throw new Error(`dormant_client_called_server:${requests}`);
daemon.kill('SIGTERM');await sleep(150);

fs.writeFileSync(stateFile,JSON.stringify(state(true)),{mode:0o600});requests=0;mode='expire';
daemon=startDaemon();
await sleep(1800);
const expiredState=JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(requests!==1) throw new Error(`expired_connection_retried_cloud:${requests}`);
if(expiredState.cloud?.desiredConnected!==false||expiredState.cloud?.state!=='dormant') throw new Error('expired_connection_not_dormant');
daemon.kill('SIGTERM');await sleep(150);

mode='connect';requests=0;
const connect=spawn(process.execPath,[`${root}/device-agent/operator-agent.mjs`,'connect','--hub',base],{cwd:root,env,stdio:['ignore','pipe','pipe']});
let out='',err='';connect.stdout.on('data',d=>out+=d);connect.stderr.on('data',d=>err+=d);
await new Promise(r=>connect.on('close',r));
if(connect.exitCode!==0) throw new Error(`connect_failed:${err}`);
const connectedState=JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(connectedState.cloud?.desiredConnected!==true||connectedState.cloud?.state!=='connected'||connectedState.cloud?.connectionId!=='dc_test') throw new Error('connect_state_not_persisted');
if(requests!==1) throw new Error(`connect_request_count_wrong:${requests}`);

// Prove a Local Wall connect cannot be clobbered by an already in-flight daemon long poll.
fs.writeFileSync(stateFile,JSON.stringify(state(true)),{mode:0o600});requests=0;mode='race';
let racePollStartedResolve;const racePollStarted=new Promise(r=>{racePollStartedResolve=r;});racePollResolve=racePollStartedResolve;
daemon=startDaemon();
await Promise.race([racePollStarted,sleep(1500).then(()=>{throw new Error('race_poll_not_started');})]);
const raceConnect=spawn(process.execPath,[`${root}/device-agent/operator-agent.mjs`,'connect','--hub',base],{cwd:root,env,stdio:['ignore','pipe','pipe']});
let raceErr='';raceConnect.stderr.on('data',d=>raceErr+=d);await new Promise(r=>raceConnect.on('close',r));
if(raceConnect.exitCode!==0) throw new Error(`race_connect_failed:${raceErr}`);
await sleep(900);
const raceState=JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(raceState.cloud?.connectionId!=='dc_race'||raceState.cloud?.hardExpiresAt==null||raceState.cloud?.reconnectGraceMs!==1800000) throw new Error(`inflight_poll_clobbered_connect_state:${JSON.stringify(raceState.cloud)}`);
daemon.kill('SIGTERM');await sleep(150);

console.log(JSON.stringify({ok:true,dormantCloudRequests:0,expiryRequests:1,connectRequests:1,inflightPollConnectRace:'preserved',serviceModel:'always-alive-local/cloud-finite'},null,2));
server.close();fs.rmSync(tmp,{recursive:true,force:true});
