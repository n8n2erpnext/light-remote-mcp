export const UPDATE_REPORT_SCHEMA=1;
export const UPDATE_CODES=Object.freeze({
  MANIFEST_FETCH:'LRU100',
  MANIFEST_SIGNATURE:'LRU101',
  ARTIFACT_MISSING:'LRU110',
  ARTIFACT_INTEGRITY:'LRU111',
  CORE_STAGE:'LRU120',
  CORE_RESTART:'LRU130',
  CORE_HEALTH:'LRU131',
  ROLLBACK_MISSING:'LRU140',
  ROLLBACK_FAILED:'LRU141',
  HELPER_FINALIZE:'LRU150',
  HELPER_HEALTH:'LRU151',
  UNKNOWN:'LRU199'
});
const CODE_SET=new Set(Object.values(UPDATE_CODES));
const bounded=(value,max=160)=>String(value??'').trim().slice(0,max);
export function normalizeUpdateStatus(input={}){
  const state=bounded(input.state||'idle',40)||'idle';
  return {state,currentVersion:bounded(input.currentVersion,64)||null,targetVersion:bounded(input.targetVersion,64)||null,helperVersion:bounded(input.helperVersion,64)||null,code:CODE_SET.has(String(input.code||''))?String(input.code):null,updatedAt:Number.isSafeInteger(Number(input.updatedAt))?Number(input.updatedAt):null};
}
export function normalizeUpdateReport(input={}){
  const outcome=bounded(input.outcome,24);
  if(!['success','rollback','failed'].includes(outcome))throw new Error('invalid_update_report_outcome');
  const code=String(input.code||'');
  if(outcome!=='success'&&!CODE_SET.has(code))throw new Error('invalid_update_report_code');
  const reportId=bounded(input.reportId,96);
  if(!/^ur_[A-Za-z0-9_-]{12,80}$/.test(reportId))throw new Error('invalid_update_report_id');
  const rollback=input.rollback&&typeof input.rollback==='object'?input.rollback:{};
  return {schemaVersion:UPDATE_REPORT_SCHEMA,reportId,outcome,code:CODE_SET.has(code)?code:null,phase:bounded(input.phase,48)||null,fromVersion:bounded(input.fromVersion,64)||null,targetVersion:bounded(input.targetVersion,64)||null,activeVersion:bounded(input.activeVersion,64)||null,helperVersion:bounded(input.helperVersion,64)||null,platform:bounded(input.platform,32)||null,rollback:{attempted:Boolean(rollback.attempted),success:Boolean(rollback.success)},detail:bounded(input.detail,320)||null,at:Number.isSafeInteger(Number(input.at))?Number(input.at):Date.now()};
}
export function updateCodeKnown(value){return CODE_SET.has(String(value||''));}
