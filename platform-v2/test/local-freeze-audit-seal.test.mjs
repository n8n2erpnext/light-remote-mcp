import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalIngressFreezeGate } from '../../lib/local-ingress-freeze.mjs';
import { AuditAppendBarrier } from '../../operator-host/audit-append-barrier.mjs';
import { appendDurableAuditBatch } from '../../operator-host/durable-audit-append.mjs';

test('real audit fsync must finish after jobs and before local frozen ACK',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-p0-audit-drain-'));
  const filename=path.join(dir,'operations.jsonl');
  let finishWrite;
  let startedWrite;
  const started=new Promise(r=>{startedWrite=r;});
  const barrier=new AuditAppendBarrier({write:async batch=>{
    startedWrite();
    await new Promise(r=>{finishWrite=r;});
    await appendDurableAuditBatch(filename,batch);
  }});
  let jobs=1;
  const gate=new LocalIngressFreezeGate({
    enabled:true,
    beforeDrained:()=>barrier.flush()
  });
  gate.registerPendingSource('operatorJobs',()=>jobs);
  try{
    const write=barrier.enqueue('{"event":"completed"}\n');
    await started;
    let resolved=false;
    const frozen=gate.freeze().then(()=>{resolved=true;});
    assert.equal(gate.snapshot().phase,'freezing');
    assert.equal(gate.snapshot().sealing,false); // pending job
    jobs=0;
    gate.notifyPendingChanged();
    await Promise.resolve();
    assert.equal(gate.snapshot().sealing,true); // audit still uncommitted
    assert.equal(gate.snapshot().phase,'freezing');
    assert.equal(resolved,false);
    finishWrite();
    await write;
    await frozen;
    assert.equal(gate.snapshot().phase,'frozen');
    assert.equal(gate.snapshot().sealFailed,false);
    assert.equal(fs.readFileSync(filename,'utf8'),'{"event":"completed"}\n');
    assert.equal(resolved,true);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('audit fsync failure never acknowledges drained and all waiters reject',async()=>{
  const barrier=new AuditAppendBarrier({write:async()=>{throw Error('fake_ENOSPC');}});
  const gate=new LocalIngressFreezeGate({
    enabled:true,
    beforeDrained:()=>barrier.flush()
  });
  const failed=barrier.enqueue('pending-audit\n');
  const first=gate.freeze();
  const second=gate.freeze();
  await assert.rejects(failed,/fake_ENOSPC/);
  await assert.rejects(first,/fake_ENOSPC/);
  await assert.rejects(second,/fake_ENOSPC/);
  assert.equal(gate.snapshot().phase,'freezing');
  assert.equal(gate.snapshot().sealFailed,true);
  assert.equal(gate.snapshot().drained,false);
  assert.equal(gate.beginWork(),null);
  await assert.rejects(gate.freeze(),/fake_ENOSPC/);
});
test('actual Operator freeze wiring waits for its durable audit flush',()=>{
  const src=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
  assert.match(src,/beforeDrained:.*flushDiskRecords\(\)/);
  assert.match(src,/write:batch=>appendDurableAuditBatch\(LOG_FILE,batch\)/);
  assert.match(src,/return auditAppendBarrier\.flush\(\)/);
  assert.match(src,/return auditAppendBarrier\.enqueue\(batch\)/);
  // Local audit seal does not equate to PostgreSQL/Redis/JSON authority.
  assert.doesNotMatch(src,/GLOBAL_WRITER_FENCE_READY/);
});
