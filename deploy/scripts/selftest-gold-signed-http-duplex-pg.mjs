import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import pg from 'pg';
import {GoldExecutionEpochs} from '../../lib/gold-execution-epoch.mjs';
import {EnrollmentRegistry,EnrollmentError} from '../../operator-host/enrollment-registry.mjs';
import {verifiedGoldChannelContext} from '../../lib/gold-verified-channel-context.mjs';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';
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
const resourceLocks=new GoldDeviceResourceLocks({capacity:2});
const accountId='acct-http-fixture',connectionId='dc_http_fixture_1';
const nodeId='node-http-fixture',instanceId='ei_http_fixture_1';
const publicIdentityKey=device.publicKey.export({format:'der',type:'spki'}).toString('base64');
const enrollment=new EnrollmentRegistry();
const pendingEnrollment=enrollment.begin({publicIdentityKey,
  capabilities:['filesystem'],sourceHash:'signed-http-fixture',
  displayName:'P2B fixture Agent',platform:'linux',architecture:'arm64'});
assert.throws(()=>enrollment.approve({enrollmentId:pendingEnrollment.enrollmentId,
  code:'ZZZZ-ZZZZ',accountId}),/device_code_not_found_or_used/);
assert.throws(()=>enrollment.poll({enrollmentId:pendingEnrollment.enrollmentId,
  pollToken:'bad-token'}),/invalid_enrollment_poll_token/);
const approvedEnrollment=enrollment.approve({enrollmentId:pendingEnrollment.enrollmentId,
  code:pendingEnrollment.deviceCode,accountId,approvedCapabilities:['filesystem']});
const deviceId=approvedEnrollment.deviceId;
assert.equal(enrollment.poll({enrollmentId:pendingEnrollment.enrollmentId,
  pollToken:pendingEnrollment.pollToken}).deviceId,deviceId);
assert.throws(()=>enrollment.approve({enrollmentId:pendingEnrollment.enrollmentId,
  code:pendingEnrollment.deviceCode,accountId}),/device_code_not_found_or_used/);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-signed-http-fixture-'));
if(process.platform!=='win32')fs.chmodSync(dir,0o700);
const journal=new AgentExecutionEpochJournal({directory:dir});
const native=new NativeProcessRegistry();
const commandMap=new Map(),jobMap=new Map(),results=new Map();
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
const deviceRegistry={get:id=>{
 const binding=enrollment.binding(id);
 return {accountId:binding.accountId,deviceId:id,
  publicIdentityKey:binding.publicIdentityKey,nodeId,
  agentVersion:'synthetic'};
}};
const verifiedChannelContext=async(body,action)=>verifiedGoldChannelContext({
 body,action,enrollments:enrollment,devices:deviceRegistry,
 sessions:{activeCountByNode:()=>0},
 rateLimiter:{check:async()=>true},EnrollmentError
});
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
 requireDeviceConnection:()=>true,reconcileSignedTerminalProcessReceipts:async(ctx,items)=>{
  if(!Array.isArray(items))return [];
  const acks=[];
  for(const process of items.slice(0,32)){
   const ack=await resourceLocks.acknowledgeVerifiedTerminal(pool,{
    accountId:ctx.binding.accountId,deviceId:ctx.device.deviceId,process});
   if(ack.acked)acks.push({processId:process.processId,state:process.state,finishedAt:process.finishedAt});
  }
  return acks;
 },
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
 const terminalByCommand=new Map();
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
  terminalByCommand.set(command.commandId,{processId:done.processId,state:done.state,finishedAt:done.finishedAt});
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

 // P2-B: exact terminal receipt through the real signed HTTP PULSE route,
 // real PostgreSQL ACK transaction and actual native child process identity.
 // Claims are inserted ONLY into this explicitly disposable fixture DB.
 const done=terminalByCommand.get(pollCommand.commandId);
 assert.ok(done&&done.processId&&done.state==='finished'&&done.finishedAt>0);
 const foreignJob=crypto.randomUUID();
 await pool.query(`INSERT INTO lr_gold_device_resource_claims
 (job_id,account_id,device_id,resource_key,resource_mode,worker_state,process_id)
 VALUES ($1,$2,$3,$4,'exclusive','running',$5),
        ($6,$2,$3,$7,'exclusive','terminal_unknown',NULL)`,
 [pollCommand.jobId,accountId,deviceId,'p2b:fixture:real',done.processId,foreignJob,'p2b:fixture:no-pid']);
 const pulsePayload={nodeId,agentVersion:'p2b-fixture',policyRevision:1,
  sessionCeiling:1,capabilities:[],processTerminalReceipts:[done]};
 const query=async()=>({
  claims:Number((await pool.query('SELECT COUNT(*) n FROM lr_gold_device_resource_claims WHERE device_id=$1',[deviceId])).rows[0].n),
  acks:Number((await pool.query('SELECT COUNT(*) n FROM lr_gold_terminal_receipt_acks WHERE device_id=$1',[deviceId])).rows[0].n)
 });
 assert.deepEqual(await query(),{claims:2,acks:0});
 const invalidEnvelope=signed('pulse',pulsePayload);
 invalidEnvelope.payload={...pulsePayload,processTerminalReceipts:[{...done,finishedAt:done.finishedAt+5}]};
 const invalidResponse=await fetch(base+'/device-channel/pulse',{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify(invalidEnvelope)});
 assert.ok(invalidResponse.status>=400,'tampered signature must fail authentication');
 assert.deepEqual(await query(),{claims:2,acks:0});
 const fake=await request('pulse',{...pulsePayload,
  processTerminalReceipts:[{...done,processId:'lp_00000000000000000000'}]});
 assert.deepEqual(fake.terminalReceiptsAck,[]);
 assert.deepEqual(await query(),{claims:2,acks:0});
 const accepted=await request('pulse',pulsePayload);
 assert.deepEqual(accepted.terminalReceiptsAck,[done]);
 assert.deepEqual(await query(),{claims:1,acks:1});
 const exact=(await pool.query('SELECT process_id,terminal_state,finished_at_ms FROM lr_gold_terminal_receipt_acks WHERE device_id=$1',[deviceId])).rows[0];
 assert.equal(exact.process_id,done.processId);
 assert.equal(exact.terminal_state,done.state);
 assert.equal(Number(exact.finished_at_ms),done.finishedAt);
 const duplicate=await request('pulse',pulsePayload);
 assert.deepEqual(duplicate.terminalReceiptsAck,[done]);
 assert.deepEqual(await query(),{claims:1,acks:1});
 const mismatch=await request('pulse',{...pulsePayload,
  processTerminalReceipts:[{...done,finishedAt:done.finishedAt+1}]});
 assert.deepEqual(mismatch.terminalReceiptsAck,[]);
 assert.deepEqual(await query(),{claims:1,acks:1});
 const remaining=(await pool.query('SELECT job_id,process_id,worker_state FROM lr_gold_device_resource_claims WHERE device_id=$1',[deviceId])).rows;
 assert.equal(remaining.length,1);
 assert.equal(remaining[0].job_id,foreignJob);
 assert.equal(remaining[0].process_id,null);
 assert.equal(remaining[0].worker_state,'terminal_unknown');

 // Real EnrollmentRegistry nonce replay, identity and revocation boundaries.
 const auditPulse={nodeId,agentVersion:'p2b-fixture',policyRevision:1,
  sessionCeiling:1,capabilities:[],processTerminalReceipts:[]};
 const replayFrame=signed('pulse',auditPulse);
 const postFrame=frame=>fetch(base+'/device-channel/pulse',{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify(frame)});
 const firstFrame=await postFrame(replayFrame);
 assert.equal(firstFrame.status,200);
 const replayedFrame=await postFrame(replayFrame);
 assert.equal(replayedFrame.status,409,'same signed channel nonce must not execute twice');
 assert.deepEqual(await query(),{claims:1,acks:1});
 const driftFrame=signed('pulse',auditPulse);
 await assert.rejects(()=>verifiedGoldChannelContext({
  body:driftFrame,action:'pulse',enrollments:enrollment,
  devices:{get:id=>({...deviceRegistry.get(id),accountId:'other-account'})},
  sessions:{activeCountByNode:()=>0},
  rateLimiter:{check:async()=>true},EnrollmentError
 }),/device_binding_mismatch/);
 const keyDriftFrame=signed('pulse',auditPulse);
 await assert.rejects(()=>verifiedGoldChannelContext({
  body:keyDriftFrame,action:'pulse',enrollments:enrollment,
  devices:{get:id=>({...deviceRegistry.get(id),publicIdentityKey:'other-key'})},
  sessions:{activeCountByNode:()=>0},
  rateLimiter:{check:async()=>true},EnrollmentError
 }),/device_binding_mismatch/);
 enrollment.revoke({deviceId,accountId,reason:'test-only-revocation'});
 const revoked=await postFrame(signed('pulse',auditPulse));
 assert.equal(revoked.status,403,'revoked enrollment must deny signed channel');
 assert.deepEqual(await query(),{claims:1,acks:1});
 console.log('P2B_REAL_ENROLLMENT_APPROVAL_REPLAY_REVOKE_AND_BINDING=PASS');
 console.log('P2B_REAL_SIGNED_HTTP_PG_EXACT_TERMINAL_ACK_AND_FENCE=PASS');
 console.log('P2B_TAMPERED_ENVELOPE_AND_UNKNOWN_PID_NO_RELEASE=PASS');
 console.log('P2B_DUPLICATE_ACK_IDEMPOTENT_MISSING_PID_FENCED=PASS');
 console.log(JSON.stringify({ok:true,realHttpSignedEnrollment:true,realNdjsonDuplex:true,
  transports:['signed-poll-v1','device-duplex-v1'],realPostgres:true,
  realOSChildren:2,noDuplicateOSMarkers:true,fixtureOnly:true,
  signedPulseAckTransaction:true,unknownPidClaimPreserved:true,realUATUnchanged:true}));
}finally{
 try{await duplex?.close('fixture_done')}catch{}
 await new Promise(r=>server?server.close(()=>r()):r());
 native.close();fs.rmSync(dir,{recursive:true,force:true});
 await pool.end();
}
