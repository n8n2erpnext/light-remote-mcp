import crypto from 'node:crypto';
import { callOperatorJson } from '../gateway/operator-proxy.mjs';
import { sealOperatorPayload } from '../gateway/operator-crypto.mjs';
import { redactRestrictedText } from './response-sanitizer.mjs';

const opId=p=>`${p}-${crypto.randomUUID()}`;
const cleanDevice=d=>({deviceId:d.deviceId,name:d.displayName,platform:d.platform,architecture:d.architecture,state:d.state,capabilities:[...(d.effectiveCapabilities||d.capabilities||d.approvedCapabilities||[])]});
const cleanSession=s=>({sessionId:s.sessionId,deviceId:s.deviceId,state:s.state,workspace:s.workspace||'',gracePreset:s.gracePreset||null});
const cleanJob=j=>({jobId:j.jobId,state:j.state||null,running:!j.finishedAt,exitCode:j.exitCode??null});

function stableAgentId(identity){return `plugin-${crypto.createHash('sha256').update(`${identity.accountId}|${identity.clientId}`).digest('hex').slice(0,40)}`;}
export class AccountOperatorAdapter{
  constructor(identity){if(!identity?.accountId)throw new Error('plugin_identity_required');this.identity=identity;this.agentId=stableAgentId(identity);}
  async ownedDevicesRaw(){const row=await callOperatorJson('GET','/v1/devices');return (row.devices||[]).filter(d=>d.accountId===this.identity.accountId&&d.state!=='revoked');}
  async devices(){return (await this.ownedDevicesRaw()).map(cleanDevice);}
  async deviceRaw(deviceId){const row=await callOperatorJson('GET',`/v1/devices/${encodeURIComponent(deviceId)}`),d=row.device;if(!d||d.accountId!==this.identity.accountId||d.state==='revoked')throw Object.assign(new Error('device_not_available'),{status:404});return d;}
  async openSession({deviceId,workspace='',gracePreset='60m'}={}){const d=await this.deviceRaw(deviceId);if(d.state!=='online')throw new Error('device_offline');const row=await callOperatorJson('POST','/v1/sessions/open',{accountId:this.identity.accountId,agentId:this.agentId,label:'ChatGPT Light Remote',workspace:String(workspace||'').slice(0,512),nodeId:d.nodeId,gracePreset});if(row?.session?.deviceId!==d.deviceId)throw new Error('session_target_mismatch');return cleanSession(row.session);}
  async sessionRaw(sessionId){const row=await callOperatorJson('GET',`/v1/sessions/${encodeURIComponent(sessionId)}?agentId=${encodeURIComponent(this.agentId)}`),s=row.session;if(!s)throw new Error('session_not_found');await this.deviceRaw(s.deviceId);return s;}
  async sessions(){const owned=new Set((await this.ownedDevicesRaw()).map(d=>d.deviceId)),row=await callOperatorJson('GET','/v1/sessions');return (row.sessions||[]).filter(s=>s.agentId===this.agentId&&owned.has(s.deviceId)).map(cleanSession);}
  async closeSession(sessionId){await this.sessionRaw(sessionId);const row=await callOperatorJson('POST',`/v1/sessions/${encodeURIComponent(sessionId)}/close`,{agentId:this.agentId});return cleanSession(row.session);}
  async fs(sessionId,fs,operationId=opId('fs'),waitMs=7000){const s=await this.sessionRaw(sessionId),payload={action:'fs',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,fs,waitMs};return callOperatorJson('POST','/v1/fs',sealOperatorPayload(payload));}
  async search(sessionId,search,operationId=opId('search'),waitMs=7000){const s=await this.sessionRaw(sessionId),payload={action:'search',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,search,waitMs};return callOperatorJson('POST','/v1/search',sealOperatorPayload(payload));}
  async process(sessionId,process,operationId=opId('process'),waitMs=7000){const s=await this.sessionRaw(sessionId),payload={action:'process',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,process,waitMs};return callOperatorJson('POST','/v1/process',sealOperatorPayload(payload));}
  async terminal(sessionId,terminal,operationId=opId('terminal'),waitMs=7000){const s=await this.sessionRaw(sessionId),payload={action:'terminal',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,terminal,waitMs};return callOperatorJson('POST','/v1/terminal',sealOperatorPayload(payload));}
  async exec(sessionId,script,{cwd='',operationId=opId('exec'),timeoutMs=600000,waitMs=7000}={}){const s=await this.sessionRaw(sessionId),payload={action:'exec_batch',operationId,sessionId,agentId:this.agentId,nodeId:s.nodeId,script:String(script),cwd:String(cwd||''),timeoutMs,waitMs,requiredCapabilities:[],note:'OpenAI Light Remote plugin'};return callOperatorJson('POST','/v1/execute',sealOperatorPayload(payload));}
  async job(jobId){const row=await callOperatorJson('GET',`/v1/jobs/${encodeURIComponent(jobId)}?agentId=${encodeURIComponent(this.agentId)}`),j=row.job;if(!j)throw new Error('job_not_found');await this.deviceRaw(j.deviceId);return cleanJob(j);}
  async output(jobId,stream='stdout',offset=0,limit=262144){await this.job(jobId);const q=new URLSearchParams({agentId:this.agentId,stream:stream==='stderr'?'stderr':'stdout',offset:String(Math.max(0,offset)),limit:String(Math.max(1,Math.min(limit,1048576)))});const row=await callOperatorJson('GET',`/v1/output/${encodeURIComponent(jobId)}?${q}`);return {jobId:row.jobId,stream:row.stream,offset:row.offset,returnedBytes:row.returnedBytes,totalBytes:row.totalBytes,hasMore:row.hasMore,output:redactRestrictedText(row.output)};}
}
