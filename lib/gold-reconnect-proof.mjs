import crypto from 'node:crypto';
import {canonicalJson} from './device-proof.mjs';

// SOURCE-ONLY V1 contract, not yet wired to any live Agent/server route.
// The enrolled device key authenticates a bounded journal inventory, while a
// server challenge and PG-issued monotonic execution epoch prevent replay.
// A signed empty/partial inventory is NEVER evidence that an OS job stopped.
const ident=/^[A-Za-z0-9._:-]{1,160}$/;
const jobId=/^[a-f0-9-]{36}$/i;
const processId=/^lp_[A-Za-z0-9_-]{20,80}$/;
const challengePattern=/^[a-f0-9]{32,128}$/;
const states=new Set(['running','finished','stopped','timeout','error','reserved','unknown']);
export const reconnectChallenge=()=>crypto.randomBytes(24).toString('hex');
const goodEpoch=v=>/^[1-9][0-9]{0,18}$/.test(String(v||''))&&BigInt(v)<=9223372036854775807n;
export function assertExecutionEpoch({commandEpoch,currentEpoch,authenticated=false}={}){
  if(!authenticated||!goodEpoch(commandEpoch)||!goodEpoch(currentEpoch)||
    BigInt(commandEpoch)!==BigInt(currentEpoch))throw Error('gold_execution_epoch_stale_or_untrusted');
  return true;
}
export function validateReconnectInventory(proof,{accountId,deviceId,challenge,minEpoch='1',now=Date.now()}={}){
  if(!proof||proof.version!==1||!ident.test(String(accountId||''))||!ident.test(String(deviceId||''))||
     proof.accountId!==accountId||proof.deviceId!==deviceId||
     !challengePattern.test(String(challenge||''))||proof.challenge!==challenge||
     !goodEpoch(proof.executionEpoch)||!goodEpoch(minEpoch)||
     BigInt(proof.executionEpoch)<BigInt(minEpoch)||
     !Number.isSafeInteger(proof.capturedAt)||Math.abs(now-proof.capturedAt)>120000||
     typeof proof.complete!=='boolean'||!Array.isArray(proof.processes)||proof.processes.length>128)
    throw Error('gold_reconnect_inventory_untrusted');
  const seen=new Set();
  for(const p of proof.processes){
    if(!p||!jobId.test(String(p.jobId||''))||
       p.processId!==null&&(!processId.test(String(p.processId||'')))||
       !states.has(String(p.state||''))||
       !Number.isSafeInteger(p.startedAt)||p.startedAt<=0||p.startedAt>now+120000||
       !ident.test(String(p.operationId||''))||seen.has(p.jobId))
      throw Error('gold_reconnect_inventory_invalid_record');
    seen.add(p.jobId);
    // A terminal record without an actual process identity is not a terminal
    // receipt; it may describe the crash window before the launch was saved.
    if(['finished','stopped','timeout','error'].includes(p.state)&&!p.processId)
      throw Error('gold_reconnect_terminal_without_process_identity');
  }
  return proof;
}
export function signReconnectInventory(proof,privateKey){
  return {proof,signature:crypto.sign(null,Buffer.from(canonicalJson(proof)),privateKey).toString('base64url')};
}
export function verifyReconnectInventory(statement,{publicKey,...expected}={}){
  const proof=validateReconnectInventory(statement?.proof,expected);
  const sig=String(statement?.signature||'');
  if(!/^[A-Za-z0-9_-]{80,128}$/.test(sig)||
     !crypto.verify(null,Buffer.from(canonicalJson(proof)),publicKey,Buffer.from(sig,'base64url')))
    throw Error('gold_reconnect_inventory_signature_invalid');
  return {verified:true,proof};
}
export function classifyReconnectFence(fence,verified){
  if(verified?.verified!==true||!fence||!verified.proof||
     fence.accountId!==verified.proof.accountId||fence.deviceId!==verified.proof.deviceId)
    return 'keep_untrusted';
  const match=verified.proof.processes.find(p=>p.jobId===fence.jobId);
  if(!match)return 'keep_not_in_inventory';
  if(fence.processId&&match.processId!==fence.processId)return 'keep_process_identity_mismatch';
  if(match.state==='running')return 'keep_running';
  if(match.state==='unknown'||match.state==='reserved')return 'keep_ambiguous';
  if(!fence.processId)return 'keep_no_pid_requires_durable_non_dispatch_proof';
  // A signed inventory alone is not the durable terminal receipt. Existing
  // signed terminal ACK machinery must validate exact process/finishedAt.
  return 'await_exact_terminal_receipt';
}
