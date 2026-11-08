import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FreeBenefitRegistry} from '../../operator-host/free-benefit-registry.mjs';
import {writeSyntheticJsonDurably} from '../portability/durable-json-synthetic.mjs';

let passed=0;
function test(name,fn){fn();console.log('PASS '+name);passed++;}
function fixture(run){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-benefit-fixture-'));
  const stateFile=path.join(root,'free-benefits.json');
  try{
    return run({root,stateFile,
      opts:(ops=fs)=>({
        stateFile,mode:'shadow',now:()=>Date.UTC(2026,9,12),
        syntheticDurableUat:{syntheticOnly:true,root,writer:({stateFile:file,value})=>
          writeSyntheticJsonDurably({root,file,value,ops})}
      })
    });
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
const sample={accountId:'acct_synthetic',deviceId:'dev_synthetic',chargeId:'call_0001'};
test('opt_in_shadow_fixture_survives_reload',()=>fixture(({root,stateFile,opts})=>{
  const a=new FreeBenefitRegistry(opts());
  const first=a.reserve(sample);
  assert.equal(first.allowed,true);
  const data=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  assert.equal(data.schemaVersion,1);
  assert.equal(data.buckets['dev_synthetic|2026-10'].used,1);
  assert.equal(fs.statSync(stateFile).mode&0o777,0o600);
  const b=new FreeBenefitRegistry(opts());
  assert.equal(b.status({deviceId:'dev_synthetic'}).used,1);
  assert.equal(b.reserve(sample).idempotent,true);
  assert.deepEqual(fs.readdirSync(root),['free-benefits.json']);
}));
test('default_registry_still_uses_legacy_writer_and_schema',()=>fixture(({stateFile})=>{
  const a=new FreeBenefitRegistry({stateFile,mode:'shadow',now:()=>Date.UTC(2026,9,12)});
  assert.equal(a.reserve(sample).allowed,true);
  const b=new FreeBenefitRegistry({stateFile,mode:'shadow',now:()=>Date.UTC(2026,9,12)});
  assert.equal(b.reserve(sample).idempotent,true);
}));
test('explicit_uat_opt_in_required',()=>fixture(({stateFile})=>{
  assert.throws(()=>new FreeBenefitRegistry({
    stateFile,mode:'shadow',syntheticDurableUat:{syntheticOnly:false,writer:()=>{}}
  }),/invalid_synthetic_durable_uat/);
  assert.throws(()=>new FreeBenefitRegistry({
    stateFile,mode:'enforce',syntheticDurableUat:{syntheticOnly:true,writer:()=>{}}
  }),/invalid_synthetic_durable_uat/);
  assert.throws(()=>new FreeBenefitRegistry({
    stateFile,mode:'shadow',syntheticDurableUat:{syntheticOnly:true}
  }),/invalid_synthetic_durable_uat/);
}));
test('fsync_error_poison_fails_closed_until_reload',()=>fixture(({stateFile,opts})=>{
  let injections=0;
  const ops={...fs,fsyncSync(fd){if(injections++===0)throw new Error('synthetic EIO');return fs.fsyncSync(fd);}};
  const reg=new FreeBenefitRegistry(opts(ops));
  assert.throws(()=>reg.reserve(sample),/synthetic_io_failed_at_file_sync/);
  assert.equal(fs.existsSync(stateFile),false);
  assert.throws(()=>reg.reserve(sample),/synthetic_uat_persist_failed_restart_required/);
  assert.throws(()=>reg.status({deviceId:'dev_synthetic'}),/synthetic_uat_persist_failed_restart_required/);
  const restart=new FreeBenefitRegistry(opts());
  assert.equal(restart.reserve(sample).allowed,true);
}));
test('ambiguous_post_rename_failure_is_not_reported_as_charge_success',()=>fixture(({stateFile,opts})=>{
  let fsyncCalls=0;
  const ops={...fs,fsyncSync(fd){if(++fsyncCalls===2)throw new Error('synthetic directory EIO');return fs.fsyncSync(fd);}};
  const reg=new FreeBenefitRegistry(opts(ops));
  assert.throws(()=>reg.reserve(sample),/synthetic_io_failed_at_directory_sync/);
  assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).buckets['dev_synthetic|2026-10'].used,1);
  assert.throws(()=>reg.reserve({...sample,chargeId:'call_0002'}),/synthetic_uat_persist_failed_restart_required/);
}));
test('synthetic_failure_does_not_allow_paid_short_circuit',()=>fixture(({opts})=>{
  const reg=new FreeBenefitRegistry(opts({...fs,writeSync(){return 0;}}));
  assert.throws(()=>reg.reserve(sample),/synthetic_short_write/);
  assert.throws(()=>reg.reserve({...sample,plan:'pro'}),/synthetic_uat_persist_failed_restart_required/);
}));
console.log('RC50_FREE_BENEFIT_DURABLE_UAT_PASS '+passed+'/'+passed);
