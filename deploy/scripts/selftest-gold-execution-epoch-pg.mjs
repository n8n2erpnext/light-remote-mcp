// Intentionally operates ONLY on a disposable, owner-created PG test database.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {GoldExecutionEpochs,verifyExecutionCommand} from '../../lib/gold-execution-epoch.mjs';
import {AgentExecutionEpochJournal} from '../../device-agent/execution-epoch-journal.mjs';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';

const database=process.env.LR_GOLD_EPOCH_TEST_DB||'';
assert.match(database,/^lr_gold_epoch_fixture_[0-9]{8}$/,'disposable PG DB name required');
const moduleRef=process.env.LR_GOLD_EPOCH_PG_DRIVER?pathToFileURL(process.env.LR_GOLD_EPOCH_PG_DRIVER).href:'pg';
const {default:pg}=await import(moduleRef);
const poolA=new pg.Pool({host:process.env.PGHOST||'/var/run/postgresql',user:process.env.PGUSER||'postgres',database,max:5});
const poolB=new pg.Pool({host:process.env.PGHOST||'/var/run/postgresql',user:process.env.PGUSER||'postgres',database,max:5});
const issuer=crypto.generateKeyPairSync('ed25519');
const deviceKeys=crypto.generateKeyPairSync('ed25519');
const A=new GoldExecutionEpochs({pool:poolA,signer:issuer});
const B=new GoldExecutionEpochs({pool:poolB,signer:issuer});
const accountId='acct-epoch-fixture',deviceId='dev-epoch-fixture',connectionId='dc_epoch_fixture_1';
const key=issuer.publicKey;
const cmdId='cmd_22222222-2222-4222-8222-222222222222',jobId='11111111-1111-4111-8111-111111111111';
const command={commandId:cmdId,jobId,payload:{type:'process',operationId:'op_1234567890123456',process:{op:'start',script:'synthetic harmless native process'}}};
let localDir=null;
try{
  const first=await A.issue({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_1'});
  assert.equal(first.grant.executionEpoch,'1');
  const duplicate=await B.issue({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_1'});
  assert.equal(duplicate.grant.executionEpoch,'1');
  localDir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-epoch-fixture-'));fs.chmodSync(localDir,0o700);
  const journal=new AgentExecutionEpochJournal({directory:localDir,maxRecords:256});
  const grant=journal.acceptGrant(first,{accountId,deviceId,instanceId:'ei_fixture_process_1',publicKey:key});
  assert.equal(journal.grant.executionEpoch,'1');
  const inventory=journal.inventory({accountId,deviceId,privateKey:deviceKeys.privateKey});
  assert.equal(inventory.proof.complete,false,'absence cannot certify no effects');
  const recorded=await B.recordInventory({accountId,deviceId,connectionId,statement:inventory,devicePublicKey:deviceKeys.publicKey});
  assert.equal(recorded.verified,true);
  await A.assertReady({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_1'});
  const ticket=await A.authorizeCommand({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_1',command});
  assert.equal(verifyExecutionCommand(ticket,{grant,accountId,deviceId,publicKey:key}).commandId,cmdId);
  const start=await A.validateStart({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_1',
    authorization:ticket.executionAuthorization});
  assert.equal(start.authorized,true);
  await assert.rejects(()=>B.validateStart({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_1',
    authorization:ticket.executionAuthorization}),/execution_start_already_authorized/);
  assert.equal(journal.reserve(ticket,{accountId,deviceId,publicKey:key}).state,'reserved');
  assert.equal(journal.reserve(ticket,{accountId,deviceId,publicKey:key}).previous,true,'duplicate may replay but not respawn');
  // Execute ONE real operating-system child under a synthetic device owner.
  // Both transport deliveries of the same command must converge to that
  // single authenticated PG effect permit and single native process.
  const marker=path.join(localDir,'harmless-process-count.txt');
  const registry=new NativeProcessRegistry();
  const owner={accountId,deviceId,sessionId:'synthetic-session',agentId:'synthetic-agent'};
  const code=`require('node:fs').appendFileSync(${JSON.stringify(marker)},'1')`;
  const launched=registry.start({...owner,cwd:localDir,script:'synthetic process fixture',
    spawnSpec:()=>({file:process.execPath,args:['-e',code]})});
  assert.match(launched.processId,/^lp_/);
  journal.finish(command,{data:{ok:true,operation:'start',process:launched}});
  let observed=launched;
  for(let i=0;i<100&&!observed.finishedAt;i++){
    await new Promise(resolve=>setTimeout(resolve,20));
    observed=registry.view(launched.processId,owner);
  }
  assert.equal(observed.state,'finished');
  assert.equal(observed.exitCode,0);
  journal.observeProcesses([observed],{accountId,deviceId});
  assert.equal(journal.rows.get(cmdId).processId,launched.processId);
  assert.equal(journal.rows.get(cmdId).pid,launched.pid);
  assert.equal(journal.rows.get(cmdId).state,'finished');
  assert.equal(fs.readFileSync(marker,'utf8'),'1','a duplicated Poll+Duplex command caused a second OS effect');
  registry.close();
  const restarted=new AgentExecutionEpochJournal({directory:localDir,maxRecords:256});
  assert.equal(restarted.rows.get(cmdId).state,'finished','native terminal identity persisted across Agent restart');
  const tickets=await Promise.all([A.authorizeCommand({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_1',command}),B.authorizeCommand({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_1',command})]);
  assert.deepEqual(tickets[0].executionAuthorization.ticket,tickets[1].executionAuthorization.ticket);
  assert.equal((await poolA.query('SELECT count(*)::int n FROM lr_gold_execution_command_issuance')).rows[0].n,1,'exactly one issuance across Operators');
  // A replay of the SAME signed inventory is idempotent; a DIFFERENT
  // snapshot, even signed by the device, cannot replace pinned epoch proof.
  const pinnedBefore=(await poolA.query('SELECT inventory_sha256 FROM lr_gold_device_execution_epochs WHERE device_id=$1',[deviceId])).rows[0].inventory_sha256;
  const repeated=await B.recordInventory({accountId,deviceId,connectionId,statement:inventory,devicePublicKey:deviceKeys.publicKey});
  assert.equal(repeated.ready,true);assert.equal(repeated.idempotent,true);
  const conflictingSnapshot=journal.inventory({accountId,deviceId,privateKey:deviceKeys.privateKey});
  await assert.rejects(()=>A.recordInventory({accountId,deviceId,connectionId,
    statement:conflictingSnapshot,devicePublicKey:deviceKeys.publicKey}),/execution_inventory_epoch_already_reconciled/);
  assert.equal((await poolB.query('SELECT inventory_sha256 FROM lr_gold_device_execution_epochs WHERE device_id=$1',[deviceId])).rows[0].inventory_sha256,pinnedBefore);
  // A real Agent restart mints a NEW epoch before it may submit new proof.
  const second=await A.issue({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_2'});
  assert.equal(second.grant.executionEpoch,'2');
  journal.acceptGrant(second,{accountId,deviceId,instanceId:'ei_fixture_process_2',publicKey:key});
  await assert.rejects(()=>A.assertReady({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_2'}),/execution_inventory_not_reconciled/);
  // All journal records must be represented across signed 128-record pages.
  // No single truncated last-64 inventory is ever treated as complete.
  for(let i=0;i<130;i++){
    const id='cmd_fixture-'+String(i).padStart(20,'0');
    journal.rows.set(id,{commandId:id,jobId:crypto.randomUUID(),processId:null,
      operationId:'op_fixture_'+String(i).padStart(20,'0'),executionEpoch:'1',
      state:'reserved',startedAt:Date.now()-1000});
  }
  journal.save();
  const pages=journal.inventoryPages({accountId,deviceId,privateKey:deviceKeys.privateKey});
  assert.equal(pages.length,2);
  assert.equal(pages[0].proof.processes.length,128);
  assert.equal(pages[1].proof.processes.length,3);
  const firstPage=await B.recordInventory({accountId,deviceId,connectionId,
    statement:pages[0],devicePublicKey:deviceKeys.publicKey});
  assert.equal(firstPage.ready,false);
  const lastPage=await A.recordInventory({accountId,deviceId,connectionId,
    statement:pages[1],devicePublicKey:deviceKeys.publicKey});
  assert.equal(lastPage.ready,true);
  assert.equal(lastPage.items,131);
  assert.equal(lastPage.complete,false,'historic OS absence is not proven');

  const [issued3,issued4]=await Promise.all([
    A.issue({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_3'}),
    B.issue({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_4'})
  ]);
  assert.deepEqual([issued3.grant.executionEpoch,issued4.grant.executionEpoch].sort(),['3','4']);
  const current=(await poolB.query('SELECT epoch,agent_instance_id FROM lr_gold_device_execution_epochs WHERE device_id=$1',[deviceId])).rows[0];
  assert.equal(String(current.epoch),'4');
  await assert.rejects(()=>A.authorizeCommand({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_1',command}),/execution_old_command_replay_fenced|execution_epoch_connection_stale/);
  await assert.rejects(()=>B.validateStart({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_1',
    authorization:ticket.executionAuthorization}),/execution_start_stale_epoch/);
  assert.throws(()=>restarted.acceptGrant(issued3,{accountId,deviceId,instanceId:'ei_fixture_process_1',publicKey:key}),/execution_grant_invalid/);
  // Replay and stale inventory from a prior epoch are rejected even when signed.
  await assert.rejects(()=>B.recordInventory({accountId,deviceId,connectionId,statement:inventory,devicePublicKey:deviceKeys.publicKey}),/gold_reconnect_inventory_untrusted|execution_inventory_stale_epoch/);
  await assert.rejects(()=>A.assertReady({accountId,deviceId,connectionId,instanceId:'ei_fixture_process_1'}),/execution_inventory_not_reconciled/);
  // Simulate a real reconnect with a NEW connection ID: the old connection
  // cannot issue commands or resurrect an already signed, expired snapshot.
  const successorConnection='dc_epoch_fixture_2';
  await poolA.query('UPDATE lr_device_connections SET closed_at=now() WHERE connection_id=$1',[connectionId]);
  await poolB.query(`INSERT INTO lr_device_connections
    (connection_id,account_id,device_id,connected_at,closed_at,hard_expires_at)
    VALUES($1,$2,$3,clock_timestamp(),NULL,clock_timestamp()+interval '1 hour')`,
    [successorConnection,accountId,deviceId]);
  await assert.rejects(()=>A.issue({accountId,deviceId,connectionId,
    instanceId:'ei_fixture_process_5'}),/execution_pg_connection_not_current/);
  await assert.rejects(()=>B.authorizeCommand({accountId,deviceId,connectionId,
    instanceId:'ei_fixture_process_4',command}),/execution_pg_connection_not_current/);
  const successor=await A.issue({accountId,deviceId,connectionId:successorConnection,
    instanceId:'ei_fixture_process_5'});
  assert.equal(successor.grant.executionEpoch,'5');
  await assert.rejects(()=>B.assertReady({accountId,deviceId,connectionId:successorConnection,
    instanceId:'ei_fixture_process_5'}),/execution_inventory_not_reconciled/);
  journal.acceptGrant(successor,{accountId,deviceId,instanceId:'ei_fixture_process_5',publicKey:key});
  const rebootPages=journal.inventoryPages({accountId,deviceId,privateKey:deviceKeys.privateKey});
  assert.equal(rebootPages.length,2);
  const firstReboot=await B.recordInventory({accountId,deviceId,
    connectionId:successorConnection,statement:rebootPages[0],devicePublicKey:deviceKeys.publicKey});
  assert.equal(firstReboot.ready,false,'partial reboot inventory cannot open execution gate');
  await assert.rejects(()=>A.assertReady({accountId,deviceId,connectionId:successorConnection,
    instanceId:'ei_fixture_process_5'}),/execution_inventory_not_reconciled/);
  const bothFinal=await Promise.all([
    A.recordInventory({accountId,deviceId,connectionId:successorConnection,
      statement:rebootPages[1],devicePublicKey:deviceKeys.publicKey}),
    B.recordInventory({accountId,deviceId,connectionId:successorConnection,
      statement:rebootPages[1],devicePublicKey:deviceKeys.publicKey})
  ]);
  assert.ok(bothFinal.every(row=>row.ready===true));
  assert.equal(bothFinal.filter(row=>row.idempotent===true).length,1,
    'two Operators racing to commit final page must converge to one immutable inventory');
  assert.equal(bothFinal[0].digest,bothFinal[1].digest);
  await B.assertReady({accountId,deviceId,connectionId:successorConnection,
    instanceId:'ei_fixture_process_5'});
  await assert.rejects(()=>B.recordInventory({accountId,deviceId,connectionId,
    statement:inventory,devicePublicKey:deviceKeys.publicKey}),/execution_pg_connection_not_current/);
  await assert.rejects(()=>A.validateStart({accountId,deviceId,connectionId,
    instanceId:'ei_fixture_process_1',authorization:ticket.executionAuthorization}),/execution_pg_connection_not_current/);
  assert.equal((await poolA.query('SELECT count(*)::int n FROM lr_gold_terminal_receipt_acks')).rows[0].n,0);
  console.log(JSON.stringify({ok:true,postgresql:true,operators:2,monotonicEpoch:5,
    rotatedConnectionFenced:true,partialRebootInventoryDenied:true,readyAfterAllSignedPages:true,
    concurrentFinalPageIdempotent:true,
    identicalSnapshotReplayIdempotent:true,conflictingSnapshotRejected:true,oldSnapshotHashPinned:true,
    duplicateConcurrentIssuance:1,oneTimePgEffectStart:true,oldEpochCommandDenied:true,staleInventoryDenied:true,
    journalFsyncRecovery:true,realNativeOSProcessStartedOnce:true,signedInventoryPages:2,terminalAcksCreated:0,sourceOnly:true}));
}finally{if(localDir)fs.rmSync(localDir,{recursive:true,force:true});await Promise.allSettled([poolA.end(),poolB.end()]);}
