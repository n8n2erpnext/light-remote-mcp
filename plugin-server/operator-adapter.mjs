import crypto from 'node:crypto';
import { callOperatorJson } from '../gateway/operator-proxy.mjs';
import { sealOperatorPayload } from '../gateway/operator-crypto.mjs';
import { redactRestrictedText } from './response-sanitizer.mjs';
import { helperOverview, helperGroup } from './tool-helper.mjs';
import { cleanJob } from './job-view.mjs';
import {goldAbV2HelperKey,signGoldAbV2HelperTarget} from '../lib/gold-ab-v2-helper-proof.mjs';
import {signGoldAbV2HelperPoll} from '../lib/gold-ab-v2-helper-poll-proof.mjs';
import {signGoldGuestQueueProof} from '../lib/gold-pro-share-guest-queue-proof.mjs';

const opId=p=>`${p}-${crypto.randomUUID()}`;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cleanDevice=d=>({deviceId:d.deviceId,name:d.displayName||d.name||d.deviceId,platform:d.platform,architecture:d.architecture,state:d.state,capabilities:[...(d.effectiveCapabilities||d.capabilities||d.approvedCapabilities||[])]});
const cleanSession=s=>({sessionId:s.sessionId,deviceId:s.deviceId,displayName:s.displayName||null,nameSource:s.nameSource||null,state:s.state,workspace:s.workspace||'',gracePreset:s.gracePreset||null,holdReason:s.holdReason||null,expiresAt:s.expiresAt||null,reconnectCount:Number(s.reconnectCount)||0});
const cleanContext=c=>c?({deviceId:c.deviceId||null,sessionId:c.sessionId||null,nodeId:c.nodeId||null,workspace:c.workspace||'',gracePreset:c.gracePreset||null,platform:c.platform||null,architecture:c.architecture||null,deviceState:c.deviceState||null,connectionState:c.connectionState||null}):null;
// Job view normalization is shared with P0 regression fixtures.
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

function stableAgentId(identity){return `plugin-${crypto.createHash('sha256').update(`${identity.accountId}|${identity.clientId}`).digest('hex').slice(0,40)}`;}
function safeAccount(a={}){return {plan:String(a.plan||'free'),mainDeviceId:a.mainDeviceId||null,fleet:a.fleetProvisioning?{deviceId:a.fleetProvisioning.deviceId||null,state:a.fleetProvisioning.state||null,reason:a.fleetProvisioning.reason||null,moduleVersion:a.fleetProvisioning.moduleVersion||null,agentVersion:a.fleetProvisioning.agentVersion||null,port:Number(a.fleetProvisioning.port)||null}:null};}
function safeRouting(r={}){return {mode:r.mode||null,state:r.state||null,draining:Boolean(r.draining),sessionCeiling:Number.isFinite(Number(r.sessionCeiling))?Number(r.sessionCeiling):null,queuedCommands:Number(r.queuedCommands)||0,inFlightCommands:Number(r.inFlightCommands)||0};}
function safeConnection(c={}){return {state:c.state||null,plan:c.plan||null,enforced:Boolean(c.enforced),reconnectGraceMs:Number.isFinite(Number(c.reconnectGraceMs))?Number(c.reconnectGraceMs):null};}
function safeUpdate(u={}){return {state:u.state||u.status||null,currentVersion:u.currentVersion||null,targetVersion:u.targetVersion||null,helperVersion:u.helperVersion||null,mode:u.mode||null,code:u.code||null};}
function safePolicy(d={}){const p=d.policy||{},mode=String(d.routing?.mode||'');return {profile:d.policyProfile||p.policyProfile||null,authority:mode==='local'?'local-main':'server-and-local',revision:Number(p.policyRevision)||null,approvedCapabilities:[...(p.approvedCapabilities||d.approvedCapabilities||d.capabilities||[])],effectiveCapabilities:[...(d.effectiveCapabilities||d.capabilities||[])],localFinalDeny:true};}
function cleanActivityEvent(e={}){const out={type:String(e.type||'activity'),status:e.status||null,route:e.route||null};if(e.requiredCapabilities)out.requiredCapabilities=[...e.requiredCapabilities];if(e.type==='job_admission_denied'){const code=String(e.reason||'');if(['target_node_capability_missing','local_host_capability_missing'].includes(code))out.reason=code;if(Array.isArray(e.missingCapabilities))out.missingCapabilities=e.missingCapabilities.filter(c=>/^[a-z0-9._:-]{1,80}$/.test(String(c))).slice(0,32);if(e.missingCapabilityReasons&&typeof e.missingCapabilityReasons==='object')out.missingCapabilityReasons=Object.fromEntries((out.missingCapabilities||[]).map(c=>[c,e.missingCapabilityReasons[c]]).filter(([,why])=>['agent_not_advertising','agent_policy_revision_stale','enrollment_not_approved'].includes(why)));}if(e.cwd)out.cwd=redactRestrictedText(String(e.cwd).slice(0,1024));if(e.note)out.note=redactRestrictedText(String(e.note).slice(0,1024));if(e.toolMeta&&typeof e.toolMeta==='object')out.tool={kind:e.toolMeta.kind||null,operation:e.toolMeta.op||null,label:e.toolMeta.label?redactRestrictedText(String(e.toolMeta.label).slice(0,512)):null};return out;}

export class AccountOperatorAdapter{
  constructor(identity){if(!identity?.accountId||!identity?.clientId)throw new Error('plugin_identity_required');this.identity=identity;this.agentId=stableAgentId(identity);}
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
  async resolveAbV2Target(targetQuery,{guestShare=false}={}){
    // Only a verified OAuth identity reaches this method through guarded().
    // SOURCE GATE: cannot create A/B, grant or ready while PG043 is absent.
    if((guestShare&&process.env.LR_GOLD_PRO_SHARE_GUEST_AB_TARGET_QUERY!=='1')||
       (!guestShare&&process.env.LR_GOLD_AB_V2_HELPER_TARGET_QUERY!=='1'))
      return {status:'target_resolution_unavailable',nextAction:'use_legacy_a_code',
        helperReady:false,approvalState:'not_issued'};
    const proof=signGoldAbV2HelperTarget({identity:this.identity,targetQuery,
      key:goldAbV2HelperKey()});
    const response=await callOperatorJson('POST',guestShare?
      '/v1/plugin/pro-share/target-resolve':'/v1/plugin/abv2/target-resolve',proof);
    return {status:'target_resolution',resolution:response.status,
      total:response.total,matches:response.matches||[],
      helperReady:false,approvalState:'not_issued',
      nextAction:response.nextAction||'specify_target'};
  }
  async issueAbV2Request(targetQuery,{requestKey=null,guestShare=false}={}){
    if((guestShare&&process.env.LR_GOLD_PRO_SHARE_GUEST_AB_REQUEST_ISSUE!=='1')||
       (!guestShare&&process.env.LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE!=='1'))
      return {status:'request_issuance_unavailable',nextAction:'use_legacy_a_code',
        helperReady:false,approvalState:'not_issued'};
    // Resolve first as the same OAuth principal; if the name is ambiguous,
    // never guess Main or grant a session on a partial name match.
    const resolved=await this.resolveAbV2Target(targetQuery,{guestShare});
    if(resolved.status!=='target_resolution'||resolved.resolution!=='single'||
      resolved.matches.length!==1)return resolved;
    const selected=resolved.matches[0];
    if(!selected?.deviceId||!selected?.shortId||!selected.online)
      return {...resolved,status:'target_not_online',
        nextAction:'select_online_device',helperReady:false};
    const key=requestKey||crypto.randomBytes(16).toString('hex');
    const proof=signGoldAbV2HelperTarget({identity:this.identity,
      targetQuery:selected.shortId,purpose:'issue',
      selectedDeviceId:selected.deviceId,requestKey:key,
      key:goldAbV2HelperKey()});
    const response=await callOperatorJson('POST',guestShare?
      '/v1/plugin/pro-share/request-issue':'/v1/plugin/abv2/request-issue',proof);
    return {status:response.status||'not_ready',requestId:response.requestId||null,
      deviceId:response.deviceId||null,shortId:response.shortId||null,
      bCode:response.bCode||null,requestKey:key,
      expiresAt:response.expiresAt||null,
      approvalState:response.approvalState||'not_issued',
      helperReady:false,reused:Boolean(response.reused),
      nextAction:response.nextAction||'request_not_ready'};
  }
  async pollAbV2Request({requestId,deviceId,shortId,guestShare=false}={}){
    if((guestShare?process.env.LR_GOLD_PRO_SHARE_GUEST_AB_POLL:
       process.env.LR_GOLD_AB_V2_HELPER_POLL_ATTACH)!=='1')
      return {status:'poll_unavailable',helperReady:false,nextAction:'use_legacy_a_code'};
    const proof=signGoldAbV2HelperPoll({identity:this.identity,
      requestId,deviceId,shortId,purpose:guestShare?'guest-poll':'poll'});
    const result=await callOperatorJson('POST',guestShare?
      '/v1/plugin/pro-share/request-poll':'/v1/plugin/abv2/request-poll',proof);
    // Cross-account Guest poll deliberately does not attach to the owner-only
    // working session/execute routes before a dedicated dispatch lane exists.
    if(guestShare)return {status:result.status||'approval_pending',requestId,
     approvalState:result.approvalState||'pending',helperReady:false,
     nextAction:result.nextAction||'guest_dispatch_not_enabled'};
    if(result.status!=='ready'||result.helperReady!==true)
      return {status:result.status||'approval_pending',requestId,
       approvalState:result.approvalState||'pending',helperReady:false,
       nextAction:result.nextAction||'owner_b_approval_pending'};
    if(result.requestId!==requestId||result.deviceId!==deviceId||
       result.shortId!==shortId||result.agentId!==this.agentId||
       !/^lrc_[A-Za-z0-9_-]+$/.test(result.clientSessionId||''))
      throw Error('abv2_helper_durable_binding_invalid');
    // Operator confirmed actual native PG grant AND native Agent binding.
    // A working execution session is an independent, later request.
    return {status:'ready',helperReady:true,requestId,deviceId,shortId,
     clientSessionId:result.clientSessionId,pairedDevice:deviceId,
     expiresAt:result.expiresAt,context:null,session:null};
  }
  // Private staged source adapter, not exposed as an MCP tool yet.
  // OAuth identity is inherited from guarded(identity) only; caller never
  // supplies an actor, owner billing account, grant, or Agent ID.
  async stageGuestQueue({deviceId,requestKey,operation,
   requiredCapabilities=[]}={}){
   if(process.env.LR_GOLD_PRO_SHARE_GUEST_QUEUE_HTTP!=='1')
    return {status:'guest_queue_unavailable',helperReady:false};
   const proof=signGoldGuestQueueProof({
    identity:this.identity,deviceId,requestKey,operation,requiredCapabilities});
   const row=await callOperatorJson('POST',
    '/v1/plugin/pro-share/guest-queue/enqueue',proof);
   return {status:'guest_queue_dispatch_hold',helperReady:false,
    jobId:row.jobId||null,reused:row.reused===true,
    nextAction:'guest_dispatch_not_yet_enabled'};
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
    // A/B approval attaches a device grant; it MUST NOT require a new
    // execution session on that device. A Pro account may authorize four
    // distinct OAuth clients while the device's two session slots are full.
    // Opening a session is an independent, capacity-governed operation.
    return {state:'approved',client:attached.client,device:attached.device,context:null,session:null};
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
  async authorizedDeviceDetails(){
    // The agent-client bindings endpoint contains device identities but can
    // omit current node/effective capabilities. Enrich only A/B-authorized
    // devices from the authoritative device endpoint; never enumerate extra
    // targets or substitute a failed read with a different device.
    const authorized=await this.authorizedDevicesRaw();
    return Promise.all(authorized.map(async binding=>{
      try{
        const row=await callOperatorJson('GET',`/v1/devices/${encodeURIComponent(binding.deviceId)}`);
        const current=row?.device;
        if(current?.deviceId===binding.deviceId&&current.accountId===this.identity.accountId)
          return {...binding,...current};
      }catch{}
      return binding;
    }));
  }
  async devices(){return (await this.authorizedDeviceDetails()).map(cleanDevice);}
  async deviceRaw(deviceId,{continuity=false}={}){
    const client=await this.clientRaw({required:true,continuity});
    await callOperatorJson('POST','/v1/agent-client/resolve',{clientSessionId:client.clientSessionId,agentId:this.agentId,deviceId});
    const row=await callOperatorJson('GET',`/v1/devices/${encodeURIComponent(deviceId)}`),d=row.device;
    if(!d||d.accountId!==this.identity.accountId||d.state==='revoked')throw Object.assign(new Error('device_not_available'),{status:404});
    return d;
  }
  async workingContext({deviceId=null,workspace=null,gracePreset=null,agentNickname=null}={}){
    const client=await this.clientRaw({required:true,continuity:true}),body={clientSessionId:client.clientSessionId,agentId:this.agentId};
    if(deviceId)body.deviceId=deviceId;
    if(workspace!==null)body.workspace=String(workspace||'').slice(0,512);
    if(gracePreset)body.gracePreset=gracePreset;
    if(agentNickname!=null)body.agentNickname=String(agentNickname).slice(0,120);
    const row=await callOperatorJson('POST','/v1/agent-client/context',body);
    if(row?.session?.accountId!==this.identity.accountId)throw new Error('session_account_mismatch');
    return {context:cleanContext(row.context),session:cleanSession(row.session)};
  }
  async connectionHelper(requestedGroup=null){
    const account=await this.accountRaw(),client=await this.clientRaw({required:false}),devices=client?await this.authorizedDeviceDetails():[],mainId=account.mainDeviceId||null,ready=devices.length>0,transient=!client&&await this.hasActiveSessionEvidence();
    let working=null;
    if(ready){try{working=await this.workingContext({});}catch(error){if(!['agent_client_temporarily_unavailable','target_node_draining','node_session_capacity_reached','account_session_capacity_reached','session_capacity_reached'].includes(String(error?.message||'')))throw error;}}
    const helper=ready?(requestedGroup?helperGroup(requestedGroup,working?.context||{}):helperOverview(working?.context||{})):null;
    const status=transient?'temporarily_unavailable':ready?'ready':'need_a_code';
    return {product:'Light Remote',status,purpose:'Governed remote computing for AI agents on explicitly authorized user-owned devices.',account:safeAccount(account),productCapabilities:[...PRODUCT_CAPABILITIES],onboarding:{nextAction:transient?'retry_same_helper_no_repair':ready?'use_working_context_and_helper_menu':'ask_owner_for_local_wall_a_code',retryable:transient||undefined,retryAfterMs:transient?1500:undefined,normalFlow:['Open the target device Local Wall and copy the one-time A code.','Call this helper with that A code to create the B approval request.','Show only the B code to the owner.','The owner enters B at that same Local Wall /approve and chooses Approve.','Call this helper again with the returned continuation. Only then is the device available to this plugin client.'],trustBoundary:'OAuth signs the user into the account, but it does not authorize a device. Every target device must be A/B-approved into this plugin client. The MCP cannot mint A or bypass Local Wall /approve.'},topology:devices.map(d=>({deviceId:d.deviceId,name:d.displayName||d.name||d.deviceId,role:d.deviceId===mainId?'main':'device',platform:d.platform,architecture:d.architecture,state:d.state,routing:safeRouting(d.routing||{}),effectiveCapabilities:[...(d.effectiveCapabilities||d.capabilities||[])]})),context:working?.context||null,session:working?.session||null,toolHelper:helper,governance:{explicitTargetRequired:true,silentFallback:false,localPolicyFinalDeny:true,credentialsMustRemainLocal:true,deviceAuthorization:'local-wall-a-b'}};
  }

  async inspectDevice(deviceId){
    // deviceRaw first verifies this exact A/B grant via Operator.
    const [d,a]=await Promise.all([this.deviceRaw(deviceId),this.accountRaw()]);
    const client=await this.clientRaw({required:true});
    const q=new URLSearchParams({agentId:this.agentId,clientSessionId:client.clientSessionId});
    const boot=await callOperatorJson('GET',
      `/v1/plugin/accounts/${encodeURIComponent(this.identity.accountId)}/devices/${encodeURIComponent(deviceId)}/boot-evidence?${q}`);
    return {device:cleanDevice(d),role:a.mainDeviceId===d.deviceId?'main':'device',
      routing:safeRouting(d.routing||{}),connection:safeConnection(d.connection||{}),
      policy:safePolicy(d),update:safeUpdate(d.updateStatus||{}),
      fleet:{accountPlan:String(a.plan||'free'),mainDeviceId:a.mainDeviceId||null,
        provisioning:a.fleetProvisioning?{state:a.fleetProvisioning.state||null,
          deviceId:a.fleetProvisioning.deviceId||null,
          moduleVersion:a.fleetProvisioning.moduleVersion||null}:null},
      bootEvidence:{state:boot.state,evidenceClass:boot.evidenceClass||null,
        releaseEligible:false,evidence:boot.evidence||null,
        recoveryAuthorization:'not_authorized_by_boot_telemetry'}};
  }
  async recentActivity(deviceId,limit=50){await this.deviceRaw(deviceId);const n=Math.max(1,Math.min(Number(limit)||50,200)),row=await callOperatorJson('GET',`/v1/activity?deviceId=${encodeURIComponent(deviceId)}&limit=${n}`);return {deviceId,events:(row.events||[]).map(cleanActivityEvent)};}
  async setMainDevice(deviceId){await this.deviceRaw(deviceId);const row=await callOperatorJson('POST',`/v1/plugin/accounts/${encodeURIComponent(this.identity.accountId)}/main-device`,{deviceId});return {account:safeAccount(row.account),mainDevice:cleanDevice(row.mainDevice)};}
  async revokeDevice(deviceId,reason='plugin_owner_revoked'){await this.deviceRaw(deviceId);const row=await callOperatorJson('POST',`/v1/plugin/accounts/${encodeURIComponent(this.identity.accountId)}/devices/${encodeURIComponent(deviceId)}/revoke`,{reason:String(reason||'plugin_owner_revoked').slice(0,120)});return {deviceId:row.device?.deviceId||deviceId,state:row.device?.state||'revoked',revoked:true};}
  async removeDevice(deviceId,reason='plugin_owner_removed'){await this.deviceRaw(deviceId);const row=await callOperatorJson('POST',`/v1/plugin/accounts/${encodeURIComponent(this.identity.accountId)}/devices/${encodeURIComponent(deviceId)}/remove`,{reason:String(reason||'plugin_owner_removed').slice(0,120)});return {deviceId,removed:Boolean(row.removed?.removed||row.binding?.removed||row.removed===true)};}
  async openSession({deviceId,openId=null,workspace='',gracePreset='60m',agentNickname=null}={}){
    const d=await this.deviceRaw(deviceId);if(d.state!=='online')throw new Error('device_offline');
    if(openId){
      const row=await callOperatorJson('POST','/v1/plugin/sessions/open',{accountId:this.identity.accountId,openId,agentId:this.agentId,label:'ChatGPT Light Remote',workspace:String(workspace||'').slice(0,512),gracePreset,nodeId:d.nodeId});
      if(row?.session?.accountId!==this.identity.accountId||row?.session?.deviceId!==d.deviceId)throw new Error('session_target_mismatch');
    }
    const working=await this.workingContext({deviceId:d.deviceId,workspace,gracePreset,agentNickname});
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
  async exec(sessionId,script,{shell=null,cwd='',operationId=opId('exec'),timeoutMs=600000,waitMs=7000,requiredCapabilities=null,executionMode='auto'}={}){
    const s=await this.sessionRaw(sessionId),payload={action:'exec_batch',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,script:String(script),cwd:String(cwd||''),shell:shell||undefined,timeoutMs,waitMs,executionMode,requiredCapabilities:Array.isArray(requiredCapabilities)&&requiredCapabilities.length?requiredCapabilities:['filesystem'],note:'OpenAI Light Remote plugin'};
    return callOperatorJson('POST','/v1/execute',sealOperatorPayload(payload));
  }
  async cancelJob(jobId){
    // Pure control plane operation: do not await a read/command on a stalled device.
    // The Operator authenticates the exact owning session and agent before mutation.
    const value=await callOperatorJson('POST',`/v1/jobs/${encodeURIComponent(jobId)}/cancel`,{agentId:this.agentId});
    return {jobId,state:value.state,reason:value.reason,
      ...(value.state==='stop_requested'?{verified:false,nextAction:'read_existing_job_until_signed_terminal_result'}:{}),
      ...(value.state==='cancelled'?{verified:true}:{})};
  }
  async job(jobId){const row=await callOperatorJson('GET',`/v1/jobs/${encodeURIComponent(jobId)}?agentId=${encodeURIComponent(this.agentId)}`),j=row.job;if(!j)throw new Error('job_not_found');await this.deviceRaw(j.deviceId);return cleanJob(j);}
  async output(jobId,stream='stdout',offset=0,limit=4*1024*1024,full=false){await this.job(jobId);const q=new URLSearchParams({agentId:this.agentId,stream:stream==='stderr'?'stderr':'stdout',offset:String(Math.max(0,offset)),limit:String(Math.max(1,Math.min(limit,8*1024*1024))),full:full?'1':'0'});const row=await callOperatorJson('GET',`/v1/output/${encodeURIComponent(jobId)}?${q}`);return {jobId:row.jobId,stream:row.stream,offset:row.offset,returnedBytes:row.returnedBytes,totalBytes:row.totalBytes,hasMore:row.hasMore,output:redactRestrictedText(row.output)};}
}
