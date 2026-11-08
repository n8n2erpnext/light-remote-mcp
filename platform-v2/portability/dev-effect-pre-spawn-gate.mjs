/**
 * Explicit DEV/UAT-ONLY native OS spawn wrapper.
 *
 * Makes the required ordering executable (durable intent before registry.start)
 * instead of expecting test callers to remember the steps. Not imported by
 * production Agent; NOT a global writer lease/fence or cleanup authority.
 */
const OWNER_FIELDS=['accountId','deviceId','sessionId','agentId'];
export function startDevTrackedAgentEffect({
  inventory,registry,intent,nativeStart
}={}){
  if(!inventory||typeof inventory.arm!=='function'||
     typeof inventory.recordSpawn!=='function'||
     !registry||typeof registry.start!=='function'||
     !intent||typeof intent!=='object'||Array.isArray(intent)||
     !nativeStart||typeof nativeStart!=='object'||Array.isArray(nativeStart))
    throw Error('DEV_EFFECT_GATE_INVALID_INPUT');
  if(!['process','terminal'].includes(intent.kind))
    throw Error('DEV_EFFECT_GATE_INVALID_KIND');
  for(const field of OWNER_FIELDS){
    if(!intent.owner||!Object.hasOwn(intent.owner,field)||
       intent.owner[field]!==nativeStart[field])
      throw Error('DEV_EFFECT_GATE_OWNER_MISMATCH:'+field);
  }
  // Failures after arm MUST keep this effect unresolved. Do not roll back the
  // intent even if spawn reports an error; OS-level ambiguity is possible.
  const armed=inventory.arm(intent);
  const started=registry.start(nativeStart);
  const handleId=armed.kind==='process'?started?.processId:started?.terminalId;
  if(typeof handleId!=='string'||!handleId)
    throw Error('DEV_EFFECT_GATE_SPAWN_HANDLE_MISSING');
  const linked=inventory.recordSpawn(armed.effectId,{registry,handleId});
  return {native:started,entry:linked,settlementAuthorized:false};
}
