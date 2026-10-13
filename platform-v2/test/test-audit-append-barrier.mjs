import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AuditAppendBarrier } from '../../operator-host/audit-append-barrier.mjs';

let passed=0;
async function run(name,fn){await fn();console.log('PASS '+name);passed++;}
await run('ordered_batches_and_idle_flush',async()=>{
  const writes=[];
  const barrier=new AuditAppendBarrier({write:async x=>{await Promise.resolve();writes.push(x);}});
  const a=barrier.enqueue('a\n'),b=barrier.enqueue('b\n');
  await Promise.all([a,b]);await barrier.flush();
  assert.deepEqual(writes,['a\n','b\n']);
  assert.equal(barrier.failed,false);
});
await run('flush_waits_for_pending_append',async()=>{
  let release;
  const barrier=new AuditAppendBarrier({write:()=>new Promise(r=>{release=r;})});
  const write=barrier.enqueue('waiting\n');
  let settled=false;const flush=barrier.flush().then(()=>{settled=true;});
  await new Promise(setImmediate);
  assert.equal(settled,false);
  release();await write;await flush;assert.equal(settled,true);
});
await run('failed_append_propagates_to_request_barrier',async()=>{
  const errors=[];
  const err=new Error('injected ENOSPC');
  const barrier=new AuditAppendBarrier({write:async()=>{throw err;},onFailure:x=>errors.push(x)});
  await assert.rejects(barrier.enqueue('a\n'),/ENOSPC/);
  await assert.rejects(barrier.flush(),/ENOSPC/);
  assert.equal(barrier.failed,true);
  assert.deepEqual(errors,[err]);
});
await run('latched_error_blocks_later_queued_batches',async()=>{
  let writes=0;
  const barrier=new AuditAppendBarrier({write:async()=>{writes++;throw new Error('EIO');}});
  const a=barrier.enqueue('a\n'),b=barrier.enqueue('b\n');
  await assert.rejects(a,/EIO/);
  await assert.rejects(b,/EIO/);
  await assert.rejects(barrier.enqueue('c\n'),/EIO/);
  assert.equal(writes,1);
});
await run('failure_logger_must_not_mask_latched_write_error',async()=>{
  const barrier=new AuditAppendBarrier({
    write:()=>Promise.reject(new Error('real_append_error')),
    onFailure:()=>{throw new Error('logger_failed');}
  });
  await assert.rejects(barrier.enqueue('event\n'),/real_append_error/);
  await assert.rejects(barrier.flush(),/real_append_error/);
});
await run('invalid_inputs_never_enqueue',async()=>{
  assert.throws(()=>new AuditAppendBarrier({}),/audit_append_dependencies_required/);
  const b=new AuditAppendBarrier({write:()=>Promise.resolve()});
  await assert.rejects(b.enqueue(''),/audit_batch_required/);
  await assert.rejects(b.enqueue({}),/audit_batch_required/);
  await b.flush();assert.equal(b.failed,false);
});
await run('empty_flush_rejects_after_old_async_failure',async()=>{
  let fail;
  const barrier=new AuditAppendBarrier({write:()=>new Promise((_,reject)=>{fail=reject;})});
  const promise=barrier.enqueue('a\n');
  await new Promise(setImmediate);
  fail(new Error('async disk failure'));
  await assert.rejects(promise,/async disk failure/);
  await assert.rejects(barrier.flush(),/async disk failure/);
});
await run('executor_dev_source_uses_error_latch_and_nonzero_shutdown',async()=>{
  const src=fs.readFileSync(path.resolve('operator-host/executor.mjs'),'utf8');
  assert.ok(src.includes("import { AuditAppendBarrier } from './audit-append-barrier.mjs'"));
  assert.ok(src.includes("import { appendDurableAuditBatch } from './durable-audit-append.mjs'"));
  assert.ok(src.includes('write:batch=>appendDurableAuditBatch(LOG_FILE,batch),'));
  assert.ok(src.includes('return auditAppendBarrier.enqueue(batch);'));
  assert.ok(src.includes('return auditAppendBarrier.flush();'));
  assert.ok(src.includes("server.close(()=>process.exit(1))"));
  assert.ok(src.includes("flushDiskRecords().catch(()=>{})"));
  assert.equal(src.includes('diskWriteChain=diskWriteChain.then('),false);
});
console.log('RC50_AUDIT_APPEND_BARRIER_TESTS_PASS '+passed+'/'+passed);
