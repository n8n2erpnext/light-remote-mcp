#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deviceChannelMessage, deviceHeartbeatMessage, devicePolicyMessage, normalizeDeviceCapabilities } from '../lib/device-proof.mjs';
import { createPlatformAdapter } from './platform-adapters/index.mjs';
import { startLocalWall } from './local-wall.mjs';
import { loadLocalWallAuth, writeLocalWallAuthConfig } from './local-wall-auth.mjs';

const VERSION='0.9.0-beta.1';
const PLATFORM_ADAPTER=createPlatformAdapter();
const DEFAULT_BASE=process.env.OPERATOR_AGENT_BASE_URL || 'https://light-remote-mcp.vercel.app';
const DEFAULT_HUB=process.env.OPERATOR_AGENT_HUB_URL || 'https://mcp.dashboard.thaiduy.store';
const STATE_FILE=process.env.OPERATOR_AGENT_STATE || path.join(os.homedir(),'.config','gpt-operator-agent','device.json');
const COMMAND_DIR=process.env.OPERATOR_AGENT_COMMAND_DIR || path.join(path.dirname(STATE_FILE),'commands');
const LOCAL_WALL_HOST=process.env.OPERATOR_AGENT_WALL_HOST || '127.0.0.1';
const LOCAL_WALL_PORT=Math.max(1024,Math.min(Number(process.env.OPERATOR_AGENT_WALL_PORT)||5491,65535));
const LOCAL_WALL_AUTH_FILE=process.env.OPERATOR_AGENT_WALL_AUTH_FILE || path.join(path.dirname(STATE_FILE),'wall-auth.json');
const LOCAL_WALL_BRAND=fileURLToPath(new URL('../assets/branding/light-remote-mark.svg',import.meta.url));
const MAX_OUTPUT=4*1024*1024;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function parseArgs(argv){const out={_:[]};for(let i=0;i<argv.length;i++){const v=argv[i];if(!v.startsWith('--'))out._.push(v);else{const k=v.slice(2);if(['no-wait','reenroll'].includes(k))out[k]=true;else out[k]=argv[++i];}}return out;}
function readState(){try{return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}catch{return null;}}
function writeJson0600(file,value){const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,file);}
function writeState(state){writeJson0600(STATE_FILE,state);}
function ensureIdentity(state={}){if(state.identity?.privateKey&&state.identity?.publicIdentityKey)return state;const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');return {...state,identity:{algorithm:'Ed25519',privateKey:privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),publicIdentityKey,publicKeySha256:sha256(Buffer.from(publicIdentityKey,'base64')),createdAt:Date.now()}};}
function discoverCapabilities(){return PLATFORM_ADAPTER.discoverCapabilities();}
function effectiveCapabilities(approved,denied){const deny=new Set(denied||[]);return (approved||[]).filter(x=>!deny.has(x)).sort();}
async function parseResponse(response){const text=await response.text();let json;try{json=JSON.parse(text)}catch{json={raw:text}}if(!response.ok||!json.ok){const e=new Error(json.error||json.upstream?.error||`http_${response.status}`);e.status=response.status;e.payload=json;throw e;}return json;}
async function operator(base,action,payload){const response=await fetch(`${base.replace(/\/$/,'')}/api/operator`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(15000)});return (await parseResponse(response)).upstream;}
function privateKey(state){return crypto.createPrivateKey({key:Buffer.from(state.identity.privateKey,'base64'),format:'der',type:'pkcs8'});}
function verifyEnrollment(state,enrollment){const cert=enrollment.certificate;if(!cert||cert.publicKeySha256!==state.identity.publicKeySha256||cert.deviceId!==enrollment.deviceId)throw new Error('device_certificate_identity_mismatch');const signer=crypto.createPublicKey({key:Buffer.from(enrollment.signer.publicKey,'base64'),format:'der',type:'spki'});if(!crypto.verify(null,Buffer.from(JSON.stringify(cert)),signer,Buffer.from(enrollment.certificateSignature,'base64url')))throw new Error('device_certificate_signature_invalid');return true;}
function applyPolicyEnvelope(state,envelope){
  if(!envelope)return false;
  const policy=envelope.policy,signature=String(envelope.signature||''),trustedSigner=String(state.enrollment?.signer?.publicKey||'');
  if(!policy||!trustedSigner||String(envelope.signer?.publicKey||'')!==trustedSigner)throw new Error('device_policy_signer_mismatch');
  if(policy.deviceId!==state.enrollment.deviceId||policy.accountId!==state.enrollment.accountId)throw new Error('device_policy_identity_mismatch');
  const revision=Number(policy.policyRevision);if(!Number.isSafeInteger(revision)||revision<1)throw new Error('invalid_device_policy_revision');
  const grantable=normalizeDeviceCapabilities(policy.grantableCapabilities),approved=normalizeDeviceCapabilities(policy.approvedCapabilities);
  if(!approved.length||approved.some(cap=>!grantable.includes(cap)))throw new Error('invalid_device_policy_capabilities');
  const message=devicePolicyMessage({deviceId:policy.deviceId,accountId:policy.accountId,revision,approvedCapabilities:approved,grantableCapabilities:grantable,policyProfile:policy.policyProfile,updatedAt:policy.policyUpdatedAt});
  const signer=crypto.createPublicKey({key:Buffer.from(trustedSigner,'base64'),format:'der',type:'spki'});
  if(!crypto.verify(null,Buffer.from(message),signer,Buffer.from(signature,'base64url')))throw new Error('device_policy_signature_invalid');
  const current=Math.max(0,Number(state.policy?.serverPolicyRevision)||0);if(revision<current)return false;
  state.enrollment.grantableCapabilities=grantable;state.enrollment.approvedCapabilities=approved;state.enrollment.policyProfile=String(policy.policyProfile||'default');
  state.policy={...(state.policy||{}),serverPolicyRevision:revision,serverPolicyUpdatedAt:Number(policy.policyUpdatedAt)||Date.now(),localFinalDenyBoundary:true};
  state.effectiveCapabilities=effectiveCapabilities(approved,state.policy?.deniedCapabilities);writeState(state);return revision>current;
}
async function heartbeat(state,base,{persist=true}={}){if(!state.enrollment?.deviceId)throw new Error('device_not_enrolled');const capabilities=effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities);const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');const message=deviceHeartbeatMessage({deviceId:state.enrollment.deviceId,timestamp,nonce,capabilities});const signature=crypto.sign(null,Buffer.from(message),privateKey(state)).toString('base64url');const upstream=await operator(base,'device-heartbeat',{deviceId:state.enrollment.deviceId,timestamp,nonce,capabilities,signature,policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0)});applyPolicyEnvelope(state,upstream.policy);state.lastHeartbeatAt=Date.now();state.effectiveCapabilities=effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities);if(persist)writeState(state);return upstream.device;}
async function channelRequest(state,hubBase,action,payload){if(!state.enrollment?.deviceId)throw new Error('device_not_enrolled');const deviceId=state.enrollment.deviceId,timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');const signature=crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,action,timestamp,nonce,payload})),privateKey(state)).toString('base64url');const response=await fetch(`${hubBase.replace(/\/$/,'')}/device-channel/${action}`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({deviceId,timestamp,nonce,signature,payload}),signal:AbortSignal.timeout(action==='poll'?25000:15000)});return parseResponse(response);}
async function finishEnrollment(state,base,{wait=false}={}){const pending=state.pendingEnrollment;if(!pending?.enrollmentId||!pending?.pollToken)throw new Error('no_pending_enrollment');do{const upstream=await operator(base,'enrollment-poll',{enrollmentId:pending.enrollmentId,pollToken:pending.pollToken});const e=upstream.enrollment;if(e.state==='approved'){verifyEnrollment(state,e);state.enrollment={enrollmentId:e.enrollmentId,deviceId:e.deviceId,nodeId:e.deviceId,accountId:e.accountId,grantableCapabilities:[...(pending.requestedCapabilities||e.approvedCapabilities||[])],approvedCapabilities:e.approvedCapabilities,policyProfile:e.policyProfile,certificate:e.certificate,certificateSignature:e.certificateSignature,signer:e.signer,enrolledAt:Date.now()};state.policy={...(state.policy||{}),serverPolicyRevision:1,localFinalDenyBoundary:true};state.effectiveCapabilities=effectiveCapabilities(e.approvedCapabilities,state.policy?.deniedCapabilities);state.cloud={...(state.cloud||{}),desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastError:null,lastDisconnectedAt:Date.now()};delete state.pendingEnrollment;writeState(state);const device=await heartbeat(state,base);return {state:'approved',device,effectiveCapabilities:[...(state.effectiveCapabilities||[])]};}if(e.state==='expired'||e.state==='replaced'||e.state==='cancelled'){delete state.pendingEnrollment;writeState(state);return {state:e.state};}if(!wait)return {state:e.state,expiresAt:e.expiresAt};if(Date.now()>=pending.expiresAt){delete state.pendingEnrollment;writeState(state);return {state:'expired'};}await sleep(3000);}while(true);}
async function beginWallEnrollment(base=DEFAULT_BASE){let state=ensureIdentity(readState()||{});const discovered=discoverCapabilities();if(!discovered.length)throw new Error('device_capabilities_required');const denied=normalizeDeviceCapabilities(state.policy?.deniedCapabilities||[]).filter(cap=>discovered.includes(cap));const hostname=os.hostname(),hadEnrollment=Boolean(state.enrollment?.deviceId),revoked=String(state.cloud?.lastError||'')==='device_revoked';const policyProfile=String(state.enrollment?.policyProfile||state.pendingEnrollment?.requestedPolicy||'default');const upstream=await operator(base,'enrollment-begin',{publicIdentityKey:state.identity.publicIdentityKey,displayName:hostname,platform:os.platform(),architecture:os.arch(),agentVersion:VERSION,fingerprintSummary:`${hostname} / ${os.platform()} ${os.arch()} / key ${state.identity.publicKeySha256.slice(0,12)}`,capabilities:discovered,policyProfile});const e=upstream.enrollment;state.policy={...(state.policy||{}),deniedCapabilities:denied,localFinalDenyBoundary:true};state.pendingEnrollment={enrollmentId:e.enrollmentId,pollToken:e.pollToken,activationUrl:e.activationUrl,expiresAt:e.expiresAt,requestedCapabilities:e.requestedCapabilities||discovered,requestedPolicy:e.requestedPolicy||policyProfile};writeState(state);return {state:'pending',mode:hadEnrollment||revoked?'reenroll':'link',deviceCode:e.deviceCode,activationUrl:e.activationUrl,expiresAt:e.expiresAt,expiresInSeconds:e.expiresInSeconds,deniedCapabilities:[...denied]};}
async function pollWallEnrollment(base=DEFAULT_BASE){const state=readState();if(!state?.pendingEnrollment?.enrollmentId)throw new Error('no_pending_enrollment');return finishEnrollment(state,base,{wait:false});}
async function login(args){const base=args.base||DEFAULT_BASE;let state=ensureIdentity(readState()||{});if(state.enrollment?.deviceId&&!args.reenroll){const device=await heartbeat(state,base);console.log(JSON.stringify({ok:true,alreadyEnrolled:true,deviceId:state.enrollment.deviceId,nodeId:state.enrollment.nodeId||state.enrollment.deviceId,state:device.state,effectiveCapabilities:state.effectiveCapabilities},null,2));return;}const discovered=discoverCapabilities();const denied=String(args.deny||'').split(',').map(x=>x.trim()).filter(Boolean);const requested=discovered.filter(x=>!denied.includes(x));if(!requested.length)throw new Error('all_discovered_capabilities_locally_denied');state.policy={deniedCapabilities:denied,localFinalDenyBoundary:true};const hostname=os.hostname();const upstream=await operator(base,'enrollment-begin',{publicIdentityKey:state.identity.publicIdentityKey,displayName:args.name||hostname,platform:os.platform(),architecture:os.arch(),agentVersion:VERSION,fingerprintSummary:`${hostname} / ${os.platform()} ${os.arch()} / key ${state.identity.publicKeySha256.slice(0,12)}`,capabilities:requested,policyProfile:args.policy||'default'});const e=upstream.enrollment;state.pendingEnrollment={enrollmentId:e.enrollmentId,pollToken:e.pollToken,activationUrl:e.activationUrl,expiresAt:e.expiresAt,requestedCapabilities:e.requestedCapabilities,requestedPolicy:e.requestedPolicy};writeState(state);console.log(`Activation URL: ${e.activationUrl}`);console.log(`Device code: ${e.deviceCode}`);console.log(`Expires in: ${e.expiresInSeconds}s`);if(args['no-wait'])return;console.log('Waiting for approval…');const result=await finishEnrollment(state,base,{wait:true});console.log(JSON.stringify({ok:result.state==='approved',enrollment:result.state,deviceId:state.enrollment?.deviceId||null,nodeId:state.enrollment?.nodeId||null,state:result.device?.state||null,effectiveCapabilities:state.effectiveCapabilities||[]},null,2));}
function commandFile(commandId){if(!/^cmd_[A-Za-z0-9-]{20,}$/.test(String(commandId||'')))throw new Error('invalid_command_id');return path.join(COMMAND_DIR,`${commandId}.json`);}
function readCommand(commandId){try{return JSON.parse(fs.readFileSync(commandFile(commandId),'utf8'));}catch{return null;}}
function writeCommand(commandId,value){fs.mkdirSync(COMMAND_DIR,{recursive:true,mode:0o700});writeJson0600(commandFile(commandId),value);}
function pruneCommandSpool(){fs.mkdirSync(COMMAND_DIR,{recursive:true,mode:0o700});const rows=fs.readdirSync(COMMAND_DIR).filter(name=>/^cmd_[A-Za-z0-9-]{20,}\.json$/.test(name)).map(name=>({name,stat:fs.statSync(path.join(COMMAND_DIR,name))})).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);const cutoff=Date.now()-24*60*60*1000;for(let i=0;i<rows.length;i++)if(i>=100||rows[i].stat.mtimeMs<cutoff)fs.rmSync(path.join(COMMAND_DIR,rows[i].name),{force:true});}
function boundedCollector(limit=MAX_OUTPUT){let size=0,chunks=[],truncated=false;return{add(data){const buf=Buffer.from(data);if(size>=limit){truncated=true;return;}const take=buf.subarray(0,Math.max(0,limit-size));chunks.push(take);size+=take.length;if(take.length<buf.length)truncated=true;},text(){return Buffer.concat(chunks).toString('utf8');},truncated(){return truncated;}};}
async function executeCommand(state,command){
  const existing=readCommand(command.commandId);
  if(existing?.state==='finished'&&existing.result)return existing.result;
  if(existing?.state==='running'){
    const result={commandId:command.commandId,status:'error',exitCode:125,stdout:'',stderr:'agent recovered an incomplete command; execution was not repeated\n',durationMs:Math.max(0,Date.now()-(existing.startedAt||Date.now())),recoveredIncomplete:true};
    writeCommand(command.commandId,{...existing,state:'finished',finishedAt:Date.now(),result});return result;
  }
  const p=command.payload||{};
  if(p.type!=='exec')throw new Error('unsupported_leaf_command');
  const script=String(p.script||'');
  const effective=effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities);
  const inferred=PLATFORM_ADAPTER.inferRequiredCapabilities(script);
  const required=[...new Set([...(Array.isArray(p.requiredCapabilities)?p.requiredCapabilities:[]),...inferred])].sort();
  const policyDeny=PLATFORM_ADAPTER.hardDeny?.(script)||null;
  if(policyDeny){
    const result={commandId:command.commandId,status:'error',exitCode:126,stdout:'',stderr:`local platform policy denied: ${policyDeny}\n`,durationMs:0};
    writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt:Date.now(),finishedAt:Date.now(),result});return result;
  }
  const missing=required.filter(cap=>!effective.includes(cap));
  if(missing.length){
    const result={commandId:command.commandId,status:'error',exitCode:126,stdout:'',stderr:`local capability denied: ${missing.join(',')}\n`,durationMs:0};
    writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt:Date.now(),finishedAt:Date.now(),result});return result;
  }
  const cwd=String(p.cwd||os.homedir());let stat;try{stat=fs.statSync(cwd);}catch{}
  if(!stat?.isDirectory()){
    const result={commandId:command.commandId,status:'error',exitCode:72,stdout:'',stderr:'cwd_not_directory\n',durationMs:0};
    writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt:Date.now(),finishedAt:Date.now(),result});return result;
  }
  let spec;try{spec=PLATFORM_ADAPTER.commandFor(script);}catch(error){
    const result={commandId:command.commandId,status:'error',exitCode:126,stdout:'',stderr:`platform adapter unavailable: ${error.message}\n`,durationMs:0};
    writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt:Date.now(),finishedAt:Date.now(),result});return result;
  }
  const startedAt=Date.now();writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'running',startedAt});
  const out=boundedCollector(),err=boundedCollector();let timedOut=false;
  const exitCode=await new Promise(resolve=>{
    const child=spawn(spec.file,spec.args,{cwd,env:{...process.env,GPT_OPERATOR_ACCOUNT:state.enrollment.accountId,GPT_OPERATOR_DEVICE:state.enrollment.deviceId,GPT_OPERATOR_NODE:state.enrollment.nodeId||state.enrollment.deviceId,GPT_OPERATOR_SESSION:String(p.sessionId||'')},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>out.add(d));child.stderr.on('data',d=>err.add(d));child.on('error',e=>{err.add(`${e.message}\n`);resolve(127);});child.on('exit',code=>resolve(code??128));
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),5000).unref();},Math.max(1000,Math.min(Number(p.timeoutMs)||600000,7200000)));timer.unref();child.on('close',()=>clearTimeout(timer));
  });
  const result={commandId:command.commandId,status:timedOut?'timeout':exitCode===0?'ok':'error',exitCode:timedOut?124:Math.max(0,Math.min(Number(exitCode)||0,255)),stdout:out.text(),stderr:err.text(),durationMs:Date.now()-startedAt,outputTruncated:out.truncated()||err.truncated()};
  writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;
}
function cloudDesired(state){return Boolean(state?.enrollment?.deviceId)&&state?.cloud?.desiredConnected!==false;}
function expireLocalHardLease(state,{persist=true}={}){
  const expiresAt=Number(state?.cloud?.hardExpiresAt);
  if(!cloudDesired(state)||state?.cloud?.state!=='connected'||!Number.isFinite(expiresAt)||Date.now()<expiresAt)return false;
  state.cloud={...(state.cloud||{}),desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastError:'device_connection_expired',lastDisconnectedAt:Date.now(),changedAt:Date.now()};
  if(persist)writeState(state);
  return true;
}
function markCloudState(state,value){state.cloud={...(state.cloud||{}),...value,changedAt:Date.now()};writeState(state);return state.cloud;}
async function connectCloud(args={}){
  const hub=args.hub||DEFAULT_HUB,state=readState();
  if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const hours=args['lease-hours']??args.leaseHours, rawGrace=args['grace-minutes']??args.graceMinutes;
  const leaseHours=hours==null?null:Number(hours), graceMinutes=rawGrace==null?null:Number(rawGrace);
  if(leaseHours!=null&&(!Number.isFinite(leaseHours)||leaseHours<=0))throw new Error('invalid_connection_hours');
  if(graceMinutes!=null&&(!Number.isFinite(graceMinutes)||graceMinutes<15||graceMinutes>60))throw new Error('invalid_reconnect_grace_minutes');
  const payload={nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION};
  if(leaseHours!=null)payload.requestedLeaseMs=Math.round(leaseHours*60*60*1000);
  if(graceMinutes!=null)payload.reconnectGraceMs=Math.round(graceMinutes*60*1000);
  const response=await channelRequest(state,hub,'connect',payload),connection=response.connection;
  markCloudState(state,{desiredConnected:true,state:'connected',connectionId:connection?.connectionId||null,connectedAt:connection?.connectedAt||Date.now(),hardExpiresAt:connection?.hardExpiresAt||null,reconnectGraceMs:connection?.reconnectGraceMs||null,plan:connection?.plan||null,lastError:null});
  if(!args.silent)console.log(JSON.stringify({ok:true,cloud:'connected',deviceId:state.enrollment.deviceId,connection},null,2));
  return connection;
}
async function disconnectCloud(args={}){
  const hub=args.hub||DEFAULT_HUB,state=readState();
  if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  let connection=null,error=null;
  try{const response=await channelRequest(state,hub,'disconnect',{reason:String(args.reason||'user_disconnect').slice(0,80)});connection=response.connection;}
  catch(e){error=e;}
  markCloudState(state,{desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastDisconnectedAt:Date.now(),lastError:error?.message||null});
  if(error)console.error(JSON.stringify({event:'device_disconnect_remote_ack_failed',deviceId:state.enrollment.deviceId,error:error.message,status:error.status||null}));
  if(!args.silent)console.log(JSON.stringify({ok:true,cloud:'dormant',deviceId:state.enrollment.deviceId,connection,remoteAck:!error},null,2));
  if(error&&args.requireAck)throw error;
  return connection;
}
async function setConnectionGrace(args={}){
  const hub=args.hub||DEFAULT_HUB,state=readState();
  if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const minutes=Number(args.minutes??args['grace-minutes']??args.graceMinutes);
  if(!Number.isFinite(minutes)||minutes<15||minutes>60)throw new Error('invalid_reconnect_grace_minutes');
  const response=await channelRequest(state,hub,'grace',{reconnectGraceMs:Math.round(minutes*60*1000)});
  markCloudState(state,{reconnectGraceMs:response.connection?.reconnectGraceMs||Math.round(minutes*60*1000)});
  if(!args.silent)console.log(JSON.stringify({ok:true,deviceId:state.enrollment.deviceId,connection:response.connection},null,2));
  return response.connection;
}
async function remoteDeviceStatus(hub=DEFAULT_HUB){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  return channelRequest(state,hub,'status',{nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION});
}
async function remoteDeviceActivity(hub=DEFAULT_HUB,limit=500){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const bounded=Math.max(1,Math.min(Number(limit)||500,5000));
  return channelRequest(state,hub,'activity',{nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION,limit:bounded});
}
async function rotatePairingCode(hub=DEFAULT_HUB){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const response=await channelRequest(state,hub,'pairing-code',{nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION});
  return response.pairing;
}
async function accountOwnerProofCode(hub=DEFAULT_HUB){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const response=await channelRequest(state,hub,'account-owner-proof',{nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION});
  return response.proof;
}
async function approveDeviceAccess(requestId,hub=DEFAULT_HUB){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const id=String(requestId||'').trim();if(!/^pa_[A-Za-z0-9_-]{20,80}$/.test(id))throw new Error('invalid_plus_request_id');
  const response=await channelRequest(state,hub,'access-approve',{requestId:id});
  return response.grant||response.authorization||response;
}
async function denyDeviceAccess(requestId,hub=DEFAULT_HUB,reason='owner_denied'){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const id=String(requestId||'').trim();if(!/^pa_[A-Za-z0-9_-]{20,80}$/.test(id))throw new Error('invalid_plus_request_id');
  const response=await channelRequest(state,hub,'access-deny',{requestId:id,reason:String(reason||'owner_denied').slice(0,80)});
  return response.authorization||response;
}
function setLocalPermissions(allowedCapabilities){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const grantable=normalizeDeviceCapabilities(state.enrollment.grantableCapabilities||state.enrollment.approvedCapabilities||[]);
  const allowed=normalizeDeviceCapabilities(Array.isArray(allowedCapabilities)?allowedCapabilities:[]);
  if(allowed.some(cap=>!grantable.includes(cap)))throw new Error('local_permission_not_grantable');
  const denied=grantable.filter(cap=>!allowed.includes(cap));
  state.policy={...(state.policy||{}),deniedCapabilities:denied,localFinalDenyBoundary:true,localPolicyUpdatedAt:Date.now()};
  state.effectiveCapabilities=effectiveCapabilities(state.enrollment.approvedCapabilities,denied);
  writeState(state);
  return {grantableCapabilities:grantable,serverApprovedCapabilities:[...(state.enrollment.approvedCapabilities||[])],localAllowedCapabilities:allowed,deniedCapabilities:denied,effectiveCapabilities:[...state.effectiveCapabilities],updatedAt:state.policy.localPolicyUpdatedAt};
}
function statusView(state=readState()){
  if(state)expireLocalHardLease(state);
  if(!state)return {ok:true,version:VERSION,platformAdapter:PLATFORM_ADAPTER.id,enrolled:false,deviceId:null,deviceName:os.hostname(),accountId:null,cloudDesiredConnected:false,cloudState:'dormant',connectionId:null,hardExpiresAt:null,reconnectGraceMs:null,connectionPlan:null,stateFile:STATE_FILE,localWallUrl:`http://${LOCAL_WALL_HOST}:${LOCAL_WALL_PORT}/`};
  return {ok:true,version:VERSION,platformAdapter:PLATFORM_ADAPTER.id,enrolled:Boolean(state.enrollment?.deviceId),deviceId:state.enrollment?.deviceId||null,deviceName:os.hostname(),nodeId:state.enrollment?.nodeId||state.enrollment?.deviceId||null,accountId:state.enrollment?.accountId||null,pendingEnrollmentId:state.pendingEnrollment?.enrollmentId||null,publicKeySha256:state.identity?.publicKeySha256||null,policyProfile:state.enrollment?.policyProfile||state.pendingEnrollment?.requestedPolicy||null,policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0),grantableCapabilities:state.enrollment?.grantableCapabilities||state.enrollment?.approvedCapabilities||[],approvedCapabilities:state.enrollment?.approvedCapabilities||[],deniedCapabilities:state.policy?.deniedCapabilities||[],effectiveCapabilities:state.effectiveCapabilities||[],draining:Boolean(state.routing?.draining),cloudDesiredConnected:cloudDesired(state),cloudState:state.cloud?.state||(cloudDesired(state)?'legacy-connected':'dormant'),connectionId:state.cloud?.connectionId||null,hardExpiresAt:state.cloud?.hardExpiresAt||null,reconnectGraceMs:state.cloud?.reconnectGraceMs||null,connectionPlan:state.cloud?.plan||null,lastCloudError:state.cloud?.lastError||null,lastHeartbeatAt:state.lastHeartbeatAt||null,stateFile:STATE_FILE,commandDir:COMMAND_DIR,localWallUrl:`http://${LOCAL_WALL_HOST}:${LOCAL_WALL_PORT}/`,privateKeyStoredLocally:Boolean(state.identity?.privateKey)};
}
async function daemon(args){
  const hub=args.hub||DEFAULT_HUB,base=args.base||DEFAULT_BASE;let state=readState()||{};
  if(state.enrollment?.deviceId){
    state.enrollment.nodeId=state.enrollment.nodeId||state.enrollment.deviceId;
    state.effectiveCapabilities=effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities);
  }
  const sessionCeiling=Math.max(1,Math.min(Number(process.env.OPERATOR_AGENT_MAX_SESSIONS)||2,100));
  const waitMs=Math.max(1000,Math.min(Number(process.env.OPERATOR_AGENT_CHANNEL_WAIT_MS)||8000,15000));
  const dormantPollMs=Math.max(1000,Math.min(Number(process.env.OPERATOR_AGENT_DORMANT_CHECK_MS)||2000,30000));
  let stopped=false,wake=null,failures=0,localWall=null;
  const stop=()=>{stopped=true;if(wake)wake();try{localWall?.server.close();}catch{}};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const wait=ms=>new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},ms);wake=()=>{clearTimeout(timer);wake=null;resolve();};});
  const wallAuth=loadLocalWallAuth(LOCAL_WALL_AUTH_FILE,{required:!['127.0.0.1','::1','localhost'].includes(String(LOCAL_WALL_HOST))});
  localWall=startLocalWall({host:LOCAL_WALL_HOST,port:LOCAL_WALL_PORT,brandSvgPath:LOCAL_WALL_BRAND,auth:wallAuth,getLocalStatus:async()=>statusView(),getRemoteStatus:async()=>{const remote=await remoteDeviceStatus(hub);return remote;},getRemoteActivity:async limit=>remoteDeviceActivity(hub,limit),connect:async data=>connectCloud({hub,graceMinutes:data.graceMinutes,leaseHours:data.leaseHours,silent:true}),disconnect:async data=>disconnectCloud({hub,reason:data.reason||'local_wall_disconnect',silent:true}),setGrace:async data=>setConnectionGrace({hub,minutes:data.minutes,silent:true}),setPermissions:async data=>setLocalPermissions(data?.allowedCapabilities),beginEnrollment:async()=>beginWallEnrollment(base),pollEnrollment:async()=>pollWallEnrollment(base),pairingCode:async()=>rotatePairingCode(hub),ownerProofCode:async()=>accountOwnerProofCode(hub),accessApprove:async requestId=>approveDeviceAccess(requestId,hub),accessDeny:async(requestId,data)=>denyDeviceAccess(requestId,hub,data?.reason||'owner_denied')});
  console.log(JSON.stringify({event:'local_wall_started',url:localWall.url,deviceId:state.enrollment?.deviceId||null}));
  console.log(JSON.stringify({event:'device_agent_started',mode:'always-alive-service',platformAdapter:PLATFORM_ADAPTER.id,deviceId:state.enrollment?.deviceId||null,nodeId:state.enrollment?.nodeId||null,sessionCeiling,waitMs,dormantPollMs,localWallUrl:localWall.url}));
  while(!stopped){
    const latest=readState();if(latest)state=latest;
    expireLocalHardLease(state);
    if(!state.enrollment?.deviceId||!cloudDesired(state)){await wait(dormantPollMs);continue;}
    try{
      const payload={nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION,sessionCeiling,draining:Boolean(state.routing?.draining),capabilities:effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities),policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0),waitMs};
      const response=await channelRequest(state,hub,'poll',payload);
      // A Local Wall connect/disconnect can update device.json while this long-poll is in flight.
      // Re-read before persisting the poll result so the daemon never clobbers newer lease metadata.
      const latestAfterPoll=readState();if(latestAfterPoll)state=latestAfterPoll;
      applyPolicyEnvelope(state,response.policy);failures=0;
      state.cloud={...(state.cloud||{}),desiredConnected:true,state:'connected',lastServerActivityAt:Date.now(),lastError:null};writeState(state);
      const command=response.channel?.command;
      if(command){
        const result=await executeCommand(state,command);let delivered=false,resultFailures=0;
        while(!stopped&&!delivered){
          try{const ack=await channelRequest(state,hub,'result',result);delivered=Boolean(ack.accepted);resultFailures=0;}
          catch(error){
            if(['device_connection_required','device_connection_expired'].includes(error.message)){markCloudState(state,{desiredConnected:false,state:'dormant',hardExpiresAt:null,lastError:error.message});break;}
            resultFailures++;console.error(JSON.stringify({event:'device_result_delivery_failed',deviceId:state.enrollment.deviceId,commandId:command.commandId,error:error.message,status:error.status||null,failures:resultFailures}));await wait(Math.min(1000*(2**Math.min(resultFailures,5)),30000));
          }
        }
      }
    }catch(error){
      if(['device_connection_required','device_connection_expired'].includes(error.message)){
        failures=0;markCloudState(state,{desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastError:error.message,lastDisconnectedAt:Date.now()});
        console.error(JSON.stringify({event:'device_cloud_dormant',deviceId:state.enrollment.deviceId,reason:error.message,status:error.status||null}));
        continue;
      }
      failures++;console.error(JSON.stringify({event:'device_channel_failed',deviceId:state.enrollment.deviceId,error:error.message,status:error.status||null,failures}));if(!stopped)await wait(Math.min(1000*(2**Math.min(failures,5)),30000));
    }
  }
  try{await localWall?.close();}catch{}
  if(Object.keys(state).length)writeState(state);console.log(JSON.stringify({event:'device_agent_stopped',deviceId:state.enrollment?.deviceId||null,nodeId:state.enrollment?.nodeId||null}));
}
async function setDrain(args,draining){const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');state.routing={...(state.routing||{}),draining:Boolean(draining),changedAt:Date.now()};writeState(state);const payload={nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION,sessionCeiling:Math.max(1,Math.min(Number(process.env.OPERATOR_AGENT_MAX_SESSIONS)||2,100)),draining:Boolean(draining),capabilities:effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities),policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0),waitMs:0};const response=await channelRequest(state,args.hub||DEFAULT_HUB,'poll',payload);applyPolicyEnvelope(state,response.policy);console.log(JSON.stringify({ok:true,deviceId:state.enrollment.deviceId,nodeId:payload.nodeId,draining:Boolean(draining),channelState:response.channel?.node?.state||null},null,2));}
async function status(){console.log(JSON.stringify(statusView(),null,2));}
async function initWallAuth(args){const password=fs.readFileSync(0,'utf8').replace(/[\r\n]+$/,'');if(password.length<12)throw new Error('local_wall_password_too_short');const result=writeLocalWallAuthConfig(LOCAL_WALL_AUTH_FILE,{username:args.username||'operator',password});console.log(JSON.stringify({ok:true,wallAuth:'configured',file:result.file,username:result.username,passwordEchoed:false},null,2));}
const args=parseArgs(process.argv.slice(2)),command=args._[0]||'status';
try{if(command==='login')await login(args);else if(command==='poll'){const state=readState();if(!state)throw new Error('no_device_state');console.log(JSON.stringify(await finishEnrollment(state,args.base||DEFAULT_BASE,{wait:false}),null,2));}else if(command==='heartbeat'){const state=readState();if(!state)throw new Error('no_device_state');console.log(JSON.stringify(await heartbeat(state,args.base||DEFAULT_BASE),null,2));}else if(command==='daemon')await daemon(args);else if(command==='connect')await connectCloud(args);else if(command==='disconnect')await disconnectCloud(args);else if(command==='set-grace')await setConnectionGrace(args);else if(command==='drain')await setDrain(args,true);else if(command==='undrain')await setDrain(args,false);else if(command==='status')await status();else if(command==='wall-auth-init')await initWallAuth(args);else throw new Error(`unknown_command:${command}`);}catch(error){console.error(JSON.stringify({ok:false,error:error.message,status:error.status||null},null,2));process.exitCode=1;}
