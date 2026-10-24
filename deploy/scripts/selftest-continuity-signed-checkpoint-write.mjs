import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {bootstrapOwnerBroker,provisionTrustedContinuityOperator,startIsolatedControllerBroker,ownerBrokerRequest} from '../../device-agent/project-continuity-owner-broker.mjs';
import {projectContinuityRequest,projectContinuityOwnerConsent} from '../../device-agent/project-continuity-client.mjs';
import {createProjectReadDelegation,createProjectWriteDelegation} from '../../lib/project-continuity-session-proof.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-gold-memory-write-'));
const original={mode:process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER,
 root:process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT};
const password='private-owner-fixture-only-password-1337';
const identity={accountId:'account-gold',deviceId:'device-gold',agentId:'agent-gold',sessionId:'session-gold-active'};
const signer=crypto.generateKeyPairSync('ed25519');
let broker;
try{
 fs.chmodSync(root,0o700);
 bootstrapOwnerBroker({runtimeDir:root,password});
 provisionTrustedContinuityOperator({runtimeDir:root,accountId:identity.accountId,deviceId:identity.deviceId,
  publicKeyPem:signer.publicKey.export({format:'pem',type:'spki'})});
 process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER='1';
 process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT=root;
 broker=await startIsolatedControllerBroker({runtimeDir:root,clientGroupMode:0o600});
 await once(broker.server,'listening');
 const originalSettings=await projectContinuityRequest('getGlobalModules');
 assert.equal(originalSettings.memoryEnabled,false);
 let settings=await projectContinuityRequest('setGlobalModules',{memory:true,codex:false,expectedRevision:originalSettings.revision});
 const pid=settings.defaultScopeId;
 assert.equal((await projectContinuityRequest('listProjects')).length,0,'No Project creation required');
 const note={projectId:pid,requestId:crypto.randomUUID(),body:'Checkpoint: section B done; section C waiting review',kind:'observation',sourceRef:'commit:test-0001'};
 const signed=(info=note,key=signer.privateKey)=>({...info,proof:createProjectWriteDelegation({
  privateKey:key,...identity,...info
 })});
 await assert.rejects(projectContinuityRequest('remoteMemoryCheckpoint',signed()),/continuity_remote_write_denied/);
 let scope=await projectContinuityRequest('getProject',{projectId:pid});
 await projectContinuityOwnerConsent({principal:'owner@uat.local',password,projectId:pid,enabled:true,
  expectedRevision:scope.revision,scope:'write'});
 assert.equal((await projectContinuityRequest('remoteWriteStatus',{projectId:pid})).enabled,true);
 const first=await projectContinuityRequest('remoteMemoryCheckpoint',signed());
 assert.equal(first.saved,true);assert.equal(first.duplicate,false);
 const second=await projectContinuityRequest('remoteMemoryCheckpoint',signed());
 assert.equal(second.id,first.id);assert.equal(second.duplicate,true);
 await assert.rejects(projectContinuityRequest('remoteMemoryCheckpoint',signed({
  ...note,body:'DIFFERENT CONTENT WITH SAME IDEMPOTENCY KEY'
 })),/continuity_operation_reused/);
 assert.equal((await projectContinuityRequest('memorySearch',{projectId:pid,query:'Checkpoint'})).length,1);
 const wrong={...note,body:'tampered note'};
 await assert.rejects(projectContinuityRequest('remoteMemoryCheckpoint',{
  ...wrong,proof:signed().proof}),/continuity_operator_request_mismatch/);
 const readProof=createProjectReadDelegation({privateKey:signer.privateKey,...identity,
  projectId:pid,requestId:crypto.randomUUID(),query:'',maxChars:1600});
 await assert.rejects(projectContinuityRequest('remoteMemoryCheckpoint',{
  ...note,requestId:readProof.grant.requestId,proof:readProof}),/continuity_operator_purpose_invalid/);
 await assert.rejects(projectContinuityRequest('remoteMemoryCheckpoint',signed({...note,requestId:crypto.randomUUID()},crypto.generateKeyPairSync('ed25519').privateKey)),
  /continuity_operator_signature_invalid/);
 const secretNote={...note,requestId:crypto.randomUUID(),body:'secret '+ 'sk-proj-'+'A'.repeat(45)};
 await assert.rejects(projectContinuityRequest('remoteMemoryCheckpoint',signed(secretNote)),
  /continuity_sensitive_content_rejected/);
 await broker.stop();broker=null;
 broker=await startIsolatedControllerBroker({runtimeDir:root,clientGroupMode:0o600});
 await once(broker.server,'listening');
 const replay=await projectContinuityRequest('remoteMemoryCheckpoint',signed());
 assert.equal(replay.id,first.id);assert.equal(replay.duplicate,true);
 scope=await projectContinuityRequest('getProject',{projectId:pid});
 await projectContinuityOwnerConsent({principal:'owner@uat.local',password,projectId:pid,enabled:false,
  expectedRevision:scope.revision,scope:'write'});
 assert.equal((await projectContinuityRequest('remoteWriteStatus',{projectId:pid})).enabled,false);
 await assert.rejects(projectContinuityRequest('remoteMemoryCheckpoint',
  signed({...note,requestId:crypto.randomUUID()})),/continuity_remote_write_denied/);
 settings=await projectContinuityRequest('setGlobalModules',{memory:false,codex:false,expectedRevision:settings.revision});
 assert.equal(settings.memoryEnabled,false);
 await assert.rejects(projectContinuityRequest('remoteMemoryCheckpoint',
  signed({...note,requestId:crypto.randomUUID()})),/continuity_memory_disabled/);
 console.log('SIGNED_GOLD_OPERATOR_WRITE_CONSENT_SEPARATE_FROM_READ_PASS');
 console.log('SIGNED_GOLD_OPERATOR_NOTE_HASH_TAMPER_AND_REPLAY_PASS');
 console.log('SIGNED_GOLD_DEVICE_LOCAL_SQLITE_WRITE_ONLY_AND_REVOKE_PASS');
} finally {
 try{await broker?.stop();}catch{}
 if(original.mode===undefined)delete process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER;
 else process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER=original.mode;
 if(original.root===undefined)delete process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT;
 else process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT=original.root;
 fs.rmSync(root,{recursive:true,force:true});
}
