// Cross-platform harmless native OS process proof; no Gold service involved.
// The test child may only write into a disposable private directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
import {AgentExecutionEpochJournal} from '../../device-agent/execution-epoch-journal.mjs';
import {executionGrantMessage,executionTicketMessage} from '../../lib/gold-execution-epoch.mjs';
import {devicePayloadSha256} from '../../lib/device-proof.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-gold-native-epoch-'));
if(process.platform!=='win32')fs.chmodSync(temp,0o700);
const issuer=crypto.generateKeyPairSync('ed25519');
const scope={accountId:'account-test',deviceId:'device-test'};
const grant={version:1,...scope,connectionId:'connection-test',instanceId:'instance-test',executionEpoch:'1',challenge:crypto.randomBytes(24).toString('hex')};
const signature=payload=>crypto.sign(null,Buffer.from(payload),issuer.privateKey).toString('base64url');
const journal=new AgentExecutionEpochJournal({directory:path.join(temp,'private')});
const registry=new NativeProcessRegistry();
try{
 journal.acceptGrant({grant,signature:signature(executionGrantMessage(grant))},{...scope,instanceId:grant.instanceId,publicKey:issuer.publicKey});
 const command={commandId:'cmd_'+crypto.randomUUID(),jobId:crypto.randomUUID(),payload:{type:'process',operationId:'op_1234567890123456',process:{op:'start'}}};
 const ticket={version:1,...scope,connectionId:grant.connectionId,executionEpoch:grant.executionEpoch,
   commandId:command.commandId,jobId:command.jobId,payloadSha256:devicePayloadSha256(command.payload)};
 command.executionAuthorization={ticket,signature:signature(executionTicketMessage(ticket))};
 assert.equal(journal.reserve(command,{...scope,publicKey:issuer.publicKey}).state,'reserved');
 assert.equal(journal.reserve(command,{...scope,publicKey:issuer.publicKey}).previous,true);
 const marker=path.join(temp,'single-effect-marker');
 const owner={...scope,sessionId:'session-test',agentId:'agent-test'};
 const child=registry.start({...owner,cwd:temp,script:'harmless native spawn',
   spawnSpec:()=>({file:process.execPath,args:['-e',`require('node:fs').appendFileSync(${JSON.stringify(marker)},'1')`]})});
 assert.ok(child.processId&&child.pid);
 journal.finish(command,{data:{ok:true,operation:'start',process:child}});
 let outcome=child;
 for(let i=0;i<100&&!outcome.finishedAt;i++){
   await new Promise(r=>setTimeout(r,25));
   outcome=registry.view(child.processId,owner);
 }
 assert.equal(outcome.state,'finished');
 assert.equal(outcome.exitCode,0);
 journal.observeProcesses([outcome],scope);
 assert.equal(journal.rows.get(command.commandId).processId,child.processId);
 assert.equal(journal.rows.get(command.commandId).nativeStartedAt,child.startedAt);
 assert.equal(journal.rows.get(command.commandId).pid,child.pid);
 journal.observeProcesses([{...outcome,pid:child.pid+1000,startedAt:child.startedAt+9999,state:'stopped'}],scope);
 assert.equal(journal.rows.get(command.commandId).pid,child.pid);
 assert.equal(journal.rows.get(command.commandId).state,'finished');
 const restarted=new AgentExecutionEpochJournal({directory:path.join(temp,'private')});
 assert.equal(restarted.rows.get(command.commandId).pid,child.pid);
 assert.equal(restarted.rows.get(command.commandId).state,'finished');
 assert.equal(fs.readFileSync(marker,'utf8'),'1');
 assert.equal(restarted.reserve(command,{...scope,publicKey:issuer.publicKey}).previous,true);
 assert.equal(fs.readFileSync(marker,'utf8'),'1','duplicate delivery must never spawn second effect');
 console.log(JSON.stringify({ok:true,platform:process.platform,realOSProcess:true,
   processStartIdentityPinned:true,journalRestart:true,duplicateNoSecondEffect:true}));
}finally{registry.close();fs.rmSync(temp,{force:true,recursive:true});}
