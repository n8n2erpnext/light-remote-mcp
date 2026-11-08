// P2-B portable native signed-boundary canary. Test-only Ed25519 keys and
// one disposable OS child. NEVER connects to Gold UAT or changes a live claim.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AgentExecutionEpochJournal} from '../../device-agent/execution-epoch-journal.mjs';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
import {NativeTerminalReceiptSpool} from '../../lib/native-terminal-receipt-spool.mjs';
import {executionGrantMessage,executionTicketMessage} from '../../lib/gold-execution-epoch.mjs';
import {devicePayloadSha256} from '../../lib/device-proof.mjs';
import {verifyReconnectInventory,classifyReconnectFence} from '../../lib/gold-reconnect-proof.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-gold-p2b-native-proof-'));
if(process.platform!=='win32')fs.chmodSync(root,0o700);
const issuer=crypto.generateKeyPairSync('ed25519');
const device=crypto.generateKeyPairSync('ed25519');
const accountId='p2b-test-account',deviceId='p2b-test-device',connectionId='p2b-test-conn';
const instanceId='p2b-test-instance';
const grant={version:1,accountId,deviceId,connectionId,instanceId,
 executionEpoch:'1',challenge:crypto.randomBytes(24).toString('hex')};
const sign=(value,key=issuer.privateKey)=>crypto.sign(null,Buffer.from(value),key).toString('base64url');
const journal=new AgentExecutionEpochJournal({directory:path.join(root,'journal')});
const spool=new NativeTerminalReceiptSpool({directory:path.join(root,'terminal')});
const nativeEvents=[];
const registry=new NativeProcessRegistry({emit:event=>{
 nativeEvents.push(event.type);
 if(event.type==='process_finished')spool.record(event);
}});
try{
 journal.acceptGrant({grant,signature:sign(executionGrantMessage(grant))},
  {accountId,deviceId,instanceId,publicKey:issuer.publicKey});
 const command={commandId:'cmd_'+crypto.randomUUID(),jobId:crypto.randomUUID(),
  payload:{type:'process',operationId:'op_p2b_test_123456789',process:{op:'start'}}};
 const ticket={version:1,accountId,deviceId,connectionId,executionEpoch:'1',
  commandId:command.commandId,jobId:command.jobId,
  payloadSha256:devicePayloadSha256(command.payload)};
 command.executionAuthorization={ticket,signature:sign(executionTicketMessage(ticket))};
 assert.equal(journal.reserve(command,{accountId,deviceId,publicKey:issuer.publicKey}).state,'reserved');
 const marker=path.join(root,'effect-marker');
 const owner={accountId,deviceId,sessionId:'p2b-test-session',agentId:'p2b-test-agent'};
 const proc=registry.start({...owner,cwd:root,script:'test-only harmless child',
  spawnSpec:()=>({file:process.execPath,
   args:['-e','require("node:fs").appendFileSync('+JSON.stringify(marker)+',"x")']})});
 assert.ok(proc.processId&&proc.pid);
 journal.finish(command,{data:{ok:true,operation:'start',process:proc}});
 let outcome=proc;
 for(let i=0;i<160&&(!outcome.finishedAt||spool.list(accountId,deviceId).length===0);i++){
  await new Promise(r=>setTimeout(r,25));
  outcome=registry.view(proc.processId,owner);
 }
 assert.equal(outcome.state,'finished');
 assert.equal(outcome.exitCode,0);
 assert.equal(nativeEvents.includes('process_finished'),true);
 assert.equal(fs.readFileSync(marker,'utf8'),'x');
 journal.observeProcesses([outcome],{accountId,deviceId});
 assert.equal(journal.rows.get(command.commandId).processId,proc.processId);
 assert.equal(journal.rows.get(command.commandId).nativeStartedAt,proc.startedAt);
 const stored=new AgentExecutionEpochJournal({directory:path.join(root,'journal')});
 assert.equal(stored.reserve(command,{accountId,deviceId,publicKey:issuer.publicKey}).previous,true);
 assert.equal(fs.readFileSync(marker,'utf8'),'x','duplicate must not spawn second native OS effect');
 stored.observeProcesses([{...outcome,startedAt:proc.startedAt+50000,pid:proc.pid+1,
  state:'stopped'}],{accountId,deviceId});
 assert.equal(stored.rows.get(command.commandId).state,'finished');
 const statement=stored.inventory({accountId,deviceId,privateKey:device.privateKey});
 const expected={accountId,deviceId,challenge:grant.challenge,minEpoch:'1',
  now:statement.proof.capturedAt,publicKey:device.publicKey};
 const verified=verifyReconnectInventory(statement,expected);
 assert.equal(verified.verified,true);
 assert.equal(verified.proof.complete,false,'partial/legacy absence is never proof');
 const fence={accountId,deviceId,jobId:command.jobId,processId:proc.processId};
 assert.equal(classifyReconnectFence(fence,verified),'await_exact_terminal_receipt');
 assert.equal(classifyReconnectFence({...fence,processId:null},verified),
  'keep_no_pid_requires_durable_non_dispatch_proof');
 assert.equal(classifyReconnectFence({...fence,jobId:crypto.randomUUID()},verified),'keep_not_in_inventory');
 assert.throws(()=>verifyReconnectInventory(statement,{...expected,
  challenge:crypto.randomBytes(24).toString('hex')}));
 assert.throws(()=>verifyReconnectInventory(statement,{...expected,deviceId:'different-device'}));
 assert.throws(()=>verifyReconnectInventory(statement,{...expected,minEpoch:'2'}));
 assert.throws(()=>verifyReconnectInventory({...statement,
  proof:{...statement.proof,complete:true}},expected));
 const persisted=new NativeTerminalReceiptSpool({directory:path.join(root,'terminal')});
 const exact=persisted.list(accountId,deviceId);
 assert.equal(exact.length,1);
 assert.equal(exact[0].processId,proc.processId);
 assert.equal(exact[0].state,'finished');
 assert.equal(persisted.list('unrelated-account',deviceId).length,0);
 assert.throws(()=>persisted.acknowledge(accountId,deviceId,[{...exact[0],
  finishedAt:exact[0].finishedAt+1}]),/ack_mismatch/);
 assert.throws(()=>persisted.acknowledge(accountId,deviceId,[{...exact[0],
  state:'stopped'}]),/ack_mismatch/);
 assert.equal(new NativeTerminalReceiptSpool({directory:path.join(root,'terminal')})
  .list(accountId,deviceId).length,1,'unacked receipt survives restart');
 assert.equal(persisted.acknowledge(accountId,deviceId,exact),1);
 assert.equal(persisted.acknowledge(accountId,deviceId,exact),0);
 assert.equal(new NativeTerminalReceiptSpool({directory:path.join(root,'terminal')})
  .list(accountId,deviceId).length,0);
 // Local ACK simulation is NOT the durable Gold server-side signed ACK.
 assert.equal(classifyReconnectFence(fence,verified),'await_exact_terminal_receipt');
 const later={...grant,instanceId:'p2b-test-instance-2',executionEpoch:'2',
  challenge:crypto.randomBytes(24).toString('hex')};
 stored.acceptGrant({grant:later,signature:sign(executionGrantMessage(later))},
  {accountId,deviceId,instanceId:later.instanceId,publicKey:issuer.publicKey});
 assert.throws(()=>stored.checkCommand(command,{accountId,deviceId,publicKey:issuer.publicKey}),
  /execution_command_old_epoch_or_mismatch/);
 console.log(JSON.stringify({ok:true,platform:process.platform,
  realNativeOSChild:true,durableJournalRestart:true,signedInventory:true,
  wrongChallengeDenied:true,wrongDeviceDenied:true,staleEpochDenied:true,
  identityPinned:true,duplicateNoSecondEffect:true,
  exactReceiptReplay:true,missingTerminalServerAckKeepsFence:true,
  liveDatabaseTouched:false}));
}finally{
 registry.close();
 fs.rmSync(root,{recursive:true,force:true});
}
