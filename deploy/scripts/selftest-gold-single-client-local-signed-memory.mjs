import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {startContinuityServer,continuityRequest} from '../../device-agent/project-continuity-ipc.mjs';
import {provisionContinuityOwnerAuthority,signContinuityConsent} from '../../device-agent/project-continuity-owner-grants.mjs';
import {createProjectReadDelegation,createProjectWriteDelegation} from '../../lib/project-continuity-session-proof.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-single-client-memory-'));
fs.chmodSync(root,0o700);
const password='gold-account-owner-credential-only-fixture-1234';
const keys=crypto.generateKeyPairSync('ed25519');
const id={accountId:'gold-owner-account',deviceId:'gold-device',agentId:'gold-agent',sessionId:'gold-session'};
fs.writeFileSync(path.join(root,'trusted-operator-relay.json'),JSON.stringify({schema:1,
 accountId:id.accountId,deviceId:id.deviceId,
 publicKeyPem:keys.publicKey.export({format:'pem',type:'spki'})}),{mode:0o600});
provisionContinuityOwnerAuthority({root,signerDir:root,password});
let app;
const call=(action,data)=>continuityRequest(action,data,{root});
try{
 app=startContinuityServer({root});await once(app.server,'listening');
 const orig=await call('getGlobalModules');assert.equal(orig.memoryEnabled,false);
 const state=await call('setGlobalModules',{memory:true,codex:false,expectedRevision:orig.revision});
 const pid=state.defaultScopeId;
 assert.deepEqual(await call('listProjects'),[]);
 let p=await call('getProject',{projectId:pid});
 const note={projectId:pid,requestId:crypto.randomUUID(),body:'Test milestone: finished Gold baseline verification',kind:'observation',sourceRef:'verified:baseline'};
 const readArgs={projectId:pid,requestId:crypto.randomUUID(),query:'',maxChars:1600};
 const readProof=createProjectReadDelegation({privateKey:keys.privateKey,...id,...readArgs});
 const writeProof=createProjectWriteDelegation({privateKey:keys.privateKey,...id,...note});
 await assert.rejects(call('remoteSignedWrite',{...note,proof:writeProof}),/continuity_remote_write_denied/);
 await assert.rejects(call('remoteSignedRead',{...readArgs,proof:readProof}),/continuity_remote_read_denied/);
 let signed=signContinuityConsent({root,signerDir:root,password,projectId:pid,enabled:true,revision:p.revision,principal:'Gold account',scope:'read'});
 await call('applySignedOwnerConsent',{projectId:pid,proof:signed});
 p=await call('getProject',{projectId:pid});
 signed=signContinuityConsent({root,signerDir:root,password,projectId:pid,enabled:true,revision:p.revision,principal:'Gold account',scope:'write'});
 await call('applySignedOwnerWriteConsent',{projectId:pid,proof:signed});
 const result=await call('remoteSignedWrite',{...note,proof:writeProof});
 assert.equal(result.saved,true);
 const replay=await call('remoteSignedWrite',{...note,proof:writeProof});
 assert.equal(replay.duplicate,true);
 const read=await call('remoteSignedRead',{...readArgs,proof:readProof});
 assert.match(read.content,/finished Gold baseline/);
 await assert.rejects(call('remoteSignedRead',{...readArgs,proof:readProof}),/continuity_invalid_request|continuity_action_failed|SQLITE_CONSTRAINT|UNIQUE constraint/);
 p=await call('getProject',{projectId:pid});
 signed=signContinuityConsent({root,signerDir:root,password,projectId:pid,enabled:false,revision:p.revision,principal:'Gold account',scope:'write'});
 await call('applySignedOwnerWriteConsent',{projectId:pid,proof:signed});
 const afterRevoke={...note,requestId:crypto.randomUUID()};
 await assert.rejects(call('remoteSignedWrite',{...afterRevoke,proof:createProjectWriteDelegation({privateKey:keys.privateKey,...id,...afterRevoke})}),/continuity_remote_write_denied/);
 console.log('ONE_GOLD_LOCAL_CLIENT_SIGNED_MEMORY_READ_WRITE_NO_PROJECT_PASS');
 console.log('ONE_GOLD_LOCAL_CLIENT_OWNER_CONSENT_UNVERIFIED_CHECKPOINT_IDEMPOTENCY_PASS');
}finally{
 await app?.stop();fs.rmSync(root,{recursive:true,force:true});
}
