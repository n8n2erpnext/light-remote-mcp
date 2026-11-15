import crypto from 'node:crypto';
import {memoryActorKey,memoryDigest,memoryOperationId,normalizeMemoryRequest} from '../lib/gold-memory-operation.mjs';
import {authorizeMemoryWork} from './rmv2-work-authority.mjs';

export function memoryAgentSupported(version){
 const v=/^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/.exec(String(version));if(!v)return false;
 const current=[Number(v[1]),Number(v[2]),Number(v[3]),v[4]===undefined?Infinity:Number(v[4])],minimum=[0,10,1,13];
 for(let i=0;i<4;i++){if(current[i]!==minimum[i])return current[i]>minimum[i];}return true;
}

export function memorySessionOwner(payload,deps){
 const session=deps.sessions.ensure(String(payload.sessionId??''),{agentId:String(payload.agentId??'')});
 if(session.accountId!==payload.accountId)throw Object.assign(Error('gold_memory_actor_denied'),{status:403});
 const owner={accountId:session.accountId,deviceId:session.deviceId,sessionId:session.id,agentId:session.agentId};
 memoryActorKey(owner);
 authorizeMemoryWork({payload:owner,device:{deviceId:owner.deviceId},binding:{accountId:owner.accountId}},deps);
 return {session,owner};
}

export async function startGoldMemoryOperation(payload,requestId,deps){
 const operationId=memoryOperationId(payload.operationId),request=normalizeMemoryRequest(payload.memory);
 const {session,owner}=memorySessionOwner(payload,deps);
 if(payload.nodeId!==session.nodeId||session.nodeId===deps.NODE_ID)throw Error('gold_memory_target_denied');
 // New typed commands must never fall back to the old body-bearing exec path.
 const version=String(deps.devices.get(session.deviceId).agentVersion??'');
 if(!memoryAgentSupported(version))
  throw Object.assign(Error('gold_memory_agent_upgrade_required'),{status:409});
 const fingerprint=memoryDigest({owner,operationId,requestDigest:memoryDigest(request)});
 const prior=deps.operationDedupe.get(operationId);
 if(prior){
  if(prior.fingerprint!==fingerprint)throw Error('gold_memory_operation_conflict');
  const job=deps.jobs.get(prior.jobId);if(job)return job;
 }
 const ticket=deps.memoryContent.put(owner,operationId,request);
 const toolMeta={kind:'memory',op:request.action,label:'Long Memory'};
 const job={id:crypto.randomUUID(),requestId,operationId,operationFingerprint:fingerprint,...owner,nodeId:session.nodeId,note:'local-memory',cwd:'',script:'Long Memory',status:'running',startedAt:Date.now(),finishedAt:null,exitCode:null,signal:null,timedOut:false,stdout:deps.createAccumulator(),stderr:deps.createAccumulator(),waiters:[],pid:null,timer:null,remote:true,commandId:null,requiredCapabilities:['filesystem'],resultData:{ok:false,memory:{requestRef:ticket.requestRef,phase:'unknown'}},resultSummary:'',toolMeta};
 deps.assertToolCallQuota(owner.accountId);
 const historical=await deps.reserveGoldJob(job);if(historical)return historical;
 deps.jobs.set(job.id,job);deps.goldJobs.save(job);deps.sessions.attachJob(session.id,job.id);deps.sessions.record(session.id,'toolCalls');
 deps.operationDedupe.set(operationId,{jobId:job.id,fingerprint,expiresAt:Date.now()+deps.OPERATION_DEDUPE_MS});
 deps.pushEvent({type:'job_started',jobId:job.id,requestId,operationId,...owner,nodeId:session.nodeId,status:'running',route:'outbound-leaf',requiredCapabilities:['filesystem'],toolMeta});
 const command=deps.enqueueForJob(job,{accountId:owner.accountId,deviceId:owner.deviceId,nodeId:session.nodeId,jobId:job.id,payload:{type:'memory',operationId,sessionId:owner.sessionId,agentId:owner.agentId,requestRef:ticket.requestRef,requestDigest:ticket.requestDigest}});
 job.commandId=command.commandId;
 job.timer=setTimeout(()=>{if(job.finishedAt)return;deps.fleet.abandon(job.commandId,'remote_result_timeout');job.timedOut=true;deps.finishJob(job,124,null);},120000);job.timer.unref?.();
 return job;
}
