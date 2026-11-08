import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {reconnectChallenge,assertExecutionEpoch,signReconnectInventory,
 verifyReconnectInventory,classifyReconnectFence} from '../../lib/gold-reconnect-proof.mjs';
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
const challenge=reconnectChallenge(),now=Date.now();
const accountId='acct-a',deviceId='dev-a',jobId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pId='lp_12345678901234567890';
const proof={version:1,accountId,deviceId,challenge,executionEpoch:'42',capturedAt:now,complete:true,
 processes:[{jobId,processId:pId,operationId:'op_1234567890123456',state:'running',startedAt:now-5000}]};
const expected={accountId,deviceId,challenge,minEpoch:'42',now};
const stmt=signReconnectInventory(proof,privateKey);
const verified=verifyReconnectInventory(stmt,{publicKey,...expected});
assert.equal(verified.verified,true);
assert.equal(classifyReconnectFence({accountId,deviceId,jobId,processId:pId},verified),'keep_running');
assert.equal(classifyReconnectFence({accountId,deviceId,jobId,processId:null},verified),'keep_running');
assert.equal(classifyReconnectFence({accountId,deviceId,jobId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',processId:null},verified),'keep_not_in_inventory');
assert.equal(classifyReconnectFence({accountId,deviceId:'dev-other',jobId,processId:pId},verified),'keep_untrusted');
assert.equal(classifyReconnectFence({accountId,deviceId,jobId,processId:'lp_99999999999999999999'},verified),'keep_process_identity_mismatch');
assert.equal(assertExecutionEpoch({commandEpoch:'42',currentEpoch:'42',authenticated:true}),true);
for(const arg of [{commandEpoch:'41',currentEpoch:'42',authenticated:true},
 {commandEpoch:'43',currentEpoch:'42',authenticated:true},
 {commandEpoch:'42',currentEpoch:'42',authenticated:false}])
 assert.throws(()=>assertExecutionEpoch(arg),/stale_or_untrusted/);
function denied(statement,exp=expected){assert.throws(()=>verifyReconnectInventory(statement,{publicKey,...exp}));}
denied(stmt,{...expected,challenge:reconnectChallenge()});
denied(stmt,{...expected,minEpoch:'43'});
denied(stmt,{...expected,deviceId:'another-device'});
denied({proof:{...proof,executionEpoch:'43'},signature:stmt.signature});
denied({proof:{...proof,processes:[...proof.processes,...proof.processes]},signature:stmt.signature});
denied({proof:{...proof,complete:false},signature:stmt.signature});
const terminal={...proof,processes:[{...proof.processes[0],state:'finished'}]};
const terminalVerified=verifyReconnectInventory(signReconnectInventory(terminal,privateKey),{publicKey,...expected});
assert.equal(classifyReconnectFence({accountId,deviceId,jobId,processId:null},terminalVerified),'keep_no_pid_requires_durable_non_dispatch_proof');
assert.equal(classifyReconnectFence({accountId,deviceId,jobId,processId:pId},terminalVerified),'await_exact_terminal_receipt');
console.log(JSON.stringify({ok:true,sourceOnly:true,ed25519:true,challengeReplayDenied:true,
 oldEpochDenied:true,identityBinding:true,noPidAutoRelease:false,forgedAck:0}));
