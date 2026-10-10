import crypto from 'node:crypto';
import fs from 'node:fs';
import {mintTeamPrincipalProof,teamOAuthAgentId} from '../lib/team-oauth-principal-proof.mjs';
import { callOperatorJson } from '../gateway/operator-proxy.mjs';
import { sealOperatorPayload } from '../gateway/operator-crypto.mjs';
import { redactRestrictedText } from './response-sanitizer.mjs';
import { helperOverview, helperGroup } from './tool-helper.mjs';

const opId=p=>`${p}-${crypto.randomUUID()}`;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cleanDevice=d=>({deviceId:d.deviceId,name:d.displayName||d.name||d.deviceId,platform:d.platform,architecture:d.architecture,state:d.state,capabilities:[...(d.effectiveCapabilities||d.capabilities||d.approvedCapabilities||[])]});
const cleanSession=s=>({sessionId:s.sessionId,deviceId:s.deviceId,state:s.state,workspace:s.workspace||'',gracePreset:s.gracePreset||null,holdReason:s.holdReason||null,expiresAt:s.expiresAt||null,reconnectCount:Number(s.reconnectCount)||0});
const cleanContext=c=>c?({deviceId:c.deviceId||null,sessionId:c.sessionId||null,nodeId:c.nodeId||null,workspace:c.workspace||'',gracePreset:c.gracePreset||null,platform:c.platform||null,architecture:c.architecture||null,deviceState:c.deviceState||null,connectionState:c.connectionState||null}):null;
const cleanJob=j=>({jobId:j.jobId,state:j.state||null,running:!j.finishedAt,exitCode:j.exitCode??null});
const PRODUCT_CAPABILITIES=Object.freeze([
  'account-owned device enrollment with local-first A/B approval',
  'explicit device targeting with no silent fallback',
  'durable remote sessions with resume/hold and recoverable jobs/output',
  'bounded filesystem operations and native search',
  'resumable SHA-256 verified SCP for binary and large files',
  'managed non-PTY processes',
  'real PTY/ConPTY terminals with input, resize, signals, and persistent shells',
  'Real Remote V2 semantic/live desktop observation and bounded physical input',
  'device-local final policy enforcement',
  'Main device and multi-device Fleet/Fleet Wall for entitled accounts',
  'signed outbound device channels and device identity',
  'device activity/live execution observability',
  'signed updates with an independent updater/helper and health-gated rollback'
]);

function stableAgentId(identity){return teamOAuthAgentId(identity);}
function safeAccount(a={}){return {plan:String(a.plan||'free'),mainDeviceId:a.mainDeviceId||null,fleet:a.fleetProvisioning?{deviceId:a.fleetProvisioning.deviceId||null,state:a.fleetProvisioning.state||null,reason:a.fleetProvisioning.reason||null,moduleVersion:a.fleetProvisioning.moduleVersion||null,agentVersion:a.fleetProvisioning.agentVersion||null,port:Number(a.fleetProvisioning.port)||null}:null};}
function safeRouting(r={}){return {mode:r.mode||null,state:r.state||null,draining:Boolean(r.draining),sessionCeiling:Number.isFinite(Number(r.sessionCeiling))?Number(r.sessionCeiling):null,queuedCommands:Number(r.queuedCommands)||0,inFlightCommands:Number(r.inFlightCommands)||0};}
function safeConnection(c={}){return {state:c.state||null,plan:c.plan||null,enforced:Boolean(c.enforced),reconnectGraceMs:Number.isFinite(Number(c.reconnectGraceMs))?Number(c.reconnectGraceMs):null};}
function safeUpdate(u={}){return {state:u.state||u.status||null,currentVersion:u.currentVersion||null,targetVersion:u.targetVersion||null,helperVersion:u.helperVersion||null,mode:u.mode||null,code:u.code||null};}
function safePolicy(d={}){const p=d.policy||{},mode=String(d.routing?.mode||'');return {profile:d.policyProfile||p.policyProfile||null,authority:mode==='local'?'local-main':'server-and-local',revision:Number(p.policyRevision)||null,approvedCapabilities:[...(p.approvedCapabilities||d.approvedCapabilities||d.capabilities||[])],effectiveCapabilities:[...(d.effectiveCapabilities||d.capabilities||[])],localFinalDeny:true};}
function cleanActivityEvent(e={}){const out={type:String(e.type||'activity'),status:e.status||null,route:e.route||null};if(e.requiredCapabilities)out.requiredCapabilities=[...e.requiredCapabilities];if(e.cwd)out.cwd=redactRestrictedText(String(e.cwd).slice(0,1024));if(e.note)out.note=redactRestrictedText(String(e.note).slice(0,1024));if(e.toolMeta&&typeof e.toolMeta==='object')out.tool={kind:e.toolMeta.kind||null,operation:e.toolMeta.op||null,label:e.toolMeta.label?redactRestrictedText(String(e.toolMeta.label).slice(0,512)):null};return out;}

export class AccountOperatorAdapter{
  constructor(identity,{teamOperatorCall=callOperatorJson,teamProofSigner=null}={}){
    if(!identity?.accountId||!identity?.clientId)throw new Error('plugin_identity_required');
    this.identity=identity;this.agentId=stableAgentId(identity);
    this.teamOperatorCall=teamOperatorCall;
    this.teamProofSigner=teamProofSigner||((args)=>{
      const file=String(process.env.LIGHT_REMOTE_TEAM_OAUTH_SIGNING_KEY_FILE||'');
      if(!file)throw Object.assign(new Error('team_oauth_signing_not_configured'),{status:503});
      return mintTeamPrincipalProof({...args,privateKey:fs.readFileSync(file)});
    });
  }
  async signedTeamOperatorCall(targetPath,body){
    if(!body||typeof body!=='object'||Object.hasOwn(body,'actorAccountId')||Object.hasOwn(body,'agentId'))
      throw new Error('team_identity_must_be_proven_not_submitted');
    const method='POST';
    const proof=this.teamProofSigner({identity:this.identity,method,targetPath,body});
    return this.teamOperatorCall(method,targetPath,body,{'x-light-remote-team-proof':proof});
  }
  async accountRaw(){const row=await callOperatorJson('GET',`/v1/plugin/accounts/${encodeURIComponent(this.identity.accountId)}`);if(!row?.account)throw new Error('account_not_found');return row.account;}
  async clientRaw({required=false,continuity=false}={}){
    const q=new URLSearchParams({accountId:this.identity.accountId,agentId:this.agentId});
    const attempts=continuity?[0,150,400,900]:[0];
    let last=null;
    for(const wait of attempts){
      if(wait)await delay(wait);
      try{const row=await callOperatorJson('GET',`/v1/agent-client/by-agent?${q}`);return row.client||null;}
      catch(error){last=error;if(Number(error.status)!==401)throw error;}
    }
    if(!required)return null;
    if(continuity){const e=new Error('agent_client_temporarily_unavailable');e.status=503;e.retryable=true;e.retryAfterMs=1500;e.cause=last;throw e;}
    throw last||Object.assign(new Error('agent_client_required'),{status:401});
  }
  async hasActiveSessionEvidence(){
    const q=new URLSearchParams({accountId:this.identity.accountId}),row=await callOperatorJson('GET',`/v1/plugin/sessions?${q}`);
    return (row.sessions||[]).some(s=>s.accountId===this.identity.accountId&&s.agentId===this.agentId&&['active','hold'].includes(s.state));
  }
  async teamAccessBegin(deviceId,label='ChatGPT Pro Team'){
    const row=await this.signedTeamOperatorCall('/v1/plugin/team/access/request',{
      deviceId:String(deviceId||''),label:String(label||'ChatGPT Pro Team').slice(0,120)
    });
    const approval=row?.approval;
    if(approval?.state!=='pending'||approval.agentId!==this.agentId||
       !approval.pollToken||!approval.requestId||!approval.userCode||approval.crossAccountExecutionEnabled!==false)
      throw new Error('invalid_team_approval_request');
    return {requestId:approval.requestId,pollToken:approval.pollToken,
      userCode:approval.userCode,expiresAt:approval.expiresAt,deviceId:approval.deviceId};
  }
  async teamAccessPoll({requestId,pollToken}={}){
    const row=await this.signedTeamOperatorCall('/v1/plugin/team/access/poll',{
      requestId,pollToken
    });
    if(!['pending','approved'].includes(row?.approval?.state)||
       row?.approval?.crossAccountExecutionEnabled!==false)
      throw new Error('invalid_team_approval_response');
    return row.approval;
  }
  // Unpublished dev helper methods; live MCP definitions stay unchanged.
  async teamDispatchPreview({deviceId,operation,requiredCapabilities}={}){
    return this.signedTeamOperatorCall('/v1/plugin/team/dispatch/preflight',
      {deviceId,operation,requiredCapabilities});
  }
  async teamUatSessionOpen({deviceId,operation,requiredCapabilities,openId,
    label,workspace,gracePreset}={}){
    return this.signedTeamOperatorCall('/v1/plugin/team/sessions/uat/open',
      {deviceId,operation,requiredCapabilities,openId,label,workspace,gracePreset});
  }
  async teamUatSessionAction(sessionId,action,{reason,toolAction}={}){
    if(!['get','resume','hold','touch','close'].includes(action))
      throw new Error('team_uat_session_action_invalid');
    const targetPath='/v1/plugin/team/sessions/uat/'+encodeURIComponent(sessionId)+'/'+action;
    return this.signedTeamOperatorCall(targetPath,{reason,action:toolAction});
  }
  async pairBegin(aCode,label='ChatGPT'){
    const row=await callOperatorJson('POST','/v1/device-pair/begin',{aCode:String(aCode||'').trim(),accountId:this.identity.accountId,agentId:this.agentId,label:String(label||'ChatGPT').slice(0,120)}),access=row.access;
    if(access?.state!=='pending'||!access?.request?.requestId||!access?.pollToken)throw new Error('invalid_pairing_access_request');
    if(access.request.accountId!==this.identity.accountId)throw Object.assign(new Error('pairing_account_mismatch'),{status:403});
    return {requestId:access.request.requestId,pollToken:access.pollToken,userCode:access.request.userCode,expiresAt:access.request.expiresAt,deviceId:access.request.deviceId};
  }
  async attachPairing({grant,requestId}={}){
    if(!grant||grant.accountId!==this.identity.accountId)throw Object.assign(new Error('pairing_account_mismatch'),{status:403});
    const prior=await this.clientRaw({required:false,touch:false});
    const attached=await callOperatorJson('POST','/v1/agent-client/attach',{clientSessionId:prior?.clientSessionId||null,agentId:this.agentId,grantId:grant.grantId,pairingRequestId:requestId});
    const contextRow=await callOperatorJson('POST','/v1/agent-client/context',{clientSessionId:attached.client.clientSessionId,agentId:this.agentId,deviceId:attached.device.deviceId,workspace:'',gracePreset:'60m'});
    return {state:'approved',client:attached.client,device:attached.device,context:cleanContext(contextRow.context),session:cleanSession(contextRow.session)};
  }
  async pairPoll({requestId,pollToken}={}){
    const row=await callOperatorJson('POST','/v1/device-access/poll',{requestId,pollToken}),access=row.access;
    if(access?.state!=='approved')return {state:'pending',request:access?.request||null};
    return this.attachPairing({grant:access.grant,requestId});
  }
  async pairRecover(){
    const row=await callOperatorJson('POST','/v1/device-access/recover',{accountId:this.identity.accountId,agentId:this.agentId}),access=row.access;
    if(!access)return null;
    if(access.state!=='approved')return {state:'pending',request:access.request||null};
    const requestId=access.request?.requestId;
    const ready=await this.attachPairing({grant:access.grant,requestId});
    if(requestId){try{await callOperatorJson('POST','/v1/device-access/recover-consume',{requestId,accountId:this.identity.accountId,agentId:this.agentId});}catch{}}
    return ready;
  }
  async authorizedDevicesRaw(){
    const client=await this.clientRaw({required:false});if(!client)return [];
    const q=new URLSearchParams({agentId:this.agentId}),row=await callOperatorJson('GET',`/v1/agent-client/${encodeURIComponent(client.clientSessionId)}/devices?${q}`);
    return row.devices||[];
  }
  async devices(){return (await this.authorizedDevicesRaw()).map(cleanDevice);}
  async deviceRaw(deviceId,{continuity=false}={}){
    const client=await this.clientRaw({required:true,continuity});
    await callOperatorJson('POST','/v1/agent-client/resolve',{clientSessionId:client.clientSessionId,agentId:this.agentId,deviceId});
    const row=await callOperatorJson('GET',`/v1/devices/${encodeURIComponent(deviceId)}`),d=row.device;
    if(!d||d.accountId!==this.identity.accountId||d.state==='revoked')throw Object.assign(new Error('device_not_available'),{status:404});
    return d;
  }
  async workingContext({deviceId=null,workspace=null,gracePreset=null}={}){
    const client=await this.clientRaw({required:true,continuity:true}),body={clientSessionId:client.clientSessionId,agentId:this.agentId};
    if(deviceId)body.deviceId=deviceId;
    if(workspace!==null)body.workspace=String(workspace||'').slice(0,512);
    if(gracePreset)body.gracePreset=gracePreset;
    const row=await callOperatorJson('POST','/v1/agent-client/context',body);
    if(row?.session?.accountId!==this.identity.accountId)throw new Error('session_account_mismatch');
    return {context:cleanContext(row.context),session:cleanSession(row.session)};
  }
  async connectionHelper(requestedGroup=null){
    const account=await this.accountRaw(),client=await this.clientRaw({required:false}),devices=client?await this.authorizedDevicesRaw():[],mainId=account.mainDeviceId||null,ready=devices.length>0,transient=!client&&await this.hasActiveSessionEvidence();
    let working=null;
    if(ready){try{working=await this.workingContext({});}catch(error){if(error?.message!=='agent_client_temporarily_unavailable')throw error;}}
    const helper=ready?(requestedGroup?helperGroup(requestedGroup,working?.context||{}):helperOverview(working?.context||{})):null;
    const status=transient?'temporarily_unavailable':ready?'ready':'need_a_code';
    return {product:'Light Remote',status,purpose:'Governed remote computing for AI agents on explicitly authorized user-owned devices.',account:safeAccount(account),productCapabilities:[...PRODUCT_CAPABILITIES],onboarding:{nextAction:transient?'retry_same_helper_no_repair':ready?'use_working_context_and_helper_menu':'ask_owner_for_local_wall_a_code',retryable:transient||undefined,retryAfterMs:transient?1500:undefined,normalFlow:['Open the target device Local Wall and copy the one-time A code.','Call this helper with that A code to create the B approval request.','Show only the B code to the owner.','The owner enters B at that same Local Wall /approve and chooses Approve.','Call this helper again with the returned continuation. Only then is the device available to this plugin client.'],trustBoundary:'OAuth signs the user into the account, but it does not authorize a device. Every target device must be A/B-approved into this plugin client. The MCP cannot mint A or bypass Local Wall /approve.'},topology:devices.map(d=>({deviceId:d.deviceId,name:d.displayName||d.name||d.deviceId,role:d.deviceId===mainId?'main':'device',platform:d.platform,architecture:d.architecture,state:d.state,routing:safeRouting(d.routing||{}),effectiveCapabilities:[...(d.effectiveCapabilities||d.capabilities||[])]})),context:working?.context||null,session:working?.session||null,toolHelper:helper,governance:{explicitTargetRequired:true,silentFallback:false,localPolicyFinalDeny:true,credentialsMustRemainLocal:true,deviceAuthorization:'local-wall-a-b'}};
  }

  async inspectDevice(deviceId){const [d,a]=await Promise.all([this.deviceRaw(deviceId),this.accountRaw()]);return {device:cleanDevice(d),role:a.mainDeviceId===d.deviceId?'main':'device',routing:safeRouting(d.routing||{}),connection:safeConnection(d.connection||{}),policy:safePolicy(d),update:safeUpdate(d.updateStatus||{}),fleet:{accountPlan:String(a.plan||'free'),mainDeviceId:a.mainDeviceId||null,provisioning:a.fleetProvisioning?{state:a.fleetProvisioning.state||null,deviceId:a.fleetProvisioning.deviceId||null,moduleVersion:a.fleetProvisioning.moduleVersion||null}:null}};}
  async recentActivity(deviceId,limit=50){await this.deviceRaw(deviceId);const n=Math.max(1,Math.min(Number(limit)||50,200)),row=await callOperatorJson('GET',`/v1/activity?deviceId=${encodeURIComponent(deviceId)}&limit=${n}`);return {deviceId,events:(row.events||[]).map(cleanActivityEvent)};}
  async setMainDevice(deviceId){await this.deviceRaw(deviceId);const row=await callOperatorJson('POST',`/v1/plugin/accounts/${encodeURIComponent(this.identity.accountId)}/main-device`,{deviceId});return {account:safeAccount(row.account),mainDevice:cleanDevice(row.mainDevice)};}
  async revokeDevice(deviceId,reason='plugin_owner_revoked'){await this.deviceRaw(deviceId);const row=await callOperatorJson('POST',`/v1/plugin/accounts/${encodeURIComponent(this.identity.accountId)}/devices/${encodeURIComponent(deviceId)}/revoke`,{reason:String(reason||'plugin_owner_revoked').slice(0,120)});return {deviceId:row.device?.deviceId||deviceId,state:row.device?.state||'revoked',revoked:true};}
  async removeDevice(deviceId,reason='plugin_owner_removed'){await this.deviceRaw(deviceId);const row=await callOperatorJson('POST',`/v1/plugin/accounts/${encodeURIComponent(this.identity.accountId)}/devices/${encodeURIComponent(deviceId)}/remove`,{reason:String(reason||'plugin_owner_removed').slice(0,120)});return {deviceId,removed:Boolean(row.removed?.removed||row.binding?.removed||row.removed===true)};}
  async openSession({deviceId,openId=null,workspace='',gracePreset='60m'}={}){
    const d=await this.deviceRaw(deviceId);if(d.state!=='online')throw new Error('device_offline');
    if(openId){
      const row=await callOperatorJson('POST','/v1/plugin/sessions/open',{accountId:this.identity.accountId,openId,agentId:this.agentId,label:'ChatGPT Light Remote',workspace:String(workspace||'').slice(0,512),gracePreset,nodeId:d.nodeId});
      if(row?.session?.accountId!==this.identity.accountId||row?.session?.deviceId!==d.deviceId)throw new Error('session_target_mismatch');
    }
    const working=await this.workingContext({deviceId:d.deviceId,workspace,gracePreset});
    return working.session;
  }
  async sessionRaw(sessionId){const q=new URLSearchParams({accountId:this.identity.accountId,agentId:this.agentId}),row=await callOperatorJson('GET',`/v1/plugin/sessions/${encodeURIComponent(sessionId)}?${q}`),s=row.session;if(!s||s.accountId!==this.identity.accountId)throw Object.assign(new Error('session_not_found'),{status:404});await this.deviceRaw(s.deviceId,{continuity:true});return s;}
  async session(sessionId){return cleanSession(await this.sessionRaw(sessionId));}
  async sessions(){const owned=new Set((await this.authorizedDevicesRaw()).map(d=>d.deviceId)),q=new URLSearchParams({accountId:this.identity.accountId}),row=await callOperatorJson('GET',`/v1/plugin/sessions?${q}`);return (row.sessions||[]).filter(s=>s.accountId===this.identity.accountId&&s.agentId===this.agentId&&owned.has(s.deviceId)).map(cleanSession);}
  async resumeSession(sessionId){await this.sessionRaw(sessionId);const row=await callOperatorJson('POST',`/v1/plugin/sessions/${encodeURIComponent(sessionId)}/resume`,{accountId:this.identity.accountId,agentId:this.agentId});return cleanSession(row.session);}
  async holdSession(sessionId,reason='transport_lost'){await this.sessionRaw(sessionId);const row=await callOperatorJson('POST',`/v1/plugin/sessions/${encodeURIComponent(sessionId)}/hold`,{accountId:this.identity.accountId,agentId:this.agentId,reason:String(reason||'transport_lost').slice(0,80)});return cleanSession(row.session);}
  async closeSession(sessionId){await this.sessionRaw(sessionId);const row=await callOperatorJson('POST',`/v1/plugin/sessions/${encodeURIComponent(sessionId)}/close`,{accountId:this.identity.accountId,agentId:this.agentId});return cleanSession(row.session);}
  async fs(sessionId,fs,operationId=opId('fs'),waitMs=7000){const s=await this.sessionRaw(sessionId),payload={action:'fs',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,fs,waitMs};return callOperatorJson('POST','/v1/fs',sealOperatorPayload(payload));}
  async search(sessionId,search,operationId=opId('search'),waitMs=7000){const s=await this.sessionRaw(sessionId),payload={action:'search',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,search,waitMs};return callOperatorJson('POST','/v1/search',sealOperatorPayload(payload));}
  async process(sessionId,process,operationId=opId('process'),waitMs=7000){const s=await this.sessionRaw(sessionId),payload={action:'process',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,process,waitMs};return callOperatorJson('POST','/v1/process',sealOperatorPayload(payload));}
  async terminal(sessionId,terminal,operationId=opId('terminal'),waitMs=7000){const s=await this.sessionRaw(sessionId),payload={action:'terminal',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,terminal,waitMs};return callOperatorJson('POST','/v1/terminal',sealOperatorPayload(payload));}
  async scp(sessionId,scp,operationId=opId('scp'),waitMs=7000){const s=await this.sessionRaw(sessionId),payload={action:'scp',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,scp,waitMs};return callOperatorJson('POST','/v1/scp',sealOperatorPayload(payload));}
  async desktop(sessionId,desktop,operationId=opId('desktop'),waitMs=7000){const s=await this.sessionRaw(sessionId),payload={action:'desktop',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,desktop,waitMs};return callOperatorJson('POST','/v1/desktop',sealOperatorPayload(payload));}
  async desktopLiveRead(sessionId,{semanticSessionId,afterSeq=0,limit=200,includeSnapshot=true}={}){await this.sessionRaw(sessionId);return callOperatorJson('POST','/v1/plugin/desktop-live/read',{accountId:this.identity.accountId,sessionId,agentId:this.agentId,semanticSessionId:String(semanticSessionId||''),afterSeq,limit,includeSnapshot});}
  async exec(sessionId,script,{shell=null,cwd='',operationId=opId('exec'),timeoutMs=600000,waitMs=7000,requiredCapabilities=null}={}){
    const s=await this.sessionRaw(sessionId),payload={action:'exec_batch',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,script:String(script),cwd:String(cwd||''),shell:shell||undefined,timeoutMs,waitMs,requiredCapabilities:Array.isArray(requiredCapabilities)&&requiredCapabilities.length?requiredCapabilities:['filesystem'],note:'OpenAI Light Remote plugin'};
    return callOperatorJson('POST','/v1/execute',sealOperatorPayload(payload));
  }
  async job(jobId){const row=await callOperatorJson('GET',`/v1/jobs/${encodeURIComponent(jobId)}?agentId=${encodeURIComponent(this.agentId)}`),j=row.job;if(!j)throw new Error('job_not_found');await this.deviceRaw(j.deviceId);return cleanJob(j);}
  async output(jobId,stream='stdout',offset=0,limit=4*1024*1024,full=false){await this.job(jobId);const q=new URLSearchParams({agentId:this.agentId,stream:stream==='stderr'?'stderr':'stdout',offset:String(Math.max(0,offset)),limit:String(Math.max(1,Math.min(limit,8*1024*1024))),full:full?'1':'0'});const row=await callOperatorJson('GET',`/v1/output/${encodeURIComponent(jobId)}?${q}`);return {jobId:row.jobId,stream:row.stream,offset:row.offset,returnedBytes:row.returnedBytes,totalBytes:row.totalBytes,hasMore:row.hasMore,output:redactRestrictedText(row.output)};}
}
