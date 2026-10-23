import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import crypto from 'node:crypto';
import {
 bootstrapOwnerBroker,startIsolatedControllerBroker,ownerBrokerRequest
} from '../../device-agent/project-continuity-owner-broker.mjs';
import {
 projectContinuityRequest,projectContinuityOwnerConsent
} from '../../device-agent/project-continuity-client.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-owner-protected-controller-'));
const password='isolated-restart-password-fixture-only-2026';
let broker;
const before={
 mode:process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER,
 root:process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT
};
try{
 fs.chmodSync(root,0o700);
 bootstrapOwnerBroker({runtimeDir:root,password});
 process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER='1';
 process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT=root;
 broker=await startIsolatedControllerBroker({runtimeDir:root,clientGroupMode:0o600});
 await once(broker.server,'listening');
 const project=await projectContinuityRequest('createProject',{name:'Persisted isolated controller'});
 assert.equal(project.memory_enabled,0);
 const enabled=await projectContinuityRequest('setModules',{projectId:project.id,memory:true,expectedRevision:1});
 assert.equal(enabled.memory_enabled,1);
 await projectContinuityRequest('memoryPut',{projectId:project.id,body:'PERSISTED_ISOLATED_PRIVATE_2070',sourceRef:'owner:fixture'});
 // Same cross-OS contract: independent module switches and full-size local note.
 const codexOnly=await projectContinuityRequest('createProject',{name:'Codex only'});
 await projectContinuityRequest('setModules',{projectId:codexOnly.id,codex:true,expectedRevision:1});
 const codexState=await projectContinuityRequest('getProject',{projectId:codexOnly.id});
 assert.equal(codexState.memory_enabled,0);
 assert.equal(codexState.codex_enabled,1);
 await assert.rejects(projectContinuityRequest('contextBrief',{projectId:codexOnly.id}),
  /continuity_memory_disabled/);
 const longNote=await projectContinuityRequest('memoryPut',{projectId:project.id,
  body:'a'.repeat(10000),sourceRef:'owner:bounded-max-note'});
 assert.equal(longNote.kind,'observation');
 const combined=await projectContinuityRequest('createProject',{name:'Both modules'});
 await projectContinuityRequest('setModules',{projectId:combined.id,memory:true,codex:true,expectedRevision:1});
 const modes=await projectContinuityRequest('listProjects');
 assert.equal(modes.length,3);
 assert.equal(modes.find(p=>p.id===combined.id).codex_enabled,1);
 assert.equal(modes.find(p=>p.id===combined.id).memory_enabled,1);
 const permit=await projectContinuityOwnerConsent({principal:'owner',password,
  projectId:project.id,enabled:true,expectedRevision:2});
 assert.equal(permit.remoteReadEnabled,true);
 await assert.rejects(projectContinuityRequest('remoteBrief',{projectId:project.id}),
  /continuity_remote_delegation_required/);
 await broker.stop();broker=null;
 broker=await startIsolatedControllerBroker({runtimeDir:root,clientGroupMode:0o600});
 await once(broker.server,'listening');
 const stored=await projectContinuityRequest('getProject',{projectId:project.id});
 assert.equal(stored.remote_read_enabled,1);
 const memory=await projectContinuityRequest('contextBrief',{projectId:project.id,query:'PERSISTED_ISOLATED_PRIVATE_2070',maxChars:2400});
 assert.match(memory.content,/PERSISTED_ISOLATED_PRIVATE_2070/);
 const rows=await projectContinuityRequest('memoryRecent',{projectId:project.id});
 assert.equal(rows.length,2);
 const revoked=await projectContinuityOwnerConsent({principal:'owner',password,
  projectId:project.id,enabled:false,expectedRevision:3});
 assert.equal(revoked.remoteReadEnabled,false);
 await broker.stop();broker=null;
 // The controller public-key pin is separate from root and cannot be
 // transparently replaced on a subsequent start.
 const anchor=path.join(root,'controller','owner-authority-public.pem');
 const pem=fs.readFileSync(anchor,'utf8');
 const alternative=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
 fs.writeFileSync(anchor,alternative,{mode:0o600});
 await assert.rejects(startIsolatedControllerBroker({runtimeDir:root}),
  /continuity_broker_controller_anchor_mismatch/);
 fs.writeFileSync(anchor,pem,{mode:0o600});
 console.log('ISOLATED_OWNER_CONTROLLER_RESTART_SQLITE_MEMORY_CONSENT_PASS');
 console.log('ISOLATED_OWNER_CONTROLLER_PINNED_TRUST_ANCHOR_MISMATCH_FAIL_CLOSED_PASS');
}finally{
 try{await broker?.stop();}catch{}
 if(before.mode===undefined)delete process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER;
 else process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER=before.mode;
 if(before.root===undefined)delete process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT;
 else process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT=before.root;
 fs.rmSync(root,{recursive:true,force:true});
}
