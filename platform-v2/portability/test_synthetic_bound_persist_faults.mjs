#!/usr/bin/env node
/** Linux-only disposable fail-stop tests. NEVER execute real native commands. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {signFakeAbPacket,fakeApprovalDigest} from './synthetic-ab-grant-lease.mjs';
import {signSyntheticEpoch,signSyntheticCommand,syntheticSignedEpochDigest} from './synthetic-signed-agent-gate.mjs';

const worker=path.join(path.dirname(new URL(import.meta.url).pathname),'synthetic-agent-receipt-authority-worker.mjs');
const stages=['after_write','after_file_fsync','after_rename','after_dir_fsync'];
function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-agent-authority-'));
 const lock=path.join(root,'authority.lock');
 const fd=fs.openSync(lock,'wx+',0o600);
 const key=()=>crypto.generateKeyPairSync('ed25519');
 const k={wall:key(),issuer:key(),writer:key()};
 const pk=x=>k[x].publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const t=Date.now();
 const ids={ownerAccountId:'uat_account_demo',accountId:'uat_account_demo',
  deviceId:'uat_device_demo',agentId:'uat_agent_demo'};
 const approval={kind:'fake_approval',requestId:'uat_request_fault',
  grantId:'uat_grant_fault',...ids,connectionId:'uat_connection_fault',
  deviceKeySha256:'f'.repeat(64),purpose:'device',
  createdAt:t-70000,requestExpiresAt:t-30000,approvedAt:t-60000,
  grantExpiresAt:t+300000,absoluteExpiresAt:t-60000+86400000,grantRevision:5};
 const lease={kind:'fake_lease',approvalDigest:fakeApprovalDigest(approval),
  requestId:approval.requestId,grantId:approval.grantId,...ids,
  connectionId:approval.connectionId,deviceKeySha256:approval.deviceKeySha256,
  purpose:'device',generation:50,grantRevision:5,revocationRevision:0,
  notBefore:t-3000,expiresAt:t+20000};
 const epoch={kind:'fake_epoch',accountId:ids.accountId,
  deviceId:ids.deviceId,agentId:ids.agentId,generation:50,grantRevision:5,
  notBefore:t-3000,expiresAt:t+60000};
 const command={kind:'fake_command',accountId:ids.accountId,
  deviceId:ids.deviceId,agentId:ids.agentId,generation:50,grantRevision:5,
  epochDigest:syntheticSignedEpochDigest(epoch),
  commandId:'uat_cmd_fault_test',notBefore:t-1000,expiresAt:t+16000,
  payload:{kind:'fake_noop',message:'no physical side effects'}};
 const packets={
  signedApproval:signFakeAbPacket('approval',k.wall.privateKey,approval),
  signedLease:signFakeAbPacket('lease',k.issuer.privateKey,lease),
  signedEpoch:signSyntheticEpoch(k.writer.privateKey,epoch),
  signedCommand:signSyntheticCommand(k.writer.privateKey,command)
 };
 const init={operation:'initialize_bound',verifierSpki:pk('writer'),
  wallVerifierSpki:pk('wall'),leaseVerifierSpki:pk('issuer'),
  deviceKeySha256:approval.deviceKeySha256};
 function run(request,stage=null) {
  const argv=Buffer.from(JSON.stringify(request)).toString('base64url');
  return spawnSync('flock',[
    '-x','-n','-E','77','-F',lock,process.execPath,worker,root,argv
  ],{cwd:root,stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:10000,
    env:{...process.env,LR_RC50_SYNTHETIC_FAULT_STAGE:stage??''}});
 }
 const read=()=>JSON.parse(fs.readFileSync(path.join(root,'authority.json'),'utf8'));
 const temps=()=>fs.readdirSync(root).filter(x=>/^\.authority\.[0-9]+\.[a-f0-9]{16}\.tmp$/.test(x));
 return {root,lock,fd,run,read,temps,init,packets,
  cleanup(){fs.closeSync(fd);fs.rmSync(root,{recursive:true,force:true})}};
}
function expectOK(out) {
 assert.equal(out.status,0,out.stderr||out.stdout);
 assert.match(out.stdout,/"physicalExecutionAuthorized":false/);
}
for(const [idx,stage] of stages.entries()){
 test(String(idx+1).padStart(2,'0')+' SIGKILL '+stage+' no false replay and durable reconciliation',()=>{
  const f=fixture();
  try {
   expectOK(f.run(f.init));
   expectOK(f.run({operation:'bound_accept',...f.packets}));
   assert.equal(f.read().receipts.uat_cmd_fault_test.status,'accepted');
   const inode=fs.statSync(f.lock).ino;
   const failed=f.run({operation:'bound_start',...f.packets},stage);
   assert.equal(failed.signal,'SIGKILL',failed.stderr);
   const record=f.read();
   if(stage==='after_write'||stage==='after_file_fsync'){
     assert.equal(record.receipts.uat_cmd_fault_test.status,'accepted');
     assert.equal(f.temps().length,1);
     const refused=f.run({operation:'bound_recover'});
     assert.equal(refused.status,22);
     assert.match(refused.stderr,/ambiguous_persist_residue/);
     // Supervisor acknowledges temp file under a PRIVATE TEST fixture only.
     for(const name of f.temps())fs.rmSync(path.join(f.root,name));
   }else{
     assert.equal(record.receipts.uat_cmd_fault_test.status,'started');
     assert.equal(f.temps().length,0);
   }
   // Recovery conservatively quarantines incomplete commands as UNCERTAIN.
   expectOK(f.run({operation:'bound_recover'}));
   assert.equal(f.read().receipts.uat_cmd_fault_test.status,'uncertain');
   const again=f.run({operation:'bound_start',...f.packets});
   assert.equal(again.status,24);
   assert.match(again.stdout,/COMMAND_NOT_SAFE_TO_START/);
   const independent=spawnSync('flock',['-x','-n','-E','77',f.lock,'/bin/true']);
   assert.equal(independent.status,0);
   assert.equal(fs.statSync(f.lock).ino,inode);
  }finally{f.cleanup();}
 });
}
test('05 forged fault-stage request property cannot crash child',()=>{
 const f=fixture();
 try{
  expectOK(f.run(f.init));
  expectOK(f.run({operation:'bound_accept',...f.packets}));
  expectOK(f.run({operation:'bound_start',...f.packets,testCrashAt:'after_rename'}));
  assert.equal(f.read().receipts.uat_cmd_fault_test.status,'started');
  assert.equal(f.temps().length,0);
 }finally{f.cleanup();}
});
test('06 fault injection environment does not affect non-STARTED operations',()=>{
 const f=fixture();
 try{
  expectOK(f.run(f.init));
  expectOK(f.run({operation:'bound_accept',...f.packets},'after_rename'));
  assert.equal(f.read().receipts.uat_cmd_fault_test.status,'accepted');
 }finally{f.cleanup();}
});
test('07 corrupt authority receipt cannot be silently reinitialized',()=>{
 const f=fixture();
 try{
  expectOK(f.run(f.init));
  fs.writeFileSync(path.join(f.root,'authority.json'),'{broken\n',{mode:0o600});
  const r=f.run(f.init);
  assert.equal(r.status,22);
  assert.match(r.stderr,/receipt_corrupt/);
 }finally{f.cleanup();}
});
