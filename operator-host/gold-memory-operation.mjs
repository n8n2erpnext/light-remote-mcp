import crypto from 'node:crypto';
import {memoryActorKey,memoryDigest,memoryOperationId,normalizeMemoryRequest} from '../lib/gold-memory-operation.mjs';
import {authorizeMemoryWork} from './rmv2-work-authority.mjs';

export function memoryAgentSupported(version,minimumDev=13){
 const v=/^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/.exec(String(version));if(!v)return false;
 const current=[Number(v[1]),Number(v[2]),Number(v[3]),v[4]===undefined?Infinity:Number(v[4])],minimum=[0,10,1,minimumDev];
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
 const {session,owner}=memorySessionOwner(payload,deps);
 return startDeviceContentOperation(payload,requestId,deps,{session,owner,
  request:normalizeMemoryRequest(payload.memory),family:'memory',relay:deps.memoryContent,label:'Long Memory'});
}

// Memory and the review pilot share dispatch plumbing, not validators,
// opaque refs, actor binding or content storage.
export async function startDeviceContentOperation(payload,requestId,deps,{session,owner,request,family,relay,label}){
 const operationId=memoryOperationId(payload.operationId);
 if(payload.nodeId!==session.nodeId||session.nodeId===deps.NODE_ID)throw Error('gold_memory_target_denied');
 // New typed commands must never fall back to the old body-bearing exec path.
 const version=String(deps.devices.get(session.deviceId).agentVersion??'');
 if(!memoryAgentSupported(version,family==='worker'?14:13))
  throw Object.assign(Error(family==='worker'?'api_worker_agent_upgrade_required':'gold_memory_agent_upgrade_required'),{status:409});
 const fingerprint=memoryDigest({owner,operationId,...(family==='memory'?{}:{family}),requestDigest:memoryDigest(request)});
 const prior=deps.operationDedupe.get(operationId);
 if(prior){
  if(prior.fingerprint!==fingerprint)throw Error('gold_memory_operation_conflict');
  const job=deps.jobs.get(prior.jobId);if(job)return job;
 }
 const ticket=relay.put(owner,operationId,request);
 const toolMeta={kind:family,op:request.action,label};
 const {accountId,deviceId,sessionId,agentId}=owner;
 const job={id:crypto.randomUUID(),requestId,operationId,operationFingerprint:fingerprint,accountId,deviceId,sessionId,agentId,nodeId:session.nodeId,note:'local-'+family,cwd:'',script:label,status:'running',startedAt:Date.now(),finishedAt:null,exitCode:null,signal:null,timedOut:false,stdout:deps.createAccumulator(),stderr:deps.createAccumulator(),waiters:[],pid:null,timer:null,remote:true,commandId:null,requiredCapabilities:['filesystem'],resultData:{ok:false,[family]:{requestRef:ticket.requestRef,phase:'unknown'}},resultSummary:'',toolMeta};
 deps.assertToolCallQuota(owner.accountId);
 const historical=await deps.reserveGoldJob(job);if(historical)return historical;
 deps.jobs.set(job.id,job);deps.goldJobs.save(job);deps.sessions.attachJob(session.id,job.id);deps.sessions.record(session.id,'toolCalls');
 deps.operationDedupe.set(operationId,{jobId:job.id,fingerprint,expiresAt:Date.now()+deps.OPERATION_DEDUPE_MS});
 deps.pushEvent({type:'job_started',jobId:job.id,requestId,operationId,accountId,deviceId,sessionId,agentId,nodeId:session.nodeId,status:'running',route:'outbound-leaf',requiredCapabilities:['filesystem'],toolMeta});
 const command=deps.enqueueForJob(job,{accountId,deviceId,nodeId:session.nodeId,jobId:job.id,payload:{type:family,operationId,sessionId,agentId,requestRef:ticket.requestRef,requestDigest:ticket.requestDigest}});
 job.commandId=command.commandId;
 job.timer=setTimeout(()=>{if(job.finishedAt)return;deps.fleet.abandon(job.commandId,'remote_result_timeout');job.timedOut=true;deps.finishJob(job,124,null);},120000);job.timer.unref?.();
 return job;
}
