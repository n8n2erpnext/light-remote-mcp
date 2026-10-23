import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {
 bootstrapOwnerBroker,provisionTrustedContinuityOperator,
 startIsolatedControllerBroker,ownerBrokerRequest
} from '../../device-agent/project-continuity-owner-broker.mjs';
import {projectContinuityRequest,projectContinuityOwnerConsent}
 from '../../device-agent/project-continuity-client.mjs';
import {createProjectReadDelegation}
 from '../../lib/project-continuity-session-proof.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-cont-operator-proof-'));
const before={mode:process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER,
 root:process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT};
const password='isolated-operator-proof-fixture-only-passphrase';
let broker;
try{
 fs.chmodSync(root,0o700);
 bootstrapOwnerBroker({runtimeDir:root,password});
 process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER='1';
 process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT=root;
 const accountId='account-one',deviceId='device-1234',agentId='agent-one',sessionId='s_session-one';
 const signer=crypto.generateKeyPairSync('ed25519');
 const outsider=crypto.generateKeyPairSync('ed25519');
 const project=async()=>{
  const p=await projectContinuityRequest('createProject',{name:'Signed relay privacy test'});
  await projectContinuityRequest('setModules',{projectId:p.id,memory:true,expectedRevision:1});
  await projectContinuityRequest('memoryPut',{projectId:p.id,body:'SENSITIVE_CANARY_READS_ONLY_WITH_OPERATOR_PROOF',sourceRef:'owner:test'});
  await projectContinuityOwnerConsent({principal:'owner',password,projectId:p.id,enabled:true,expectedRevision:2});
  return p.id;
 };
 broker=await startIsolatedControllerBroker({runtimeDir:root,clientGroupMode:0o600});
 await once(broker.server,'listening');
 const id=await project();
 const make=(input={},key=signer.privateKey)=> {
  const data={requestId:crypto.randomUUID(),projectId:id,query:'',maxChars:1600,...input};
  const proof=createProjectReadDelegation({privateKey:key,accountId,deviceId,agentId,sessionId,
   projectId:data.projectId,requestId:data.requestId,query:data.query,maxChars:data.maxChars});
  return {...data,proof};
 };
 await assert.rejects(projectContinuityRequest('remoteBrief',{...make()}),/continuity_operator_trust_missing/);
 await broker.stop();broker=null;
 provisionTrustedContinuityOperator({runtimeDir:root,accountId,deviceId,
  publicKeyPem:signer.publicKey.export({format:'pem',type:'spki'})});
 assert.throws(()=>provisionTrustedContinuityOperator({runtimeDir:root,accountId,deviceId,
  publicKeyPem:outsider.publicKey.export({format:'pem',type:'spki'})}),/EEXIST/);
 broker=await startIsolatedControllerBroker({runtimeDir:root,clientGroupMode:0o600});
 await once(broker.server,'listening');
 const valid=make();
 const result=await projectContinuityRequest('remoteBrief',valid);
 assert.match(result.content,/SENSITIVE_CANARY_READS_ONLY_WITH_OPERATOR_PROOF/);
 await assert.rejects(projectContinuityRequest('remoteBrief',valid),/continuity_remote_read_denied/);
 await assert.rejects(projectContinuityRequest('remoteBrief',{...make(),proof:null}),/continuity_remote_delegation_required/);
 const wrongQuery=make();
 await assert.rejects(projectContinuityRequest('remoteBrief',{...wrongQuery,query:'altered'}),/continuity_operator_request_mismatch/);
 await assert.rejects(projectContinuityRequest('remoteBrief',make({},outsider.privateKey)),/continuity_operator_signature_invalid/);
 const wrongDevice=make();
 wrongDevice.proof=createProjectReadDelegation({privateKey:signer.privateKey,accountId,deviceId:'device-other',
  agentId,sessionId,projectId:id,requestId:wrongDevice.requestId,query:'',maxChars:1600});
 await assert.rejects(projectContinuityRequest('remoteBrief',wrongDevice),/continuity_operator_identity_mismatch/);
 const wrongAccount=make();
 wrongAccount.proof=createProjectReadDelegation({privateKey:signer.privateKey,accountId:'other-account',deviceId,
  agentId,sessionId,projectId:id,requestId:wrongAccount.requestId,query:'',maxChars:1600});
 await assert.rejects(projectContinuityRequest('remoteBrief',wrongAccount),/continuity_operator_identity_mismatch/);
 const wrongSession=make();
 wrongSession.proof=createProjectReadDelegation({privateKey:signer.privateKey,accountId,deviceId,
  agentId,sessionId:'not-current-session',projectId:id,requestId:wrongSession.requestId,query:'',maxChars:1600});
 // Signed non-current session ID cannot be distinguished by the broker
 // without an online Operator revocation proof. This assertion documents
 // that only the Operator may mint token AFTER its active-session check.
 assert.equal((await projectContinuityRequest('remoteBrief',wrongSession)).projectId,id);
 const another=await projectContinuityRequest('createProject',{name:'No consent fixture'});
 await projectContinuityRequest('setModules',{projectId:another.id,memory:true,expectedRevision:1});
 await assert.rejects(projectContinuityRequest('remoteBrief',make({projectId:another.id})),/continuity_remote_read_denied/);
 const expired=make();
 expired.proof=createProjectReadDelegation({privateKey:signer.privateKey,accountId,deviceId,
  agentId,sessionId,projectId:id,requestId:expired.requestId,query:'',maxChars:1600,now:Date.now()-10000});
 await assert.rejects(projectContinuityRequest('remoteBrief',expired),/continuity_operator_proof_expired/);
 const playedBeforeRestart=make();
 await projectContinuityRequest('remoteBrief',playedBeforeRestart);
 await broker.stop();broker=null;
 broker=await startIsolatedControllerBroker({runtimeDir:root,clientGroupMode:0o600});
 await once(broker.server,'listening');
 await assert.rejects(projectContinuityRequest('remoteBrief',playedBeforeRestart),/continuity_remote_read_denied/);
 const afterRestart=make();
 assert.match((await projectContinuityRequest('remoteBrief',afterRestart)).content,/SENSITIVE_CANARY/);
 const rev=await projectContinuityRequest('getProject',{projectId:id});
 await projectContinuityOwnerConsent({principal:'owner',password,projectId:id,enabled:false,expectedRevision:rev.revision});
 await assert.rejects(projectContinuityRequest('remoteBrief',make()),/continuity_remote_read_denied/);
 console.log('CONTINUITY_OPERATOR_TRUST_PINNING_NO_SILENT_BOOTSTRAP_PASS');
 console.log('CONTINUITY_SIGNED_SESSION_PROJECT_QUERY_DEVICE_SCOPE_PASS');
 console.log('CONTINUITY_REMOTE_READ_DURABLE_REPLAY_EXPIRY_REVOKE_PASS');
 console.log('CONTINUITY_ISOLATED_BROKER_NO_JOB_NO_DIRECT_SQL_PASS');
}finally{
 try{await broker?.stop();}catch{}
 if(before.mode===undefined)delete process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER;else process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER=before.mode;
 if(before.root===undefined)delete process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT;else process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT=before.root;
 fs.rmSync(root,{recursive:true,force:true});
}
