#!/usr/bin/env node
/** Linux PRIVATE synthetic Ed25519 + OS flock receipt authority E2E.
 * All signer keys ephemeral RAM-only; every command is fake_noop.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
import {
 signSyntheticEpoch,signSyntheticCommand,
 syntheticSignedEpochDigest,
} from './synthetic-signed-agent-gate.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-agent-authority-'));
const lock=path.join(root,'authority.lock');
const fd=fs.openSync(lock,'wx+',0o600);
const inode=fs.statSync(lock).ino;
const worker=path.join(path.dirname(new URL(import.meta.url).pathname),
  'synthetic-agent-receipt-authority-worker.mjs');
const trusted=crypto.generateKeyPairSync('ed25519');
const rogue=crypto.generateKeyPairSync('ed25519');
const pin=trusted.publicKey.export({type:'spki',format:'der'}).toString('base64url');
const clock=Date.now();
const epoch=(generation=50,grantRevision=5,overrides={})=>({
 kind:'fake_epoch',
 accountId:'uat_account_demo',deviceId:'uat_device_demo',agentId:'uat_agent_demo',
 generation,grantRevision,notBefore:clock-60000,expiresAt:clock+120000,...overrides
});
const e0=epoch();
const signEpoch=(e=e0,key=trusted.privateKey)=>signSyntheticEpoch(key,e);
const packet0=signEpoch();
const digest0=syntheticSignedEpochDigest(e0);
const command=(id='uat_cmd_signed_one',digest=digest0,overrides={})=>({
 kind:'fake_command',accountId:e0.accountId,deviceId:e0.deviceId,agentId:e0.agentId,
 generation:50,grantRevision:5,epochDigest:digest,
 commandId:id,notBefore:clock-15000,expiresAt:clock+30000,
 payload:{kind:'fake_noop',message:'no operating system execution'},...overrides
});
const signCmd=(c=command(),key=trusted.privateKey)=>signSyntheticCommand(key,c);
const cmd0=signCmd();
const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const flags=['-x','-n','-E','77','-F',lock,process.execPath,worker,root];
const call=(value)=>spawnSync('flock',[...flags,enc(value)],{
 cwd:root,stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:10000
});
function expect(value,{status=0,decision,reason}={}){
 const r=call(value);
 assert.equal(r.error,undefined,String(r.error?.message));
 assert.equal(r.status,status,r.stderr||r.stdout);
 const result=r.stdout.trim()?JSON.parse(r.stdout.trim()):null;
 if(decision)assert.equal(result?.decision,decision);
 if(reason)assert.equal(result?.reason,reason);
 return result;
}
const state=()=>JSON.parse(fs.readFileSync(path.join(root,'authority.json'),'utf8'));
const req=(operation,p={})=>({operation,...p});
const signed=(operation,signedCommand=cmd0,signedEpoch=packet0,rest={})=>
  req(operation,{signedEpoch,signedCommand,...rest});
test.after(()=>{fs.closeSync(fd);fs.rmSync(root,{force:true,recursive:true})});
test('01 rejects unapproved unsigned bootstrap into trusted fixture',()=>{
 const direct=spawnSync(process.execPath,[worker,root,enc(req('initialize_signed',{verifierSpki:pin}))],
  {encoding:'utf8'});
 assert.equal(direct.status,22);
});
test('02 signed bootstrap pins ephemeral verifier inside fsynced receipt',()=>{
 const r=expect(req('initialize_signed',{verifierSpki:pin}),{decision:'SIGNED_INITIALIZED'});
 assert.equal(r.physicalExecutionAuthorized,false);
 assert.equal(state().signedVerifierSpki,pin);
 assert.equal(state().signedEpochDigest,null);
});
test('03 reinitializing with rogue verifier never changes trust pin',()=>{
 const before=JSON.stringify(state());
 assert.equal(call(req('initialize_signed',{verifierSpki:rogue.publicKey.export({
  format:'der',type:'spki'}).toString('base64url')})).status,22);
 assert.equal(JSON.stringify(state()),before);
});
test('04 unsigned internal fake flags cannot modify pinned authority',()=>{
 const r=call(req('advance_epoch',{proof:{verifiedBy:'synthetic_test_only'},
  lockState:'acquired',storageHealth:'healthy',nowMs:clock}));
 assert.equal(r.status,22);
 assert.match(r.stderr,/unsigned_operation_on_pinned_authority/);
});
test('05 rogue signed epoch rejected before receipt mutation',()=>{
 const before=JSON.stringify(state());
 expect(signed('signed_epoch',cmd0,signEpoch(e0,rogue.privateKey)),{
  status:24,reason:'EPOCH_SIGNATURE_OR_SHAPE_INVALID'
 });
 assert.equal(JSON.stringify(state()),before);
});
test('06 tampered signed epoch denied',()=>{
 const before=JSON.stringify(state());
 const altered={...packet0,payload:{...packet0.payload,grantRevision:6}};
 expect(signed('signed_epoch',cmd0,altered),{
  status:24,reason:'EPOCH_SIGNATURE_OR_SHAPE_INVALID'
 });
 assert.equal(JSON.stringify(state()),before);
});
test('07 Ed25519 valid signed epoch updates on-disk generation',()=>{
 const r=expect(signed('signed_epoch'),{decision:'PROPOSE_DURABLE_MUTATION'});
 assert.equal(r.generation,50);
 assert.equal(state().signedEpochDigest,digest0);
 assert.equal(state().grantRevision,5);
});
test('08 identical signed epoch is idempotent',()=>{
 const before=JSON.stringify(state());
 expect(signed('signed_epoch'),{decision:'NOOP',reason:'EPOCH_ALREADY_CURRENT'});
 assert.equal(JSON.stringify(state()),before);
});
test('09 wrong device signed epoch refused even with trusted signature',()=>{
 const modified=signEpoch(epoch(51,6,{deviceId:'uat_device_wrong'}));
 expect(signed('signed_epoch',cmd0,modified),{
  status:24,reason:'SIGNED_EPOCH_WRONG_TARGET'
 });
});
test('10 valid signed command persists ACCEPTED receipt with digest',()=>{
 expect(signed('signed_accept'),{decision:'PROPOSE_DURABLE_MUTATION'});
 assert.equal(state().receipts.uat_cmd_signed_one.status,'accepted');
 assert.match(state().receipts.uat_cmd_signed_one.digest,/^[a-f0-9]{64}$/);
});
test('11 signed duplicate yields NOOP with zero re-execution',()=>{
 const before=JSON.stringify(state());
 expect(signed('signed_accept'),{decision:'NOOP',reason:'DUPLICATE_RECEIPT_NO_REEXECUTION'});
 assert.equal(JSON.stringify(state()),before);
});
test('12 same command ID changed signed payload rejected',()=>{
 const different=signCmd(command('uat_cmd_signed_one',digest0,{
   payload:{kind:'fake_noop',message:'modified but still fake'}
 }));
 expect(signed('signed_accept',different),{status:24,reason:'CONFLICTING_COMMAND_ID'});
});
test('13 rogue signed command rejected before receipt',()=>{
 const before=JSON.stringify(state());
 expect(signed('signed_accept',signCmd(command('uat_cmd_signed_rogue'),rogue.privateKey)),{
  status:24,reason:'COMMAND_SIGNATURE_OR_SHAPE_INVALID'});
 assert.equal(JSON.stringify(state()),before);
});
test('14 tampered command signature rejected before receipt',()=>{
 const tampered={...cmd0,payload:{...cmd0.payload,
   payload:{kind:'fake_noop',message:'tampered'}}};
 expect(signed('signed_accept',tampered),{status:24,reason:'COMMAND_SIGNATURE_OR_SHAPE_INVALID'});
});
test('15 caller-supplied clock cannot revive already expired signed command',()=>{
 const expired=signCmd(command('uat_cmd_signed_expired',digest0,{
   notBefore:clock-25000,expiresAt:clock-5000
 }));
 expect(signed('signed_accept',expired,packet0,{nowMs:clock-12000}),{
  status:24,reason:'SIGNED_COMMAND_NOT_FRESH'});
});
test('16 wrong grant revision refused with valid command signature',()=>{
 const wrong=signCmd(command('uat_cmd_signed_revision',digest0,{grantRevision:7}));
 expect(signed('signed_accept',wrong),{
  status:24,reason:'SIGNED_COMMAND_GRANT_OR_EPOCH_MISMATCH'});
});
test('17 an independent kernel process blocks two signed receipt writers',async()=>{
 const holdReq=signed('signed_accept',cmd0,packet0,{delayMs:700});
 const hold=spawn('flock',[...flags,enc(holdReq)],{
  cwd:root,stdio:['ignore','pipe','pipe',fd]
 });
 let ready;
 const held=new Promise(resolve=>{ready=resolve;});
 const finished=new Promise((resolve,reject)=>{
  let stdout='',stderr='';
  hold.stdout.on('data',c=>{stdout+=c;if(stdout.includes('RC50_AUTHORITY_TEST_LOCK_HELD'))ready()});
  hold.stderr.on('data',c=>stderr+=c);
  hold.once('error',reject);
  hold.once('close',(code,signal)=>resolve({code,signal,stderr}));
 });
 await Promise.race([held,new Promise((_,reject)=>{
  const timer=setTimeout(()=>reject(Error('holder_no_lock_marker')),3000);timer.unref();
 })]);
 const outside=spawnSync('flock',['-x','-n','-E','77',lock,'/bin/true'],{encoding:'utf8'});
 assert.equal(outside.status,77);
 const other=call(signed('signed_accept'));
 assert.equal(other.status,77);
 const result=await finished;
 assert.equal(result.code,0,result.stderr);
 assert.equal(fs.statSync(lock).ino,inode);
});
test('18 valid signed fake STARTED survives SIGKILL without physical action',()=>{
 const r=call(signed('signed_start',cmd0,packet0,{crashAfterPersist:true}));
 assert.equal(r.signal,'SIGKILL',r.stderr);
 assert.equal(state().receipts.uat_cmd_signed_one.status,'started');
 const after=spawnSync('flock',['-x','-n','-E','77',lock,'/bin/true'],{encoding:'utf8'});
 assert.equal(after.status,0);
});
test('19 local recovery preserves UNKNOWN effects as UNCERTAIN',()=>{
 expect(req('signed_recover'),{reason:'CRASH_RECOVERY_REQUIRES_DURABLE_RECONCILIATION'});
 assert.equal(state().receipts.uat_cmd_signed_one.status,'uncertain');
});
test('20 replay of signed command after restart cannot re-execute',()=>{
 expect(signed('signed_accept'),{decision:'NOOP',reason:'DUPLICATE_RECEIPT_NO_REEXECUTION'});
 expect(signed('signed_start'),{status:24,reason:'COMMAND_NOT_SAFE_TO_START'});
});
test('21 separate signed command completes as receipt-only fake',()=>{
 const next=signCmd(command('uat_cmd_signed_second',digest0,{
   payload:{kind:'fake_noop',message:'second harmless fake'}
 }));
 expect(signed('signed_accept',next));
 expect(signed('signed_start',next));
 expect(signed('signed_complete',next),{reason:'FAKE_COMPLETE_RECEIPT_ONLY'});
 assert.equal(state().receipts.uat_cmd_signed_second.status,'completed');
});
test('22 new signed generation fences accepted work and preserves completed',()=>{
 const future=signCmd(command('uat_cmd_signed_third'));
 expect(signed('signed_accept',future));
 const next=signEpoch(epoch(51,6));
 expect(signed('signed_epoch',cmd0,next),{reason:'FAKE_EPOCH_ADVANCE'});
 assert.equal(state().generation,51);
 assert.equal(state().receipts.uat_cmd_signed_third.status,'fenced');
 assert.equal(state().receipts.uat_cmd_signed_second.status,'completed');
});
test('23 old command and downgraded signed epoch are both refused',()=>{
 expect(signed('signed_accept'),{status:24,reason:'SIGNED_EPOCH_NOT_CURRENT'});
 expect(signed('signed_epoch'),{status:24,reason:'SIGNED_EPOCH_ROLLBACK'});
});
test('24 corrupt pinned fingerprint fails closed',()=>{
 const file=path.join(root,'authority.json');
 const snapshot=state();
 snapshot.signedVerifierSha='0'.repeat(64);
 fs.writeFileSync(file,JSON.stringify(snapshot)+'\n',{mode:0o600});
 const future=signEpoch(epoch(52,7));
 expect(signed('signed_epoch',cmd0,future),{status:24,reason:'PINNED_VERIFIER_INVALID'});
 assert.equal(state().generation,51);
});
test('25 receipt symlink substitution cannot reinitialize signed root',()=>{
 const file=path.join(root,'authority.json');
 fs.rmSync(file);
 fs.symlinkSync('missing.json',file);
 const r=call(req('initialize_signed',{verifierSpki:pin}));
 assert.equal(r.status,22);
 assert.match(r.stderr,/receipt_file_invalid/);
});
