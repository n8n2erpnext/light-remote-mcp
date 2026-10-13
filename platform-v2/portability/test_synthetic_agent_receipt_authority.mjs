#!/usr/bin/env node
/** Linux only, disposable fixture only. No real Agent/PTY/desktop/fs input execution. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-agent-authority-'));
const lock=path.join(root,'authority.lock');
const worker=path.join(path.dirname(new URL(import.meta.url).pathname),'synthetic-agent-receipt-authority-worker.mjs');
const fd=fs.openSync(lock,'wx+',0o600);
const now=120000;
const base={nowMs:now};
const epoch=(generation=50,grantRevision=5)=>({
 kind:'fake_epoch',verifiedBy:'synthetic_test_only',accountId:'uat_account_demo',
 deviceId:'uat_device_demo',agentId:'uat_agent_demo',generation,grantRevision,
 notBeforeMs:100000,expiresAtMs:180000
});
const cmd=(id='uat_command_primary',digest='a'.repeat(64),generation=50,grantRevision=5)=>({
 kind:'fake_command',verifiedBy:'synthetic_test_only',accountId:'uat_account_demo',
 deviceId:'uat_device_demo',agentId:'uat_agent_demo',generation,grantRevision,
 notBeforeMs:119000,expiresAtMs:150000,commandId:id,digest,
 payload:{kind:'fake_noop',message:'only safe fake data'}
});
const e=(operation,more={})=>({...base,operation,...more});
const call=(request,options={})=>spawnSync('flock',[
  '-x','-n','-E','77','-F',lock,process.execPath,worker,root,
  Buffer.from(JSON.stringify(request)).toString('base64url')
],{stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:10000,...options});
function expect(request,status=0){
 const r=call(request);
 assert.equal(r.error,undefined,String(r.error?.message));
 assert.equal(r.status,status,String(r.stderr||r.stdout));
 return r.stdout.trim()?JSON.parse(r.stdout):null;
}
const state=()=>JSON.parse(fs.readFileSync(path.join(root,'authority.json'),'utf8'));
const inode=fs.statSync(lock).ino;
test.after(()=>{
 fs.closeSync(fd);
 fs.rmSync(root,{recursive:true,force:true});
});
test('01 rejects direct worker lacking supervisor inherited descriptor',()=>{
 const r=spawnSync(process.execPath,[worker,root,Buffer.from(JSON.stringify(e('initialize'))).toString('base64url')],{encoding:'utf8'});
 assert.equal(r.status,22);
 assert.match(r.stderr,/inherited_/);
});
test('02 initializes one 0600 fsynced receipt snapshot',()=>{
 const r=expect(e('initialize'));
 assert.equal(r.decision,'INITIALIZED');
 assert.equal(r.physicalExecutionAuthorized,false);
 assert.equal(state().generation,0);
 assert.equal(fs.statSync(path.join(root,'authority.json')).mode&0o777,0o600);
});
test('03 no reinitialize or data reset',()=>{
 const r=call(e('initialize'));
 assert.equal(r.status,22);
 assert.equal(state().generation,0);
});
test('04 bad fake epoch denied without mutation',()=>{
 const b=JSON.stringify(state());
 const r=expect(e('advance_epoch',{proof:{...epoch(),verifiedBy:'unsigned'}}),24);
 assert.equal(r.reason,'INVALID_FAKE_EPOCH_PROOF');
 assert.equal(JSON.stringify(state()),b);
});
test('05 fake epoch advances on-disk generation',()=>{
 const r=expect(e('advance_epoch',{proof:epoch()}));
 assert.equal(r.reason,'FAKE_EPOCH_ADVANCE');
 assert.equal(state().generation,50);
 assert.equal(state().grantRevision,5);
});
test('06 fake command creates durable ACCEPTED',()=>{
 const r=expect(e('accept',{command:cmd()}));
 assert.equal(r.fsyncPersisted,true);
 assert.equal(state().receipts.uat_command_primary.status,'accepted');
});
test('07 duplicate command never produces a new receipt',()=>{
 const b=JSON.stringify(state());
 const r=expect(e('accept',{command:cmd()}));
 assert.equal(r.reason,'DUPLICATE_RECEIPT_NO_REEXECUTION');
 assert.equal(JSON.stringify(state()),b);
});
test('08 same ID changed digest denied',()=>{
 const r=expect(e('accept',{command:cmd('uat_command_primary','b'.repeat(64))}),24);
 assert.equal(r.reason,'CONFLICTING_COMMAND_ID');
});
test('09 actual kernel lock excludes an independent writer',async()=>{
 // Holding process performs a harmless NOOP decision, then pauses while locked.
 const request=e('accept',{command:cmd(),delayMs:800});
 const run=spawn('flock',[
  '-x','-n','-E','77','-F',lock,process.execPath,worker,root,
  Buffer.from(JSON.stringify(request)).toString('base64url')
 ],{stdio:['ignore','pipe','pipe',fd]});
 let lockHeldResolve;
 const held=new Promise(resolve=>{lockHeldResolve=resolve;});
 const finished=new Promise((resolve,reject)=>{
   let stdout='',stderr='';
   run.stdout.on('data',c=>{
     stdout+=c;
     if(stdout.includes('RC50_AUTHORITY_TEST_LOCK_HELD')) lockHeldResolve();
   });
   run.stderr.on('data',c=>stderr+=c);
   run.once('error',reject);
   run.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
 });
 await Promise.race([held,new Promise((_,reject)=>{
   const timer=setTimeout(()=>reject(Error('did_not_observe_lock_held_marker')),3000);
   timer.unref();
 })]);
 const contender=spawnSync('flock',['-x','-n','-E','77',lock,'/bin/true'],{
  encoding:'utf8',timeout:3000
 });
 assert.equal(contender.status,77,'separate OS contender acquired receipt.lock');
 const competed=call(e('accept',{command:cmd()}));
 assert.equal(competed.status,77,'second worker improperly entered protected receipt');
 const holder=await finished;
 assert.equal(holder.code,0,holder.stderr);
 assert.equal(fs.statSync(lock).ino,inode);
});
test('10 started fake receipt dies via SIGKILL and kernel frees lock',()=>{
 const r=call(e('start_fake',{command:cmd(),crashAfterPersist:true}));
 assert.equal(r.signal,'SIGKILL');
 assert.equal(state().receipts.uat_command_primary.status,'started');
 const l=spawnSync('flock',['-x','-n','-E','77',lock,'/bin/true'],{encoding:'utf8'});
 assert.equal(l.status,0);
});
test('11 incomplete receipt recovers to UNCERTAIN, not executed again',()=>{
 const r=expect(e('recover',{recoveryEvidence:'synthetic_snapshot_checked'}));
 assert.equal(r.reason,'CRASH_RECOVERY_REQUIRES_DURABLE_RECONCILIATION');
 assert.equal(state().receipts.uat_command_primary.status,'uncertain');
});
test('12 duplicate after restart remains no-op',()=>{
 const r=expect(e('accept',{command:cmd()}));
 assert.equal(r.reason,'DUPLICATE_RECEIPT_NO_REEXECUTION');
});
test('13 uncertain receipt cannot start again',()=>{
 const r=expect(e('start_fake',{command:cmd()}),24);
 assert.equal(r.reason,'COMMAND_NOT_SAFE_TO_START');
});
test('14 independent fake command can complete durably',()=>{
 const c=cmd('uat_command_secondary','b'.repeat(64));
 expect(e('accept',{command:c}));
 expect(e('start_fake',{command:c}));
 const r=expect(e('complete_fake',{command:c,resultEvidence:'synthetic_noop_result'}));
 assert.equal(r.reason,'FAKE_COMPLETE_RECEIPT_ONLY');
 assert.equal(state().receipts.uat_command_secondary.status,'completed');
});
test('15 revoke by higher fake epoch preserves completed and fences inflight',()=>{
 const c=cmd('uat_command_third','c'.repeat(64));
 expect(e('accept',{command:c}));
 const r=expect(e('advance_epoch',{proof:epoch(51,6)}));
 assert.equal(r.generation,51);
 assert.equal(state().receipts.uat_command_third.status,'fenced');
 assert.equal(state().receipts.uat_command_secondary.status,'completed');
});
test('16 stale fake command rejected after epoch change',()=>{
 const r=expect(e('accept',{command:cmd('uat_command_stale','d'.repeat(64))}),24);
 assert.equal(r.reason,'COMMAND_INVALID_STALE_OR_EXPIRED');
});
test('17 lock file inode is never unlinked/replaced',()=>{
 assert.equal(fs.statSync(lock).ino,inode);
 assert.equal(fs.statSync(lock).mode&0o777,0o600);
 assert.equal(fs.readdirSync(root).filter(name=>name.endsWith('.tmp')).length,0);
 assert.equal(fs.existsSync(path.join(root,'3')),false);
});
test('18 corrupt disk receipt fails closed without reinit',()=>{
 fs.writeFileSync(path.join(root,'authority.json'),'{broken\n',{mode:0o600});
 const a=call(e('recover',{recoveryEvidence:'synthetic_snapshot_checked'}));
 assert.equal(a.status,22);
 assert.match(a.stderr,/receipt_corrupt/);
 const b=call(e('initialize'));
 assert.equal(b.status,22);
});
test('19 broken or replacement symlink is not treated as missing receipt',()=>{
 const file=path.join(root,'authority.json');
 fs.rmSync(file);
 fs.symlinkSync('nonexistent.json',file);
 const r=call(e('initialize'));
 assert.equal(r.status,22);
 assert.match(r.stderr,/receipt_file_invalid/);
 assert.equal(fs.lstatSync(file).isSymbolicLink(),true);
});
