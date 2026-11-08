/**
 * Light Remote rc50 — OFFLINE SOURCE-REVIEW ONLY.
 * Maps known operator-agent.mjs command types and sub-ops into P0 review lanes.
 * This does NOT accept/authorize commands, validate device grants, acquire locks,
 * verify signatures, persist receipts or execute OS work. NEVER wire as a
 * production allowlist. Unknown paths DENY and require independent review.
 */
const lanes = Object.freeze({
  EXEC: 'NATIVE_EXECUTION_GUARD',
  CONTROL: 'NATIVE_CONTROL_GUARD',
  IO: 'FILESYSTEM_MUTATION_GUARD',
  OBSERVE: 'OBSERVATION_AND_RECEIPT_REVIEW',
  UNKNOWN: 'MANUAL_REVIEW_REQUIRED'
});
const sets = Object.freeze({
  process: {exec:['start','input','stop'], observe:['output','list']},
  terminal: {exec:['start','input','signal','stop','resize'], observe:['output','list']},
  desktop: {exec:['run'], control:['attach','resume','detach','live-open','live-close','semantic-detach'], observe:['status','windows','frame','observe']},
  scp: {io:['upload-begin','upload-chunk','upload-commit'], control:['download-begin','cancel'], observe:['download-chunk','status']},
  search: {control:['start','cancel'], observe:['results']}
});
const own = (o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function decision({type=null, op=null, classification=lanes.UNKNOWN, sourceAnchor=null, reason}){
  return Object.freeze({type,op,classification,reason,sourceAnchor,
    knownPath:classification!==lanes.UNKNOWN,
    productionAuthorized:false,physicalExecutionAuthorized:false,
    epochRequired:true,deviceReceiptRequired:true,
    localLockRequired:true,actionSpecificReviewRequired:true,
    enforcementInstalled:false});
}
/** Classification is not permission. All categories still require epoch and receipt. */
export function classifyRc50AgentAction(value){
  if(!value||typeof value!=='object'||Array.isArray(value))
    return decision({reason:'INVALID_ACTION_SHAPE'});
  const type=value.type,op=value.op;
  if(typeof type!=='string'||type.length>32||typeof op!=='undefined'&&typeof op!=='string')
    return decision({reason:'INVALID_ACTION_FIELDS'});
  if(type==='exec')return decision({type,op:null,classification:lanes.EXEC,sourceAnchor:'device-agent/operator-agent.mjs:618-651',reason:'SHELL_OR_SCRIPT_EXECUTION'});
  if(type==='update')return decision({type,op:null,classification:lanes.CONTROL,sourceAnchor:'device-agent/operator-agent.mjs:559-563',reason:'LOCAL_UPDATER_TRIGGER'});
  if(type==='fs')return decision({type,op:op??null,sourceAnchor:'device-agent/operator-agent.mjs:601-617',reason:'FS_SUBOPERATIONS_NOT_YET_INDEPENDENTLY_CENSUSED'});
  if(!own(sets,type))return decision({type,op:op??null,reason:'UNKNOWN_LEAF_COMMAND_TYPE'});
  if(typeof op!=='string'||!op||op.length>40)return decision({type,op:null,reason:'SUBOP_REQUIRED'});
  const spec=sets[type];
  for(const category of ['exec','io','control','observe']){
    if(spec[category]?.includes(op)){
      const classification=category==='exec'?lanes.EXEC:category==='io'?lanes.IO:category==='control'?lanes.CONTROL:lanes.OBSERVE;
      return decision({type,op,classification,
        sourceAnchor:sourceAnchor(type),reason:'REVIEWED_SOURCE_MARKER_ONLY'});
    }
  }
  return decision({type,op,reason:'UNREVIEWED_SUBOP'});
}
function sourceAnchor(type){
  const spans={process:'device-agent/operator-agent.mjs:363-377',terminal:'device-agent/operator-agent.mjs:379-396',
    desktop:'device-agent/operator-agent.mjs:402-534',scp:'device-agent/operator-agent.mjs:535-550',
    search:'device-agent/operator-agent.mjs:398-400'};
  return spans[type];
}
export function rc50ActionTriageCatalog(){
  return Object.freeze(Object.fromEntries(Object.entries(sets).map(([type,spec])=>[
    type,Object.freeze(Object.fromEntries(Object.entries(spec).map(([k,values])=>[k,Object.freeze([...values])])))
  ])));
}
