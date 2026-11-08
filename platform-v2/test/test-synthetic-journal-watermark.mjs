import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SyntheticJournalWatermark} from '../portability/synthetic-journal-watermark.mjs';
import {AuditAppendBarrier} from '../../operator-host/audit-append-barrier.mjs';

let passed=0;
async function test(name,fn){await fn();console.log('PASS '+name);passed++;}
async function fixture(run){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-journal-fixture-'));
  const file=path.join(root,'activity.jsonl');
  try{return await run({root,file,create:(ops=fs)=>new SyntheticJournalWatermark({root,file,ops})});}
  finally{fs.rmSync(root,{recursive:true,force:true});}
}
await test('new_journal_has_zero_watermark_and_no_customer_data',()=>fixture(({file,create})=>{
  const j=create(),w=j.watermark();
  assert.equal(w.sequence,0);
  assert.equal(w.byteOffset,0);
  assert.equal(w.sha256,'0'.repeat(64));
  assert.equal(w.fsyncAcknowledged,false);
  assert.equal(w.realBackupProven,false);
  assert.equal(fs.existsSync(file),false);
}));
await test('append_fsync_watermark_and_restart_replay',()=>fixture(({file,create})=>{
  const j=create();
  const first=j.append({type:'fake_credit',value:1});
  const second=j.append({type:'fake_credit',value:2});
  assert.equal(first.sequence,1);assert.equal(second.sequence,2);
  assert.ok(second.byteOffset>first.byteOffset);
  assert.notEqual(first.sha256,second.sha256);
  assert.equal(second.fsyncAcknowledged,true);
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const restored=create().watermark();
  assert.equal(restored.fsyncAcknowledged,false);
  assert.deepEqual({...restored,fsyncAcknowledged:true},second);
  assert.equal(create().append({type:'fake_credit',value:3}).fsyncAcknowledged,true);
}));
await test('file_and_directory_fsync_count_for_new_file',()=>fixture(({create})=>{
  let fsyncs=0;
  const ops={...fs,fsyncSync(fd){fsyncs++;return fs.fsyncSync(fd);}};
  const j=create(ops);
  j.append({event:'synthetic'});
  assert.equal(fsyncs,2);
  j.append({event:'next'});
  assert.equal(fsyncs,3);
}));
await test('file_sync_error_does_not_advance_watermark',()=>fixture(({create})=>{
  let calls=0;const ops={...fs,fsyncSync(fd){calls++;if(calls===1)throw new Error('fault');return fs.fsyncSync(fd);}};
  const j=create(ops);
  assert.throws(()=>j.append({type:'fake'}),/journal_io_failed_at_file_fsync/);
  assert.equal(j.failed,true);
  assert.throws(()=>j.watermark(),/journal_restart_required_after_failure/);
  assert.throws(()=>j.append({type:'again'}),/journal_restart_required_after_failure/);
}));
await test('directory_sync_error_does_not_certify_first_creation',()=>fixture(({create})=>{
  let calls=0;const ops={...fs,fsyncSync(fd){calls++;if(calls===2)throw new Error('dir fault');return fs.fsyncSync(fd);}};
  const j=create(ops);
  assert.throws(()=>j.append({type:'fake'}),/journal_io_failed_at_directory_fsync/);
  assert.equal(j.failed,true);
}));
await test('short_write_poison_fails_closed',()=>fixture(({create})=>{
  const j=create({...fs,writeSync(){return 0;}});
  assert.throws(()=>j.append({type:'fake'}),/journal_short_write/);
  assert.equal(j.failed,true);
}));
await test('corrupt_tail_cannot_be_treated_as_replay_watermark',()=>fixture(({file,create})=>{
  const j=create();j.append({type:'fake'});
  fs.appendFileSync(file,'broken');
  assert.throws(()=>create(),/journal_incomplete_tail/);
}));
await test('tampered_record_sha_fails_reopen',()=>fixture(({file,create})=>{
  const j=create();j.append({type:'fake'});
  const text=fs.readFileSync(file,'utf8'),record=JSON.parse(text);
  record.event.type='other';
  fs.writeFileSync(file,JSON.stringify(record)+'\n',{mode:0o600});
  assert.throws(()=>create(),/journal_replay_digest_mismatch/);
}));
await test('symlink_journal_target_rejected',()=>fixture(({root,file,create})=>{
  const target=path.join(root,'safe.jsonl');
  fs.writeFileSync(target,'');
  fs.symlinkSync(target,file);
  assert.throws(()=>create(),/journal_file_not_regular/);
}));
await test('untrusted_paths_rejected',()=>fixture(({root,file})=>{
  assert.throws(()=>new SyntheticJournalWatermark({root:'/tmp',file}),/journal_fixture_root_required/);
  assert.throws(()=>new SyntheticJournalWatermark({root,file:path.join(root,'other')}),/journal_fixture_file_required/);
}));
await test('barrier_can_ack_only_after_journal_fsync',async()=>fixture(async({create})=>{
  const j=create();
  const barrier=new AuditAppendBarrier({write:async batch=>j.append({batch})});
  await barrier.enqueue('synthetic event');
  await barrier.flush();
  const w=j.watermark();
  assert.equal(w.sequence,1);
  assert.equal(w.fsyncAcknowledged,true);
}));
console.log('RC50_SYNTHETIC_JOURNAL_WATERMARK_PASS '+passed+'/'+passed);
