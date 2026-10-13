import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {SyntheticSingleInstanceLease} from '../portability/synthetic-single-instance-lease.mjs';
const moduleUrl=new URL('../portability/synthetic-single-instance-lease.mjs',import.meta.url).href;

function temp(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-uat-instance-unit-'));
 fs.chmodSync(dir,0o700);
 const file=path.join(dir,'journal');
 try{return fn(dir,file);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('one owner permitted, second process/instance denied, clean release',()=>temp((dir,file)=>{
 const first=new SyntheticSingleInstanceLease(file);
 assert.equal(first.owns(),true);
 assert.throws(()=>new SyntheticSingleInstanceLease(file),/LEASE_NOT_ACQUIRED/);
 const script=`import {SyntheticSingleInstanceLease} from ${JSON.stringify(moduleUrl)};
try{new SyntheticSingleInstanceLease(process.argv[1]);process.exit(3);}
catch(e){process.exit(e.message==='LEASE_NOT_ACQUIRED'?0:4);}`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,file],
  {encoding:'utf8',timeout:3500});
 assert.equal(child.status,0,child.stderr);
 assert.equal(first.owns(),true);
 first.release();
 const second=new SyntheticSingleInstanceLease(file);
 assert.equal(second.owns(),true);
 second.release();
}));
test('crashed child leaves sticky stale lock; no automatic PID reaping',()=>temp((dir,file)=>{
 const script=`import {SyntheticSingleInstanceLease} from ${JSON.stringify(moduleUrl)};
new SyntheticSingleInstanceLease(process.argv[1]);process.exit(0);`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,file],
  {encoding:'utf8',timeout:3500});
 assert.equal(child.status,0,child.stderr);
 assert.throws(()=>new SyntheticSingleInstanceLease(file),/LEASE_NOT_ACQUIRED/);
 assert.equal(fs.existsSync(file+'.owner-lock'),true);
 // Test-only manual stale-lock reconciliation after parent has inspected it.
 fs.unlinkSync(file+'.owner-lock');
 const next=new SyntheticSingleInstanceLease(file);
 assert.equal(next.owns(),true);next.release();
}));
test('insecure owner folder and existing owner lock denied',()=>temp((dir,file)=>{
 fs.chmodSync(dir,0o755);
 assert.throws(()=>new SyntheticSingleInstanceLease(file),/LEASE_PARENT_UNTRUSTED/);
 fs.chmodSync(dir,0o700);
 fs.writeFileSync(file+'.owner-lock','not-the-owner',{mode:0o600});
 assert.throws(()=>new SyntheticSingleInstanceLease(file),/LEASE_NOT_ACQUIRED/);
}));
test('owner lock path replacement triggers fail-closed ownership denial',()=>temp((dir,file)=>{
 const owner=new SyntheticSingleInstanceLease(file);
 const lock=file+'.owner-lock';
 const backup=lock+'.moved';
 fs.renameSync(lock,backup);
 fs.writeFileSync(lock,'replacement',{mode:0o600});
 assert.equal(owner.owns(),false);
 assert.throws(()=>owner.release(),/LEASE_OWNERSHIP_LOST/);
 assert.equal(fs.readFileSync(lock,'utf8'),'replacement');
}));
