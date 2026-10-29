import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AgentExecutionEpochJournal} from '../../device-agent/execution-epoch-journal.mjs';
import {executionGrantMessage,executionTicketMessage} from '../../lib/gold-execution-epoch.mjs';
import {devicePayloadSha256} from '../../lib/device-proof.mjs';
import {verifyReconnectInventory} from '../../lib/gold-reconnect-proof.mjs';
const keys=crypto.generateKeyPairSync('ed25519'),device=crypto.generateKeyPairSync('ed25519');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-gold-epoch-agent-'));if(process.platform!=='win32')fs.chmodSync(dir,0o700);
const accountId='acct-test',deviceId='dev-test',connectionId='dc-test',instanceId='ei-instance-1';
const grant={version:1,accountId,deviceId,connectionId,instanceId,executionEpoch:'1',challenge:crypto.randomBytes(24).toString('hex')};
const signedGrant={grant,signature:crypto.sign(null,Buffer.from(executionGrantMessage(grant)),keys.privateKey).toString('base64url')};
const command={commandId:'cmd_'+crypto.randomUUID(),jobId:crypto.randomUUID(),payload:{type:'process',operationId:'op_1234567890123456'}};
const ticket={version:1,accountId,deviceId,connectionId,executionEpoch:'1',commandId:command.commandId,jobId:command.jobId,payloadSha256:devicePayloadSha256(command.payload)};
const signed={...command,executionAuthorization:{ticket,signature:crypto.sign(null,Buffer.from(executionTicketMessage(ticket)),keys.privateKey).toString('base64url')}};
try{
 const j=new AgentExecutionEpochJournal({directory:dir,maxRecords:260});
 j.acceptGrant(signedGrant,{accountId,deviceId,instanceId,publicKey:keys.publicKey});
 assert.equal(j.reserve(signed,{accountId,deviceId,publicKey:keys.publicKey}).state,'reserved');
 assert.equal(j.reserve(signed,{accountId,deviceId,publicKey:keys.publicKey}).previous,true);
 const proc='lp_12345678901234567890';
 j.finish(signed,{data:{process:{processId:proc,state:'running',startedAt:Date.now()-500}}});
 j.observeProcesses([{accountId,deviceId,processId:proc,state:'running',pid:1234,startedAt:Date.now()-500}],{accountId,deviceId});
 assert.equal(j.rows.get(command.commandId).pid,1234);
 for(let i=0;i<150;i++){
   const id='cmd_test_'+String(i).padStart(20,'0');
   j.rows.set(id,{commandId:id,jobId:crypto.randomUUID(),operationId:'op_1234567890123456',
     executionEpoch:'1',processId:null,state:'reserved',startedAt:Date.now()});
 }
 j.save();
 const restarted=new AgentExecutionEpochJournal({directory:dir,maxRecords:260});
 assert.equal(restarted.rows.size,151);
 assert.equal(restarted.rows.get(command.commandId).pid,1234);
 assert.throws(()=>restarted.checkCommand({...signed,payload:{type:'exec'}},{accountId,deviceId,publicKey:keys.publicKey}),/mismatch/);
 const pages=restarted.inventoryPages({accountId,deviceId,privateKey:device.privateKey});
 assert.equal(pages.length,2);
 assert.equal(pages.reduce((sum,p)=>sum+p.proof.processes.length,0),151);
 assert.equal(pages[0].proof.snapshotId,pages[1].proof.snapshotId);
 for(const statement of pages){
   const proof=verifyReconnectInventory(statement,{publicKey:device.publicKey,
     accountId,deviceId,challenge:grant.challenge,minEpoch:'1',now:statement.proof.capturedAt});
   assert.equal(proof.verified,true);assert.equal(proof.proof.complete,false);
 }
 assert.throws(()=>restarted.reserve({...signed,jobId:crypto.randomUUID()},{accountId,deviceId,publicKey:keys.publicKey}),/mismatch|conflict/);
 const next={...grant,instanceId:'ei-instance-2',executionEpoch:'2',challenge:crypto.randomBytes(24).toString('hex')};
 restarted.acceptGrant({grant:next,signature:crypto.sign(null,Buffer.from(executionGrantMessage(next)),keys.privateKey).toString('base64url')},
   {accountId,deviceId,instanceId:next.instanceId,publicKey:keys.publicKey});
 assert.throws(()=>restarted.checkCommand(signed,{accountId,deviceId,publicKey:keys.publicKey}),/mismatch/);
 console.log(JSON.stringify({ok:true,platform:process.platform,fsyncJournal:true,
   restartRetained:151,signedPages:2,staleEpochDenied:true,missingProcessNotTerminal:true}));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
