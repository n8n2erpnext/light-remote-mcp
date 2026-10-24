/*
 * Gold tool receipt observer. NOT a transcript scraper and NOT a Codex worker.
 * Only a coarse operation category and outcome are persisted locally when the
 * owner opted into Long Memory. No raw commands, args, output or user text.
 *
 * Never blocks or changes the original Gold command result path. Failure to
 * record Memory must not break PTY, Filesystem, SCP or the A/B session.
 */
const TYPES=new Map([
 ['fs','filesystem'],['filesystem','filesystem'],
 ['terminal','terminal'],['exec','terminal'],
 ['search','search'],['scp','scp'],
 ['desktop','desktop'],['process','process'],['update','update']
]);
function validOperationId(x){return typeof x==='string'&&/^[A-Za-z0-9_.:-]{8,160}$/.test(x);}
export function safeGoldToolReceipt(command,result){
 if(!validOperationId(command?.commandId))return null;
 const category=TYPES.get(command?.payload?.type)||'other';
 const status=result?.status;
 const outcome=status==='ok'&&result?.exitCode===0?'ok':
   status==='denied'?'denied':status==='error'?'error':'unknown';
 return {operationId:command.commandId,category,outcome};
}
export function observeGoldToolReceipt(command,result,{request}={}){
 if(process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL!=='1')
  return Promise.resolve({recorded:false,reason:'continuity_feature_off'});
 const receipt=safeGoldToolReceipt(command,result);
 if(!receipt)return Promise.resolve({recorded:false,reason:'continuity_invalid_receipt'});
 // Dynamic import prevents extra local infrastructure even loading at OFF/OFF.
 return Promise.resolve().then(async()=>{
  const fn=request||(await import('./project-continuity-client.mjs')).projectContinuityRequest;
  return await fn('observeGoldTool',receipt,{timeoutMs:850});
 }).catch(()=>({recorded:false,reason:'continuity_local_memory_unavailable'}));
}
