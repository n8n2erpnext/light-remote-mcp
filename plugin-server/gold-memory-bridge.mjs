import crypto from 'node:crypto';
import {normalizeMemoryRequest} from '../lib/gold-memory-operation.mjs';

export async function runGoldMemoryViaAuthorizedSession(adapter,input){
 const request=normalizeMemoryRequest(input);
 if(typeof adapter.memory!=='function')throw Error('gold_memory_agent_upgrade_required');
 const operationId=input.operationId??('memory-'+crypto.randomUUID());
 const response=await adapter.memory(input.sessionId,request,operationId);
 return {...response,operationId,sessionId:input.sessionId,source:'owner_authorized_gold_device',
   ...(response.pending?{nextAction:'poll_long_memory_status_with_requestRef_do_not_repeat_save'}:{})};
}
