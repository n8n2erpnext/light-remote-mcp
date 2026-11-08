// Actual production Agent daemon -> signed Operator HTTP Poll -> PG epoch -> OS effect.
// Disposable PostgreSQL fixture only; never connect to Gold UAT, production or a real owner device.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {GoldExecutionEpochs} from '../../lib/gold-execution-epoch.mjs';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';

assert.equal(process.env.LR_EPOCH_PG_TEST_ALLOW,'1','explicit disposable-only opt-in required');
const database=process.env.LR_GOLD_EPOCH_TEST_DB;
assert.match(database||'',/^lr_gold_epoch_fixture_[0-9]{8}$/);
const pool=new pg.Pool({database,max:4});
const deviceKeys=crypto.generateKeyPairSync('ed25519'),issuer=crypto.generateKeyPairSync('ed25519');
const epochs=new GoldExecutionEpochs({pool,signer:issuer});
const accountId='acct-real-agent-fixture',deviceId='dev-real-agent-fixture';
const connectionId='dc_real_agent_fixture',nodeId='node-real-agent-fixture';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-real-agent-epoch-'));
if(process.platform!=='win32')fs.chmodSync(dir,0o700);
const stateFile=path.join(dir,'device.json'),marker=path.join(dir,'effect-marker.txt');
const agentFile=fileURLToPath(new URL('../../device-agent/operator-agent.mjs',import.meta.url));
const pub=key=>key.export({format:'der',type:'spki'}).toString('base64');
const priv=key=>key.export({format:'der',type:'pkcs8'}).toString('base64');
const publicIdentityKey=pub(deviceKeys.publicKey);
const approved=['filesystem','terminal','git'];
const pending=[],commands=new Map(),jobs=new Map(),done=new Map(),seenNonces=new Set();
let server=null,agent=null,agentOutput='',rejectedOldEpoch=0,pollCount=0;
const jsend=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));return data;};
const readJson=async req=>{let raw='';for await(const part of req){raw+=part;if(raw.length>2e6)throw Error('fixture_body_overflow');}return JSON.parse(raw||'{}');};
const verifiedChannelContext=async(body,action)=>{
 const timestamp=Number(body.timestamp),nonce=String(body.nonce||'');
 assert.equal(body.deviceId,deviceId);
 assert.ok(Number.isSafeInteger(timestamp)&&Math.abs(Date.now()-timestamp)<60000);
 assert.ok(nonce.length>=18&&!seenNonces.has(nonce),'fresh signed nonce required');
 const msg=deviceChannelMessage({deviceId,action,timestamp,nonce,payload:body.payload});
 assert.ok(crypto.verify(null,Buffer.from(msg),deviceKeys.publicKey,
   Buffer.from(String(body.signature||''),'base64url')),'device signed envelope invalid');
 seenNonces.add(nonce);
 return {binding:{accountId,deviceId,publicIdentityKey,policyRevision:1},
   device:{deviceId,nodeId,agentVersion:'fixture'},payload:body.payload||{}};
};
const fleet={
 async waitPoll(_touch,_wait,stop){
  pollCount++;
  if(pending.length)return {command:pending.shift()};
  if(!stop?.())await new Promise(r=>setTimeout(r,80));
  return {command:pending.length?pending.shift():null};
 },
 touch:()=>({online:true}),view:()=>({online:true}),resume:()=>true,
 command:id=>{const result=commands.get(id);if(!result)throw Error('command_not_found');return result;},
 receipt:id=>done.get(id)||null,
 complete:({commandId})=>{done.set(commandId,{accepted:true});commands.delete(commandId);}
};
const deps={
 readJson,sendJson:jsend,verifiedChannelContext,executionEpochs:epochs,
 requiresExecutionEpoch:id=>id===deviceId,
 FleetError:class extends Error{constructor(msg,status=409){super(msg);this.status=status;}},
 EnrollmentError:class extends Error{constructor(msg,status=409){super(msg);this.status=status;}},
 connections:{assertConnected:()=>({connectionId}),get:()=>({connectionId})},
 devices:{heartbeat:()=>true},deviceBootObservations:null,deviceResourceSampleCache:{record:()=>{}},
 verifiedLeafCapabilities:()=>approved,requireDeviceConnection:()=>true,
 reconcileSignedTerminalProcessReceipts:async()=>[],deviceStopRequests:()=>[],
 fleet,accessGrants:{pendingForDevice:()=>[],activeForDevice:()=>null},
 enrollments:{policyEnvelope:()=>null},applyDeviceTelemetry:()=>{},emitStream:()=>{},
 jobs,finishJob:(job,code)=>{job.finishedAt=Date.now();job.exitCode=code;job.status=code===0?'ok':'error';},
 goldJobs:{flush:async()=>{},get:async()=>null,completedForCommand:async()=>null},
 jobView:job=>({status:job.status,commandId:job.commandId}),
 MAX_MEMORY_OUTPUT:1024*1024,pushEvent:()=>{}
};
const makeCommand=(digit)=>{
 const commandId='cmd_'+crypto.randomUUID(),jobId=crypto.randomUUID();
 const payload={type:'exec',operationId:'op_'+crypto.randomBytes(12).toString('hex'),
   script:'printf '+digit+' >> '+JSON.stringify(marker),cwd:dir,
   sessionId:'synthetic-session',agentId:'synthetic-agent',requiredCapabilities:['filesystem'],
   timeoutMs:10000};
 const command={commandId,jobId,accountId,deviceId,nodeId,payload};
 commands.set(commandId,command);
 jobs.set(jobId,{commandId,jobId,accountId,deviceId,nodeId,status:'running'});
 return command;
};
const timeout=async(predicate,ms=18000,label='wait')=>{
 const started=Date.now();
 while(!(await predicate())){
  if(Date.now()-started>ms)throw Error('actual_agent_timeout_'+label+' : '+agentOutput.slice(-4500));
  await new Promise(r=>setTimeout(r,75));
 }
};
const disposeAgent=async()=>{
 if(!agent)return;
 const child=agent;agent=null;
 if(child.exitCode!==null||child.signalCode!==null)return;
 await new Promise(resolve=>{
  const timer=setTimeout(()=>{try{child.kill('SIGKILL')}catch{};resolve()},4500);
  child.once('exit',()=>{clearTimeout(timer);resolve()});
  try{child.kill('SIGTERM')}catch{clearTimeout(timer);resolve()}
 });
};
const reserveWallPort=async()=>{
 const probe=net.createServer();
 await new Promise((resolve,reject)=>probe.listen(0,'127.0.0.1',e=>e?reject(e):resolve()));
 const port=probe.address().port;
 await new Promise(resolve=>probe.close(resolve));
 return port;
};
const launchAgent=async(base)=>{
 const port=await reserveWallPort();
 const env={...process.env,HOME:dir,OPERATOR_AGENT_STATE:stateFile,
   OPERATOR_AGENT_COMMAND_DIR:path.join(dir,'commands'),
   OPERATOR_AGENT_HUB_URL:base,OPERATOR_AGENT_BASE_URL:base,
   OPERATOR_AGENT_EXECUTION_EPOCH_REQUIRED:'1',
   OPERATOR_AGENT_WALL_HOST:'127.0.0.1',OPERATOR_AGENT_WALL_PORT:String(port),
   OPERATOR_FLEET_WALL_PORT:String(port+1<65536?port+1:port-1),
   LIGHT_REMOTE_UPDATE_MODE:'server-managed',
   OPERATOR_AGENT_CHANNEL_WAIT_MS:'1000',OPERATOR_FLEET_RECONCILE_MS:'300000'};
 const child=spawn(process.execPath,[agentFile,'daemon','--hub',base],{
   cwd:fileURLToPath(new URL('../../',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
 agent=child;
 child.stdout.on('data',b=>{agentOutput=(agentOutput+b.toString()).slice(-18000)});
 child.stderr.on('data',b=>{agentOutput=(agentOutput+b.toString()).slice(-18000)});
 child.on('error',e=>{agentOutput+=' agent_spawn_error:'+e.message});
 return child;
};
try{
 await pool.query("INSERT INTO lr_devices(device_id,state,last_seen_at) VALUES($1,'online',now())",[deviceId]);
 await pool.query("INSERT INTO lr_device_connections(connection_id,account_id,device_id,connected_at,hard_expires_at) VALUES($1,$2,$3,now(),now()+interval '12 hours')",[connectionId,accountId,deviceId]);
 const now=Date.now();
 const state={identity:{algorithm:'Ed25519',privateKey:priv(deviceKeys.privateKey),
   publicIdentityKey,publicKeySha256:crypto.createHash('sha256').update(Buffer.from(publicIdentityKey,'base64')).digest('hex')},
  enrollment:{deviceId,nodeId,accountId,signer:{publicKey:pub(issuer.publicKey)},approvedCapabilities:approved,
   grantableCapabilities:approved,enrollmentId:'fixture-enrollment',policyProfile:'full'},
  cloud:{desiredConnected:true,state:'connected',connectionId,connectedAt:now,lastRenewedAt:now,
   hardExpiresAt:now+12*60*60*1000,reconnectGraceMs:3600000,plan:'vip'},
  policy:{serverPolicyRevision:1,deniedCapabilities:[],localFinalDenyBoundary:true},
  effectiveCapabilities:approved};
 fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
 server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/device-channel/'))url.pathname='/v1'+url.pathname;
  const action=url.pathname.slice('/v1/device-channel/'.length);
  try{
   if(['memory-peers','memory-relay','fleet-intent','capabilities-refresh','account-notifications'].includes(action)){
    const body=await readJson(req);await verifiedChannelContext(body,action);
    if(action==='memory-peers')return jsend(res,200,{ok:true,devices:[],currentDeviceId:deviceId});
    if(action==='fleet-intent')return jsend(res,200,{ok:true,fleet:{enabled:false}});
    if(action==='memory-relay')return jsend(res,200,{ok:true,result:{items:[]}});
    if(action==='capabilities-refresh')return jsend(res,200,{ok:true,policy:null});
    return jsend(res,200,{ok:true,notifications:[]});
   }
   await handleDeviceChannelRoutes(req,res,url,deps);
  }catch(error){
   if(String(error.message||'').includes('execution_old_command_replay_fenced'))rejectedOldEpoch++;
   if(!res.headersSent)jsend(res,Number(error.status)||409,{ok:false,error:String(error.message||error)});
   else res.destroy(error);
  }
 });
 await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',e=>e?reject(e):resolve()));
 const base='http://127.0.0.1:'+server.address().port;
 await launchAgent(base);
 await timeout(async()=>{
  const e=(await pool.query('SELECT epoch,inventory_at FROM lr_gold_device_execution_epochs WHERE device_id=$1',[deviceId])).rows[0];
  return String(e?.epoch)==='1'&&e.inventory_at!=null;
 },20000,'epoch1_inventory');
 const first=makeCommand('1');pending.push(first);
 await timeout(()=>done.has(first.commandId),17000,'first_os_effect');
 assert.equal(fs.readFileSync(marker,'utf8'),'1');
 await disposeAgent();
 assert.ok(pollCount>0);
 const file=path.join(dir,'execution-epoch-journal','gold-execution-epoch-v1.json');
 const before=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.ok(before.rows.some(row=>row.commandId===first.commandId&&row.state==='unknown'),
   'exec has no signed native process receipt and must remain UNKNOWN');
 await launchAgent(base);
 await timeout(async()=>{
  const e=(await pool.query('SELECT epoch,inventory_at FROM lr_gold_device_execution_epochs WHERE device_id=$1',[deviceId])).rows[0];
  return String(e?.epoch)==='2'&&e.inventory_at!=null;
 },20000,'epoch2_inventory');
 pending.push(first);
 await timeout(()=>rejectedOldEpoch>=1,12000,'stale_old_command_rejected');
 assert.equal(fs.readFileSync(marker,'utf8'),'1','old epoch cannot replay OS effect');
 const second=makeCommand('2');pending.push(second);
 await timeout(()=>done.has(second.commandId),16000,'second_os_effect');
 assert.equal(fs.readFileSync(marker,'utf8'),'12');
 const issued=(await pool.query('SELECT COUNT(*)::int n FROM lr_gold_execution_command_issuance WHERE device_id=$1',[deviceId])).rows[0].n;
 const starts=(await pool.query('SELECT COUNT(*)::int n FROM lr_gold_execution_effect_starts WHERE device_id=$1',[deviceId])).rows[0].n;
 assert.equal(issued,2);assert.equal(starts,2);
 const final=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(final.rows.filter(r=>r.commandId===first.commandId).length,1);
 assert.equal(final.rows.filter(r=>r.commandId===second.commandId).length,1);
 assert.equal(final.rows.find(r=>r.commandId===first.commandId).state,'unknown');
 console.log(JSON.stringify({ok:true,realProductionAgentDaemon:true,realSignedHttpPoll:true,
   realPostgreSQL17:true,restartedAgentEpochs:[1,2],oldEpochReplayRejected:true,
   actualOsEffectMarker:'12',durableUnknownPreserved:true,
   noGoldUatMutation:true,noProductionMutation:true}));
}finally{
 await disposeAgent();
 if(server){server.closeAllConnections?.();await new Promise(r=>server.close(()=>r()));}
 await pool.end();fs.rmSync(dir,{recursive:true,force:true});
}
