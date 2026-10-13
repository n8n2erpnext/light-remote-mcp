#!/usr/bin/env node
/** Linux fixture-only: signed Wall A/B, issuer lease and fake Agent receipt
 * under ONE kernel-locked, file+directory fsynced authority. NO real commands.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {signFakeAbPacket,fakeApprovalDigest} from './synthetic-ab-grant-lease.mjs';
import {
  signSyntheticEpoch,signSyntheticCommand,syntheticSignedEpochDigest
} from './synthetic-signed-agent-gate.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-agent-authority-'));
const lock=path.join(root,'authority.lock');
const fd=fs.openSync(lock,'wx+',0o600),inode=fs.statSync(lock).ino;
const worker=path.join(path.dirname(new URL(import.meta.url).pathname),
 'synthetic-agent-receipt-authority-worker.mjs');
const keys={
 wall:crypto.generateKeyPairSync('ed25519'),
 issuer:crypto.generateKeyPairSync('ed25519'),
 writer:crypto.generateKeyPairSync('ed25519'),
 rogue:crypto.generateKeyPairSync('ed25519')
};
const spki=key=>key.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const t=Date.now();
const deviceKeySha256='d'.repeat(64);
const ids={ownerAccountId:'uat_account_demo',accountId:'uat_account_demo',
  deviceId:'uat_device_demo',agentId:'uat_agent_demo'};
const signed=(type,p,k)=>signFakeAbPacket(type,keys[k].privateKey,p);
const approval=(generation=50,patch={})=>({
 kind:'fake_approval',requestId:'uat_request_initial',
 grantId:'uat_grant_initial',...ids,connectionId:'uat_connection_initial',
 deviceKeySha256,purpose:'device',
 createdAt:t-125000,requestExpiresAt:t-80000,approvedAt:t-100000,
 grantExpiresAt:t+90000,absoluteExpiresAt:t-100000+86400000,
 grantRevision:generation===50?5:6,...patch
});
const lease=(a=approval(),gen=50,rev=0,patch={})=>({
 kind:'fake_lease',approvalDigest:fakeApprovalDigest(a),requestId:a.requestId,
 grantId:a.grantId,...ids,connectionId:a.connectionId,
 deviceKeySha256,purpose:'device',
 generation:gen,grantRevision:a.grantRevision,revocationRevision:rev,
 notBefore:t-4000,expiresAt:t+25000,...patch
});
const writerEpoch=(gen=50,revision=5)=>({
 kind:'fake_epoch',accountId:ids.accountId,deviceId:ids.deviceId,
 agentId:ids.agentId,generation:gen,grantRevision:revision,
 notBefore:t-8000,expiresAt:t+100000
});
const command=(epoch,id='uat_cmd_bound_first',patch={})=>({
 kind:'fake_command',accountId:ids.accountId,deviceId:ids.deviceId,
 agentId:ids.agentId,generation:epoch.generation,
 grantRevision:epoch.grantRevision,epochDigest:syntheticSignedEpochDigest(epoch),
 commandId:id,notBefore:t-1000,expiresAt:t+18000,
 payload:{kind:'fake_noop',message:'no physical side effects'},...patch
});
const a=approval(),l=lease(a),e=writerEpoch(),c=command(e);
const packets=(ap=a,lp=l,ep=e,cp=c)=>({
 signedApproval:signed('approval',ap,'wall'),
 signedLease:signed('lease',lp,'issuer'),
 signedEpoch:signSyntheticEpoch(keys.writer.privateKey,ep),
 signedCommand:signSyntheticCommand(keys.writer.privateKey,cp)
});
const standard=packets();
const req=(operation,extra={})=>({operation,...extra});
const encoded=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const flags=['-x','-n','-E','77','-F',lock,process.execPath,worker,root];
const call=(r)=>spawnSync('flock',[...flags,encoded(r)],{
 cwd:root,stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:10000
});
const expect=(r,code=0,reason)=>{const out=call(r);
 assert.equal(out.error,undefined,String(out.error?.message));
 assert.equal(out.status,code,out.stderr||out.stdout);
 const value=out.stdout.trim()?JSON.parse(out.stdout.trim()):null;
 if(reason)assert.equal(value?.reason,reason);
 if(value)assert.equal(value.physicalExecutionAuthorized,false);
 return value;
};
const file=path.join(root,'authority.json');
const state=()=>JSON.parse(fs.readFileSync(file,'utf8'));
test.after(()=>{fs.closeSync(fd);fs.rmSync(root,{recursive:true,force:true})});
test('01 direct worker without supervisor fd3 denied',()=>{
 const p=spawnSync(process.execPath,[worker,root,encoded(req('initialize_bound'))],{
  encoding:'utf8'});
 assert.equal(p.status,22);
});
test('01b rejects a reused issuer key at initial trust bootstrap',()=>{
 const r=call(req('initialize_bound',{
  verifierSpki:spki(keys.writer),wallVerifierSpki:spki(keys.writer),
  leaseVerifierSpki:spki(keys.issuer),deviceKeySha256
 }));
 assert.equal(r.status,22);
 assert.match(r.stderr,/bound_issuer_key_reuse_disallowed/);
 assert.equal(fs.existsSync(file),false);
});
test('02 initialize trusted fixture with three independent Ed25519 pins',()=>{
 const r=expect(req('initialize_bound',{
  verifierSpki:spki(keys.writer),wallVerifierSpki:spki(keys.wall),
  leaseVerifierSpki:spki(keys.issuer),deviceKeySha256
 }));
 assert.equal(r.decision,'BOUND_INITIALIZED');
 assert.equal(state().grantState.floorGeneration,0);
 assert.notEqual(state().grantState.wallPin,state().grantState.issuerPin);
});
test('03 bound root never allows re-bootstrap',()=>{
 const prev=JSON.stringify(state());
 assert.equal(call(req('initialize_bound',{
  verifierSpki:spki(keys.rogue),wallVerifierSpki:spki(keys.rogue),
  leaseVerifierSpki:spki(keys.rogue),deviceKeySha256
 })).status,22);
 assert.equal(JSON.stringify(state()),prev);
});
test('04 unsigned fake request cannot bypass bound mode',()=>{
 const result=call(req('advance_epoch',{proof:{kind:'fake_epoch'}}));
 assert.equal(result.status,22);
 assert.match(result.stderr,/bypass_bound_authority_disallowed/);
});
test('05 signed-only epoch request cannot bypass bound mode',()=>{
 const result=call(req('signed_epoch',{signedEpoch:standard.signedEpoch}));
 assert.equal(result.status,22);
 assert.match(result.stderr,/bypass_bound_authority_disallowed/);
});
test('06 forged Wall signature fails before receipt or grant mutation',()=>{
 const original=JSON.stringify(state());
 const fake={...standard,signedApproval:signed('approval',a,'rogue')};
 expect(req('bound_accept',fake),24,'APPROVAL_OR_LEASE_SIGNATURE_INVALID');
 assert.equal(JSON.stringify(state()),original);
});
test('07 forged issuer lease fails before receipt mutation',()=>{
 const fake={...standard,signedLease:signed('lease',l,'rogue')};
 expect(req('bound_accept',fake),24,'APPROVAL_OR_LEASE_SIGNATURE_INVALID');
 assert.equal(Object.keys(state().receipts).length,0);
});
test('08 forged command writer signature rejected',()=>{
 const fake={...standard,signedCommand:signSyntheticCommand(keys.rogue.privateKey,c)};
 expect(req('bound_accept',fake),24,'BOUND_SIGNED_EPOCH_OR_COMMAND_INVALID');
});
test('09 writer generation cannot exceed signed lease scope',()=>{
 const wrong=writerEpoch(51,6);
 const fake={...standard,signedEpoch:signSyntheticEpoch(keys.writer.privateKey,wrong)};
 expect(req('bound_accept',fake),24,'BOUND_WRITER_EPOCH_DOES_NOT_MATCH_LEASE');
});
test('10 valid approval, lease, epoch and command COMMIT one snapshot',()=>{
 const r=expect(req('bound_accept',standard));
 assert.equal(r.reason,'BOUND_APPROVAL_EPOCH_AND_RECEIPT_PERSISTED');
 assert.equal(state().generation,50);
 assert.equal(state().grantState.floorGeneration,50);
 assert.equal(state().grantState.activeGrantId,'uat_grant_initial');
 assert.equal(state().receipts.uat_cmd_bound_first.status,'accepted');
 assert.equal(fs.statSync(file).mode&0o777,0o600);
});
test('11 duplicate signed admission cannot restart execution',()=>{
 expect(req('bound_accept',standard),0,'BOUND_DUPLICATE_RECEIPT');
 assert.equal(state().receipts.uat_cmd_bound_first.status,'accepted');
});
test('12 competing independent OS process cannot write bound receipts',async()=>{
 const holder=spawn('flock',[...flags,encoded(req('bound_accept',{
  ...standard,delayMs:700
 }))],{cwd:root,stdio:['ignore','pipe','pipe',fd]});
 let notify;const marker=new Promise(resolve=>{notify=resolve});
 const ended=new Promise((resolve,reject)=>{
   let out='',err='';
   holder.stdout.on('data',d=>{out+=d;if(out.includes('RC50_AUTHORITY_TEST_LOCK_HELD'))notify()});
   holder.stderr.on('data',d=>err+=d);
   holder.once('error',reject);
   holder.once('close',(code,signal)=>resolve({code,signal,err}));
 });
 await Promise.race([marker,new Promise((_,reject)=>{
   const timeout=setTimeout(()=>reject(Error('missing_lock_marker')),3000);timeout.unref();
 })]);
 const outside=spawnSync('flock',['-x','-n','-E','77',lock,'/bin/true'],{
  encoding:'utf8'});
 assert.equal(outside.status,77);
 assert.equal(call(req('bound_start',standard)).status,77);
 assert.equal((await ended).code,0);
 assert.equal(fs.statSync(lock).ino,inode);
});
test('13 signed revocation fences already ACCEPTED fake receipt',()=>{
 const revoke={kind:'fake_revocation',ownerAccountId:ids.ownerAccountId,
  accountId:ids.accountId,deviceId:ids.deviceId,grantId:a.grantId,
  revocationRevision:1,effectiveAt:t-1000,reason:'owner_revoke'};
 const pkt=signed('revocation',revoke,'issuer');
 const result=expect(req('bound_revoke',{signedRevocation:pkt}));
 assert.equal(result.reason,'BOUND_REVOCATION_DURABLE_FENCE');
 assert.equal(state().receipts.uat_cmd_bound_first.status,'fenced');
 assert.equal(state().grantState.activeGrantId,null);
 assert.equal(state().grantState.revocationRevision,1);
 assert.deepEqual(state().grantState.revokedGrantIds,['uat_grant_initial']);
});
test('14 after worker restart old valid lease still tombstoned',()=>{
 expect(req('bound_start',standard),24,'GRANT_TOMBSTONED');
 expect(req('bound_accept',standard),24,'GRANT_TOMBSTONED');
});
test('15 forged revocation does not reset monotonic floor',()=>{
 const rev={kind:'fake_revocation',ownerAccountId:ids.ownerAccountId,
  accountId:ids.accountId,deviceId:ids.deviceId,grantId:a.grantId,
  revocationRevision:2,effectiveAt:t-1000,reason:'owner_revoke'};
 expect(req('bound_revoke',{signedRevocation:signed('revocation',rev,'rogue')}),
  24,'REVOCATION_SIGNATURE_INVALID');
 assert.equal(state().grantState.revocationRevision,1);
});
const nextA=approval(51,{requestId:'uat_request_regrant',grantId:'uat_grant_regrant',
 grantRevision:6});
const nextL=lease(nextA,51,1);
const nextE=writerEpoch(51,6);
const nextC=command(nextE,'uat_cmd_bound_second');
const nextPackets=packets(nextA,nextL,nextE,nextC);
test('16 signed new A/B proof and higher epoch rebinds after revocation',()=>{
 const r=expect(req('bound_accept',nextPackets));
 assert.equal(r.reason,'BOUND_APPROVAL_EPOCH_AND_RECEIPT_PERSISTED');
 assert.equal(state().generation,51);
 assert.equal(state().grantState.floorGeneration,51);
 assert.equal(state().grantState.activeGrantId,'uat_grant_regrant');
 assert.equal(state().receipts.uat_cmd_bound_second.status,'accepted');
});
test('17 fake STARTED dies after fsync, kernel lock released',()=>{
 const result=call(req('bound_start',{...nextPackets,crashAfterPersist:true}));
 assert.equal(result.signal,'SIGKILL',result.stderr);
 assert.equal(state().receipts.uat_cmd_bound_second.status,'started');
 assert.equal(spawnSync('flock',['-x','-n','-E','77',lock,'/bin/true']).status,0);
});
test('18 fresh process converts crashed STARTED -> UNCERTAIN durably',()=>{
 expect(req('bound_recover'),0,'CRASH_RECOVERY_REQUIRES_DURABLE_RECONCILIATION');
 assert.equal(state().receipts.uat_cmd_bound_second.status,'uncertain');
});
test('19 after restart valid signed lease cannot re-start uncertain job',()=>{
 expect(req('bound_start',nextPackets),24,'COMMAND_NOT_SAFE_TO_START');
});
test('20 new fake command can complete under same approved lease',()=>{
 const other=command(nextE,'uat_cmd_bound_third',{
   payload:{kind:'fake_noop',message:'other fake command'}
 });
 const p=packets(nextA,nextL,nextE,other);
 expect(req('bound_accept',p),0,'BOUND_APPROVAL_EPOCH_AND_RECEIPT_PERSISTED');
 expect(req('bound_start',p),0,'BOUND_FAKE_STARTED');
 expect(req('bound_complete',p),0,'BOUND_FAKE_COMPLETED');
 assert.equal(state().receipts.uat_cmd_bound_third.status,'completed');
});
test('20b corrupted durable grant revision fails closed during recovery',()=>{
 const backup=fs.readFileSync(file);
 const broken=JSON.parse(backup.toString('utf8'));
 broken.grantState.floorGeneration+=1;
 fs.writeFileSync(file,JSON.stringify(broken)+'\n',{mode:0o600});
 expect(req('bound_recover'),24,'BOUND_DURABLE_STATE_CORRUPT');
 fs.writeFileSync(file,backup,{mode:0o600});
});
test('20c corrupted receipt digest fails closed even during signed revocation',()=>{
 const backup=fs.readFileSync(file);
 const broken=JSON.parse(backup.toString('utf8'));
 broken.receipts.uat_cmd_bound_third.digest='invalid';
 fs.writeFileSync(file,JSON.stringify(broken)+'\n',{mode:0o600});
 const rev={kind:'fake_revocation',ownerAccountId:ids.ownerAccountId,
   accountId:ids.accountId,deviceId:ids.deviceId,grantId:nextA.grantId,
   revocationRevision:2,effectiveAt:t-1000,reason:'owner_revoke'};
 expect(req('bound_revoke',{signedRevocation:signed('revocation',rev,'issuer')}),
   24,'BOUND_DURABLE_STATE_CORRUPT');
 fs.writeFileSync(file,backup,{mode:0o600});
});
test('20d tampering writer verifier pin blocks grant recovery',()=>{
 const backup=fs.readFileSync(file);
 const broken=JSON.parse(backup.toString('utf8'));
 broken.signedVerifierSha='0'.repeat(64);
 fs.writeFileSync(file,JSON.stringify(broken)+'\n',{mode:0o600});
 expect(req('bound_recover'),24,'BOUND_IDENTITY_OR_ISSUER_PIN_MISMATCH');
 fs.writeFileSync(file,backup,{mode:0o600});
});
test('20e signed revoke while fake STARTED marks UNCERTAIN, preserves completed',()=>{
 const fourth=command(nextE,'uat_cmd_bound_fourth',{
   payload:{kind:'fake_noop',message:'uncompleted fake action'}
 });
 const pkt=packets(nextA,nextL,nextE,fourth);
 expect(req('bound_accept',pkt),0,'BOUND_APPROVAL_EPOCH_AND_RECEIPT_PERSISTED');
 expect(req('bound_start',pkt),0,'BOUND_FAKE_STARTED');
 assert.equal(state().receipts.uat_cmd_bound_fourth.status,'started');
 const revoke={kind:'fake_revocation',ownerAccountId:ids.ownerAccountId,
  accountId:ids.accountId,deviceId:ids.deviceId,grantId:nextA.grantId,
  revocationRevision:2,effectiveAt:t-1000,reason:'owner_revoke'};
 expect(req('bound_revoke',{signedRevocation:signed('revocation',revoke,'issuer')}),
   0,'BOUND_REVOCATION_DURABLE_FENCE');
 assert.equal(state().receipts.uat_cmd_bound_fourth.status,'uncertain');
 assert.equal(state().receipts.uat_cmd_bound_third.status,'completed');
 expect(req('bound_start',pkt),24,'GRANT_TOMBSTONED');
});
test('21 owner forged clock value not allowed to extend expired grants',()=>{
 // In this test, corrupting lastSeenMs simulates a protected clock rollback
 // observation; the new worker MUST fail closed.
 const snapshot=state();
 snapshot.grantState.lastSeenMs=Date.now()+3600000;
 fs.writeFileSync(file,JSON.stringify(snapshot)+'\n',{mode:0o600});
 expect(req('bound_start',{...nextPackets,nowMs:Date.now()+7200000}),
  24,'CLOCK_ROLLBACK_FAIL_CLOSED');
});
test('22 receipt and grant must be a single readable JSON object',()=>{
 const all=state();
 assert.equal(all.grantState.floorGeneration,51);
 assert.equal(all.generation,51);
 assert.equal(all.grantState.revocationRevision,2);
 assert.equal(all.receipts.uat_cmd_bound_fourth.status,'uncertain');
 assert.equal(fs.statSync(lock).ino,inode);
 assert.equal(fs.readdirSync(root).filter(x=>x.endsWith('.tmp')).length,0);
});
test('23 corruption cannot bootstrap a fresh trusted grant',()=>{
 fs.writeFileSync(file,'{torn\n',{mode:0o600});
 const r=call(req('initialize_bound',{
  verifierSpki:spki(keys.writer),wallVerifierSpki:spki(keys.wall),
  leaseVerifierSpki:spki(keys.issuer),deviceKeySha256
 }));
 assert.equal(r.status,22);
 assert.match(r.stderr,/receipt_corrupt/);
});
test('24 symlink receipt cannot be treated as missing trust state',()=>{
 fs.rmSync(file);
 fs.symlinkSync('does-not-exist.json',file);
 const r=call(req('initialize_bound',{
  verifierSpki:spki(keys.writer),wallVerifierSpki:spki(keys.wall),
  leaseVerifierSpki:spki(keys.issuer),deviceKeySha256
 }));
 assert.equal(r.status,22);
 assert.match(r.stderr,/receipt_file_invalid/);
});
