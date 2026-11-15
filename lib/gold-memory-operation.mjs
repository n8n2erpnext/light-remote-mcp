import crypto from 'node:crypto';

// Canonical, typed content. Never serialize this into a job/command/event.
const actions=new Set(['handoff','list','get','save','scopes','scope_resolve','scope_handoff','scope_get','scope_save','scope_usage','scope_full_context']);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function fail(){throw Object.assign(Error('gold_memory_request_invalid'),{status:400});}
function text(value,min,max){if(typeof value!=='string'||value.length<min||value.length>max)fail();return value;}
function integer(value,fallback,min,max){const n=value??fallback;if(!Number.isSafeInteger(n)||n<min||n>max)fail();return n;}
export function normalizeMemoryRequest(x){
 if(!x||!actions.has(x.action))fail();const v={action:x.action};
 if(['save','scope_save'].includes(v.action)){
  Object.assign(v,{title:text(x.title,1,240),body:text(x.body,1,12000),source:text(x.source,1,512),kind:x.kind??'checkpoint'});
  if(!['checkpoint','decision','handoff'].includes(v.kind))fail();
  if(v.action==='scope_save'){
   v.status=x.status??'observed';if(!['observed','claimed','test_passed','owner_approved','blocked'].includes(v.status))fail();
   if(x.evidence!==undefined){if(!Array.isArray(x.evidence)||x.evidence.length>24)fail();v.evidence=x.evidence.map(e=>text(e,1,300));}
  }
 }
 if(['get','scope_get'].includes(v.action)){if(!uuid.test(x.id??''))fail();v.id=x.id;}
 if(['scope_save','scope_get','scope_handoff','scope_full_context'].includes(v.action)){if(!uuid.test(x.scopeId??''))fail();v.scopeId=x.scopeId;}
 if(v.action==='list')v.query=text(x.query??'',0,160);
 if(['handoff','list','scope_handoff'].includes(v.action))v.limit=integer(x.limit,5,1,v.action==='handoff'?10:v.action==='scope_handoff'?20:30);
 if(v.action==='scope_resolve'){
  if(!['workspace','repository','job','task','work_context'].includes(x.sourceType))fail();
  v.sourceType=x.sourceType;v.sourceId=text(x.sourceId,1,1024);
 }
 if(v.action==='scope_full_context'){v.offset=integer(x.offset,0,0,524288);v.maxChars=integer(x.maxChars,8000,1,10000);}
 return v;
}
export function memoryDigest(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function memoryActorKey(owner){
 return ['accountId','deviceId','sessionId','agentId'].map(k=>{
  const v=owner?.[k];if(typeof v!=='string'||!/^[A-Za-z0-9._:-]{1,160}$/.test(v))fail();return v;
 }).join('|');
}
export function memoryOperationId(value){if(typeof value!=='string'||!/^[A-Za-z0-9._:-]{16,128}$/.test(value))fail();return value;}
export function memoryRef(value){if(typeof value!=='string'||!/^mem_[a-f0-9]{48}$/.test(value))fail();return value;}
// This is the ONLY result shape permitted in durable job/control channels.
export function memoryControlResult(value){
 return {ok:value?.ok===true,memory:{requestRef:memoryRef(value?.memory?.requestRef),phase:['completed','failed','unknown'].includes(value?.memory?.phase)?value.memory.phase:'unknown'}};
}
export function memorySafeError(error){
 const code=String(error?.message??'');
 return /^gold_(?:memory|scope|checkpoint|module)_[a-z0-9_]{1,100}$/.test(code)?code:'gold_memory_operation_failed';
}
