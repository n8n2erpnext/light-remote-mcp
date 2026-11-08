import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeSyntheticJsonDurably} from '../portability/durable-json-synthetic.mjs';

let passed=0;
function run(name,fn){fn();console.log('PASS '+name);passed++;}
function fixture(fn){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-synthetic-json-'));
  const file=path.join(root,'registry.json');
  try{return fn({root,file});}
  finally{fs.rmSync(root,{recursive:true,force:true});}
}
function noTemps(root){
  assert.deepEqual(fs.readdirSync(root).filter(n=>n.startsWith('.lr-synthetic-')),[]);
}
function ioFault(stage,n=1){
  let hits=0;
  return {
    ...fs,
    [stage](...args){
      hits++;
      if(hits===n)throw Object.assign(new Error('injected synthetic EIO'),{code:'EIO'});
      return fs[stage](...args);
    }
  };
}
run('fresh_fixture_exclusive_temp_and_two_fsyncs',()=>fixture(({root,file})=>{
  let syncCount=0;
  const ops={...fs,fsyncSync(fd){syncCount++;return fs.fsyncSync(fd);}};
  const r=writeSyntheticJsonDurably({root,file,value:{schemaVersion:1,revoked:true},ops});
  assert.equal(syncCount,2);
  assert.equal(r.fileSynced,true);
  assert.equal(r.directorySynced,true);
  assert.equal(r.realBackupProven,false);
  assert.equal(r.productionCutoverAuthorized,false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{schemaVersion:1,revoked:true});
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  noTemps(root);
}));
run('atomic_replacement_updates_fixture_with_restricted_mode',()=>fixture(({root,file})=>{
  fs.writeFileSync(file,JSON.stringify({rev:1}),{mode:0o644});
  writeSyntheticJsonDurably({root,file,value:{rev:2}});
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).rev,2);
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  noTemps(root);
}));
run('file_fsync_failure_preserves_previous_generation',()=>fixture(({root,file})=>{
  fs.writeFileSync(file,'{"rev":1}\n');
  assert.throws(()=>writeSyntheticJsonDurably({root,file,value:{rev:2},ops:ioFault('fsyncSync',1)}),
    /synthetic_io_failed_at_file_sync/);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).rev,1);noTemps(root);
}));
run('short_write_failure_preserves_previous_generation',()=>fixture(({root,file})=>{
  fs.writeFileSync(file,'{"rev":1}\n');
  const ops={...fs,writeSync(){return 0;}};
  assert.throws(()=>writeSyntheticJsonDurably({root,file,value:{rev:2},ops}),/synthetic_short_write/);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).rev,1);noTemps(root);
}));
run('rename_failure_preserves_previous_generation',()=>fixture(({root,file})=>{
  fs.writeFileSync(file,'{"rev":1}\n');
  assert.throws(()=>writeSyntheticJsonDurably({root,file,value:{rev:2},ops:ioFault('renameSync')}),
    /synthetic_io_failed_at_rename/);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).rev,1);noTemps(root);
}));
run('directory_fsync_failure_is_ambiguous_and_never_returns_success',()=>fixture(({root,file})=>{
  fs.writeFileSync(file,'{"rev":1}\n');
  assert.throws(()=>writeSyntheticJsonDurably({root,file,value:{rev:2},ops:ioFault('fsyncSync',2)}),
    /synthetic_io_failed_at_directory_sync/);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).rev,2);
  noTemps(root);
}));
run('symlink_target_rejected_without_clobbering_destination',()=>fixture(({root,file})=>{
  const outside=path.join(root,'original.json');
  fs.writeFileSync(outside,'{"safe":true}\n');
  fs.symlinkSync(outside,file);
  assert.throws(()=>writeSyntheticJsonDurably({root,file,value:{safe:false}}),
    /synthetic_target_not_regular_file/);
  assert.equal(JSON.parse(fs.readFileSync(outside,'utf8')).safe,true);noTemps(root);
}));
run('symlink_parent_rejected',()=>fixture(({root,file})=>{
  const real=path.join(root,'real'),sym=path.join(root,'linked');
  fs.mkdirSync(real);fs.symlinkSync(real,sym);
  assert.throws(()=>writeSyntheticJsonDurably({root,file:path.join(sym,'a.json'),value:{v:1}}),
    /synthetic_parent_not_real_directory/);
}));
run('traversal_or_outside_fixture_rejected',()=>fixture(({root,file})=>{
  assert.throws(()=>writeSyntheticJsonDurably({root,file:path.join(root,'..','other.json'),value:{v:1}}),
    /synthetic_target_outside_fixture_root/);
  assert.throws(()=>writeSyntheticJsonDurably({root,file:root+'/../other.json',value:{v:1}}),
    /synthetic_path_not_normalized/);
}));
run('unrestricted_mode_rejected',()=>fixture(({root,file})=>{
  assert.throws(()=>writeSyntheticJsonDurably({root,file,value:{v:1},mode:0o644}),
    /synthetic_mode_must_be_0600/);
}));
run('encoding_cycle_rejected',()=>fixture(({root,file})=>{
  const cycle={v:1};cycle.circular=cycle;
  assert.throws(()=>writeSyntheticJsonDurably({root,file,value:cycle}),
    /synthetic_json_encoding_failed/);
}));
run('large_payload_rejected',()=>fixture(({root,file})=>{
  assert.throws(()=>writeSyntheticJsonDurably({root,file,value:{x:'z'.repeat(9*1024*1024)}}),
    /synthetic_fixture_size_limit/);
}));
run('existing_directory_is_not_replaced',()=>fixture(({root,file})=>{
  fs.mkdirSync(file);
  assert.throws(()=>writeSyntheticJsonDurably({root,file,value:{v:1}}),
    /synthetic_target_not_regular_file/);
}));
run('invalid_fixture_root_or_json_shape_rejected',()=>fixture(({root,file})=>{
  assert.throws(()=>writeSyntheticJsonDurably({root:'relative-root',file,value:{v:1}}),
    /synthetic_absolute_paths_required/);
  assert.throws(()=>writeSyntheticJsonDurably({root,file,value:[]}),
    /synthetic_json_object_required/);
}));
console.log('RC50_DURABLE_JSON_SYNTHETIC_TESTS_PASS '+passed+'/'+passed);
