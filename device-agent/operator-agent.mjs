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
import { loadLocalWallAuth, writeLocalWallAuthConfig, writeAccountOnlyWallAuthConfig } from './local-wall-auth.mjs';
import { FleetComponentManager } from './fleet-component-manager.mjs';
import { FleetComponentSupervisor } from './fleet-component-supervisor.mjs';
import { executeNativeFs, filesystemPolicy } from '../lib/native-fs.mjs';
import { NativeProcessRegistry } from '../lib/native-process.mjs';
import { NativeSearchRegistry } from '../lib/native-search.mjs';
import { LightScpRegistry } from '../lib/light-scp-registry.mjs';
import { normalizeUpdateReport, normalizeUpdateStatus } from '../lib/update-contract.mjs';
import { runtimeVersion } from '../lib/runtime-version.mjs';

const VERSION=runtimeVersion({envNames:['LIGHT_REMOTE_VERSION','OPERATOR_AGENT_VERSION']});
const PLATFORM_ADAPTER=createPlatformAdapter();
const NATIVE_PROCESSES=new NativeProcessRegistry();
const NATIVE_SEARCHES=new NativeSearchRegistry();
const LIGHT_SCP=new LightScpRegistry();
const DEFAULT_BASE=process.env.OPERATOR_AGENT_BASE_URL || 'https://light-remote-mcp.vercel.app';
const DEFAULT_HUB=process.env.OPERATOR_AGENT_HUB_URL || 'https://mcp.dashboard.thaiduy.store';
const STATE_FILE=process.env.OPERATOR_AGENT_STATE || path.join(os.homedir(),'.config','gpt-operator-agent','device.json');
const EXTERNAL_IDENTITY_FILE=String(process.env.OPERATOR_AGENT_IDENTITY_FILE||'').trim();
const COMMAND_DIR=process.env.OPERATOR_AGENT_COMMAND_DIR || path.join(path.dirname(STATE_FILE),'commands');
const LOCAL_WALL_HOST=process.env.OPERATOR_AGENT_WALL_HOST || '127.0.0.1';
const LOCAL_WALL_PORT=Math.max(1024,Math.min(Number(process.env.OPERATOR_AGENT_WALL_PORT)||5491,65535));
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
function parseArgs(argv){const out={_:[]};for(let i=0;i<argv.length;i++){const v=argv[i];if(!v.startsWith('--'))out._.push(v);else{const k=v.slice(2);if(['no-wait','reenroll'].includes(k))out[k]=true;else out[k]=argv[++i];}}return out;}
function readState(){try{return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}catch{return null;}}
function writeJson0600(file,value){const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,file);}
function writeState(state){writeJson0600(STATE_FILE,state);}
function readJsonFile(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function updateStatusView(){const status=normalizeUpdateStatus(readJsonFile(UPDATE_STATUS_FILE)||{}),report=readJsonFile(UPDATE_REPORT_FILE);return {...status,pendingReport:report?{outcome:String(report.outcome||''),code:String(report.code||'')||null,targetVersion:String(report.targetVersion||'')||null,at:Number(report.at)||null}:null};}
function acknowledgeCoreUpdateHealth(){const tx=readJsonFile(UPDATE_TRANSACTION_FILE);if(!tx||String(tx.targetVersion||'')!==VERSION||!/^ut_[A-Za-z0-9_-]{12,80}$/.test(String(tx.txId||'')))return false;writeJson0600(UPDATE_ACK_FILE,{schemaVersion:1,txId:tx.txId,version:VERSION,healthy:true,pid:process.pid,at:Date.now()});return true;}
async function requestLocalUpdate(source='local-wall',mode='apply'){const action=mode==='check'?'check':'apply';if(process.platform==='win32'){const updater=path.join(process.env.LOCALAPPDATA||os.homedir(),'Light Remote','Updater','LightRemote.Updater.exe'),installRoot=fileURLToPath(new URL('../../',import.meta.url));if(!fs.existsSync(updater))throw new Error('independent_updater_missing');const args=[action==='check'?'--check-update':'--apply-update-now','--install-dir',installRoot],child=spawn(updater,args,{windowsHide:true,detached:true,stdio:'ignore'});child.unref();return {accepted:true,source,mode:action,transport:'independent-updater',requestedAt:Date.now()};}const target=action==='check'?UPDATE_CHECK_REQUEST_FILE:UPDATE_REQUEST_FILE;writeJson0600(target,{schemaVersion:1,requestId:`uq_${crypto.randomBytes(12).toString('base64url')}`,source:String(source||'local-wall').slice(0,40),mode:action,currentVersion:VERSION,requestedAt:Date.now()});return {accepted:true,source,mode:action,transport:'helper-trigger',requestedAt:Date.now()};}
async function flushPendingUpdateReport(state,hub){const raw=readJsonFile(UPDATE_REPORT_FILE);if(!raw)return null;const report=normalizeUpdateReport(raw);const response=await channelRequest(state,hub,'update-report',{...report,nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION});try{fs.rmSync(UPDATE_REPORT_FILE,{force:true});}catch{}return response;}
let externalIdentityCache=null;
function externalIdentity(){if(!EXTERNAL_IDENTITY_FILE)return null;if(externalIdentityCache)return externalIdentityCache;const row=JSON.parse(fs.readFileSync(EXTERNAL_IDENTITY_FILE,'utf8')),privateKey=crypto.createPrivateKey({key:Buffer.from(row.privateKey,'base64'),format:'der',type:'pkcs8'}),publicKey=crypto.createPublicKey({key:Buffer.from(row.publicKey||row.publicIdentityKey,'base64'),format:'der',type:'spki'});if(privateKey.asymmetricKeyType!=='ed25519'||publicKey.asymmetricKeyType!=='ed25519')throw new Error('invalid_external_device_identity');const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');externalIdentityCache={privateKey,publicIdentityKey,publicKeySha256:sha256(Buffer.from(publicIdentityKey,'base64')),createdAt:Number(row.createdAt)||Date.now()};return externalIdentityCache;}
function ensureIdentity(state={}){if(state.identity?.publicIdentityKey&&(state.identity?.privateKey||EXTERNAL_IDENTITY_FILE))return state;const external=externalIdentity();if(external)return {...state,identity:{algorithm:'Ed25519',publicIdentityKey:external.publicIdentityKey,publicKeySha256:external.publicKeySha256,createdAt:external.createdAt}};const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');return {...state,identity:{algorithm:'Ed25519',privateKey:privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),publicIdentityKey,publicKeySha256:sha256(Buffer.from(publicIdentityKey,'base64')),createdAt:Date.now()}};}
function discoverCapabilities(){return PLATFORM_ADAPTER.discoverCapabilities();}
function effectiveCapabilities(approved,denied){const deny=new Set(denied||[]);return (approved||[]).filter(x=>!deny.has(x)).sort();}
function responseRetryAfterMs(response,json){const header=String(response.headers?.get?.('retry-after')||'').trim(),bodySeconds=Number(json?.retryAfterSeconds);let value=Number.isFinite(bodySeconds)&&bodySeconds>0?bodySeconds*1000:0;if(/^\d+$/.test(header))value=Math.max(value,Number(header)*1000);else if(header){const at=Date.parse(header);if(Number.isFinite(at))value=Math.max(value,at-Date.now());}return Math.max(0,Math.min(value,5*60*1000));}
async function parseResponse(response){const text=await response.text();let json;try{json=JSON.parse(text)}catch{json={raw:text}}if(!response.ok||!json.ok){const e=new Error(json.error||json.upstream?.error||`http_${response.status}`);e.status=response.status;e.payload=json;e.retryAfterMs=responseRetryAfterMs(response,json);throw e;}return json;}
async function operator(base,action,payload){const response=await fetch(`${base.replace(/\/$/,'')}/api/operator`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(15000)});return (await parseResponse(response)).upstream;}
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
async function heartbeat(state,base,{persist=true}={}){if(!state.enrollment?.deviceId)throw new Error('device_not_enrolled');const capabilities=effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities);const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');const message=deviceHeartbeatMessage({deviceId:state.enrollment.deviceId,timestamp,nonce,capabilities});const signature=crypto.sign(null,Buffer.from(message),privateKey(state)).toString('base64url');const upstream=await operator(base,'device-heartbeat',{deviceId:state.enrollment.deviceId,timestamp,nonce,capabilities,signature,policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0)});applyPolicyEnvelope(state,upstream.policy);state.lastHeartbeatAt=Date.now();state.effectiveCapabilities=effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities);if(persist)writeState(state);return upstream.device;}
async function channelRequest(state,hubBase,action,payload){if(!state.enrollment?.deviceId)throw new Error('device_not_enrolled');const deviceId=state.enrollment.deviceId,timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');const signature=crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,action,timestamp,nonce,payload})),privateKey(state)).toString('base64url');const response=await fetch(`${hubBase.replace(/\/$/,'')}/device-channel/${action}`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({deviceId,timestamp,nonce,signature,payload}),signal:AbortSignal.timeout(action==='poll'?25000:15000)});return parseResponse(response);}
async function finishEnrollment(state,base,{wait=false}={}){const pending=state.pendingEnrollment;if(!pending?.enrollmentId||!pending?.pollToken)throw new Error('no_pending_enrollment');do{const upstream=await operator(base,'enrollment-poll',{enrollmentId:pending.enrollmentId,pollToken:pending.pollToken});const e=upstream.enrollment;if(e.state==='approved'){verifyEnrollment(state,e);state.enrollment={enrollmentId:e.enrollmentId,deviceId:e.deviceId,nodeId:e.deviceId,accountId:e.accountId,grantableCapabilities:[...(pending.requestedCapabilities||e.approvedCapabilities||[])],approvedCapabilities:e.approvedCapabilities,policyProfile:e.policyProfile,certificate:e.certificate,certificateSignature:e.certificateSignature,signer:e.signer,enrolledAt:Date.now()};state.policy={...(state.policy||{}),serverPolicyRevision:1,localFinalDenyBoundary:true};state.effectiveCapabilities=effectiveCapabilities(e.approvedCapabilities,state.policy?.deniedCapabilities);state.cloud={...(state.cloud||{}),desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastError:null,lastDisconnectedAt:Date.now()};delete state.pendingEnrollment;writeState(state);const device=await heartbeat(state,base);return {state:'approved',device,effectiveCapabilities:[...(state.effectiveCapabilities||[])]};}if(e.state==='expired'||e.state==='replaced'||e.state==='cancelled'){delete state.pendingEnrollment;writeState(state);return {state:e.state};}if(!wait)return {state:e.state,expiresAt:e.expiresAt};if(Date.now()>=pending.expiresAt){delete state.pendingEnrollment;writeState(state);return {state:'expired'};}await sleep(3000);}while(true);}
async function beginWallEnrollment(base=DEFAULT_BASE){let state=readState()||{};if(state.identityResetRequired)throw new Error('external_identity_rotation_required');state=ensureIdentity(state);const discovered=discoverCapabilities();if(!discovered.length)throw new Error('device_capabilities_required');const denied=normalizeDeviceCapabilities(state.policy?.deniedCapabilities||[]).filter(cap=>discovered.includes(cap));const hostname=os.hostname(),hadEnrollment=Boolean(state.enrollment?.deviceId),revoked=String(state.cloud?.lastError||'')==='device_revoked';const policyProfile=String(state.enrollment?.policyProfile||state.pendingEnrollment?.requestedPolicy||'default');const upstream=await operator(base,'enrollment-begin',{publicIdentityKey:state.identity.publicIdentityKey,displayName:hostname,platform:os.platform(),architecture:os.arch(),agentVersion:VERSION,fingerprintSummary:`${hostname} / ${os.platform()} ${os.arch()} / key ${state.identity.publicKeySha256.slice(0,12)}`,capabilities:discovered,policyProfile});const e=upstream.enrollment;state.policy={...(state.policy||{}),deniedCapabilities:denied,localFinalDenyBoundary:true};state.pendingEnrollment={enrollmentId:e.enrollmentId,pollToken:e.pollToken,activationUrl:e.activationUrl,expiresAt:e.expiresAt,requestedCapabilities:e.requestedCapabilities||discovered,requestedPolicy:e.requestedPolicy||policyProfile};writeState(state);return {state:'pending',mode:hadEnrollment||revoked?'reenroll':'link',deviceCode:e.deviceCode,activationUrl:e.activationUrl,expiresAt:e.expiresAt,expiresInSeconds:e.expiresInSeconds,deniedCapabilities:[...denied]};}
async function pollWallEnrollment(base=DEFAULT_BASE){const state=readState();if(!state?.pendingEnrollment?.enrollmentId)throw new Error('no_pending_enrollment');return finishEnrollment(state,base,{wait:false});}
async function login(args){const base=args.base||DEFAULT_BASE;let state=ensureIdentity(readState()||{});if(state.enrollment?.deviceId&&!args.reenroll){const device=await heartbeat(state,base);console.log(JSON.stringify({ok:true,alreadyEnrolled:true,deviceId:state.enrollment.deviceId,nodeId:state.enrollment.nodeId||state.enrollment.deviceId,state:device.state,effectiveCapabilities:state.effectiveCapabilities},null,2));return;}const discovered=discoverCapabilities();if(!discovered.length)throw new Error('device_capabilities_required');const denied=args.deny==null&&args.reenroll?normalizeDeviceCapabilities(state.policy?.deniedCapabilities||[]).filter(cap=>discovered.includes(cap)):normalizeDeviceCapabilities(String(args.deny||'').split(',').map(x=>x.trim()).filter(Boolean)).filter(cap=>discovered.includes(cap));state.policy={...(state.policy||{}),deniedCapabilities:denied,localFinalDenyBoundary:true};const hostname=os.hostname(),policyProfile=String(args.policy||state.enrollment?.policyProfile||state.pendingEnrollment?.requestedPolicy||'default');const upstream=await operator(base,'enrollment-begin',{publicIdentityKey:state.identity.publicIdentityKey,displayName:args.name||hostname,platform:os.platform(),architecture:os.arch(),agentVersion:VERSION,fingerprintSummary:`${hostname} / ${os.platform()} ${os.arch()} / key ${state.identity.publicKeySha256.slice(0,12)}`,capabilities:discovered,policyProfile});const e=upstream.enrollment;state.pendingEnrollment={enrollmentId:e.enrollmentId,pollToken:e.pollToken,activationUrl:e.activationUrl,expiresAt:e.expiresAt,requestedCapabilities:e.requestedCapabilities||discovered,requestedPolicy:e.requestedPolicy||policyProfile};writeState(state);console.log(`Activation URL: ${e.activationUrl}`);console.log(`Device code: ${e.deviceCode}`);console.log(`Expires in: ${e.expiresInSeconds}s`);if(args['no-wait'])return;console.log('Waiting for approval…');const result=await finishEnrollment(state,base,{wait:true});console.log(JSON.stringify({ok:result.state==='approved',enrollment:result.state,deviceId:state.enrollment?.deviceId||null,nodeId:state.enrollment?.nodeId||null,state:result.device?.state||null,effectiveCapabilities:state.effectiveCapabilities||[]},null,2));}
function commandFile(commandId){if(!/^cmd_[A-Za-z0-9-]{20,}$/.test(String(commandId||'')))throw new Error('invalid_command_id');return path.join(COMMAND_DIR,`${commandId}.json`);}
function readCommand(commandId){try{return JSON.parse(fs.readFileSync(commandFile(commandId),'utf8'));}catch{return null;}}
function writeCommand(commandId,value){fs.mkdirSync(COMMAND_DIR,{recursive:true,mode:0o700});writeJson0600(commandFile(commandId),value);}
function pruneCommandSpool(){fs.mkdirSync(COMMAND_DIR,{recursive:true,mode:0o700});const rows=fs.readdirSync(COMMAND_DIR).filter(name=>/^cmd_[A-Za-z0-9-]{20,}\.json$/.test(name)).map(name=>({name,stat:fs.statSync(path.join(COMMAND_DIR,name))})).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);const cutoff=Date.now()-24*60*60*1000;for(let i=0;i<rows.length;i++)if(i>=100||rows[i].stat.mtimeMs<cutoff)fs.rmSync(path.join(COMMAND_DIR,rows[i].name),{force:true});}
function boundedCollector(limit=MAX_OUTPUT){let size=0,chunks=[],truncated=false;return{add(data){const buf=Buffer.from(data);if(size>=limit){truncated=true;return;}const take=buf.subarray(0,Math.max(0,limit-size));chunks.push(take);size+=take.length;if(take.length<buf.length)truncated=true;},text(){return Buffer.concat(chunks).toString('utf8');},truncated(){return truncated;}};}
async function executeProcessCommand(state,p){
  const request=p.process&&typeof p.process==='object'&&!Array.isArray(p.process)?p.process:{};
  const op=String(request.op||'');
  const owner={accountId:state.enrollment.accountId,deviceId:state.enrollment.deviceId,sessionId:String(p.sessionId||''),agentId:String(p.agentId||'')};
  const effective=effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities);
  if(op==='start'){
    const script=String(request.script||'');if(!script.trim())throw new Error('process_script_required');
    const required=[...new Set([...(Array.isArray(request.requiredCapabilities)?request.requiredCapabilities:[]),...PLATFORM_ADAPTER.inferRequiredCapabilities(script)])].sort();
    const policyDeny=PLATFORM_ADAPTER.hardDeny?.(script)||null;if(policyDeny)throw new Error(`local platform policy denied: ${policyDeny}`);
    const missing=required.filter(cap=>!effective.includes(cap));if(missing.length)throw new Error(`local capability denied: ${missing.join(',')}`);
    const cwd=String(request.cwd||os.homedir());let stat;try{stat=fs.statSync(cwd);}catch{}if(!stat?.isDirectory())throw new Error('cwd_not_directory');
    return {ok:true,operation:'start',process:NATIVE_PROCESSES.start({...owner,script,cwd,timeoutMs:request.timeoutMs,spawnSpec:value=>PLATFORM_ADAPTER.commandFor(value),env:{GPT_OPERATOR_ACCOUNT:owner.accountId,GPT_OPERATOR_DEVICE:owner.deviceId,GPT_OPERATOR_NODE:state.enrollment.nodeId||owner.deviceId,GPT_OPERATOR_SESSION:owner.sessionId}})};
  }
  if(!effective.includes('filesystem'))throw new Error('local capability denied: filesystem');
  if(op==='input')return {ok:true,operation:'input',process:NATIVE_PROCESSES.input(request.processId,owner,{data:request.data,eof:Boolean(request.eof)})};
  if(op==='output')return {ok:true,operation:'output',...NATIVE_PROCESSES.output(request.processId,owner,{stream:request.stream,offset:request.offset,limit:request.limit})};
  if(op==='stop')return {ok:true,operation:'stop',process:NATIVE_PROCESSES.stop(request.processId,owner,{force:Boolean(request.force)})};
  if(op==='list')return {ok:true,operation:'list',processes:NATIVE_PROCESSES.list(owner)};
  throw new Error('process_operation_unsupported');
}

async function executeSearchCommand(state,p){
  const request=p.search&&typeof p.search==='object'&&!Array.isArray(p.search)?p.search:{};
  const op=String(request.op||''),owner={accountId:state.enrollment.accountId,deviceId:state.enrollment.deviceId,sessionId:String(p.sessionId||''),agentId:String(p.agentId||'')};
  const effective=effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities);if(!effective.includes('filesystem'))throw new Error('local capability denied: filesystem');
  if(op==='start'){const policy=filesystemPolicy();return {ok:true,operation:'start',search:await NATIVE_SEARCHES.start({...owner,path:request.path,searchType:request.searchType,pattern:request.pattern,literalSearch:Boolean(request.literalSearch),ignoreCase:request.ignoreCase!==false,filePattern:request.filePattern,contextLines:request.contextLines,maxResults:request.maxResults,readRoots:policy.readRoots})};}
  if(op==='results')return {ok:true,operation:'results',...NATIVE_SEARCHES.results(request.searchId,owner,{offset:request.offset,limit:request.limit})};
  if(op==='cancel')return {ok:true,operation:'cancel',search:NATIVE_SEARCHES.cancel(request.searchId,owner)};
  throw new Error('search_operation_unsupported');
}

async function executeScpCommand(state,p){
  const request=p.scp&&typeof p.scp==='object'&&!Array.isArray(p.scp)?p.scp:{};
  const op=String(request.op||''),owner={accountId:state.enrollment.accountId,deviceId:state.enrollment.deviceId,sessionId:String(p.sessionId||''),agentId:String(p.agentId||'')};
  const effective=effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities);
  if(!effective.includes('filesystem'))throw new Error('local capability denied: filesystem');
  if(op==='upload-begin')return {ok:true,operation:op,transfer:await LIGHT_SCP.beginUpload(owner,request)};
  if(op==='upload-chunk')return {ok:true,operation:op,transfer:await LIGHT_SCP.putUploadChunk(owner,request.transferId,request)};
  if(op==='upload-commit')return {ok:true,operation:op,result:await LIGHT_SCP.commitUpload(owner,request.transferId)};
  if(op==='download-begin')return {ok:true,operation:op,transfer:await LIGHT_SCP.beginDownload(owner,request)};
  if(op==='download-chunk')return {ok:true,operation:op,chunk:await LIGHT_SCP.readDownloadChunk(owner,request.transferId,request)};
  if(op==='status')return {ok:true,operation:op,transfer:await LIGHT_SCP.status(owner,request.transferId)};
  if(op==='cancel')return {ok:true,operation:op,result:await LIGHT_SCP.cancel(owner,request.transferId)};
  throw new Error('scp_operation_unsupported');
}

async function executeCommand(state,command){
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
  if(p.type==='search'){
    const startedAt=Date.now();writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'running',startedAt});
    try{const data=await executeSearchCommand(state,p);const result={commandId:command.commandId,status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:Date.now()-startedAt,data};writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;}
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
    const effective=effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities);
    const startedAt=Date.now();
    if(!effective.includes('filesystem')){
      const result={commandId:command.commandId,status:'error',exitCode:126,stdout:'',stderr:'local capability denied: filesystem\n',durationMs:0};
      writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});return result;
    }
    writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'running',startedAt});
    try{
      const data=await executeNativeFs(p.fs||{}, {policy:filesystemPolicy()});
      const result={commandId:command.commandId,status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:Date.now()-startedAt,data};
      writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;
    }catch(error){
      const result={commandId:command.commandId,status:'error',exitCode:1,stdout:'',stderr:String(error?.message||error)+'\n',durationMs:Date.now()-startedAt,data:{ok:false,error:String(error?.message||error),status:Number(error?.status)||500}};
      writeCommand(command.commandId,{commandId:command.commandId,operationId:p.operationId,state:'finished',startedAt,finishedAt:Date.now(),result});pruneCommandSpool();return result;
    }
  }
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
async function authenticateWallAccount(email,password,hub=DEFAULT_HUB){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const response=await channelRequest(state,hub,'account-auth',{email:String(email||''),password:String(password||'')});
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
function setLocalPermissions(allowedCapabilities,profile='custom'){
  const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  const grantable=normalizeDeviceCapabilities(state.enrollment.grantableCapabilities||state.enrollment.approvedCapabilities||[]);
  const allowed=normalizeDeviceCapabilities(Array.isArray(allowedCapabilities)?allowedCapabilities:[]);
  if(allowed.some(cap=>!grantable.includes(cap)))throw new Error('local_permission_not_grantable');
  const localProfile=/^(safe|developer|full|custom)$/.test(String(profile||''))?String(profile):'custom';
  const denied=grantable.filter(cap=>!allowed.includes(cap));
  state.policy={...(state.policy||{}),deniedCapabilities:denied,localProfile,localFinalDenyBoundary:true,localPolicyUpdatedAt:Date.now()};
  state.effectiveCapabilities=effectiveCapabilities(state.enrollment.approvedCapabilities,denied);
  writeState(state);
  return {profile:localProfile,grantableCapabilities:grantable,serverApprovedCapabilities:[...(state.enrollment.approvedCapabilities||[])],localAllowedCapabilities:allowed,deniedCapabilities:denied,effectiveCapabilities:[...state.effectiveCapabilities],updatedAt:state.policy.localPolicyUpdatedAt};
}
function statusView(state=readState()){
  if(state)expireLocalHardLease(state);
  if(!state)return {ok:true,version:VERSION,platformAdapter:PLATFORM_ADAPTER.id,enrolled:false,deviceId:null,deviceName:os.hostname(),accountId:null,cloudDesiredConnected:false,cloudState:'dormant',connectionId:null,hardExpiresAt:null,reconnectGraceMs:null,connectionPlan:null,stateFile:STATE_FILE,localWallUrl:`http://${LOCAL_WALL_HOST}:${LOCAL_WALL_PORT}/`,update:updateStatusView()};
  return {ok:true,version:VERSION,platformAdapter:PLATFORM_ADAPTER.id,enrolled:Boolean(state.enrollment?.deviceId),deviceId:state.enrollment?.deviceId||null,deviceName:state.enrollment?.displayName||os.hostname(),nodeId:state.enrollment?.nodeId||state.enrollment?.deviceId||null,accountId:state.enrollment?.accountId||null,pendingEnrollmentId:state.pendingEnrollment?.enrollmentId||null,publicKeySha256:state.identity?.publicKeySha256||null,policyProfile:state.enrollment?.policyProfile||state.pendingEnrollment?.requestedPolicy||null,localPolicyProfile:state.policy?.localProfile||((state.policy?.deniedCapabilities||[]).length?'custom':'full'),policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0),grantableCapabilities:state.enrollment?.grantableCapabilities||state.enrollment?.approvedCapabilities||[],approvedCapabilities:state.enrollment?.approvedCapabilities||[],deniedCapabilities:state.policy?.deniedCapabilities||[],effectiveCapabilities:state.effectiveCapabilities||[],draining:Boolean(state.routing?.draining),cloudDesiredConnected:cloudDesired(state),cloudState:state.cloud?.state||(cloudDesired(state)?'legacy-connected':'dormant'),connectionId:state.cloud?.connectionId||null,hardExpiresAt:state.cloud?.hardExpiresAt||null,reconnectGraceMs:state.cloud?.reconnectGraceMs||null,connectionPlan:state.cloud?.plan||null,lastCloudError:state.cloud?.lastError||null,lastHeartbeatAt:state.lastHeartbeatAt||null,stateFile:STATE_FILE,commandDir:COMMAND_DIR,localWallUrl:`http://${LOCAL_WALL_HOST}:${LOCAL_WALL_PORT}/`,privateKeyStoredLocally:Boolean(state.identity?.privateKey),update:updateStatusView()};
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
  let stopped=false,wake=null,failures=0,localWall=null,fleetTimer=null,fleetReconciling=false;
  const fleetManager=new FleetComponentManager(),fleetSupervisor=new FleetComponentSupervisor({manager:fleetManager,stateProvider:()=>readState(),requestIntent:async current=>{const local=await localFleetStatus();const response=await channelRequest(current,hub,'fleet-intent',{agentVersion:VERSION,moduleVersion:fleetManager.current()?.version||null,fleetHealthy:local.healthy===true,fleetPort:local.port});return response.fleet;},env:{OPERATOR_AGENT_STATE:STATE_FILE,OPERATOR_AGENT_IDENTITY_FILE:EXTERNAL_IDENTITY_FILE,OPERATOR_AGENT_WALL_AUTH_FILE:LOCAL_WALL_AUTH_FILE,OPERATOR_AGENT_HUB_URL:hub,OPERATOR_FLEET_WALL_HOST:FLEET_WALL_HOST,OPERATOR_FLEET_WALL_PORT:String(FLEET_WALL_PORT),OPERATOR_FLEET_WALL_PUBLIC_URL:FLEET_WALL_PUBLIC_URL},emit:event=>console.log(JSON.stringify(event))});
  const stop=()=>{stopped=true;if(wake)wake();if(fleetTimer){clearInterval(fleetTimer);fleetTimer=null;}fleetSupervisor.close().catch(()=>{});try{localWall?.server.close();}catch{}};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const wait=ms=>new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},ms);wake=()=>{clearTimeout(timer);wake=null;resolve();};});
  if(state.enrollment?.deviceId&&!fs.existsSync(LOCAL_WALL_AUTH_FILE))writeAccountOnlyWallAuthConfig(LOCAL_WALL_AUTH_FILE,{username:'account'});
  const wallAuth=loadLocalWallAuth(LOCAL_WALL_AUTH_FILE,{required:!['127.0.0.1','::1','localhost'].includes(String(LOCAL_WALL_HOST))});
  localWall=startLocalWall({host:LOCAL_WALL_HOST,port:LOCAL_WALL_PORT,brandSvgPath:LOCAL_WALL_BRAND,auth:wallAuth,getLocalStatus:async()=>({...statusView(),fleetWall:await localFleetStatus()}),getRemoteStatus:async()=>{const remote=await remoteDeviceStatus(hub);return remote;},getRemoteActivity:async limit=>remoteDeviceActivity(hub,limit),connect:async data=>connectCloud({hub,graceMinutes:data.graceMinutes,leaseHours:data.leaseHours,silent:true}),disconnect:async data=>disconnectCloud({hub,reason:data.reason||'local_wall_disconnect',silent:true}),setGrace:async data=>setConnectionGrace({hub,minutes:data.minutes,silent:true}),setPermissions:async data=>setLocalPermissions(data?.allowedCapabilities,data?.profile),beginEnrollment:async()=>beginWallEnrollment(base),pollEnrollment:async()=>pollWallEnrollment(base),accountAuthenticate:async data=>authenticateWallAccount(data?.username,data?.password,hub),pairingCode:async data=>rotatePairingCode(hub,data),ownerProofCode:async()=>accountOwnerProofCode(hub),accessApprove:async requestId=>approveDeviceAccess(requestId,hub),accessDeny:async(requestId,data)=>denyDeviceAccess(requestId,hub,data?.reason||'owner_denied'),requestUpdate:async data=>requestLocalUpdate('local-wall',data?.mode||'apply')});
  console.log(JSON.stringify({event:'local_wall_started',url:localWall.url,deviceId:state.enrollment?.deviceId||null}));
  console.log(JSON.stringify({event:'device_agent_started',mode:'always-alive-service',platformAdapter:PLATFORM_ADAPTER.id,deviceId:state.enrollment?.deviceId||null,nodeId:state.enrollment?.nodeId||null,sessionCeiling,waitMs,dormantPollMs,localWallUrl:localWall.url}));
  acknowledgeCoreUpdateHealth();
  const fleetReconcileMs=Math.max(500,Math.min(Number(process.env.OPERATOR_FLEET_RECONCILE_MS)||15000,300000));
  const reconcileFleet=async()=>{if(stopped||fleetReconciling)return;fleetReconciling=true;try{const current=readState();if(current)expireLocalHardLease(current);if(!current?.enrollment?.deviceId||!cloudDesired(current)||current.cloud?.state!=='connected'){await fleetSupervisor.stop('device_cloud_dormant');return;}await fleetSupervisor.reconcile();}catch(error){console.error(JSON.stringify({event:'fleet_component_reconcile_failed',error:error.message,status:error.status||null}));}finally{fleetReconciling=false;}};
  fleetTimer=setInterval(reconcileFleet,fleetReconcileMs);fleetTimer.unref?.();
  while(!stopped){
    const latest=readState();if(latest)state=latest;
    expireLocalHardLease(state);
    if(!state.enrollment?.deviceId||!cloudDesired(state)){await wait(dormantPollMs);continue;}
    try{
      await flushPendingUpdateReport(state,hub).catch(error=>console.error(JSON.stringify({event:'update_report_delivery_failed',error:error.message,status:error.status||null})));
      const payload={nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION,sessionCeiling,draining:Boolean(state.routing?.draining),capabilities:effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities),policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0),updateStatus:updateStatusView(),waitMs};
      const response=await channelRequest(state,hub,'poll',payload);
      // A Local Wall connect/disconnect can update device.json while this long-poll is in flight.
      // Re-read before persisting the poll result so the daemon never clobbers newer lease metadata.
      const latestAfterPoll=readState();if(latestAfterPoll)state=latestAfterPoll;
      applyPolicyEnvelope(state,response.policy);failures=0;
      state.cloud={...(state.cloud||{}),desiredConnected:true,state:'connected',lastServerActivityAt:Date.now(),lastError:null};writeState(state);
      void reconcileFleet();
      const command=response.channel?.command;
      if(command){
        const deviceReceivedAt=Date.now();
        const result=await executeCommand(state,command),completedAt=Date.now();
        const reportedFirst=Number(result.telemetry?.firstOutputAt);
        result.telemetry={...(result.telemetry||{}),deviceReceivedAt,firstOutputAt:Number.isSafeInteger(reportedFirst)&&reportedFirst>0?reportedFirst:completedAt,completedAt};
        let delivered=false,resultFailures=0;
        while(!stopped&&!delivered){
          try{const ack=await channelRequest(state,hub,'result',result);delivered=Boolean(ack.accepted);resultFailures=0;}
          catch(error){
            if(['device_binding_not_found','device_not_found'].includes(error.message)){markDeviceRemoved(state,error.message);break;}if(['device_connection_required','device_connection_expired','device_revoked'].includes(error.message)){markCloudState(state,{desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastError:error.message,lastDisconnectedAt:Date.now()});break;}
            resultFailures++;const retryInMs=Math.min(Math.max(1000*(2**Math.min(resultFailures,5)),Number(error.retryAfterMs)||0),300000);console.error(JSON.stringify({event:'device_result_delivery_failed',deviceId:state.enrollment.deviceId,commandId:command.commandId,error:error.message,status:error.status||null,failures:resultFailures,retryInMs}));await wait(retryInMs);
          }
        }
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
  try{await fleetSupervisor.close();}catch{}
  try{await localWall?.close();}catch{}
  if(Object.keys(state).length)writeState(state);console.log(JSON.stringify({event:'device_agent_stopped',deviceId:state.enrollment?.deviceId||null,nodeId:state.enrollment?.nodeId||null}));
}
async function wallOnly(args){
  const hub=args.hub||DEFAULT_HUB,state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
  if(!fs.existsSync(LOCAL_WALL_AUTH_FILE))writeAccountOnlyWallAuthConfig(LOCAL_WALL_AUTH_FILE,{username:'account'});
  const wallAuth=loadLocalWallAuth(LOCAL_WALL_AUTH_FILE,{required:!['127.0.0.1','::1','localhost'].includes(String(LOCAL_WALL_HOST))});
  const fleetManager=new FleetComponentManager(),fleetSupervisor=new FleetComponentSupervisor({manager:fleetManager,stateProvider:()=>readState(),requestIntent:async current=>{const local=await localFleetStatus();const response=await channelRequest(current,hub,'fleet-intent',{agentVersion:VERSION,moduleVersion:fleetManager.current()?.version||null,fleetHealthy:local.healthy===true,fleetPort:local.port});return response.fleet;},env:{OPERATOR_AGENT_STATE:STATE_FILE,OPERATOR_AGENT_IDENTITY_FILE:EXTERNAL_IDENTITY_FILE,OPERATOR_AGENT_WALL_AUTH_FILE:LOCAL_WALL_AUTH_FILE,OPERATOR_AGENT_HUB_URL:hub,OPERATOR_FLEET_WALL_HOST:FLEET_WALL_HOST,OPERATOR_FLEET_WALL_PORT:String(FLEET_WALL_PORT),OPERATOR_FLEET_WALL_PUBLIC_URL:FLEET_WALL_PUBLIC_URL},emit:event=>console.log(JSON.stringify(event))});
  const localWall=startLocalWall({host:LOCAL_WALL_HOST,port:LOCAL_WALL_PORT,brandSvgPath:LOCAL_WALL_BRAND,auth:wallAuth,getLocalStatus:async()=>({...statusView(),fleetWall:await localFleetStatus()}),getRemoteStatus:async()=>remoteDeviceStatus(hub),getRemoteActivity:async limit=>remoteDeviceActivity(hub,limit),connect:async data=>connectCloud({hub,graceMinutes:data.graceMinutes,leaseHours:data.leaseHours,silent:true}),disconnect:async data=>disconnectCloud({hub,reason:data.reason||'local_wall_disconnect',silent:true}),setGrace:async data=>setConnectionGrace({hub,minutes:data.minutes,silent:true}),setPermissions:async data=>setLocalPermissions(data?.allowedCapabilities,data?.profile),accountAuthenticate:async data=>authenticateWallAccount(data?.username,data?.password,hub),pairingCode:async data=>rotatePairingCode(hub,data),ownerProofCode:async()=>accountOwnerProofCode(hub),accessApprove:async requestId=>approveDeviceAccess(requestId,hub),accessDeny:async(requestId,data)=>denyDeviceAccess(requestId,hub,data?.reason||'owner_denied')});
  console.log(JSON.stringify({event:'host_wall_companion_started',mode:'wall-only',url:localWall.url,deviceId:state.enrollment.deviceId,nodeId:state.enrollment.nodeId||state.enrollment.deviceId}));
  let stopping=false,resolveStop;const stopped=new Promise(resolve=>resolveStop=resolve);const stop=()=>{if(stopping)return;stopping=true;resolveStop();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  const reconcile=async()=>{if(stopping)return;try{await fleetSupervisor.reconcile();}catch(error){console.error(JSON.stringify({event:'fleet_component_reconcile_failed',error:error.message,status:error.status||null}));}};
  await reconcile();const timer=setInterval(reconcile,Math.max(1000,Math.min(Number(process.env.OPERATOR_FLEET_RECONCILE_MS)||15000,300000)));timer.unref?.();
  await stopped;clearInterval(timer);try{await fleetSupervisor.close();}catch{}try{await localWall.close();}catch{}console.log(JSON.stringify({event:'host_wall_companion_stopped',deviceId:state.enrollment.deviceId}));
}

async function setDrain(args,draining){const state=readState();if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');state.routing={...(state.routing||{}),draining:Boolean(draining),changedAt:Date.now()};writeState(state);const payload={nodeId:state.enrollment.nodeId||state.enrollment.deviceId,agentVersion:VERSION,sessionCeiling:Math.max(1,Math.min(Number(process.env.OPERATOR_AGENT_MAX_SESSIONS)||2,100)),draining:Boolean(draining),capabilities:effectiveCapabilities(state.enrollment.approvedCapabilities,state.policy?.deniedCapabilities),policyRevision:Math.max(0,Number(state.policy?.serverPolicyRevision)||0),waitMs:0};const response=await channelRequest(state,args.hub||DEFAULT_HUB,'poll',payload);applyPolicyEnvelope(state,response.policy);console.log(JSON.stringify({ok:true,deviceId:state.enrollment.deviceId,nodeId:payload.nodeId,draining:Boolean(draining),channelState:response.channel?.node?.state||null},null,2));}
async function status(){console.log(JSON.stringify(statusView(),null,2));}
async function initWallAuth(args){const password=fs.readFileSync(0,'utf8').replace(/[\r\n]+$/,'');if(password.length<12)throw new Error('local_wall_password_too_short');const result=writeLocalWallAuthConfig(LOCAL_WALL_AUTH_FILE,{username:args.username||'operator',password});console.log(JSON.stringify({ok:true,wallAuth:'configured',file:result.file,username:result.username,passwordEchoed:false},null,2));}
const args=parseArgs(process.argv.slice(2)),command=args._[0]||'status';
try{if(command==='login')await login(args);else if(command==='poll'){const state=readState();if(!state)throw new Error('no_device_state');console.log(JSON.stringify(await finishEnrollment(state,args.base||DEFAULT_BASE,{wait:false}),null,2));}else if(command==='heartbeat'){const state=readState();if(!state)throw new Error('no_device_state');console.log(JSON.stringify(await heartbeat(state,args.base||DEFAULT_BASE),null,2));}else if(command==='daemon')await daemon(args);else if(command==='wall-only')await wallOnly(args);else if(command==='connect')await connectCloud(args);else if(command==='disconnect')await disconnectCloud(args);else if(command==='set-grace')await setConnectionGrace(args);else if(command==='drain')await setDrain(args,true);else if(command==='undrain')await setDrain(args,false);else if(command==='status')await status();else if(command==='wall-auth-init')await initWallAuth(args);else throw new Error(`unknown_command:${command}`);}catch(error){console.error(JSON.stringify({ok:false,error:error.message,status:error.status||null},null,2));process.exitCode=1;}
