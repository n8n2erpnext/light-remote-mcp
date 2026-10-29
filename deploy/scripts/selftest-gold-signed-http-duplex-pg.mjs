import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import pg from 'pg';
import {GoldExecutionEpochs} from '../../lib/gold-execution-epoch.mjs';
import {AgentExecutionEpochJournal} from '../../device-agent/execution-epoch-journal.mjs';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';
import {DeviceDuplexClient,DEVICE_DUPLEX_PROTOCOL} from '../../lib/device-duplex-client.mjs';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';

// Real localhost signed HTTP and streaming Duplex, but fixture-only PostgreSQL.
// No installed Agent, live Gold database, real Owner connection or real GC.
assert.equal(process.env.LR_EPOCH_PG_TEST_ALLOW,'1');
const database=process.env.LR_GOLD_EPOCH_TEST_DB;
assert.match(database||'',/^lr_gold_epoch_fixture_[0-9]{8}$/);
const pool=new pg.Pool({database,max:4});
const device=crypto.generateKeyPairSync('ed25519');
const issuer=crypto.generateKeyPairSync('ed25519');
const signer=new GoldExecutionEpochs({pool,signer:issuer});
const accountId='acct-http-fixture',deviceId='dev-http-fixture',connectionId='dc_http_fixture_1';
const nodeId='node-http-fixture',instanceId='ei_http_fixture_1';
const publicIdentityKey=device.publicKey.export({format:'der',type:'spki'}).toString('base64');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-signed-http-fixture-'));
if(process.platform!=='win32')fs.chmodSync(dir,0o700);
const journal=new AgentExecutionEpochJournal({directory:dir});
const native=new NativeProcessRegistry();
const commandMap=new Map(),jobMap=new Map(),results=new Map(),usedNonces=new Set();
const makeCommand=label=>{
 const commandId='cmd_'+crypto.randomUUID(),jobId=crypto.randomUUID();
 const command={commandId,jobId,accountId,deviceId,nodeId,
  payload:{type:'process',operationId:'op_'+crypto.randomBytes(12).toString('hex'),process:{op:'start'}}};
 commandMap.set(commandId,command);
 jobMap.set(jobId,{commandId,accountId,deviceId,jobId,status:'running'});
 return {...command,payload:{...command.payload,label}};
};
const pollCommand=makeCommand('poll');
const duplexCommand=makeCommand('duplex');
const pending=[pollCommand];
const signed=(action,payload)=>{
 const timestamp=Date.now(),nonce=crypto.randomBytes(16).toString('base64url');
 const message=deviceChannelMessage({deviceId,action,timestamp,nonce,payload});
 return {deviceId,timestamp,nonce,payload,
  signature:crypto.sign(null,Buffer.from(message),device.privateKey).toString('base64url')};
};
const readJson=async req=>{
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1048576)throw Error('body_too_large');}
 return JSON.parse(raw||'{}');
};
const sendJson=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));return body;};
const verifiedChannelContext=async(body,action)=>{
 const stamp=Number(body?.timestamp),nonce=String(body?.nonce||'');
 assert.equal(body?.deviceId,deviceId);
 assert.ok(Number.isSafeInteger(stamp)&&Math.abs(Date.now()-stamp)<60000);
 assert.ok(nonce.length>=18&&!usedNonces.has(nonce));
 const canonical=deviceChannelMessage({deviceId,action,timestamp:stamp,nonce,payload:body.payload});
 assert.ok(crypto.verify(null,Buffer.from(canonical),device.publicKey,
  Buffer.from(String(body.signature||''),'base64url')),'bad enrolled device signature');
 usedNonces.add(nonce);
 return {binding:{accountId,deviceId,publicIdentityKey,policyRevision:1},
  device:{deviceId,nodeId,agentVersion:'synthetic'},payload:body.payload||{}};
};
const fakeFleet={
 async waitPoll(touch,wait,stop){
  if(pending.length)return {command:pending.shift()};
  if(!stop?.())await new Promise(r=>setTimeout(r,20));
  if(pending.length)return {command:pending.shift()};
  return {command:null};
 },
 touch:()=>({online:true}),view:()=>({online:true}),resume:()=>true,
 command:id=>{const cmd=commandMap.get(id);if(!cmd)throw Error('command_not_found');return cmd;},
 receipt:id=>results.get(id)||null,
 complete:({commandId})=>{results.set(commandId,{accepted:true});commandMap.delete(commandId);}
};
const deps={
 readJson,sendJson,verifiedChannelContext,executionEpochs:signer,
 requiresExecutionEpoch:id=>id===deviceId,
 FleetError:class extends Error{constructor(m,status=400){super(m);this.status=status;}},
 EnrollmentError:class extends Error{constructor(m,status=400){super(m);this.status=status;}},
 connections:{assertConnected:()=>({connectionId}),get:()=>({connectionId})},
 devices:{heartbeat:()=>true},deviceBootObservations:null,
 deviceResourceSampleCache:{record:()=>true},verifiedLeafCapabilities:()=>[],
 requireDeviceConnection:()=>true,reconcileSignedTerminalProcessReceipts:async()=>null,
 deviceStopRequests:()=>[],fleet:fakeFleet,
 accessGrants:{pendingForDevice:()=>[],activeForDevice:()=>null},
 enrollments:{policyEnvelope:()=>null},
 applyDeviceTelemetry:()=>{},emitStream:()=>{},jobs:jobMap,
 finishJob:job=>{job.finishedAt=Date.now();job.exitCode=0;job.status='ok';},
 goldJobs:{flush:async()=>{},get:async()=>null,completedForCommand:async()=>null},
 jobView:job=>({status:job.status,commandId:job.commandId}),
 MAX_MEMORY_OUTPUT:1024*1024,
 pushEvent:()=>{}
};
let server,duplex;
const waitFor=async(predicate,ms=6000)=>{
 const start=Date.now();while(!predicate()){
  if(Date.now()-start>ms)throw Error('signed_http_timeout');
  await new Promise(r=>setTimeout(r,30));
 }
};
try{
 await pool.query("INSERT INTO lr_devices(device_id,state,last_seen_at) VALUES($1,'online',now())",[deviceId]);
 await pool.query(`INSERT INTO lr_device_connections(connection_id,account_id,device_id,connected_at,hard_expires_at)
  VALUES($1,$2,$3,now(),now()+interval '6 hours')`,[connectionId,accountId,deviceId]);
 server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/device-channel/'))url.pathname='/v1'+url.pathname;
  try{await handleDeviceChannelRoutes(req,res,url,deps);}
  catch(error){if(!res.headersSent)sendJson(res,Number(error.status)||409,{ok:false,error:String(error.message)});else res.destroy(error);}
 });
 await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',e=>e?reject(e):resolve()));
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(action,payload)=>{
  const resp=await fetch(base+'/device-channel/'+action,{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify(signed(action,payload))});
  const json=await resp.json();if(!resp.ok||json.ok!==true)throw Error('http_'+action+':'+JSON.stringify(json));
  return json;
 };
 const grantResponse=await request('execution-epoch',{instanceId});
 const grant=journal.acceptGrant(grantResponse,{accountId,deviceId,instanceId,publicKey:issuer.publicKey});
 assert.equal(grant.executionEpoch,'1');
 for(const statement of journal.inventoryPages({accountId,deviceId,privateKey:device.privateKey})){
  const r=await request('execution-inventory',{statement});
  assert.equal(r.inventory.ready,true);
 }
 const executed=[];
 const execute=async command=>{
  journal.checkCommand(command,{accountId,deviceId,publicKey:issuer.publicKey});
  const approval=await request('execution-start',{instanceId,executionAuthorization:command.executionAuthorization});
  assert.equal(approval.start.authorized,true);
  journal.reserve(command,{accountId,deviceId,publicKey:issuer.publicKey});
  const label=command.payload.label;
  const marker=path.join(dir,label+'.txt');
  const child=native.start({accountId,deviceId,sessionId:'session-fixture',
   agentId:'agent-fixture',cwd:dir,script:'synthetic',
   spawnSpec:()=>({file:process.execPath,args:['-e',`require('node:fs').appendFileSync(${JSON.stringify(marker)},'1')`]})});
  journal.finish(command,{data:{ok:true,operation:'start',process:child}});
  let done=child;for(let i=0;i<100&&!done.finishedAt;i++){
   await new Promise(r=>setTimeout(r,20));done=native.view(child.processId);
  }
  assert.equal(done.state,'finished');
  journal.observeProcesses([done],{accountId,deviceId});
  assert.equal(fs.readFileSync(marker,'utf8'),'1');
  executed.push(label);
  return {commandId:command.commandId,status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:1,data:{ok:true}};
 };
 const p=await request('poll',{nodeId,executionInstanceId:instanceId,waitMs:50,
  capabilities:[],policyRevision:1,sessionCeiling:1});
 assert.equal(p.channel.command.commandId,pollCommand.commandId);
 await execute(p.channel.command);
 const receipt=await request('result',{commandId:p.channel.command.commandId,status:'ok',
  exitCode:0,stdout:'',stderr:''});
 assert.equal(receipt.accepted,true);
 pending.push(duplexCommand);
 duplex=new DeviceDuplexClient({
  hub:base,
  hello:meta=>signed('stream',{protocol:DEVICE_DUPLEX_PROTOCOL,
   transportEpoch:meta.transportEpoch,resumeClientSeq:meta.resumeClientSeq,
   clientSeq:meta.clientSeq,nodeId,executionInstanceId:instanceId,
   agentVersion:'synthetic',capabilities:[],sessionCeiling:1,policyRevision:1}),
  onCommand:execute,
  heartbeatPayload:()=>null,
  log:()=>{}
 });
 assert.equal(await duplex.waitReady(3000),true,'authenticated Duplex handshake');
 await waitFor(()=>results.has(duplexCommand.commandId),8000);
 await waitFor(()=>executed.includes('duplex'),8000);
 assert.deepEqual(executed,['poll','duplex']);
 assert.equal(fs.readFileSync(path.join(dir,'poll.txt'),'utf8'),'1');
 assert.equal(fs.readFileSync(path.join(dir,'duplex.txt'),'utf8'),'1');
 assert.equal((await pool.query('SELECT COUNT(*)::int n FROM lr_gold_execution_effect_starts WHERE device_id=$1',[deviceId])).rows[0].n,2);
 console.log(JSON.stringify({ok:true,realHttpSignedEnrollment:true,realNdjsonDuplex:true,
  transports:['signed-poll-v1','device-duplex-v1'],realPostgres:true,
  realOSChildren:2,noDuplicateOSMarkers:true,realUATUnchanged:true}));
}finally{
 try{await duplex?.close('fixture_done')}catch{}
 await new Promise(r=>server?server.close(()=>r()):r());
 native.close();fs.rmSync(dir,{recursive:true,force:true});
 await pool.end();
}
