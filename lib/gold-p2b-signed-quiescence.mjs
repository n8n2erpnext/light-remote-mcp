/**
 * P2-B signed-effect quiescence boundary.
 * Aggregates only. No device IDs, job IDs, process IDs or signed payloads
 * are returned. This never releases resource claims or fabricates ACKs.
 */
const integer=v=>Number.isSafeInteger(v)&&v>=0;
export function evaluateP2BQuiescence(evidence={}){
 const fields=['unknownTotal','retainedPreDispatch','unresolvedUnknown',
  'startedUnknown','foreignClaims','runningClaims','claimsWithoutTerminalAck',
  'claimsWithProcessId','unknownWithClaims','terminalAckMatches'];
 if(fields.some(field=>!integer(evidence[field])))
  throw Error('p2b_quiescence_aggregate_missing_or_invalid');
 if(evidence.retainedPreDispatch+evidence.unresolvedUnknown!==evidence.unknownTotal||
    evidence.startedUnknown>evidence.unresolvedUnknown||
    evidence.unknownWithClaims>evidence.unknownTotal||
    evidence.runningClaims>evidence.foreignClaims||
    evidence.claimsWithoutTerminalAck>evidence.foreignClaims||
    evidence.claimsWithProcessId>evidence.foreignClaims||
    evidence.terminalAckMatches>evidence.foreignClaims)
  throw Error('p2b_quiescence_aggregate_inconsistent');
 const block=[];
 if(evidence.unresolvedUnknown>0)block.push('unknown_dispatch_or_missing_reason_unresolved');
 if(evidence.retainedPreDispatch>0)block.push('retained_interrupted_tombstones_require_preservation');
 if(evidence.foreignClaims>0)block.push('foreign_m4_claim_requires_signed_reconciliation');
 if(evidence.runningClaims>0)block.push('os_effect_may_still_be_running');
 if(evidence.claimsWithoutTerminalAck>0)block.push('exact_signed_terminal_receipt_missing');
 if(evidence.unknownWithClaims>0)block.push('unknown_work_resource_claim_overlap');
 // SQL rows, status=interrupted, and elapsed time are not signed OS proof.
 // Even an empty result does not grant permission to migrate or reconnect.
 block.push('no_fresh_signed_os_effect_quiescence_or_owner_approval');
 return Object.freeze({
  phase:'P2-B',source:'aggregated_read_only_sql',
  unknownTotal:evidence.unknownTotal,
  retainedPreDispatch:evidence.retainedPreDispatch,
  unresolvedUnknown:evidence.unresolvedUnknown,
  startedUnknown:evidence.startedUnknown,
  foreignClaims:evidence.foreignClaims,
  runningClaims:evidence.runningClaims,
  claimsWithoutTerminalAck:evidence.claimsWithoutTerminalAck,
  claimTerminalAckMatches:evidence.terminalAckMatches,
  classification:evidence.unresolvedUnknown||evidence.foreignClaims?'HOLD':'SIGNED_PROOF_STILL_REQUIRED',
  blockers:Object.freeze(block),
  signedQuiescenceProven:false,
  releaseAllowed:false,
  modifiedRows:0,
 });
}
