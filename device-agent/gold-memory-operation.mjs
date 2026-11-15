import {memoryActorKey,memoryDigest,memoryOperationId,memoryRef,normalizeMemoryRequest,memorySafeError} from '../lib/gold-memory-operation.mjs';

export function executeMemoryRequest(modules,input,{transactionManaged=false}={}){
 const x=normalizeMemoryRequest(input);
 switch(x.action){
  case 'handoff':return modules.handoff(x);
  case 'list':return modules.listCheckpoints(x);
  case 'get':return modules.readCheckpoint(x.id);
  case 'save':return modules.saveCheckpoint(x);
  case 'scopes':return modules.listMemoryScopes();
  case 'scope_resolve':return modules.resolveMemoryScope(x);
  case 'scope_handoff':return modules.scopedHandoff(x);
  case 'scope_get':return modules.readScopedCheckpoint({scopeId:x.scopeId,checkpointId:x.id});
  case 'scope_save':return modules.appendScopedCheckpoint(x,{transactionManaged});
  case 'scope_usage':return modules.localMemoryUsage();
  case 'scope_full_context':{
   const found=modules.readFullContext({scopeId:x.scopeId});if(!found.available)return found;
   const offset=Math.min(x.offset,found.text.length),text=found.text.slice(offset,offset+x.maxChars);
   return {scopeId:found.scopeId,available:true,title:found.title,bytes:found.bytes,sha256:found.sha256,integrity:found.integrity,checkpointRevision:found.checkpointRevision,totalChars:found.text.length,offset,text,nextOffset:offset+text.length,hasMore:offset+text.length<found.text.length};
  }
 }
}

// The caller has a signed enrolled control command. Recheck authority on both
// content fetch and reply push; local policy/module/Home checks remain final.
export async function executeRemoteMemory({state,command,modules,channel,allowed}){
 const ref=memoryRef(command.requestRef),operationId=memoryOperationId(command.operationId);
 const owner={accountId:state.enrollment?.accountId,deviceId:state.enrollment?.deviceId,sessionId:command.sessionId,agentId:command.agentId};
 memoryActorKey(owner);if(!allowed())throw Error('gold_memory_local_policy_denied');
 const actor={sessionId:owner.sessionId,agentId:owner.agentId,requestRef:ref,requestDigest:command.requestDigest};
 const fetched=await channel('memory-content-fetch',actor);
 const request=normalizeMemoryRequest(fetched.request);
 if(fetched.operationId!==operationId||fetched.requestRef!==ref||memoryDigest(request)!==command.requestDigest)throw Error('gold_memory_operation_conflict');
 let reply;
 try{
  if(!allowed())throw Error('gold_memory_local_policy_denied');
  const result=modules.remoteMemoryOperation({owner,operationId,request});
  reply={ok:true,action:request.action,result};
 }catch(error){reply={ok:false,error:memorySafeError(error)};}
 await channel('memory-content-push',{...actor,reply});
 // Never return the checkpoint or even its title to the command spool/result.
 return {ok:reply.ok,memory:{requestRef:ref,phase:reply.ok?'completed':'failed'}};
}
