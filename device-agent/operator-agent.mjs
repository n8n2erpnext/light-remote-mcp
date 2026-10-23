#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deviceChannelMessage, deviceHeartbeatMessage, devicePolicyMessage, normalizeDeviceCapabilities } from '../lib/device-proof.mjs';
import { createPlatformAdapter } from './platform-adapters/index.mjs';
import { invalidateCommandExistenceCache } from './platform-adapters/shared.mjs';
import { startLocalWall } from './local-wall.mjs';
import { filesystemVolumeInventory } from './filesystem-volume-inventory.mjs';
import { loadLocalWallAuth, writeLocalWallAuthConfig, writeAccountOnlyWallAuthConfig } from './local-wall-auth.mjs';
import {provisionContinuityOwnerAuthority,signContinuityConsent,rekeyContinuityOwnerAuthority} from './project-continuity-owner-grants.mjs';
import { FleetComponentManager } from './fleet-component-manager.mjs';
import { FleetComponentSupervisor } from './fleet-component-supervisor.mjs';
import { executeNativeFs, filesystemPolicy, normalizeFilesystemRoots } from '../lib/native-fs.mjs';
import { NativeProcessRegistry } from '../lib/native-process.mjs';
import { NativeTerminalReceiptSpool } from '../lib/native-terminal-receipt-spool.mjs';
import { DeviceResourceSampler } from '../lib/device-resource-telemetry.mjs';
import { ProcessSupervisorClient } from './process-supervisor-client.mjs';
import { NativeTerminalRegistry } from '../lib/native-terminal.mjs';
import { NativeSearchRegistry } from '../lib/native-search.mjs';
import { NativeDesktopBridge, realRemoteAvailable } from '../lib/native-desktop.mjs';
import { withRealRemoteCapabilities, defaultRealRemoteDenied, realRemotePolicyAfterSave, REAL_REMOTE_INPUT_CAPABILITY } from '../lib/real-remote-policy.mjs';
import realRemoteInputPolicy from '../lib/real-remote-input.cjs';
import { LightScpRegistry } from '../lib/light-scp-registry.mjs';
import { normalizeUpdateReport, normalizeUpdateStatus } from '../lib/update-contract.mjs';
import { runtimeVersion } from '../lib/runtime-version.mjs';
import { migrateLegacyEndpoint } from '../lib/public-endpoint.mjs';
import { compactResultAfter413, fitResultForDelivery, isCompacted413Result } from './result-delivery.mjs';
import { CommandExecutionCoordinator, DeviceDuplexClient, DEVICE_DUPLEX_PROTOCOL } from '../lib/device-duplex-client.mjs';
import { ExecutorReadinessProbe } from '../lib/executor-readiness-probe.mjs';

const VERSION=runtimeVersion({envNames:['LIGHT_REMOTE_VERSION','OPERATOR_AGENT_VERSION']});
const CORE_ROOT=fileURLToPath(new URL('../',import.meta.url));
const UPDATE_MODE=String(process.env.LIGHT_REMOTE_UPDATE_MODE||'independent-helper').trim()||'independent-helper';
const PLATFORM_ADAPTER=createPlatformAdapter();
const DEVICE_RESOURCE_SAMPLER=new DeviceResourceSampler();
const NATIVE_PROCESSES=new NativeProcessRegistry({emit:event=>{
 if(event?.type==='process_finished')NATIVE_TERMINAL_SPOOL.record(event);
}});
const PROCESS_SUPERVISOR_SOCKET=String(process.env.LIGHT_REMOTE_PROCESS_SUPERVISOR_SOCKET||'').trim();
const PROCESS_SUPERVISOR_TOKEN_FILE=String(process.env.LIGHT_REMOTE_PROCESS_SUPERVISOR_TOKEN_FILE||'').trim();
if(PROCESS_SUPERVISOR_SOCKET&&(process.platform==='win32'||!PROCESS_SUPERVISOR_TOKEN_FILE))
  throw Error('process_supervisor_platform_or_token_missing');
const SUPERVISED_PROCESSES=PROCESS_SUPERVISOR_SOCKET?new ProcessSupervisorClient({
  socketPath:PROCESS_SUPERVISOR_SOCKET,tokenFile:PROCESS_SUPERVISOR_TOKEN_FILE}):null;
const EXECUTOR_PROBE=new ExecutorReadinessProbe({
  intervalMs:Number(process.env.OPERATOR_AGENT_EXECUTOR_PROBE_INTERVAL_MS)||30000,
  timeoutMs:Number(process.env.OPERATOR_AGENT_EXECUTOR_PROBE_TIMEOUT_MS)||5000,
  onTransition:state=>console.log(JSON.stringify({event:'device_executor_probe_readiness_changed',state:state.state,consecutiveFailures:state.consecutiveFailures}))
});
const NATIVE_TERMINALS=new NativeTerminalRegistry({emit:event=>console.log(JSON.stringify(event))});
const NATIVE_SEARCHES=new NativeSearchRegistry();
const REAL_REMOTE_AVAILABLE=realRemoteAvailable();
const NATIVE_DESKTOP=new NativeDesktopBridge();
const {normalizeDesktopInput}=realRemoteInputPolicy;
const LIGHT_SCP=new LightScpRegistry({policy:()=>effectiveFilesystemPolicy(readState())});
const DEFAULT_BASE=migrateLegacyEndpoint(process.env.OPERATOR_AGENT_BASE_URL,{kind:'base'});
const DEFAULT_HUB=migrateLegacyEndpoint(process.env.OPERATOR_AGENT_HUB_URL,{kind:'hub'});
const STATE_FILE=process.env.OPERATOR_AGENT_STATE || path.join(os.homedir(),'.config','gpt-operator-agent','device.json');
// Only terminal OS evidence; a missing terminal after Agent restart is UNKNOWN.
const NATIVE_TERMINAL_SPOOL=new NativeTerminalReceiptSpool({directory:path.join(path.dirname(STATE_FILE),'terminal-journal')});
const EXTERNAL_IDENTITY_FILE=String(process.env.OPERATOR_AGENT_IDENTITY_FILE||'').trim();
const COMMAND_DIR=process.env.OPERATOR_AGENT_COMMAND_DIR || path.join(path.dirname(STATE_FILE),'commands');
const LOCAL_WALL_HOST=process.env.OPERATOR_AGENT_WALL_HOST || '127.0.0.1';
const LOCAL_WALL_PORT=Math.max(1024,Math.min(Number(process.env.OPERATOR_AGENT_WALL_PORT)||5491,65535));
// OFF by default. Does not start Codex or open a network listener.
async function ownerConsentWithStepUp({principal,password,projectId,enabled,expectedRevision}={}){
  const {projectContinuityRequest,isolatedContinuityEnabled,projectContinuityOwnerConsent}=await import('./project-continuity-client.mjs');
  const {continuityDefaultRoot}=await import('./project-continuity-store.mjs');
  const username=String(principal||'').trim(),credential=String(password||'');
  if(!username||credential.length<1||credential.length>1024)throw Error('continuity_owner_credentials_invalid');
  const wallAuth=loadLocalWallAuth(LOCAL_WALL_AUTH_FILE,{required:true});
  if(wallAuth.mode==='local'){
    if(!wallAuth.verifyCredentials(username,credential))throw Error('continuity_owner_credentials_invalid');
  }else if(wallAuth.mode==='account-only'){
    if(!username.includes('@'))throw Error('continuity_account_owner_required');
    const result=await authenticateWallAccount(username,credential);
    if(!result?.account?.accountId||
      String(result.account.email||'').trim().toLowerCase()!==username.toLowerCase())
      throw Error('continuity_owner_identity_mismatch');
  }else throw Error('continuity_owner_auth_unavailable');
  const root=continuityDefaultRoot(),signerDir=path.dirname(LOCAL_WALL_AUTH_FILE);
  const current=await projectContinuityRequest('getProject',{projectId},{root});
  if(!current||current.revision!==expectedRevision)throw Error('continuity_stale_revision');
  if(!current.memory_enabled)throw Error('continuity_memory_disabled');
  if(isolatedContinuityEnabled())return projectContinuityOwnerConsent({
    principal:username,password:credential,projectId,enabled,expectedRevision});
  const proof=signContinuityConsent({root,signerDir,password:credential,projectId,enabled,revision:expectedRevision,principal:username});
  return projectContinuityRequest('applySignedOwnerConsent',{projectId,proof},{root});
}
async function ownerRekeyAfterCredentialChange({principal,oldPassword,newPassword}={}){
  const username=String(principal||'').trim();
  const currentPassword=String(newPassword||'');
  if(!username||typeof oldPassword!=='string'||oldPassword.length<1||
     currentPassword.length<12||currentPassword.length>1024)
    throw Error('continuity_owner_rekey_credentials_invalid');
  const wallAuth=loadLocalWallAuth(LOCAL_WALL_AUTH_FILE,{required:true});
  // The owner must have changed the ACTUAL login password independently.
  // This operation only rewraps the independent Continuity signing key.
  if(wallAuth.mode==='local'){
    if(!wallAuth.verifyCredentials(username,currentPassword))
      throw Error('continuity_owner_rekey_auth_failed');
  }else if(wallAuth.mode==='account-only'){
    const identity=await authenticateWallAccount(username,currentPassword);
    if(!identity?.account?.accountId||
       String(identity.account.email||'').trim().toLowerCase()!==username.toLowerCase())
      throw Error('continuity_owner_rekey_auth_failed');
  }else throw Error('continuity_owner_rekey_auth_unavailable');
  const {continuityDefaultRoot}=await import('./project-continuity-store.mjs');
  const {isolatedContinuityEnabled,projectContinuityOwnerRekey}=await import('./project-continuity-client.mjs');
  if(isolatedContinuityEnabled())return projectContinuityOwnerRekey({oldPassword,newPassword:currentPassword});
  return rekeyContinuityOwnerAuthority({root:continuityDefaultRoot(),
    signerDir:path.dirname(LOCAL_WALL_AUTH_FILE),oldPassword,newPassword:currentPassword});
}
const CONTINUITY_UI=process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL==='1'
  ? {request:async(action,data)=>{const {projectContinuityRequest}=await import('./project-continuity-client.mjs');return projectContinuityRequest(action,data);},
     ownerConsent:ownerConsentWithStepUp,
     ownerRekey:ownerRekeyAfterCredentialChange}
  : null;

const LOCAL_WALL_AUTH_FILE=process.env.OPERATOR_AGENT_WALL_AUTH_FILE || path.join(path.dirname(STATE_FILE),'wall-auth.json');
const FLEET_WALL_HOST=process.env.OPERATOR_FLEET_WALL_HOST||LOCAL_WALL_HOST;
const FLEET_WALL_PORT=Math.max(1024,Math.min(Number(process.env.OPERATOR_FLEET_WALL_PORT)||5492,65535));
const FLEET_WALL_PUBLIC_URL=String(process.env.OPERATOR_FLEET_WALL_PUBLIC_URL||'').trim();
const LOCAL_WALL_BRAND=fileURLToPath(new URL('../assets/branding/light-remote-mark.svg',import.meta.url));
const UPDATE_RUNTIME_DIR=process.env.LIGHT_REMOTE_UPDATE_STATE_DIR||(process.platform==='win32'?path.join(process.env.LOCALAPPDATA||os.homedir(),'Light Remote','Updater','state'):path.join(path.dirname(STATE_FILE),'update-runtime'));
const UPDATE_REQUEST_FILE=path.join(UPDATE_RUNTIME_DIR,'request.json'),UPDATE_CHECK_REQUEST_FILE=path.join(UPDATE_RUNTIME_DIR,'check-request.json'),UPDATE_TRANSACTION_FILE=path.join(UPDATE_RUNTIME_DIR,'transaction.json'),UPDATE_ACK_FILE=path.join(UPDATE_RUNTIME_DIR,'core-health-ack.json'),UPDATE_REPORT_FILE=path.join(UPDATE_RUNTIME_DIR,'pending-report.json'),UPDATE_STATUS_FILE=path.join(UPDATE_RUNTIME_DIR,'status.json');
const MAX_OUTPUT=4*1024*1024;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function parseArgs(argv){const out={_:[]};for(let i=0;i<argv.length;i++){const v=argv[i];if(!v.startsWith('--'))out._.push(v);else{const k=v.slice(2);if(['no-wait','reenroll'].includes(k))out[k]=true;else{const raw=argv[++i];out[k]=k==='base'?migrateLegacyEndpoint(raw,{kind:'base'}):k==='hub'?migrateLegacyEndpoint(raw,{kind:'hub'}):raw;}}}return out;}
function readState(){try{return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}catch{return null;}}
function effectiveFilesystemPolicy(state){
  return filesystemPolicy(process.env,state?.policy?.filesystemRoots??null);
}
function sleepSync(ms){const sab=new SharedArrayBuffer(4);Atomics.wait(new Int32Array(sab),0,0,Math.max(1,ms));}
function writeJson0600(file,value){const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});const lock=`${file}.lock`,deadline=Date.now()+2500;let lockFd=null;while(lockFd===null){try{lockFd=fs.openSync(lock,'wx',0o600);}catch(error){if(error?.code!=='EEXIST'||Date.now()>=deadline)throw error;sleepSync(20);}}const tmp=`${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;try{fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});fs.chmodSync(tmp,0o600);for(let attempt=0;;attempt++){try{fs.renameSync(tmp,file);break;}catch(error){if(process.platform==='win32'&&['EPERM','EACCES','EEXIST'].includes(error?.code)&&attempt<6){sleepSync(25*(attempt+1));continue;}if(process.platform==='win32'&&['EPERM','EACCES','EEXIST'].includes(error?.code)){fs.copyFileSync(tmp,file);fs.rmSync(tmp,{force:true});break;}throw error;}}}finally{try{if(fs.existsSync(tmp))fs.rmSync(tmp,{force:true});}catch{}try{if(lockFd!==null)fs.closeSync(lockFd);}catch{}try{fs.rmSync(lock,{force:true});}catch{}}}
function writeState(state){writeJson0600(STATE_FILE,state);}
function readJsonFile(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function updateStatusView(){const report=readJsonFile(UPDATE_REPORT_FILE);if(UPDATE_MODE==='server-managed')return {state:'managed',currentVersion:VERSION,targetVersion:null,helperVersion:'server-managed',code:null,updatedAt:null,mode:UPDATE_MODE,pendingReport:null};const status=normalizeUpdateStatus(readJsonFile(UPDATE_STATUS_FILE)||{});return {...status,currentVersion:status.currentVersion||VERSION,mode:UPDATE_MODE,pendingReport:report?{outcome:String(report.outcome||''),code:String(report.code||'')||null,targetVersion:String(report.targetVersion||'')||null,at:Number(report.at)||null}:null};}
function acknowledgeCoreUpdateHealth(){const tx=readJsonFile(UPDATE_TRANSACTION_FILE);if(!tx||String(tx.targetVersion||'')!==VERSION||!/^ut_[A-Za-z0-9_-]{12,80}$/.test(String(tx.txId||'')))return false;writeJson0600(UPDATE_ACK_FILE,{schemaVersion:1,txId:tx.txId,version:VERSION,healthy:true,pid:process.pid,at:Date.now()});return true;}
async function requestLocalUpdate(source='local-wall',mode='apply'){if(UPDATE_MODE==='server-managed')throw new Error('update_managed_by_server_deployment');const action=mode==='check'?'check':'apply';if(process.platform==='win32'){const updater=path.join(process.env.LOCALAPPDATA||os.homedir(),'Light Remote','Updater','LightRemote.Updater.exe'),installRoot=fileURLToPath(new URL('../../',import.meta.url));if(!fs.existsSync(updater))throw new Error('independent_updater_missing');const args=[action==='check'?'--check-update':'--apply-update-now','--install-dir',installRoot],child=spawn(updater,args,{windowsHide:true,detached:true,stdio:'ignore'});child.unref();return {accepted:true,source,mode:action,transport:'independent-updater',requestedAt:Date.now()};}const target=action==='check'?UPDATE_CHECK_REQUEST_FILE:UPDATE_REQUEST_FILE;writeJson0600(target,{schemaVersion:1,requestId:`uq_${crypto.randomBytes(12).toString('base64url')}`,source:String(source||'local-wall').slice(0,40),mode:action,currentVersion:VERSION,requestedAt:Date.now()});return {accepted:true,source,mode:action,transport:'helper-trigger',requestedAt:Date.now()};}
async function flushPendingUpdateReport(state,hub){const raw=readJsonFile(UPDATE_REPORT_FILE);if(!raw)return null;const report=normalizeUpdateReport(raw);const response=await channelRequest(state,hub,'update-report',{...report,nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION});try{fs.rmSync(UPDATE_REPORT_FILE,{force:true});}catch{}return response;}
let externalIdentityCache=null;
function externalIdentity(){if(!EXTERNAL_IDENTITY_FILE)return null;if(externalIdentityCache)return externalIdentityCache;const row=JSON.parse(fs.readFileSync(EXTERNAL_IDENTITY_FILE,'utf8')),privateKey=crypto.createPrivateKey({key:Buffer.from(row.privateKey,'base64'),format:'der',type:'pkcs8'}),publicKey=crypto.createPublicKey({key:Buffer.from(row.publicKey||row.publicIdentityKey,'base64'),format:'der',type:'spki'});if(privateKey.asymmetricKeyType!=='ed25519'||publicKey.asymmetricKeyType!=='ed25519')throw new Error('invalid_external_device_identity');const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');externalIdentityCache={privateKey,publicIdentityKey,publicKeySha256:sha256(Buffer.from(publicIdentityKey,'base64')),createdAt:Number(row.createdAt)||Date.now()};return externalIdentityCache;}
function ensureIdentity(state={}){if(state.identity?.publicIdentityKey&&(state.identity?.privateKey||EXTERNAL_IDENTITY_FILE))return state;const external=externalIdentity();if(external)return {...state,identity:{algorithm:'Ed25519',publicIdentityKey:external.publicIdentityKey,publicKeySha256:external.publicKeySha256,createdAt:external.createdAt}};const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');return {...state,identity:{algorithm:'Ed25519',privateKey:privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),publicIdentityKey,publicKeySha256:sha256(Buffer.from(publicIdentityKey,'base64')),createdAt:Date.now()}};}
function discoverCapabilities(){return withRealRemoteCapabilities(PLATFORM_ADAPTER.discoverCapabilities(),{available:REAL_REMOTE_AVAILABLE});}
function effectiveCapabilities(approved,denied){const deny=new Set(denied||[]);return (approved||[]).filter(x=>!deny.has(x)).sort();}
function isTrustedHostState(state){return String(state?.enrollment?.enrollmentId||'')==='trusted-host';}
function policyBaseCapabilities(state){return normalizeDeviceCapabilities(isTrustedHostState(state)?(state?.enrollment?.grantableCapabilities||[]):(state?.enrollment?.approvedCapabilities||[]));}
function effectiveCapabilitiesForState(state){return effectiveCapabilities(policyBaseCapabilities(state),state?.policy?.deniedCapabilities);}
function responseRetryAfterMs(response,json){const header=String(response.headers?.get?.('retry-after')||'').trim(),bodySeconds=Number(json?.retryAfterSeconds);let value=Number.isFinite(bodySeconds)&&bodySeconds>0?bodySeconds*1000:0;if(/^\d+$/.test(header))value=Math.max(value,Number(header)*1000);else if(header){const at=Date.parse(header);if(Number.isFinite(at))value=Math.max(value,at-Date.now());}return Math.max(0,Math.min(value,5*60*1000));}
async function parseResponse(response){const text=await response.text();let json;try{json=JSON.parse(text)}catch{json={raw:text}}if(!response.ok||!json.ok){const e=new Error(json.error||json.upstream?.error||`http_${response.status}`);e.status=response.status;e.payload=json;e.retryAfterMs=responseRetryAfterMs(response,json);throw e;}return json;}
async function operator(base,action,payload){const response=await fetch(`${base.replace(/\/$/,'')}/api/operator`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(15000)});const parsed=await parseResponse(response);return parsed.upstream??parsed;}
function privateKey(state){if(state.identity?.privateKey)return crypto.createPrivateKey({key:Buffer.from(state.identity.privateKey,'base64'),format:'der',type:'pkcs8'});const external=externalIdentity();if(!external||external.publicIdentityKey!==state.identity?.publicIdentityKey)throw new Error('device_private_key_unavailable');return external.privateKey;}
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
async function ownerApproveServerPermissions({email,password,approvedCapabilities,profile}={},hub=DEFAULT_HUB){
  let state=readState();if(!state?.enrollment?.deviceId)throw Error('device_not_enrolled');
  if(isTrustedHostState(state))throw Error('trusted_host_uses_local_capability_authority');
  const desired=normalizeDeviceCapabilities(approvedCapabilities||[]);
  if(!desired.length)throw Error('owner_permissions_empty');
  if(desired.some(c=>!normalizeDeviceCapabilities(state.enrollment.grantableCapabilities||[]).includes(c))){
    await rescanHostCapabilities(hub);state=readState();
  }
  if(desired.some(c=>!normalizeDeviceCapabilities(state.enrollment.grantableCapabilities||[]).includes(c)))
    throw Error('owner_permissions_not_device_supported');
  if(!email||!password)throw Error('owner_credentials_required');
  const response=await channelRequest(state,hub,'capabilities-owner-approve',{
    email:String(email).trim(),password:String(password),approvedCapabilities:desired,policyProfile:String(profile||'custom')});
  if(!response?.policy?.policy)throw Error('owner_approval_signed_policy_missing');
  applyPolicyEnvelope(state,response.policy);
  state.effectiveCapabilities=effectiveCapabilitiesForState(state);writeState(state);
  return {policyRevision:state.policy.serverPolicyRevision,approvedCapabilities:state.enrollment.approvedCapabilities,
    effectiveCapabilities:state.effectiveCapabilities};
}
async function heartbeat(state,base,{persist=true}={}){if(!state.enrollment?.deviceId)throw new Error('device_not_enrolled');const capabilities=effectiveCapabilitiesForState(state);const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');const message=deviceHeartbeatMessage({deviceId:state.enrollment.deviceId,timestamp,nonce,capabilities});const signature=crypto.sign(null,Buffer.from(message),privateKey(state)).toString('base64url');const upstream=await operator(base,'device-heartbeat',{deviceId:state.enrollment.deviceId,timestamp,nonce,capabilities,signature,policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0)});applyPolicyEnvelope(state,upstream.policy);state.lastHeartbeatAt=Date.now();state.effectiveCapabilities=effectiveCapabilitiesForState(state);if(persist)writeState(state);return upstream.device;}
let observerChannelTail=Promise.resolve(),observerChannelNextAt=0,rmLiveChannelTail=Promise.resolve(),rmLiveChannelNextAt=0;
function clientChannelLane(action){
  if(action==='desktop-live-push')return 'rm-live';
  return ['status','activity','fleet-intent','fleet-authority','fleet-status','fleet-devices','fleet-sessions','fleet-activity','fleet-jobs'].includes(action)?'observer':'direct';
}
function signedChannelEnvelope(state,action,payload){if(!state.enrollment?.deviceId)throw new Error('device_not_enrolled');const deviceId=state.enrollment.deviceId,timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');const signature=crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,action,timestamp,nonce,payload})),privateKey(state)).toString('base64url');return {deviceId,timestamp,nonce,signature,payload};}
function channelRequestLocalOperator(state,action,payload){
  if(!['capabilities-refresh','capabilities-owner-approve'].includes(action))throw new Error('local_operator_action_denied');
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify(signedChannelEnvelope(state,action,payload));
    const req=http.request({socketPath:process.env.LIGHT_REMOTE_LOCAL_OPERATOR_SOCKET,path:'/v1/device-channel/'+action,method:'POST',headers:{'content-type':'application/json'}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>void parseResponse(new Response(Buffer.concat(chunks),{status:res.statusCode||502})).then(resolve,reject));
    });
    req.setTimeout(15000,()=>req.destroy(new Error('operator_timeout')));req.on('error',reject);req.end(body);
  });
}
async function channelRequestDirect(state,hubBase,action,payload){
  if(['capabilities-refresh','capabilities-owner-approve'].includes(action)&&process.env.LIGHT_REMOTE_LOCAL_OPERATOR_SOCKET)return channelRequestLocalOperator(state,action,payload);const response=await fetch(hubBase.replace(/\/$/,'')+'/device-channel/'+action,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(signedChannelEnvelope(state,action,payload)),signal:AbortSignal.timeout(action==='poll'?25000:15000)});return parseResponse(response);}
async function channelRequest(state,hubBase,action,payload){
  const lane=clientChannelLane(action);
  if(lane==='direct')return channelRequestDirect(state,hubBase,action,payload);
  const rm=lane==='rm-live',nextAt=rm?rmLiveChannelNextAt:observerChannelNextAt,minGap=rm?40:350;
  const run=async()=>{const delay=Math.max(0,nextAt-Date.now());if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(rm)rmLiveChannelNextAt=Date.now()+minGap;else observerChannelNextAt=Date.now()+minGap;return channelRequestDirect(state,hubBase,action,payload);};
  const tail=rm?rmLiveChannelTail:observerChannelTail,next=tail.then(run,run);
  if(rm)rmLiveChannelTail=next.catch(()=>{});else observerChannelTail=next.catch(()=>{});
  return next;
}
async function rescanHostCapabilities(hub=DEFAULT_HUB){
  const state=readState();
  if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  if(isTrustedHostState(state))throw new Error('trusted_host_capabilities_refresh_on_operator_restart');
  invalidateCommandExistenceCache();
  PLATFORM_ADAPTER.invalidateInstalledCapabilities?.();
  const discovered=discoverCapabilities();
  const response=await channelRequest(state,hub,'capabilities-refresh',{capabilities:discovered,agentVersion:VERSION});
  if(!response?.policy?.policy)throw new Error('capability_rescan_unsigned_policy_missing');
  const newlyGrantable=normalizeDeviceCapabilities(response.change?.addedCapabilities||[]);
  // An explicit local owner selection is remembered before server approval.
  // Otherwise newly discovered rights stay locally denied; never auto-grant.
  const ownerIntent=new Set(normalizeDeviceCapabilities(state.policy?.localRequestedCapabilities||[]));
  const newDeny=newlyGrantable.filter(cap=>!ownerIntent.has(cap));
  state.policy={...(state.policy||{}),deniedCapabilities:normalizeDeviceCapabilities([...(state.policy?.deniedCapabilities||[]),...newDeny]),localProfile:newlyGrantable.length?'custom':state.policy?.localProfile||'custom'};
  applyPolicyEnvelope(state,response.policy);
  state.effectiveCapabilities=effectiveCapabilitiesForState(state);
  writeState(state);
  return {supportedCapabilities:discovered,installedCapabilities:PLATFORM_ADAPTER.installedCapabilities?.()||[],addedCapabilities:newlyGrantable,removedCapabilities:response.change?.removedCapabilities||[],approvalRequired:newlyGrantable,policyRevision:state.policy.serverPolicyRevision,effectiveCapabilities:state.effectiveCapabilities};
}
const REAL_REMOTE_LIVE=new Map();
const REAL_REMOTE_VISUAL=new Map();
function visualPublicView(row,value={}){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const {leaseToken,visualSessionId,...rest}=source;
  return {desktopSessionId:row.desktopSessionId,...rest};
}
function visualOwner(p){return {sessionId:String(p.sessionId||''),agentId:String(p.agentId||'')};}
function requireRealRemoteVisual(p,desktopSessionId){
  const id=String(desktopSessionId||''),row=REAL_REMOTE_VISUAL.get(id);
  if(!row)throw new Error('desktop_session_missing');
  const owner=visualOwner(p);
  if(row.sessionId!==owner.sessionId||row.agentId!==owner.agentId)throw new Error('desktop_session_owner_mismatch');
  if(Date.now()>=row.expiresAt){void stopRealRemoteVisual(row).catch(error=>console.error(JSON.stringify({event:'desktop_visual_cleanup_failed',desktopSessionId:id,error:String(error?.message||error)})));throw new Error('desktop_session_expired');}
  return row;
}
function armRealRemoteVisual(row){
  if(row.timer){clearTimeout(row.timer);row.timer=null;}
  row.expiresAt=Date.now()+row.idleTimeoutMs;
  row.timer=setTimeout(()=>{row.timer=null;void stopRealRemoteVisual(row).catch(error=>console.error(JSON.stringify({event:'desktop_visual_cleanup_failed',desktopSessionId:row.desktopSessionId,error:String(error?.message||error)})));},row.idleTimeoutMs);
  row.timer.unref?.();
}
async function stopRealRemoteVisual(row,{detach=true}={}){
  if(!row||row.stopping)return row?.stopping||null;
  row.stopping=(async()=>{
    REAL_REMOTE_VISUAL.delete(row.desktopSessionId);
    if(row.timer){clearTimeout(row.timer);row.timer=null;}
    let detached=null,detachError=null;
    if(detach){
      try{detached=await NATIVE_DESKTOP.request('visual-detach',{visualSessionId:row.visualSessionId,leaseToken:row.leaseToken},{timeoutMs:10000});}
      catch(error){
        if(!/visual_(session_missing|lease_expired)|real_remote_helper_(closed|exited|timeout)/.test(String(error?.message||error)))detachError=error;
      }
    }
    try{row.release?.();}catch{}
    try{NATIVE_DESKTOP.closeIfIdle();}catch{}
    if(detachError)throw detachError;
    return detached;
  })().finally(()=>{row.stopping=null;});
  return row.stopping;
}
async function attachRealRemoteVisual(p,request){
  const owner=visualOwner(p),idleTimeoutMs=Math.max(1000,Math.min(Number(request.idleTimeoutMs)||120000,900000));
  const native=await NATIVE_DESKTOP.request('visual-attach',{
    screen:request.screen==null||Number(request.screen)<0?0:Math.max(0,Math.min(Number(request.screen)||0,31)),
    maxWidth:Math.max(160,Math.min(Number(request.maxWidth)||960,1280)),
    maxHeight:Math.max(90,Math.min(Number(request.maxHeight)||540,720)),
    quality:Math.max(25,Math.min(Number(request.quality)||50,70)),
    leaseMs:idleTimeoutMs,
    owner:(owner.sessionId+':'+owner.agentId).slice(0,80)
  },{timeoutMs:10000});
  const desktopSessionId='desk_'+crypto.randomBytes(12).toString('base64url');
  const row={desktopSessionId,visualSessionId:String(native.visualSessionId||''),leaseToken:String(native.leaseToken||''),...owner,
    idleTimeoutMs,minIntervalMs:Math.max(0,Math.min(Number(request.minIntervalMs)||250,5000)),omitUnchanged:request.omitUnchanged!==false,
    lastFrameSha:null,lastObservedAt:0,expiresAt:0,timer:null,release:NATIVE_DESKTOP.retain(),stopping:null};
  if(!row.visualSessionId||!row.leaseToken){try{row.release();}catch{};throw new Error('desktop_visual_attach_invalid');}
  REAL_REMOTE_VISUAL.set(desktopSessionId,row);armRealRemoteVisual(row);
  return visualPublicView(row,native);
}
async function resumeRealRemoteVisual(p,request){
  const row=requireRealRemoteVisual(p,request.desktopSessionId);
  const native=await NATIVE_DESKTOP.request('visual-resume',{visualSessionId:row.visualSessionId,leaseToken:row.leaseToken,leaseMs:row.idleTimeoutMs},{timeoutMs:10000});
  armRealRemoteVisual(row);return visualPublicView(row,native);
}
async function detachRealRemoteVisual(p,request){
  const row=requireRealRemoteVisual(p,request.desktopSessionId),native=await stopRealRemoteVisual(row,{detach:true});
  return visualPublicView(row,native||{detached:true});
}
async function frameRealRemoteVisual(p,request,{observe=false}={}){
  const id=String(request.desktopSessionId||'');
  if(!id){
    return NATIVE_DESKTOP.request('frame',{
      screen:request.screen==null||Number(request.screen)<0?0:Math.max(0,Math.min(Number(request.screen)||0,31)),
      maxWidth:Math.max(160,Math.min(Number(request.maxWidth)||960,1280)),
      maxHeight:Math.max(90,Math.min(Number(request.maxHeight)||540,720)),
      quality:Math.max(25,Math.min(Number(request.quality)||50,70))
    },{timeoutMs:10000});
  }
  const row=requireRealRemoteVisual(p,id),now=Date.now(),remaining=Math.max(0,row.minIntervalMs-(now-row.lastObservedAt));
  if(observe&&remaining>0){armRealRemoteVisual(row);return {desktopSessionId:id,unchanged:true,throttled:true,retryAfterMs:remaining,frameSeq:null,expiresAt:row.expiresAt};}
  let native;
  try{native=await NATIVE_DESKTOP.request('visual-frame',{visualSessionId:row.visualSessionId,leaseToken:row.leaseToken},{timeoutMs:10000});}
  catch(error){await stopRealRemoteVisual(row,{detach:false}).catch(()=>{});throw error;}
  row.lastObservedAt=Date.now();armRealRemoteVisual(row);
  const capture=native?.frame&&typeof native.frame==='object'?native.frame:null,hash=String(capture?.frameSha256||'');
  const unchanged=Boolean(observe&&row.omitUnchanged&&hash&&row.lastFrameSha===hash);
  if(hash)row.lastFrameSha=hash;
  if(!unchanged)return visualPublicView(row,native);
  const safeCapture={...capture};delete safeCapture.data;
  return visualPublicView(row,{...native,frame:safeCapture,unchanged:true});
}
const COMMAND_EXECUTIONS=new CommandExecutionCoordinator();
// Only bounded terminal worker receipts, no scripts/paths/output or secrets.
let PROCESS_TERMINAL_RECEIPTS=[],PROCESS_TERMINAL_CURSOR=0;
// Terminal receipts are retained by the device process supervisor journal.
// Rotate on each signed transmission, not on a timer: a fixed last-32
// window could starve older terminal leases indefinitely after restart.
function nextProcessTerminalReceipts(){
 const all=PROCESS_TERMINAL_RECEIPTS,cap=Math.min(32,all.length);
 if(!cap)return [];
 const start=PROCESS_TERMINAL_CURSOR%all.length;
 PROCESS_TERMINAL_CURSOR=(start+cap)%all.length;
 return Array.from({length:cap},(_,i)=>all[(start+i)%all.length]);
}
async function refreshProcessTerminalReceipts(current){
 if(!current?.enrollment?.deviceId||!current.enrollment?.accountId)return;
 try{
  const list=SUPERVISED_PROCESSES?
   await SUPERVISED_PROCESSES.listUnackedTerminals(current.enrollment.accountId,current.enrollment.deviceId):
   NATIVE_TERMINAL_SPOOL.list(current.enrollment.accountId,current.enrollment.deviceId);
  PROCESS_TERMINAL_RECEIPTS=list.filter(v=>
    /^lp_[A-Za-z0-9_-]{20,80}$/.test(String(v.processId||''))&&
    ['finished','stopped','timeout','error'].includes(v.state)&&
    Number.isSafeInteger(Number(v.finishedAt))&&Number(v.finishedAt)>0)
   .slice(-64).map(v=>({processId:v.processId,state:v.state,finishedAt:v.finishedAt,
      exitCode:v.exitCode??null}));
 }catch(error){PROCESS_TERMINAL_RECEIPTS=[];console.error(JSON.stringify({event:'terminal_receipt_refresh_failed',code:String(error?.code||error?.message||'JOURNAL_UNAVAILABLE').slice(0,80)}));}
}

async function confirmTerminalReceiptsAck(current,acks){
 if(!Array.isArray(acks)||!acks.length||
    !current?.enrollment?.accountId||!current?.enrollment?.deviceId)return;
 const valid=acks.slice(0,32).filter(x=>
  /^lp_[A-Za-z0-9_-]{20,80}$/.test(String(x?.processId||''))&&
  ['finished','stopped','timeout','error'].includes(String(x?.state||''))&&
  Number.isSafeInteger(Number(x?.finishedAt))&&Number(x.finishedAt)>0);
 if(!valid.length)return;
 // Fail closed: Supervisor must fsync its private terminal ACK journal first.
 // The next poll/heartbeat will replay if the local write was interrupted.
 if(SUPERVISED_PROCESSES)
  await SUPERVISED_PROCESSES.ackTerminals(current.enrollment.accountId,current.enrollment.deviceId,valid);
 else NATIVE_TERMINAL_SPOOL.acknowledge(current.enrollment.accountId,current.enrollment.deviceId,valid);
 await refreshProcessTerminalReceipts(current);
}

let DEVICE_DUPLEX=null,DEVICE_DUPLEX_IDLE_DEADLINE=0,DEVICE_DUPLEX_IDLE_TIMER=null;
const DEVICE_DUPLEX_IDLE_CLOSE_MS=Math.max(500,Math.min(Number(process.env.LIGHT_REMOTE_DEVICE_DUPLEX_IDLE_CLOSE_MS)||1500,10000));
function deviceDuplexStatus(){return DEVICE_DUPLEX?.status?.()||{active:false,ready:false};}
function executorReadiness(){
  if(deviceDuplexStatus().executorDegraded)return false;
  return EXECUTOR_PROBE.status().ready;
}
function cancelDeviceDuplexIdleClose(){DEVICE_DUPLEX_IDLE_DEADLINE=0;if(DEVICE_DUPLEX_IDLE_TIMER){clearTimeout(DEVICE_DUPLEX_IDLE_TIMER);DEVICE_DUPLEX_IDLE_TIMER=null;}}
function scheduleDeviceDuplexIdleClose(){
  if(!DEVICE_DUPLEX)return;
  cancelDeviceDuplexIdleClose();
  DEVICE_DUPLEX_IDLE_DEADLINE=Date.now()+DEVICE_DUPLEX_IDLE_CLOSE_MS;
  DEVICE_DUPLEX_IDLE_TIMER=setTimeout(async()=>{DEVICE_DUPLEX_IDLE_TIMER=null;if(REAL_REMOTE_LIVE.size||!DEVICE_DUPLEX||Date.now()<DEVICE_DUPLEX_IDLE_DEADLINE)return;if(deviceDuplexStatus().activeCommands>0){scheduleDeviceDuplexIdleClose();return;}const current=DEVICE_DUPLEX;DEVICE_DUPLEX=null;DEVICE_DUPLEX_IDLE_DEADLINE=0;try{await current.close('real_remote_idle');}catch{}console.log(JSON.stringify({event:'device_duplex_idle_closed'}));},DEVICE_DUPLEX_IDLE_CLOSE_MS);
  DEVICE_DUPLEX_IDLE_TIMER.unref?.();
}
function duplexHelloPayload(state,meta={}){
  return {protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:meta.transportEpoch,resumeClientSeq:Math.max(0,Number(meta.resumeClientSeq)||0),clientSeq:Math.max(0,Number(meta.clientSeq)||0),nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION,sessionCeiling:Math.max(1,Math.min(Number(process.env.OPERATOR_AGENT_MAX_SESSIONS)||2,100)),draining:Boolean(state.routing?.draining),executorReady:executorReadiness(),capabilities:effectiveCapabilitiesForState(state),policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0),updateStatus:updateStatusView()};
}
function duplexHeartbeatPayload(){
  const state=readState();if(!state?.enrollment?.deviceId||!cloudDesired(state))return null;
  return {nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION,sessionCeiling:Math.max(1,Math.min(Number(process.env.OPERATOR_AGENT_MAX_SESSIONS)||2,100)),draining:Boolean(state.routing?.draining),executorReady:executorReadiness(),capabilities:effectiveCapabilitiesForState(state),policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0),updateStatus:updateStatusView(),processTerminalReceipts:nextProcessTerminalReceipts(),resourceSample:DEVICE_RESOURCE_SAMPLER.sample()};
}
async function duplexExecuteCommand(command,hub){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const deviceReceivedAt=Date.now(),claim=await COMMAND_EXECUTIONS.run(command.commandId,'duplex',()=>executeCommand(state,command,{hub}));
  if(!claim.owner)console.log(JSON.stringify({event:'device_command_duplicate_replayed',commandId:command.commandId,ownerTransport:claim.transport,duplicateTransport:'duplex'}));
  const source=claim.result;if(!source||typeof source!=='object'||Array.isArray(source))return source;
  const result={...source,telemetry:{...(source.telemetry||{})}},completedAt=Date.now(),reportedFirst=Number(result.telemetry?.firstOutputAt);
  result.telemetry={...(result.telemetry||{}),deviceReceivedAt,firstOutputAt:Number.isSafeInteger(reportedFirst)&&reportedFirst>0?reportedFirst:completedAt,completedAt,deviceTransport:'duplex-v1',duplicateTransport:claim.owner?null:'duplex'};
  return fitResultForDelivery(result);
}
async function resyncLiveAfterDuplexEpochChange(){
  for(const row of REAL_REMOTE_LIVE.values()){
    if(row.stopped)continue;
    try{const snapshot=await NATIVE_DESKTOP.request('semantic-snapshot',{semanticSessionId:row.semanticSessionId},{timeoutMs:15000});row.lastSnapshotAt=Date.now();row.afterSeq=Math.max(row.afterSeq,Number(snapshot?.stateSeq)||0);row.inputSeq=Math.max(row.inputSeq||0,Number(snapshot?.inputSeq)||0);row.rootEpoch=Math.max(row.rootEpoch||0,Number(snapshot?.rootEpoch)||0);await pushRealRemoteLive(row,{stateSeq:row.afterSeq,inputSeq:row.inputSeq,rootEpoch:row.rootEpoch,snapshot,displayTopologyId:snapshot?.displayTopologyId||row.displayTopologyId,resyncRecommended:false});}catch(error){console.error(JSON.stringify({event:'device_duplex_resync_failed',semanticSessionId:row.semanticSessionId,error:String(error?.message||error)}));}
  }
}
async function ensureDeviceDuplex(state,hub){
  cancelDeviceDuplexIdleClose();
  if(DEVICE_DUPLEX&&DEVICE_DUPLEX.hub!==String(hub||'').replace(/\/$/,'')){const prior=DEVICE_DUPLEX;DEVICE_DUPLEX=null;try{await prior.close('hub_changed');}catch{}}
  if(!DEVICE_DUPLEX){
    DEVICE_DUPLEX=new DeviceDuplexClient({
      hub,
      hello:meta=>{const current=readState()||state;return signedChannelEnvelope(current,'stream',duplexHelloPayload(current,meta));},
      onCommand:command=>duplexExecuteCommand(command,hub),
      onProjectRequest:async request=>{
        // Device-local consent is mandatory and separate from FS/SCP/PTY.
        // Disabled by default on existing Gold builds.
        if(process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL!=='1')
          throw Error('continuity_remote_unavailable');
        if(typeof request?.projectId!=='string'||!/^[a-f0-9-]{36}$/.test(request.projectId))
          throw Error('continuity_project_missing');
        if(typeof request?.query!=='string'||request.query.length>300)
          throw Error('continuity_device_read_failed');
        if(!Number.isInteger(request.maxChars)||request.maxChars<512||request.maxChars>8000)
          throw Error('continuity_device_read_failed');
        const {projectContinuityRequest}=await import('./project-continuity-client.mjs');
        // Isolated mode intentionally DENIES remoteBrief until broker
        // receives a verified A/B session-scoped authorization proof.
        return projectContinuityRequest('remoteBrief',{projectId:request.projectId,
          query:request.query,maxChars:request.maxChars,requestId:request.requestId,
          proof:request.proof},{timeoutMs:7500});
      },
      onHelloAck:async(frame,info)=>{const current=readState();if(current){applyPolicyEnvelope(current,frame.policy);current.cloud={...(current.cloud||{}),desiredConnected:true,state:'connected',lastServerActivityAt:Date.now(),lastError:null};writeState(current);}if(info?.serverEpochChanged)queueMicrotask(()=>void resyncLiveAfterDuplexEpochChange());},
      onHeartbeatAck:async frame=>{const current=readState();if(current&&frame.policy)applyPolicyEnvelope(current,frame.policy);if(current)await confirmTerminalReceiptsAck(current,frame.terminalReceiptsAck);},
      heartbeatPayload:duplexHeartbeatPayload,
      heartbeatMs:5000,
      maxPending:128,
      log:event=>console.log(JSON.stringify(event))
    });
    DEVICE_DUPLEX.start();
  }
  const ready=await DEVICE_DUPLEX.waitReady(1800);
  return Boolean(ready&&deviceDuplexStatus().ready);
}

const REAL_REMOTE_LIVE_HEARTBEAT_MS=Math.max(1000,Math.min(Number(process.env.LIGHT_REMOTE_RMV2_LIVE_HEARTBEAT_MS)||60000,240000));
const REAL_REMOTE_LIVE_SNAPSHOT_DEBOUNCE_MS=1000;
function realRemoteLiveId(value={}){return String(value?.semanticSessionId||value?.browserSessionId||'');}
function touchRealRemoteLive(id){const row=REAL_REMOTE_LIVE.get(String(id||''));if(!row||row.stopped)return;row.expiresAt=Date.now()+row.idleTimeoutMs;scheduleRealRemoteLive(row);}
async function pushRealRemoteLive(row,value={}){
  const current=readState()||row.state,snapshot=value.snapshot||null;
  const payload={sessionId:row.sessionId,agentId:row.agentId,semanticSessionId:row.semanticSessionId,stateSeq:Math.max(0,Number(value.stateSeq)||row.afterSeq||0),inputSeq:Math.max(0,Number(value.inputSeq??snapshot?.inputSeq??row.inputSeq)||0),rootEpoch:Math.max(0,Number(value.rootEpoch??snapshot?.rootEpoch??row.rootEpoch)||0),events:Array.isArray(value.events)?value.events:[],snapshot,displayTopologyId:value.displayTopologyId||row.displayTopologyId||null,cursor:value.cursor||null,foreground:value.foreground||null,resyncRecommended:Boolean(value.resyncRecommended),heartbeat:Boolean(value.heartbeat),closed:Boolean(value.closed)};
  row.inputSeq=Math.max(row.inputSeq||0,payload.inputSeq);row.rootEpoch=Math.max(row.rootEpoch||0,payload.rootEpoch);
  if(deviceDuplexStatus().ready){
    try{if(await DEVICE_DUPLEX.sendLive(payload))return {ok:true,accepted:true,transport:'device-duplex-v1'};}
    catch(error){console.error(JSON.stringify({event:'device_duplex_live_fallback',semanticSessionId:row.semanticSessionId,error:String(error?.message||error)}));}
  }
  return channelRequest(current,row.hub,'desktop-live-push',payload);
}
function scheduleRealRemoteLive(row){
  if(row.timer){clearTimeout(row.timer);row.timer=null;}if(row.stopped)return;
  const delay=Math.max(250,Math.min(Math.max(0,row.expiresAt-Date.now()),REAL_REMOTE_LIVE_HEARTBEAT_MS));
  row.timer=setTimeout(async()=>{row.timer=null;if(row.stopped)return;if(Date.now()>=row.expiresAt){await stopRealRemoteLive(row);return;}try{await pushRealRemoteLive(row,{heartbeat:true});row.failures=0;}catch(error){row.failures++;console.error(JSON.stringify({event:'real_remote_live_heartbeat_failed',semanticSessionId:row.semanticSessionId,error:String(error?.message||error),failures:row.failures}));if(row.failures>=5){await stopRealRemoteLive(row,{notify:false});return;}}scheduleRealRemoteLive(row);},delay);
  row.timer.unref?.();
}
async function stopRealRemoteLive(row,{detach=true,notify=true}={}){
  if(!row)return null;if(row.stopping)return row.stopping;
  row.stopping=(async()=>{row.stopped=true;REAL_REMOTE_LIVE.delete(row.semanticSessionId);if(row.timer){clearTimeout(row.timer);row.timer=null;}let detached=null;
    if(detach){try{detached=await NATIVE_DESKTOP.request('semantic-detach',{semanticSessionId:row.semanticSessionId},{timeoutMs:10000});}catch(error){if(!/session_(missing|not_found)/.test(String(error?.message||error)))console.error(JSON.stringify({event:'real_remote_live_detach_failed',semanticSessionId:row.semanticSessionId,error:String(error?.message||error)}));}}
    if(notify){try{await pushRealRemoteLive(row,{closed:true});}catch{}}
    try{row.release?.();}catch{}
    if(REAL_REMOTE_LIVE.size===0){NATIVE_DESKTOP.closeIfIdle();scheduleDeviceDuplexIdleClose();}
    return detached;})();
  return row.stopping;
}
async function drainRealRemoteLive(row){
  if(!row||row.stopped)return;if(row.draining){row.dirty=true;return row.draining;}let again=false;
  row.draining=(async()=>{
    for(let pass=0;pass<8&&!row.stopped;pass++){
      row.dirty=false;
      const observed=await NATIVE_DESKTOP.request('semantic-events',{semanticSessionId:row.semanticSessionId,afterSeq:row.afterSeq,limit:200},{timeoutMs:10000});
      const events=Array.isArray(observed?.events)?observed.events:[],now=Date.now();let snapshot=null;
      if(observed?.resyncRecommended&&now-row.lastSnapshotAt>=REAL_REMOTE_LIVE_SNAPSHOT_DEBOUNCE_MS){try{snapshot=await NATIVE_DESKTOP.request('semantic-snapshot',{semanticSessionId:row.semanticSessionId},{timeoutMs:15000});row.lastSnapshotAt=Date.now();}catch{}}
      const nextSeq=Math.max(row.afterSeq,Number(observed?.stateSeq)||0,Number(snapshot?.stateSeq)||0);
      if(events.length||snapshot){await pushRealRemoteLive(row,{stateSeq:nextSeq,events,snapshot,displayTopologyId:snapshot?.displayTopologyId||observed?.displayTopologyId,foreground:observed?.foreground||null,resyncRecommended:Boolean(observed?.resyncRecommended&&!snapshot)});row.failures=0;row.lastPushAt=Date.now();}
      row.afterSeq=nextSeq;if(observed?.hasMore)row.dirty=true;if(!row.dirty)break;
    }
    again=row.dirty&&!row.stopped;
  })().catch(async error=>{row.failures++;console.error(JSON.stringify({event:'real_remote_live_drain_failed',semanticSessionId:row.semanticSessionId,error:String(error?.message||error),failures:row.failures}));await stopRealRemoteLive(row,{notify:true});}).finally(()=>{row.draining=null;if(again&&!row.stopped)queueMicrotask(()=>void drainRealRemoteLive(row));});
  return row.draining;
}
async function pushDirectRealRemoteDelta(row,data){
  if(!row||row.stopped)return;
  const events=Array.isArray(data?.events)?data.events:[];
  let snapshot=null;
  const now=Date.now();
  if(data?.resyncRecommended&&now-row.lastSnapshotAt>=REAL_REMOTE_LIVE_SNAPSHOT_DEBOUNCE_MS){
    try{snapshot=await NATIVE_DESKTOP.request('semantic-snapshot',{semanticSessionId:row.semanticSessionId},{timeoutMs:15000});row.lastSnapshotAt=Date.now();}catch{}
  }
  const nextSeq=Math.max(row.afterSeq,Number(data?.stateSeq)||0,Number(snapshot?.stateSeq)||0);
  await pushRealRemoteLive(row,{
    stateSeq:nextSeq,events,snapshot,
    foreground:data?.foreground||null,focused:data?.focused||null,inputSeq:Number(data?.inputSeq)||0,
    scope:data?.scope||null,rootHwnd:data?.rootHwnd||null,rootTitle:data?.rootTitle||null,rootEpoch:Number(data?.rootEpoch)||0,
    resyncRecommended:Boolean(data?.resyncRecommended&&!snapshot)
  });
  row.afterSeq=nextSeq;row.failures=0;row.lastPushAt=Date.now();
}
function onRealRemoteLiveEvent(message){
  const name=String(message?.eventName||'');
  if(name==='robot.closed'){for(const row of [...REAL_REMOTE_LIVE.values()])void stopRealRemoteLive(row,{detach:false,notify:true});for(const row of [...REAL_REMOTE_VISUAL.values()]){REAL_REMOTE_VISUAL.delete(row.desktopSessionId);if(row.timer)clearTimeout(row.timer);try{row.release?.();}catch{}}return;}
  if(name!=='semantic.changed'&&name!=='browser.semantic.changed')return;
  const data=message?.data||{},id=realRemoteLiveId(data),row=REAL_REMOTE_LIVE.get(id);if(!row||row.stopped)return;
  if(name==='semantic.changed'&&Array.isArray(data.events)){
    row.directQueue=(row.directQueue||Promise.resolve()).then(()=>pushDirectRealRemoteDelta(row,data)).catch(async error=>{
      row.failures++;console.error(JSON.stringify({event:'real_remote_live_direct_push_failed',semanticSessionId:row.semanticSessionId,error:String(error?.message||error),failures:row.failures}));
      if(row.failures>=5)await stopRealRemoteLive(row,{notify:true});
    });
    return;
  }
  row.dirty=true;void drainRealRemoteLive(row);
}
NATIVE_DESKTOP.onEvent(onRealRemoteLiveEvent);
async function finishEnrollment(state,base,{wait=false}={}){const pending=state.pendingEnrollment;if(!pending?.enrollmentId||!pending?.pollToken)throw new Error('no_pending_enrollment');do{const upstream=await operator(base,'enrollment-poll',{enrollmentId:pending.enrollmentId,pollToken:pending.pollToken});const e=upstream.enrollment;if(e.state==='approved'){verifyEnrollment(state,e);state.enrollment={enrollmentId:e.enrollmentId,deviceId:e.deviceId,nodeId:e.deviceId,accountId:e.accountId,grantableCapabilities:[...(pending.requestedCapabilities||e.approvedCapabilities||[])],approvedCapabilities:e.approvedCapabilities,policyProfile:e.policyProfile,certificate:e.certificate,certificateSignature:e.certificateSignature,signer:e.signer,enrolledAt:Date.now()};state.policy={...(state.policy||{}),serverPolicyRevision:1,localFinalDenyBoundary:true};state.effectiveCapabilities=effectiveCapabilities(e.approvedCapabilities,state.policy?.deniedCapabilities);state.cloud={...(state.cloud||{}),desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastError:null,lastDisconnectedAt:Date.now()};delete state.pendingEnrollment;writeState(state);const device=await heartbeat(state,base);return {state:'approved',device,effectiveCapabilities:[...(state.effectiveCapabilities||[])]};}if(e.state==='expired'||e.state==='replaced'||e.state==='cancelled'){delete state.pendingEnrollment;writeState(state);return {state:e.state};}if(!wait)return {state:e.state,expiresAt:e.expiresAt};if(Date.now()>=pending.expiresAt){delete state.pendingEnrollment;writeState(state);return {state:'expired'};}await sleep(3000);}while(true);}
async function beginWallEnrollment(base=DEFAULT_BASE){let state=readState()||{};if(state.identityResetRequired)throw new Error('external_identity_rotation_required');state=ensureIdentity(state);const discovered=discoverCapabilities();if(!discovered.length)throw new Error('device_capabilities_required');const denied=defaultRealRemoteDenied({discovered,denied:normalizeDeviceCapabilities(state.policy?.deniedCapabilities||[]),inputDecision:state.policy?.realRemoteInputDecision});const hostname=os.hostname(),hadEnrollment=Boolean(state.enrollment?.deviceId),revoked=String(state.cloud?.lastError||'')==='device_revoked';const policyProfile=String(state.enrollment?.policyProfile||state.pendingEnrollment?.requestedPolicy||'default');const upstream=await operator(base,'enrollment-begin',{publicIdentityKey:state.identity.publicIdentityKey,displayName:hostname,platform:os.platform(),architecture:os.arch(),agentVersion:VERSION,fingerprintSummary:`${hostname} / ${os.platform()} ${os.arch()} / key ${state.identity.publicKeySha256.slice(0,12)}`,capabilities:discovered,policyProfile});const e=upstream.enrollment;state.policy={...(state.policy||{}),deniedCapabilities:denied,localFinalDenyBoundary:true};state.pendingEnrollment={enrollmentId:e.enrollmentId,pollToken:e.pollToken,activationUrl:e.activationUrl,expiresAt:e.expiresAt,requestedCapabilities:e.requestedCapabilities||discovered,requestedPolicy:e.requestedPolicy||policyProfile};writeState(state);return {state:'pending',mode:hadEnrollment||revoked?'reenroll':'link',deviceCode:e.deviceCode,activationUrl:e.activationUrl,expiresAt:e.expiresAt,expiresInSeconds:e.expiresInSeconds,deniedCapabilities:[...denied]};}
async function pollWallEnrollment(base=DEFAULT_BASE){const state=readState();if(!state?.pendingEnrollment?.enrollmentId)throw new Error('no_pending_enrollment');return finishEnrollment(state,base,{wait:false});}
async function login(args){const base=args.base||DEFAULT_BASE;let state=ensureIdentity(readState()||{});if(state.enrollment?.deviceId&&!args.reenroll){const device=await heartbeat(state,base);console.log(JSON.stringify({ok:true,alreadyEnrolled:true,deviceId:state.enrollment.deviceId,nodeId:state.enrollment.nodeId||state.enrollment.deviceId,state:device.state,effectiveCapabilities:state.effectiveCapabilities},null,2));return;}const discovered=discoverCapabilities();if(!discovered.length)throw new Error('device_capabilities_required');const requestedDenied=args.deny==null&&args.reenroll?normalizeDeviceCapabilities(state.policy?.deniedCapabilities||[]):normalizeDeviceCapabilities(String(args.deny||'').split(',').map(x=>x.trim()).filter(Boolean));const denied=defaultRealRemoteDenied({discovered,denied:requestedDenied,inputDecision:state.policy?.realRemoteInputDecision});state.policy={...(state.policy||{}),deniedCapabilities:denied,localFinalDenyBoundary:true};const hostname=os.hostname(),policyProfile=String(args.policy||state.enrollment?.policyProfile||state.pendingEnrollment?.requestedPolicy||'default');const upstream=await operator(base,'enrollment-begin',{publicIdentityKey:state.identity.publicIdentityKey,displayName:args.name||hostname,platform:os.platform(),architecture:os.arch(),agentVersion:VERSION,fingerprintSummary:`${hostname} / ${os.platform()} ${os.arch()} / key ${state.identity.publicKeySha256.slice(0,12)}`,capabilities:discovered,policyProfile});const e=upstream.enrollment;state.pendingEnrollment={enrollmentId:e.enrollmentId,pollToken:e.pollToken,activationUrl:e.activationUrl,expiresAt:e.expiresAt,requestedCapabilities:e.requestedCapabilities||discovered,requestedPolicy:e.requestedPolicy||policyProfile};writeState(state);console.log(`Activation URL: ${e.activationUrl}`);console.log(`Device code: ${e.deviceCode}`);console.log(`Expires in: ${e.expiresInSeconds}s`);if(args['no-wait'])return;console.log('Waiting for approval…');const result=await finishEnrollment(state,base,{wait:true});console.log(JSON.stringify({ok:result.state==='approved',enrollment:result.state,deviceId:state.enrollment?.deviceId||null,nodeId:state.enrollment?.nodeId||null,state:result.device?.state||null,effectiveCapabilities:state.effectiveCapabilities||[]},null,2));}
function commandFile(commandId){if(!/^cmd_[A-Za-z0-9-]{20,}$/.test(String(commandId||'')))throw new Error('invalid_command_id');return path.join(COMMAND_DIR,`${commandId}.json`);}
function readCommand(commandId){try{return JSON.parse(fs.readFileSync(commandFile(commandId),'utf8'));}catch{return null;}}
function writeCommand(commandId,value){fs.mkdirSync(COMMAND_DIR,{recursive:true,mode:0o700});writeJson0600(commandFile(commandId),value);}
function pruneCommandSpool(){fs.mkdirSync(COMMAND_DIR,{recursive:true,mode:0o700});const rows=fs.readdirSync(COMMAND_DIR).filter(name=>/^cmd_[A-Za-z0-9-]{20,}\.json$/.test(name)).map(name=>({name,stat:fs.statSync(path.join(COMMAND_DIR,name))})).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);const cutoff=Date.now()-24*60*60*1000;for(let i=0;i<rows.length;i++)if(i>=100||rows[i].stat.mtimeMs<cutoff)fs.rmSync(path.join(COMMAND_DIR,rows[i].name),{force:true});}
function likelyBinaryBytes(value){const buf=Buffer.isBuffer(value)?value:Buffer.from(value);if(!buf.length)return false;if(buf.length>=4){if(buf[0]===0x1f&&buf[1]===0x8b)return true;if(buf[0]===0x50&&buf[1]===0x4b&&[0x03,0x05,0x07].includes(buf[2]))return true;if(buf[0]===0x7f&&buf[1]===0x45&&buf[2]===0x4c&&buf[3]===0x46)return true;if(buf[0]===0x00&&buf[1]===0x01&&buf[2]===0x00&&buf[3]===0x00)return true;const magic=buf.subarray(0,4).toString('ascii');if(magic==='wOFF'||magic==='wOF2')return true;}const sample=buf.subarray(0,Math.min(buf.length,8192));let controls=0;for(const byte of sample){if(byte===0)return true;if(byte<32&&byte!==9&&byte!==10&&byte!==13)controls++;}return controls>=8&&controls/sample.length>0.01;}
function boundedCollector(limit=MAX_OUTPUT){let size=0,chunks=[],truncated=false,finished=false,binary=false,binaryBytes=0;const decoder=new StringDecoder('utf8');const addText=text=>{if(!text)return;const buf=Buffer.from(text,'utf8');if(size>=limit){truncated=true;return;}const take=buf.subarray(0,Math.max(0,limit-size));chunks.push(take);size+=take.length;if(take.length<buf.length)truncated=true;};return{add(data){const buf=Buffer.isBuffer(data)?data:Buffer.from(data);if(binary||likelyBinaryBytes(buf)){binary=true;binaryBytes+=buf.length;return;}addText(decoder.write(buf));},finish(){if(finished)return;finished=true;if(binary)addText('[binary output suppressed · '+binaryBytes+' bytes]\n');else addText(decoder.end());},text(){this.finish();return Buffer.concat(chunks).toString('utf8');},truncated(){return truncated;},binaryBytes(){return binaryBytes;}};}
async function executeProcessCommand(state,p){
  const request=p.process&&typeof p.process==='object'&&!Array.isArray(p.process)?p.process:{};
  const op=String(request.op||'');
  const owner={accountId:state.enrollment.accountId,deviceId:state.enrollment.deviceId,sessionId:String(p.sessionId||''),agentId:String(p.agentId||'')};
  const effective=effectiveCapabilitiesForState(state);
  if(op==='start'){
    const script=String(request.script||'');if(!script.trim())throw new Error('process_script_required');
    const required=[...new Set([...(Array.isArray(request.requiredCapabilities)?request.requiredCapabilities:[]),...PLATFORM_ADAPTER.inferRequiredCapabilities(script,{shell:request.shell})])].sort();
    const policyDeny=PLATFORM_ADAPTER.hardDeny?.(script)||null;if(policyDeny)throw new Error(`local platform policy denied: ${policyDeny}`);
    const missing=required.filter(cap=>!effective.includes(cap));if(missing.length)throw new Error(`local capability denied: ${missing.join(',')}`);
    const cwd=String(request.cwd||os.homedir());let stat;try{stat=fs.statSync(cwd);}catch{}if(!stat?.isDirectory())throw new Error('cwd_not_directory');
    const process=SUPERVISED_PROCESSES?
      await SUPERVISED_PROCESSES.start({...owner,script,cwd,timeoutMs:request.timeoutMs,shell:request.shell,operationId:p.operationId,executionMode:request.executionMode}):
      NATIVE_PROCESSES.start({...owner,script,cwd,timeoutMs:request.timeoutMs,spawnSpec:value=>PLATFORM_ADAPTER.commandFor(value,{shell:request.shell}),env:{GPT_OPERATOR_ACCOUNT:owner.accountId,GPT_OPERATOR_DEVICE:owner.deviceId,GPT_OPERATOR_NODE:state.enrollment.nodeId||owner.deviceId,GPT_OPERATOR_SESSION:owner.sessionId}});
    return {ok:true,operation:'start',process};
  }
  if(!effective.includes('filesystem'))throw new Error('local capability denied: filesystem');
  if(op==='input')return {ok:true,operation:'input',process:await (SUPERVISED_PROCESSES||NATIVE_PROCESSES).input(request.processId,owner,{data:request.data,eof:Boolean(request.eof)})};
  if(op==='output')return {ok:true,operation:'output',...await (SUPERVISED_PROCESSES||NATIVE_PROCESSES).output(request.processId,owner,{stream:request.stream,offset:request.offset,limit:request.limit})};
  if(op==='stop')return {ok:true,operation:'stop',process:await (SUPERVISED_PROCESSES||NATIVE_PROCESSES).stop(request.processId,owner,{force:Boolean(request.force)})};
  if(op==='list')return {ok:true,operation:'list',processes:await (SUPERVISED_PROCESSES||NATIVE_PROCESSES).list(owner)};
  throw new Error('process_operation_unsupported');
}

async function executeTerminalCommand(state,p){
  const request=p.terminal&&typeof p.terminal==='object'&&!Array.isArray(p.terminal)?p.terminal:{};
  const op=String(request.op||''),owner={accountId:state.enrollment.accountId,deviceId:state.enrollment.deviceId,sessionId:String(p.sessionId||''),agentId:String(p.agentId||'')};
  const effective=effectiveCapabilitiesForState(state);
  if(!effective.includes('terminal'))throw new Error('local capability denied: terminal');
  if(op==='start'){
    const cwd=String(request.cwd||os.homedir());let stat;try{stat=fs.statSync(cwd);}catch{}if(!stat?.isDirectory())throw new Error('cwd_not_directory');
    const shellSpec=PLATFORM_ADAPTER.terminalFor({shell:request.shell});
    return {ok:true,operation:'start',terminal:NATIVE_TERMINALS.start({...owner,shellSpec,cwd,cols:request.cols,rows:request.rows,term:request.term,env:{GPT_OPERATOR_ACCOUNT:owner.accountId,GPT_OPERATOR_DEVICE:owner.deviceId,GPT_OPERATOR_NODE:state.enrollment.nodeId||owner.deviceId,GPT_OPERATOR_SESSION:owner.sessionId}})};
  }
  if(op==='input')return {ok:true,operation:'input',terminal:NATIVE_TERMINALS.input(request.terminalId,owner,{data:request.data})};
  if(op==='output')return {ok:true,operation:'output',...NATIVE_TERMINALS.output(request.terminalId,owner,{offset:request.offset,limit:request.limit})};
  if(op==='resize')return {ok:true,operation:'resize',terminal:NATIVE_TERMINALS.resize(request.terminalId,owner,{cols:request.cols,rows:request.rows})};
  if(op==='signal')return {ok:true,operation:'signal',terminal:NATIVE_TERMINALS.signal(request.terminalId,owner,{signal:request.signal})};
  if(op==='stop')return {ok:true,operation:'stop',terminal:NATIVE_TERMINALS.stop(request.terminalId,owner,{force:Boolean(request.force)})};
  if(op==='list')return {ok:true,operation:'list',terminals:NATIVE_TERMINALS.list(owner)};
  throw new Error('terminal_operation_unsupported');
}

async function executeSearchCommand(state,p){
  const request=p.search&&typeof p.search==='object'&&!Array.isArray(p.search)?p.search:{};
  const op=String(request.op||''),owner={accountId:state.enrollment.accountId,deviceId:state.enrollment.deviceId,sessionId:String(p.sessionId||''),agentId:String(p.agentId||'')};
  const effective=effectiveCapabilitiesForState(state);if(!effective.includes('filesystem'))throw new Error('local capability denied: filesystem');
  if(op==='start'){const policy=effectiveFilesystemPolicy(state);return {ok:true,operation:'start',search:await NATIVE_SEARCHES.start({...owner,path:request.path,searchType:request.searchType,pattern:request.pattern,literalSearch:Boolean(request.literalSearch),ignoreCase:request.ignoreCase!==false,filePattern:request.filePattern,contextLines:request.contextLines,maxResults:request.maxResults,readRoots:policy.readRoots})};}
  if(op==='results')return {ok:true,operation:'results',...NATIVE_SEARCHES.results(request.searchId,owner,{offset:request.offset,limit:request.limit})};
  if(op==='cancel')return {ok:true,operation:'cancel',search:NATIVE_SEARCHES.cancel(request.searchId,owner)};
  throw new Error('search_operation_unsupported');
}

async function executeDesktopCommand(state,p,{hub=DEFAULT_HUB}={}){
  const request=p.desktop&&typeof p.desktop==='object'&&!Array.isArray(p.desktop)?p.desktop:{};
  const op=String(request.op||''),effective=effectiveCapabilitiesForState(state);
  if(!effective.includes('desktop'))throw new Error('local capability denied: desktop');
  if(!REAL_REMOTE_AVAILABLE)throw new Error('real_remote_unavailable');
  if(op==='status')return {ok:true,operation:op,desktop:await NATIVE_DESKTOP.request('status',{})};
  if(op==='live-open'){
    const provider=String(request.provider||'windows-uia').trim().toLowerCase();
    if(!['windows-uia','browser-cdp'].includes(provider))throw new Error('invalid_semantic_provider');
    const depth=Number(request.maxDepth),nodes=Number(request.maxNodes),idleTimeoutMs=Math.max(15000,Math.min(Number(request.idleTimeoutMs)||300000,900000));
    const semantic={provider,maxDepth:Math.max(1,Math.min(Number.isFinite(depth)?depth:(provider==='browser-cdp'?8:6),16)),maxNodes:Math.max(1,Math.min(Number.isFinite(nodes)?nodes:(provider==='browser-cdp'?600:400),1500))};
    if(provider==='windows-uia')semantic.scope=request.scope==='foreground'?'foreground':'desktop';
    else{if(request.cdpEndpoint!=null)semantic.cdpEndpoint=String(request.cdpEndpoint).slice(0,256);if(request.targetId!=null)semantic.targetId=String(request.targetId).slice(0,256);if(request.urlMatch!=null)semantic.urlMatch=String(request.urlMatch).slice(0,512);}
    for(const existing of [...REAL_REMOTE_LIVE.values()])if(existing.sessionId===String(p.sessionId||'')&&existing.agentId===String(p.agentId||''))await stopRealRemoteLive(existing);
    const initial=await NATIVE_DESKTOP.request('semantic-attach',semantic,{timeoutMs:15000}),semanticSessionId=realRemoteLiveId(initial);
    if(!semanticSessionId)throw new Error('semantic_session_not_found');
    const row={semanticSessionId,provider,state,hub,sessionId:String(p.sessionId||''),agentId:String(p.agentId||''),afterSeq:Math.max(0,Number(initial?.stateSeq)||0),inputSeq:Math.max(0,Number(initial?.inputSeq)||0),rootEpoch:Math.max(0,Number(initial?.rootEpoch)||0),displayTopologyId:String(initial?.displayTopologyId||''),idleTimeoutMs,expiresAt:Date.now()+idleTimeoutMs,lastPushAt:0,lastSnapshotAt:Date.now(),failures:0,dirty:false,draining:null,directQueue:Promise.resolve(),stopped:false,stopping:null,timer:null,release:NATIVE_DESKTOP.retain()};
    REAL_REMOTE_LIVE.set(semanticSessionId,row);
    let duplexReady=false;
    try{duplexReady=await ensureDeviceDuplex(state,hub);}
    catch(error){console.error(JSON.stringify({event:'device_duplex_open_failed',error:String(error?.message||error)}));}
    try{await pushRealRemoteLive(row,{stateSeq:row.afterSeq,inputSeq:row.inputSeq,rootEpoch:row.rootEpoch,snapshot:{...initial,semanticSessionId},displayTopologyId:row.displayTopologyId});scheduleRealRemoteLive(row);}
    catch(error){await stopRealRemoteLive(row,{notify:false});throw error;}
    return {ok:true,operation:op,desktop:{...initial,semanticSessionId,live:{active:true,transport:duplexReady?'device-duplex-v1':'semantic-push-cache',eventDriven:true,heartbeatMs:REAL_REMOTE_LIVE_HEARTBEAT_MS,idleTimeoutMs,duplex:deviceDuplexStatus()}}};
  }
  if(op==='live-close'){
    const semanticSessionId=String(request.semanticSessionId||'');if(!semanticSessionId)throw new Error('semantic_session_id_required');
    const row=REAL_REMOTE_LIVE.get(semanticSessionId);let detached=null;
    if(row)detached=await stopRealRemoteLive(row,{detach:true,notify:true});
    else{
      if(NATIVE_DESKTOP.running){try{detached=await NATIVE_DESKTOP.request('semantic-detach',{semanticSessionId},{timeoutMs:10000});}catch(error){if(!/session_(missing|not_found)/.test(String(error?.message||error)))throw error;}}
      const closePayload={sessionId:String(p.sessionId||''),agentId:String(p.agentId||''),semanticSessionId,stateSeq:0,inputSeq:0,rootEpoch:0,events:[],snapshot:null,heartbeat:false,closed:true};
      let sent=false;if(deviceDuplexStatus().ready){try{sent=await DEVICE_DUPLEX.sendLive(closePayload);}catch{}}
      if(!sent){try{await channelRequest(readState()||state,hub,'desktop-live-push',closePayload);}catch{}}
    }
    if(REAL_REMOTE_LIVE.size===0){NATIVE_DESKTOP.closeIfIdle();scheduleDeviceDuplexIdleClose();}
    return {ok:true,operation:op,desktop:{semanticSessionId,closed:true,detached}};
  }
  if(op==='attach')return {ok:true,operation:op,desktop:await attachRealRemoteVisual(p,request)};
  if(op==='resume')return {ok:true,operation:op,desktop:await resumeRealRemoteVisual(p,request)};
  if(op==='detach')return {ok:true,operation:op,desktop:await detachRealRemoteVisual(p,request)};
  if(op==='windows')return {ok:true,operation:op,desktop:await NATIVE_DESKTOP.request('windows',{limit:Math.max(1,Math.min(Number(request.limit)||100,200))})};
  if(op==='frame')return {ok:true,operation:op,desktop:await frameRealRemoteVisual(p,request,{observe:false})};
  if(op==='observe'){
    const semanticSessionId=String(request.semanticSessionId||'').trim();
    const semanticRequested=Boolean(semanticSessionId||request.provider||request.cdpEndpoint||request.targetId||request.urlMatch);
    if(semanticRequested){
      if(semanticSessionId){
        if(request.afterSeq!=null){
          const afterSeq=Number(request.afterSeq),limit=Number(request.limit);
          return {ok:true,operation:op,desktop:await NATIVE_DESKTOP.request('semantic-events',{
            semanticSessionId,
            afterSeq:Number.isFinite(afterSeq)?Math.max(0,Math.floor(afterSeq)):0,
            limit:Math.max(1,Math.min(Number.isFinite(limit)?Math.floor(limit):100,200))
          },{timeoutMs:10000})};
        }
        return {ok:true,operation:op,desktop:await NATIVE_DESKTOP.request('semantic-snapshot',{semanticSessionId},{timeoutMs:15000})};
      }
      const provider=String(request.provider||'windows-uia').trim().toLowerCase();
      if(!['windows-uia','browser-cdp'].includes(provider))throw new Error('invalid_semantic_provider');
      const depth=Number(request.maxDepth),nodes=Number(request.maxNodes),semantic={provider,maxDepth:Math.max(0,Math.min(Number.isFinite(depth)?depth:(provider==='browser-cdp'?8:6),12)),maxNodes:Math.max(1,Math.min(Number.isFinite(nodes)?nodes:(provider==='browser-cdp'?600:400),1500))};
      if(provider==='windows-uia')semantic.scope=request.scope==='desktop'?'desktop':'foreground';
      else{if(request.cdpEndpoint!=null)semantic.cdpEndpoint=String(request.cdpEndpoint).slice(0,256);if(request.targetId!=null)semantic.targetId=String(request.targetId).slice(0,256);if(request.urlMatch!=null)semantic.urlMatch=String(request.urlMatch).slice(0,512);}
      return {ok:true,operation:op,desktop:await NATIVE_DESKTOP.request('semantic-attach',semantic,{timeoutMs:15000})};
    }
    return {ok:true,operation:op,desktop:await frameRealRemoteVisual(p,request,{observe:true})};
  }
  if(op==='run'){
    if(!effective.includes(REAL_REMOTE_INPUT_CAPABILITY))throw new Error('local capability denied: desktop-input');
    const wait=request.await&&typeof request.await==='object'&&!Array.isArray(request.await)?request.await:null;
    let payload,semanticSessionId='';
    if(String(request.nodeId||'').trim()&&String(request.action||'').trim()&&!Array.isArray(request.events)){
      semanticSessionId=String(request.semanticSessionId||'');
      if(!semanticSessionId)throw new Error('semantic_session_id_required');
      payload={semanticSessionId,nodeId:String(request.nodeId),action:String(request.action),afterSeq:Math.max(0,Number(request.afterSeq)||0),settleMs:Math.max(0,Math.min(Number(request.settleMs)||90,250))};
      if(request.value!=null)payload.value=String(request.value).slice(0,4096);
      if(wait)payload.await=wait;
    }else{
      payload=normalizeDesktopInput(request);semanticSessionId=String(payload.semanticSessionId||'');
      if(wait)payload.await=wait;
    }
    const desktop=await NATIVE_DESKTOP.request('run',payload,{timeoutMs:20000});
    touchRealRemoteLive(semanticSessionId);
    return {ok:true,operation:op,desktop};
  }
  if(op==='input'){
    if(!effective.includes(REAL_REMOTE_INPUT_CAPABILITY))throw new Error('local capability denied: desktop-input');
    const input=normalizeDesktopInput(request),desktop=await NATIVE_DESKTOP.request('input',input,{timeoutMs:10000});
    touchRealRemoteLive(input.semanticSessionId);
    return {ok:true,operation:op,desktop};
  }
  if(op==='act'){
    if(!effective.includes(REAL_REMOTE_INPUT_CAPABILITY))throw new Error('local capability denied: desktop-input');
    if(Array.isArray(request.events)){
      const input=normalizeDesktopInput(request),desktop=await NATIVE_DESKTOP.request('input',input,{timeoutMs:10000});
      touchRealRemoteLive(input.semanticSessionId);
      return {ok:true,operation:op,desktop};
    }
    const semanticSessionId=String(request.semanticSessionId||'');
    if(!semanticSessionId)throw new Error('semantic_session_id_required');
    const action={semanticSessionId,nodeId:String(request.nodeId||''),action:String(request.action||''),afterSeq:Math.max(0,Number(request.afterSeq)||0),settleMs:Math.max(0,Math.min(Number(request.settleMs)||90,250))};
    if(request.value!=null)action.value=String(request.value).slice(0,4096);
    const desktop=await NATIVE_DESKTOP.request('semantic-act',action,{timeoutMs:10000});
    touchRealRemoteLive(semanticSessionId);
    return {ok:true,operation:op,desktop};
  }
  if(op==='semantic-attach'){
    const provider=String(request.provider||'windows-uia').trim().toLowerCase();
    if(!['windows-uia','browser-cdp'].includes(provider))throw new Error('invalid_semantic_provider');
    const depth=Number(request.maxDepth),nodes=Number(request.maxNodes);
    const semantic={provider,maxDepth:Math.max(0,Math.min(Number.isFinite(depth)?depth:(provider==='browser-cdp'?8:6),12)),maxNodes:Math.max(1,Math.min(Number.isFinite(nodes)?nodes:(provider==='browser-cdp'?600:400),1500))};
    if(provider==='windows-uia')semantic.scope=request.scope==='desktop'?'desktop':'foreground';
    else{if(request.cdpEndpoint!=null)semantic.cdpEndpoint=String(request.cdpEndpoint).slice(0,256);if(request.targetId!=null)semantic.targetId=String(request.targetId).slice(0,256);if(request.urlMatch!=null)semantic.urlMatch=String(request.urlMatch).slice(0,512);}
    return {ok:true,operation:op,desktop:await NATIVE_DESKTOP.request('semantic-attach',semantic,{timeoutMs:15000})};
  }
  if(op==='semantic-snapshot')return {ok:true,operation:op,desktop:await NATIVE_DESKTOP.request('semantic-snapshot',{semanticSessionId:String(request.semanticSessionId||'')},{timeoutMs:15000})};
  if(op==='semantic-events'){
    const afterSeq=Number(request.afterSeq),limit=Number(request.limit);
    return {ok:true,operation:op,desktop:await NATIVE_DESKTOP.request('semantic-events',{
      semanticSessionId:String(request.semanticSessionId||''),
      afterSeq:Number.isFinite(afterSeq)?Math.max(0,Math.floor(afterSeq)):0,
      limit:Math.max(1,Math.min(Number.isFinite(limit)?Math.floor(limit):100,200))
    },{timeoutMs:10000})};
  }
  if(op==='semantic-detach')return {ok:true,operation:op,desktop:await NATIVE_DESKTOP.request('semantic-detach',{semanticSessionId:String(request.semanticSessionId||'')},{timeoutMs:10000})};
  throw new Error('desktop_operation_unsupported');
}

async function executeScpCommand(state,p){
  const request=p.scp&&typeof p.scp==='object'&&!Array.isArray(p.scp)?p.scp:{};
  const op=String(request.op||''),owner={accountId:state.enrollment.accountId,deviceId:state.enrollment.deviceId,sessionId:String(p.sessionId||''),agentId:String(p.agentId||'')};
  const effective=effectiveCapabilitiesForState(state);
  if(!effective.includes('filesystem'))throw new Error('local capability denied: filesystem');
  if(op==='upload-begin')return {ok:true,operation:op,transfer:await LIGHT_SCP.beginUpload(owner,request)};
  if(op==='upload-chunk')return {ok:true,operation:op,transfer:await LIGHT_SCP.putUploadChunk(owner,request.transferId,request)};
  if(op==='upload-commit')return {ok:true,operation:op,result:await LIGHT_SCP.commitUpload(owner,request.transferId)};
  if(op==='download-begin')return {ok:true,operation:op,transfer:await LIGHT_SCP.beginDownload(owner,request)};
  if(op==='download-chunk'){const chunk=await LIGHT_SCP.readDownloadChunk(owner,request.transferId,request);return {ok:true,operation:op,chunk,transfer:await LIGHT_SCP.status(owner,request.transferId)};}
  if(op==='status')return {ok:true,operation:op,transfer:await LIGHT_SCP.status(owner,request.transferId)};
  if(op==='cancel')return {ok:true,operation:op,result:await LIGHT_SCP.cancel(owner,request.transferId)};
  throw new Error('scp_operation_unsupported');
}

async function executeCommand(state,command,{hub=DEFAULT_HUB}={}){
  const existing=readCommand(command.commandId);
  if(existing?.state==='finished'&&existing.result)return existing.result;
  if(existing?.state==='running'){
    const result={commandId:command.commandId,status:'error',exitCode:125,stdout:'',stderr:'agent recovered an incomplete command; execution was not repeated\n',durationMs:Math.max(0,Date.now()-(existing.startedAt||Date.now())),recoveredIncomplete:true};
    writeCommand(command.commandId,{...existing,state:'finished',finishedAt:Date.now(),result});return result;
  }
  const p=command.payload||{};
  if(p.type==='update'){
    const startedAt=Date.now();writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'running',startedAt});
    try{const source=String(p.update?.source||'remote-owner').slice(0,40),data=await requestLocalUpdate(source);const result={commandId:command.commandId,status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:Date.now()-startedAt,data};writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;}
    catch(error){const result={commandId:command.commandId,status:'error',exitCode:1,stdout:'',stderr:String(error?.message||error)+'\n',durationMs:Date.now()-startedAt,data:{ok:false,error:String(error?.message||error)}};writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;}
  }
  if(p.type==='scp'){
    const startedAt=Date.now();writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'running',startedAt});
    try{
      const data=await executeScpCommand(state,p);
      const result={commandId:command.commandId,status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:Date.now()-startedAt,data};
      writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;
    }catch(error){
      const result={commandId:command.commandId,status:'error',exitCode:1,stdout:'',stderr:String(error?.message||error)+'\n',durationMs:Date.now()-startedAt,data:{ok:false,error:String(error?.message||error),status:Number(error?.status)||500}};
      writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;
    }
  }
  if(p.type==='desktop'){
    const startedAt=Date.now();writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'running',startedAt});
    try{const data=await executeDesktopCommand(state,p,{hub});const result={commandId:command.commandId,status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:Date.now()-startedAt,data};writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;}
    catch(error){const result={commandId:command.commandId,status:'error',exitCode:1,stdout:'',stderr:String(error?.message||error)+'\n',durationMs:Date.now()-startedAt,data:{ok:false,error:String(error?.message||error),status:Number(error?.status)||500}};writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;}
  }
  if(p.type==='search'){
    const startedAt=Date.now();writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'running',startedAt});
    try{const data=await executeSearchCommand(state,p);const result={commandId:command.commandId,status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:Date.now()-startedAt,data};writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;}
    catch(error){const result={commandId:command.commandId,status:'error',exitCode:1,stdout:'',stderr:String(error?.message||error)+'\n',durationMs:Date.now()-startedAt,data:{ok:false,error:String(error?.message||error),status:Number(error?.status)||500}};writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;}
  }
  if(p.type==='terminal'){
    const startedAt=Date.now();writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'running',startedAt});
    try{const data=await executeTerminalCommand(state,p);const result={commandId:command.commandId,status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:Date.now()-startedAt,data};writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;}
    catch(error){const result={commandId:command.commandId,status:'error',exitCode:1,stdout:'',stderr:String(error?.message||error)+'\n',durationMs:Date.now()-startedAt,data:{ok:false,error:String(error?.message||error),status:Number(error?.status)||500}};writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;}
  }
  if(p.type==='process'){
    const startedAt=Date.now();writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'running',startedAt});
    try{
      const data=await executeProcessCommand(state,p);
      const result={commandId:command.commandId,status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:Date.now()-startedAt,data};
      writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;
    }catch(error){
      const result={commandId:command.commandId,status:'error',exitCode:1,stdout:'',stderr:String(error?.message||error)+'\n',durationMs:Date.now()-startedAt,data:{ok:false,error:String(error?.message||error),status:Number(error?.status)||500}};
      writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;
    }
  }
  if(p.type==='fs'){
    const effective=effectiveCapabilitiesForState(state);
    const startedAt=Date.now();
    if(!effective.includes('filesystem')){
      const result={commandId:command.commandId,status:'error',exitCode:126,stdout:'',stderr:'local capability denied: filesystem\n',durationMs:0};
      writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});return result;
    }
    writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'running',startedAt});
    try{
      const data=await executeNativeFs(p.fs||{}, {policy:effectiveFilesystemPolicy(state)});
      const result={commandId:command.commandId,status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:Date.now()-startedAt,data};
      writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;
    }catch(error){
      const result={commandId:command.commandId,status:'error',exitCode:1,stdout:'',stderr:String(error?.message||error)+'\n',durationMs:Date.now()-startedAt,data:{ok:false,error:String(error?.message||error),status:Number(error?.status)||500}};
      writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;
    }
  }
  if(p.type!=='exec')throw new Error('unsupported_leaf_command');
  const script=String(p.script||'');
  const effective=effectiveCapabilitiesForState(state);
  const inferred=PLATFORM_ADAPTER.inferRequiredCapabilities(script,{shell:p.shell});
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
  let spec;try{spec=PLATFORM_ADAPTER.commandFor(script,{shell:p.shell});}catch(error){
    const result={commandId:command.commandId,status:'error',exitCode:126,stdout:'',stderr:`platform adapter unavailable: ${error.message}\n`,durationMs:0};
    writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt:Date.now(),finishedAt:Date.now(),result});return result;
  }
  const startedAt=Date.now();writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'running',startedAt});
  const out=boundedCollector(),err=boundedCollector();let timedOut=false,firstOutputAt=null;
  const markOutput=(collector,data)=>{if(firstOutputAt==null)firstOutputAt=Date.now();collector.add(data);};
  const exitCode=await new Promise(resolve=>{
    const child=spawn(spec.file,spec.args,{cwd,env:{...process.env,GPT_OPERATOR_ACCOUNT:state.enrollment.accountId,GPT_OPERATOR_DEVICE:state.enrollment.deviceId,GPT_OPERATOR_NODE:state.enrollment.nodeId||state.enrollment.deviceId,GPT_OPERATOR_SESSION:String(p.sessionId||'')},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>markOutput(out,d));child.stderr.on('data',d=>markOutput(err,d));child.on('error',e=>{err.add(`${e.message}\n`);resolve(127);});child.on('exit',code=>resolve(code??128));
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),5000).unref();},Math.max(1000,Math.min(Number(p.timeoutMs)||600000,7200000)));timer.unref();child.on('close',()=>clearTimeout(timer));
  });
  const result={commandId:command.commandId,status:timedOut?'timeout':exitCode===0?'ok':'error',exitCode:timedOut?124:Math.max(0,Math.min(Number(exitCode)||0,255)),stdout:out.text(),stderr:err.text(),durationMs:Date.now()-startedAt,outputTruncated:out.truncated()||err.truncated(),telemetry:{firstOutputAt}};
  writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;
}
async function localFleetStatus(){try{const r=await fetch(`http://${FLEET_WALL_HOST}:${FLEET_WALL_PORT}/healthz`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(800)}),j=await r.json();if(!r.ok||!j.ok||j.service!=='light-remote-fleet-wall')throw new Error('fleet_wall_unhealthy');return {healthy:true,port:FLEET_WALL_PORT,version:j.version||null,publicUrl:FLEET_WALL_PUBLIC_URL||null};}catch{return {healthy:false,port:FLEET_WALL_PORT,version:null,publicUrl:FLEET_WALL_PUBLIC_URL||null};}}
function cloudDesired(state){return Boolean(state?.enrollment?.deviceId)&&state?.cloud?.desiredConnected!==false;}
function expireLocalHardLease(state,{persist=true}={}){
  const expiresAt=Number(state?.cloud?.hardExpiresAt);
  if(!cloudDesired(state)||state?.cloud?.state!=='connected'||!Number.isFinite(expiresAt)||Date.now()<expiresAt)return false;
  state.cloud={...(state.cloud||{}),desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastError:'device_connection_expired',lastDisconnectedAt:Date.now(),changedAt:Date.now()};
  if(persist)writeState(state);
  return true;
}
function cloudLeaseWindowMs(state){
  const hard=Number(state?.cloud?.hardExpiresAt),started=Number(state?.cloud?.lastRenewedAt||state?.cloud?.connectedAt);
  return Number.isFinite(hard)&&Number.isFinite(started)&&hard>started?hard-started:0;
}
function cloudLeaseRenewalDue(state,now=Date.now()){
  if(!cloudDesired(state)||state?.cloud?.state!=='connected')return false;
  const hard=Number(state?.cloud?.hardExpiresAt),windowMs=cloudLeaseWindowMs(state);
  if(!Number.isFinite(hard)||windowMs<=0)return false;
  const margin=Math.max(15*60*1000,Math.floor(windowMs/2));
  return hard-now<=margin;
}
async function renewCloudLease(state,hub=DEFAULT_HUB){
  if(!cloudLeaseRenewalDue(state))return null;
  const response=await channelRequest(state,hub,'renew',{nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION}),connection=response.connection,now=Date.now();
  markCloudState(state,{desiredConnected:true,state:'connected',connectionId:connection?.connectionId||state.cloud?.connectionId||null,connectedAt:state.cloud?.connectedAt||connection?.connectedAt||now,lastRenewedAt:now,hardExpiresAt:connection?.hardExpiresAt||state.cloud?.hardExpiresAt||null,reconnectGraceMs:connection?.reconnectGraceMs||state.cloud?.reconnectGraceMs||null,plan:connection?.plan||state.cloud?.plan||null,lastError:null});
  return connection;
}
function markCloudState(state,value){state.cloud={...(state.cloud||{}),...value,changedAt:Date.now()};writeState(state);return state.cloud;}
function markDeviceRemoved(state,reason='device_removed'){const prior=state.enrollment?.deviceId||null;delete state.enrollment;delete state.pendingEnrollment;delete state.routing;state.effectiveCapabilities=[];if(state.identity?.privateKey){delete state.identity;delete state.identityResetRequired;}else if(EXTERNAL_IDENTITY_FILE){state.identityResetRequired=true;}state.cloud={...(state.cloud||{}),desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastError:'device_removed',lastDisconnectedAt:Date.now(),changedAt:Date.now()};writeState(state);return prior;}
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
  markCloudState(state,{desiredConnected:true,state:'connected',connectionId:connection?.connectionId||null,connectedAt:connection?.connectedAt||Date.now(),lastRenewedAt:Date.now(),hardExpiresAt:connection?.hardExpiresAt||null,reconnectGraceMs:connection?.reconnectGraceMs||null,plan:connection?.plan||null,lastError:null});
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
async function remoteAccessLookup(hub=DEFAULT_HUB){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  return channelRequest(state,hub,'access-lookup',{nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION});
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
async function closeWallSession(hub=DEFAULT_HUB,data={}){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  return channelRequest(state,hub,'session-close',{nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION,sessionId:String(data.sessionId||''),agentId:String(data.agentId||''),reason:'owner_closed_from_wall'});
}
async function authenticateWallAccount(email,credential,base=DEFAULT_BASE){
  const state=readState()||{},field='pass'+'word';
  const response=await operator(base,'account-login',{email:String(email||'').trim(),[field]:String(credential||'')});
  if(!response?.account?.accountId)throw new Error('invalid_account_credentials');
  if(state.enrollment?.accountId&&response.account.accountId!==state.enrollment.accountId){const error=new Error('device_account_mismatch');error.status=403;throw error;}
  return {account:response.account,entitlements:response.entitlements};
}
async function rotatePairingCode(hub=DEFAULT_HUB,options={}){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const response=await channelRequest(state,hub,'pairing-code',{nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION,rotate:options.rotate===true});
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
function setLocalFilesystemRoots(input){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  // The owner changes locations through authenticated Local Wall + CSRF.
  // This does not grant a capability denied by the signed server policy.
  const roots=normalizeFilesystemRoots(input);
  state.policy={...(state.policy||{}),filesystemRoots:roots,localFilesystemRootsUpdatedAt:Date.now()};
  writeState(state);
  // Stop searches started under an older read scope. SCP rechecks per chunk/commit.
  for(const row of NATIVE_SEARCHES.rows.values())if(!row.finishedAt)row.cancelRequested=true;
  NATIVE_SEARCHES.rows.clear(); // Drop results admitted by an earlier read scope.
  return {source:'owner',...roots,updatedAt:state.policy.localFilesystemRootsUpdatedAt};
}
function setLocalPermissions(allowedCapabilities,profile='custom'){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const grantable=normalizeDeviceCapabilities(state.enrollment.grantableCapabilities||state.enrollment.approvedCapabilities||[]);
  const supported=normalizeDeviceCapabilities([...discoverCapabilities(),...grantable]);
  const allowed=normalizeDeviceCapabilities(Array.isArray(allowedCapabilities)?allowedCapabilities:[]);
  if(allowed.some(cap=>!supported.includes(cap)))throw new Error('local_permission_not_device_supported');
  const localProfile=/^(safe|developer|support|infra|full|custom)$/.test(String(profile||''))?String(profile):'custom';
  const denied=supported.filter(cap=>!allowed.includes(cap));
  state.policy=realRemotePolicyAfterSave({...(state.policy||{}),deniedCapabilities:denied,localRequestedCapabilities:allowed,localProfile,localFinalDenyBoundary:true,localPolicyUpdatedAt:Date.now()},{grantable:supported,allowed});
  state.effectiveCapabilities=effectiveCapabilitiesForState(state);
  writeState(state);
  return {profile:localProfile,policyAuthority:isTrustedHostState(state)?'local-main':'server-and-local',supportedCapabilities:supported,grantableCapabilities:grantable,serverApprovedCapabilities:[...(state.enrollment.approvedCapabilities||[])],localAllowedCapabilities:allowed,deniedCapabilities:denied,effectiveCapabilities:[...state.effectiveCapabilities],updatedAt:state.policy.localPolicyUpdatedAt};
}
function statusView(state=readState()){
  if(state)expireLocalHardLease(state);
  if(!state)return {ok:true,version:VERSION,platformAdapter:PLATFORM_ADAPTER.id,enrolled:false,deviceId:null,deviceName:os.hostname(),accountId:null,cloudDesiredConnected:false,cloudState:'dormant',connectionId:null,hardExpiresAt:null,reconnectGraceMs:null,connectionPlan:null,stateFile:STATE_FILE,localWallUrl:`http://${LOCAL_WALL_HOST}:${LOCAL_WALL_PORT}/`,deviceDuplex:deviceDuplexStatus(),executorReady:executorReadiness(),executorProbe:EXECUTOR_PROBE.status(),realRemoteLiveSessions:REAL_REMOTE_LIVE.size,update:updateStatusView()};
  return {ok:true,version:VERSION,platformAdapter:PLATFORM_ADAPTER.id,enrolled:Boolean(state.enrollment?.deviceId),deviceId:state.enrollment?.deviceId||null,deviceName:state.enrollment?.displayName||os.hostname(),nodeId:state.enrollment?.nodeId||state.enrollment?.deviceId||null,accountId:state.enrollment?.accountId||null,pendingEnrollmentId:state.pendingEnrollment?.enrollmentId||null,publicKeySha256:state.identity?.publicKeySha256||null,policyProfile:state.enrollment?.policyProfile||state.pendingEnrollment?.requestedPolicy||null,localPolicyProfile:state.policy?.localProfile||((state.policy?.deniedCapabilities||[]).length?'custom':'full'),policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0),policyAuthority:isTrustedHostState(state)?'local-main':'server-and-local',grantableCapabilities:state.enrollment?.grantableCapabilities||state.enrollment?.approvedCapabilities||[],supportedCapabilities:discoverCapabilities(),installedCapabilities:PLATFORM_ADAPTER.installedCapabilities?.()||[],approvedCapabilities:state.enrollment?.approvedCapabilities||[],localRequestedCapabilities:state.policy?.localRequestedCapabilities||[],deniedCapabilities:state.policy?.deniedCapabilities||[],filesystemRoots:effectiveFilesystemPolicy(state),effectiveCapabilities:state.effectiveCapabilities||[],draining:Boolean(state.routing?.draining),cloudDesiredConnected:cloudDesired(state),cloudState:state.cloud?.state||(cloudDesired(state)?'legacy-connected':'dormant'),connectionId:state.cloud?.connectionId||null,hardExpiresAt:state.cloud?.hardExpiresAt||null,reconnectGraceMs:state.cloud?.reconnectGraceMs||null,connectionPlan:state.cloud?.plan||null,lastCloudError:state.cloud?.lastError||null,lastHeartbeatAt:state.lastHeartbeatAt||null,stateFile:STATE_FILE,commandDir:COMMAND_DIR,localWallUrl:`http://${LOCAL_WALL_HOST}:${LOCAL_WALL_PORT}/`,privateKeyStoredLocally:Boolean(state.identity?.privateKey),deviceDuplex:deviceDuplexStatus(),executorReady:executorReadiness(),executorProbe:EXECUTOR_PROBE.status(),realRemoteLiveSessions:REAL_REMOTE_LIVE.size,update:updateStatusView()};
}
async function daemon(args){
  const hub=args.hub||DEFAULT_HUB,base=args.base||DEFAULT_BASE;let state=readState()||{};
  if(state.enrollment?.deviceId){
    state.enrollment.nodeId=state.enrollment.nodeId||state.enrollment.deviceId;
    state.effectiveCapabilities=effectiveCapabilitiesForState(state);
  }
  const sessionCeiling=Math.max(1,Math.min(Number(process.env.OPERATOR_AGENT_MAX_SESSIONS)||2,100));
  const waitMs=Math.max(1000,Math.min(Number(process.env.OPERATOR_AGENT_CHANNEL_WAIT_MS)||8000,15000));
  const dormantPollMs=Math.max(1000,Math.min(Number(process.env.OPERATOR_AGENT_DORMANT_CHECK_MS)||2000,30000));
  const commandHeartbeatMs=Math.max(2000,Math.min(Number(process.env.OPERATOR_AGENT_COMMAND_HEARTBEAT_MS)||5000,15000));
  let stopped=false,wake=null,failures=0,localWall=null,fleetTimer=null,fleetReconciling=false;
  const fleetManager=new FleetComponentManager(),fleetSupervisor=new FleetComponentSupervisor({manager:fleetManager,stateProvider:()=>readState(),requestIntent:async current=>{const local=await localFleetStatus();const response=await channelRequest(current,hub,'fleet-intent',{agentVersion:VERSION,moduleVersion:fleetManager.current()?.version||null,fleetHealthy:local.healthy===true,fleetPort:local.port});return response.fleet;},env:{OPERATOR_AGENT_STATE:STATE_FILE,OPERATOR_AGENT_IDENTITY_FILE:EXTERNAL_IDENTITY_FILE,OPERATOR_AGENT_WALL_AUTH_FILE:LOCAL_WALL_AUTH_FILE,OPERATOR_AGENT_HUB_URL:hub,OPERATOR_FLEET_WALL_HOST:FLEET_WALL_HOST,OPERATOR_FLEET_WALL_PORT:String(FLEET_WALL_PORT),OPERATOR_FLEET_WALL_PUBLIC_URL:FLEET_WALL_PUBLIC_URL},emit:event=>console.log(JSON.stringify(event))});
  EXECUTOR_PROBE.start();
  // Do not start a signed command channel with an unprobed new Agent.
  await EXECUTOR_PROBE.check();
  if(EXECUTOR_PROBE.status().ready===null)await EXECUTOR_PROBE.check();
  const stop=()=>{if(stopped)return;EXECUTOR_PROBE.stop();NATIVE_PROCESSES.close();NATIVE_TERMINALS.close();stopped=true;if(wake)wake();if(fleetTimer){clearInterval(fleetTimer);fleetTimer=null;}fleetSupervisor.close().catch(()=>{});try{localWall?.server.close();}catch{}};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const wait=ms=>new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},ms);wake=()=>{clearTimeout(timer);wake=null;resolve();};});
  if(!fs.existsSync(LOCAL_WALL_AUTH_FILE))writeAccountOnlyWallAuthConfig(LOCAL_WALL_AUTH_FILE,{username:'account'});
  const wallAuth=loadLocalWallAuth(LOCAL_WALL_AUTH_FILE,{required:!['127.0.0.1','::1','localhost'].includes(String(LOCAL_WALL_HOST))});
  if(CONTINUITY_UI){
    const {continuityDefaultRoot}=await import('./project-continuity-store.mjs');
    const {isolatedContinuityEnabled}=await import('./project-continuity-client.mjs');
    if(!isolatedContinuityEnabled())
      provisionContinuityOwnerAuthority({root:continuityDefaultRoot(),signerDir:path.dirname(LOCAL_WALL_AUTH_FILE)});
  }
  localWall=startLocalWall({continuity:CONTINUITY_UI,host:LOCAL_WALL_HOST,port:LOCAL_WALL_PORT,brandSvgPath:LOCAL_WALL_BRAND,auth:wallAuth,getLocalStatus:async()=>({...statusView(),fleetWall:await localFleetStatus()}),getLocalPolicyStatus:async()=>statusView(),getPendingAccess:async()=>remoteAccessLookup(hub),getRemoteStatus:async()=>{const remote=await remoteDeviceStatus(hub);return remote;},getRemoteActivity:async limit=>remoteDeviceActivity(hub,limit),getLocalProcesses:async()=>((SUPERVISED_PROCESSES?await SUPERVISED_PROCESSES.listDevice(state.enrollment.accountId,state.enrollment.deviceId):NATIVE_PROCESSES.list())).map(p=>({
    processId:p.processId,sessionId:p.sessionId,pid:p.pid,state:p.state,
    startedAt:p.startedAt,finishedAt:p.finishedAt,exitCode:p.exitCode,
    stdoutBytes:p.stdoutBytes,stderrBytes:p.stderrBytes,stopRequested:p.stopRequested,
    stopForce:p.stopForce,treeStopMethod:p.treeStopMethod
  })),
  stopLocalProcess:async({processId,force})=>{
    const p=(SUPERVISED_PROCESSES?await SUPERVISED_PROCESSES.listDevice(state.enrollment.accountId,state.enrollment.deviceId):NATIVE_PROCESSES.list()).find(row=>row.processId===processId);
    if(!p||p.deviceId!==state.enrollment?.deviceId||p.accountId!==state.enrollment?.accountId)
      throw Object.assign(new Error('process_not_found'),{status:404});
    return (SUPERVISED_PROCESSES||NATIVE_PROCESSES).stop(processId,{accountId:p.accountId,deviceId:p.deviceId,
      sessionId:p.sessionId,agentId:p.agentId},{force:Boolean(force)});
  },
  getLocalTerminals:async()=>NATIVE_TERMINALS.list().map(t=>({terminalId:t.terminalId,sessionId:t.sessionId,state:t.state,shell:t.shell,startedAt:t.startedAt,finishedAt:t.finishedAt,outputBytes:t.outputBytes})),readLocalTerminal:async(terminalId,{offset=0,limit=32768}={})=>{const t=NATIVE_TERMINALS.output(terminalId,null,{offset,limit});return {terminalId:t.terminalId,sessionId:t.sessionId,state:t.state,output:t.output};},connect:async data=>connectCloud({hub,graceMinutes:data.graceMinutes,leaseHours:data.leaseHours,silent:true}),disconnect:async data=>disconnectCloud({hub,reason:data.reason||'local_wall_disconnect',silent:true}),setGrace:async data=>setConnectionGrace({hub,minutes:data.minutes,silent:true}),setPermissions:async data=>setLocalPermissions(data?.allowedCapabilities,data?.profile),setFilesystemRoots:async data=>setLocalFilesystemRoots(data),getFilesystemVolumes:async()=>filesystemVolumeInventory(),ownerApprovePermissions:async data=>ownerApproveServerPermissions(data,hub),rescanCapabilities:async()=>rescanHostCapabilities(hub),beginEnrollment:async()=>beginWallEnrollment(base),pollEnrollment:async()=>pollWallEnrollment(base),accountAuthenticate:async data=>authenticateWallAccount(data?.username,data?.password,base),pairingCode:async data=>rotatePairingCode(hub,data),ownerProofCode:async()=>accountOwnerProofCode(hub),accessApprove:async requestId=>approveDeviceAccess(requestId,hub),accessDeny:async(requestId,data)=>denyDeviceAccess(requestId,hub,data?.reason||'owner_denied'),closeSession:async data=>closeWallSession(hub,data),requestUpdate:async data=>requestLocalUpdate('local-wall',data?.mode||'apply')});
  console.log(JSON.stringify({event:'local_wall_started',url:localWall.url,deviceId:state.enrollment?.deviceId||null}));
  console.log(JSON.stringify({event:'device_agent_started',mode:'always-alive-service',platformAdapter:PLATFORM_ADAPTER.id,deviceId:state.enrollment?.deviceId||null,nodeId:state.enrollment?.nodeId||null,sessionCeiling,waitMs,dormantPollMs,localWallUrl:localWall.url}));
  acknowledgeCoreUpdateHealth();
  // Device-supported rights and installed-tool inventory are independent.
  // Refresh the signed grantable catalog after a daemon upgrade; never auto-approve
  // or locally enable new rights without the owner's explicit saved selection.
  if(state.enrollment?.deviceId&&!isTrustedHostState(state)){
    void rescanHostCapabilities(hub)
      .then(result=>console.log(JSON.stringify({event:'device_capability_catalog_synced',added:result.addedCapabilities?.length||0,removed:result.removedCapabilities?.length||0,policyRevision:result.policyRevision})))
      .catch(error=>console.error(JSON.stringify({event:'device_capability_catalog_sync_failed',code:String(error?.message||'unknown').slice(0,96)})));
  }
  const fleetReconcileMs=Math.max(500,Math.min(Number(process.env.OPERATOR_FLEET_RECONCILE_MS)||15000,300000));
  const reconcileFleet=async()=>{if(stopped||fleetReconciling)return;fleetReconciling=true;try{const current=readState();if(current)expireLocalHardLease(current);if(!current?.enrollment?.deviceId||!cloudDesired(current)||current.cloud?.state!=='connected'){await fleetSupervisor.stop('device_cloud_dormant');return;}await fleetSupervisor.reconcile();}catch(error){console.error(JSON.stringify({event:'fleet_component_reconcile_failed',error:error.message,status:error.status||null}));}finally{fleetReconciling=false;}};
  fleetTimer=setInterval(reconcileFleet,fleetReconcileMs);fleetTimer.unref?.();
  const workerReceiptTimer=setInterval(()=>void refreshProcessTerminalReceipts(readState()||state),5000);
  workerReceiptTimer.unref?.();
  await refreshProcessTerminalReceipts(state);
  while(!stopped){
    const latest=readState();if(latest)state=latest;
    if(state?.enrollment?.deviceId&&cloudLeaseRenewalDue(state)){
      try{await renewCloudLease(state,hub);const renewed=readState();if(renewed)state=renewed;failures=0;}
      catch(error){console.error(JSON.stringify({event:'device_connection_renew_failed',deviceId:state.enrollment.deviceId,error:error.message,status:error.status||null}));}
    }
    expireLocalHardLease(state);
    if(!state.enrollment?.deviceId||!cloudDesired(state)){await wait(dormantPollMs);continue;}
    try{
      await flushPendingUpdateReport(state,hub).catch(error=>console.error(JSON.stringify({event:'update_report_delivery_failed',error:error.message,status:error.status||null})));
      if(deviceDuplexStatus().ready){failures=0;await wait(500);continue;}
      const payload={nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION,sessionCeiling,draining:Boolean(state.routing?.draining),executorReady:executorReadiness(),capabilities:effectiveCapabilitiesForState(state),policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0),updateStatus:updateStatusView(),processTerminalReceipts:nextProcessTerminalReceipts(),resourceSample:DEVICE_RESOURCE_SAMPLER.sample(),waitMs};
      const response=await channelRequest(state,hub,'poll',payload);
      // A Local Wall connect/disconnect can update device.json while this long-poll is in flight.
      // Re-read before persisting the poll result so the daemon never clobbers newer lease metadata.
      const latestAfterPoll=readState();if(latestAfterPoll)state=latestAfterPoll;
      applyPolicyEnvelope(state,response.policy);await confirmTerminalReceiptsAck(state,response.terminalReceiptsAck);failures=0;
      state.cloud={...(state.cloud||{}),desiredConnected:true,state:'connected',lastServerActivityAt:Date.now(),lastError:null};writeState(state);
      void reconcileFleet();
      const command=response.channel?.command;
      if(command){
        const deviceReceivedAt=Date.now();
        let commandPulseTimer=null,commandPulseBusy=false;
        const commandPulse=async()=>{if(stopped||commandPulseBusy)return;commandPulseBusy=true;try{const current=readState()||state;if(!current?.enrollment?.deviceId||!cloudDesired(current))return;if(cloudLeaseRenewalDue(current))await renewCloudLease(current,hub);const pulseAck=await channelRequest(current,hub,'pulse',{nodeId:current.enrollment.nodeId||current.enrollment.deviceId,agentVersion:VERSION,sessionCeiling,draining:Boolean(current.routing?.draining),executorReady:executorReadiness(),capabilities:effectiveCapabilitiesForState(current),policyRevision:Math.max(0,Number(current.policy?.serverPolicyRevision)||0),updateStatus:updateStatusView(),processTerminalReceipts:nextProcessTerminalReceipts(),resourceSample:DEVICE_RESOURCE_SAMPLER.sample()});await confirmTerminalReceiptsAck(current,pulseAck.terminalReceiptsAck);}catch(error){console.error(JSON.stringify({event:'device_command_liveness_failed',deviceId:state.enrollment?.deviceId||null,commandId:command.commandId,error:error.message,status:error.status||null}));}finally{commandPulseBusy=false;}};
        await commandPulse();commandPulseTimer=setInterval(()=>void commandPulse(),commandHeartbeatMs);commandPulseTimer.unref?.();
        let result,claim;
        try{
          claim=await COMMAND_EXECUTIONS.run(command.commandId,'poll',()=>executeCommand(state,command,{hub}));result=claim.result;
          if(!claim.owner){console.log(JSON.stringify({event:'device_command_duplicate_suppressed',commandId:command.commandId,ownerTransport:claim.transport,duplicateTransport:'poll'}));continue;}
          const completedAt=Date.now();
          const reportedFirst=Number(result.telemetry?.firstOutputAt);
          result.telemetry={...(result.telemetry||{}),deviceReceivedAt,firstOutputAt:Number.isSafeInteger(reportedFirst)&&reportedFirst>0?reportedFirst:completedAt,completedAt};
          result=fitResultForDelivery(result);
          let delivered=false,resultFailures=0;
          while(!stopped&&!delivered){
            try{const ack=await channelRequest(state,hub,'result',result);delivered=Boolean(ack.accepted);resultFailures=0;}
            catch(error){
              if(['device_binding_not_found','device_not_found'].includes(error.message)){markDeviceRemoved(state,error.message);break;}if(['device_connection_required','device_connection_expired','device_revoked'].includes(error.message)){markCloudState(state,{desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastError:error.message,lastDisconnectedAt:Date.now()});break;}if(error.message==='command_not_found'){console.error(JSON.stringify({event:'device_result_orphaned',deviceId:state.enrollment.deviceId,commandId:command.commandId,reason:error.message,status:error.status||null}));delivered=true;break;}
              if(Number(error.status)===413){
                if(isCompacted413Result(result)){console.error(JSON.stringify({event:'device_result_delivery_abandoned_after_compaction',deviceId:state.enrollment.deviceId,commandId:command.commandId,error:error.message,status:413}));break;}
                const compacted=compactResultAfter413(result);console.error(JSON.stringify({event:'device_result_compacted_after_413',deviceId:state.enrollment.deviceId,commandId:command.commandId,originalBytes:compacted.deliveryOriginalBytes,status:413,preservedStatus:compacted.status,preservedExitCode:compacted.exitCode}));result=compacted;resultFailures=0;continue;
              }
              resultFailures++;const retryInMs=Math.min(Math.max(1000*(2**Math.min(resultFailures,5)),Number(error.retryAfterMs)||0),300000);console.error(JSON.stringify({event:'device_result_delivery_failed',deviceId:state.enrollment.deviceId,commandId:command.commandId,error:error.message,status:error.status||null,failures:resultFailures,retryInMs}));await wait(retryInMs);
            }
          }
        }finally{if(commandPulseTimer)clearInterval(commandPulseTimer);}
      }
    }catch(error){
      if(['device_binding_not_found','device_not_found'].includes(error.message)){const removedId=markDeviceRemoved(state,error.message);failures=0;try{await fleetSupervisor.stop('device_removed');}catch{}console.error(JSON.stringify({event:'device_removed_remote',deviceId:removedId,reason:error.message,status:error.status||null}));continue;}
      if(['device_connection_required','device_connection_expired','device_revoked'].includes(error.message)){
        failures=0;markCloudState(state,{desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastError:error.message,lastDisconnectedAt:Date.now()});
        console.error(JSON.stringify({event:'device_cloud_dormant',deviceId:state.enrollment.deviceId,reason:error.message,status:error.status||null}));
        continue;
      }
      failures++;const retryInMs=Math.min(Math.max(1000*(2**Math.min(failures,5)),Number(error.retryAfterMs)||0),300000);console.error(JSON.stringify({event:'device_channel_failed',deviceId:state.enrollment.deviceId,error:error.message,status:error.status||null,failures,retryInMs}));if(!stopped)await wait(retryInMs);
    }
  }
  clearInterval(workerReceiptTimer);PROCESS_TERMINAL_RECEIPTS=[];
  cancelDeviceDuplexIdleClose();if(DEVICE_DUPLEX){const duplex=DEVICE_DUPLEX;DEVICE_DUPLEX=null;try{await duplex.close('daemon_stop');}catch{}}
  try{await fleetSupervisor.close();}catch{}
  try{await localWall?.close();}catch{}
  if(Object.keys(state).length)writeState(state);console.log(JSON.stringify({event:'device_agent_stopped',deviceId:state.enrollment?.deviceId||null,nodeId:state.enrollment?.nodeId||null}));
}
async function wallOnly(args){
  const hub=args.hub||DEFAULT_HUB,base=args.base||DEFAULT_BASE,state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  if(!fs.existsSync(LOCAL_WALL_AUTH_FILE))writeAccountOnlyWallAuthConfig(LOCAL_WALL_AUTH_FILE,{username:'account'});
  const wallAuth=loadLocalWallAuth(LOCAL_WALL_AUTH_FILE,{required:!['127.0.0.1','::1','localhost'].includes(String(LOCAL_WALL_HOST))});
  if(CONTINUITY_UI){
    const {continuityDefaultRoot}=await import('./project-continuity-store.mjs');
    const {isolatedContinuityEnabled}=await import('./project-continuity-client.mjs');
    if(!isolatedContinuityEnabled())
      provisionContinuityOwnerAuthority({root:continuityDefaultRoot(),signerDir:path.dirname(LOCAL_WALL_AUTH_FILE)});
  }
  const fleetManager=new FleetComponentManager(),fleetSupervisor=new FleetComponentSupervisor({manager:fleetManager,stateProvider:()=>readState(),requestIntent:async current=>{const local=await localFleetStatus();const response=await channelRequest(current,hub,'fleet-intent',{agentVersion:VERSION,moduleVersion:fleetManager.current()?.version||null,fleetHealthy:local.healthy===true,fleetPort:local.port});return response.fleet;},env:{OPERATOR_AGENT_STATE:STATE_FILE,OPERATOR_AGENT_IDENTITY_FILE:EXTERNAL_IDENTITY_FILE,OPERATOR_AGENT_WALL_AUTH_FILE:LOCAL_WALL_AUTH_FILE,OPERATOR_AGENT_HUB_URL:hub,OPERATOR_FLEET_WALL_HOST:FLEET_WALL_HOST,OPERATOR_FLEET_WALL_PORT:String(FLEET_WALL_PORT),OPERATOR_FLEET_WALL_PUBLIC_URL:FLEET_WALL_PUBLIC_URL},emit:event=>console.log(JSON.stringify(event))});
  const localWall=startLocalWall({continuity:CONTINUITY_UI,host:LOCAL_WALL_HOST,port:LOCAL_WALL_PORT,brandSvgPath:LOCAL_WALL_BRAND,auth:wallAuth,getLocalStatus:async()=>({...statusView(),fleetWall:await localFleetStatus()}),getLocalPolicyStatus:async()=>statusView(),getPendingAccess:async()=>remoteAccessLookup(hub),getRemoteStatus:async()=>remoteDeviceStatus(hub),getRemoteActivity:async limit=>remoteDeviceActivity(hub,limit),getLocalTerminals:async()=>NATIVE_TERMINALS.list().map(t=>({terminalId:t.terminalId,sessionId:t.sessionId,state:t.state,shell:t.shell,startedAt:t.startedAt,finishedAt:t.finishedAt,outputBytes:t.outputBytes})),readLocalTerminal:async(terminalId,{offset=0,limit=32768}={})=>{const t=NATIVE_TERMINALS.output(terminalId,null,{offset,limit});return {terminalId:t.terminalId,sessionId:t.sessionId,state:t.state,output:t.output};},connect:async data=>connectCloud({hub,graceMinutes:data.graceMinutes,leaseHours:data.leaseHours,silent:true}),disconnect:async data=>disconnectCloud({hub,reason:data.reason||'local_wall_disconnect',silent:true}),setGrace:async data=>setConnectionGrace({hub,minutes:data.minutes,silent:true}),setPermissions:async data=>setLocalPermissions(data?.allowedCapabilities,data?.profile),setFilesystemRoots:async data=>setLocalFilesystemRoots(data),getFilesystemVolumes:async()=>filesystemVolumeInventory(),ownerApprovePermissions:async data=>ownerApproveServerPermissions(data,hub),rescanCapabilities:async()=>rescanHostCapabilities(hub),accountAuthenticate:async data=>authenticateWallAccount(data?.username,data?.password,base),pairingCode:async data=>rotatePairingCode(hub,data),ownerProofCode:async()=>accountOwnerProofCode(hub),accessApprove:async requestId=>approveDeviceAccess(requestId,hub),accessDeny:async(requestId,data)=>denyDeviceAccess(requestId,hub,data?.reason||'owner_denied'),closeSession:async data=>closeWallSession(hub,data),requestUpdate:async data=>requestLocalUpdate('local-wall',data?.mode||'apply')});
  console.log(JSON.stringify({event:'host_wall_companion_started',mode:'wall-only',url:localWall.url,deviceId:state.enrollment.deviceId,nodeId:state.enrollment.nodeId||state.enrollment.deviceId}));
  let stopping=false,resolveStop;const stopped=new Promise(resolve=>resolveStop=resolve);const stop=()=>{if(stopping)return;stopping=true;resolveStop();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  const reconcile=async()=>{if(stopping)return;try{await fleetSupervisor.reconcile();}catch(error){console.error(JSON.stringify({event:'fleet_component_reconcile_failed',error:error.message,status:error.status||null}));}};
  await reconcile();const timer=setInterval(reconcile,Math.max(1000,Math.min(Number(process.env.OPERATOR_FLEET_RECONCILE_MS)||15000,300000)));timer.unref?.();
  await stopped;clearInterval(timer);try{await fleetSupervisor.close();}catch{}try{await localWall.close();}catch{}console.log(JSON.stringify({event:'host_wall_companion_stopped',deviceId:state.enrollment.deviceId}));
}

async function setDrain(args,draining){const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');state.routing={...(state.routing||{}),draining:Boolean(draining),changedAt:Date.now()};writeState(state);const payload={nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION,sessionCeiling:Math.max(1,Math.min(Number(process.env.OPERATOR_AGENT_MAX_SESSIONS)||2,100)),draining:Boolean(draining),executorReady:executorReadiness(),capabilities:effectiveCapabilitiesForState(state),policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0),waitMs:0};const response=await channelRequest(state,args.hub||DEFAULT_HUB,'poll',payload);applyPolicyEnvelope(state,response.policy);console.log(JSON.stringify({ok:true,deviceId:state.enrollment.deviceId,nodeId:payload.nodeId,draining:Boolean(draining),channelState:response.channel?.node?.state||null},null,2));}
async function status(){console.log(JSON.stringify({...statusView(),executorProbe:EXECUTOR_PROBE.status(),fleetWall:await localFleetStatus()},null,2));}
async function initWallAuth(args){const password=fs.readFileSync(0,'utf8').replace(/[\r\n]+$/,'');if(password.length<12)throw new Error('local_wall_password_too_short');const result=writeLocalWallAuthConfig(LOCAL_WALL_AUTH_FILE,{username:args.username||'operator',password});console.log(JSON.stringify({ok:true,wallAuth:'configured',file:result.file,username:result.username,passwordEchoed:false},null,2));}
const args=parseArgs(process.argv.slice(2)),command=args._[0]||'status';
try{if(command==='login')await login(args);else if(command==='poll'){const state=readState();if(!state)throw new Error('no_device_state');console.log(JSON.stringify(await finishEnrollment(state,args.base||DEFAULT_BASE,{wait:false}),null,2));}else if(command==='heartbeat'){const state=readState();if(!state)throw new Error('no_device_state');console.log(JSON.stringify(await heartbeat(state,args.base||DEFAULT_BASE),null,2));}else if(command==='daemon')await daemon(args);else if(command==='wall-only')await wallOnly(args);else if(command==='connect')await connectCloud(args);else if(command==='disconnect')await disconnectCloud(args);else if(command==='set-grace')await setConnectionGrace(args);else if(command==='drain')await setDrain(args,true);else if(command==='undrain')await setDrain(args,false);else if(command==='status')await status();else if(command==='wall-auth-init')await initWallAuth(args);else throw new Error(`unknown_command:${command}`);}catch(error){console.error(JSON.stringify({ok:false,error:error.message,status:error.status||null},null,2));process.exitCode=1;}
