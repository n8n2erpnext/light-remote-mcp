/*
 * Device-side selection of Project Continuity local backend.
 * OFF by default. Isolated broker mode never reads the protected DB/token,
 * does not silently fall back to the same-user SQLite service, and refuses
 * remote MCP reads until broker+device A/B session binding is implemented.
 */
import path from 'node:path';
import {ownerBrokerRequest} from './project-continuity-owner-broker.mjs';
export function isolatedContinuityEnabled(){
 return process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER==='1';
}
export function isolatedContinuityRoot(){
 const root=String(process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT||'');
 if(!root||!path.isAbsolute(root))throw Error('continuity_broker_root_required');
 return root;
}
export async function projectContinuityRequest(action,data={},options={}){
 if(isolatedContinuityEnabled()){
  // A/B session validation and broker consent gating need a separate
  // confidential read operation. Never reuse generic local controller IPC.
  if(action==='remoteMemoryCheckpoint'){
   if(!data?.proof||typeof data.requestId!=='string')
    throw Error('continuity_remote_delegation_required');
   return ownerBrokerRequest({runtimeDir:isolatedContinuityRoot(),action:'remoteWrite',
    data,timeoutMs:options.timeoutMs??7500});
  }
  if(action==='remoteBrief'){
   // Caller sessionId is NOT proof; only a broker-pinned Ed25519 Operator
   // assertion over all request fields can authorize this remote read.
   if(!data?.proof||typeof data.requestId!=='string')
    throw Error('continuity_remote_delegation_required');
   return ownerBrokerRequest({runtimeDir:isolatedContinuityRoot(),action:'remoteRead',
    data,timeoutMs:options.timeoutMs??7500});
  }
  if(['applySignedOwnerConsent','applySignedOwnerWriteConsent'].includes(action))throw Error('continuity_broker_signature_direct_use_denied');
  return ownerBrokerRequest({runtimeDir:isolatedContinuityRoot(),action:'controller',
    data:{action,data},timeoutMs:options.timeoutMs??4000});
 }
 // Legacy same-user Controller is suitable for local-only P1 pilot, NOT
 // remote session trust. The isolated broker is mandatory for remoteBrief.
 const {continuityRequest}=await import('./project-continuity-ipc.mjs');
 if(action==='remoteBrief'||action==='remoteMemoryCheckpoint'){
  if(!data?.proof||typeof data.requestId!=='string')
   throw Error('continuity_remote_delegation_required');
  return continuityRequest(action==='remoteBrief'?'remoteSignedRead':'remoteSignedWrite',data,options);
 }
 return continuityRequest(action,data,options);
}
export async function projectContinuityOwnerConsent({principal,password,projectId,enabled,expectedRevision,scope='read'}={}){
 if(!isolatedContinuityEnabled())throw Error('continuity_isolated_broker_disabled');
 return ownerBrokerRequest({runtimeDir:isolatedContinuityRoot(),action:'ownerConsent',
  data:{principal,password,projectId,enabled,revision:expectedRevision,scope},timeoutMs:7000});
}
export async function projectContinuityOwnerRekey({oldPassword,newPassword}={}){
 if(!isolatedContinuityEnabled())throw Error('continuity_isolated_broker_disabled');
 return ownerBrokerRequest({runtimeDir:isolatedContinuityRoot(),action:'rekey',
  data:{oldPassword,newPassword},timeoutMs:7000});
}
