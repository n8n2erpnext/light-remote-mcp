import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createApiWorkerQueue } from './api-worker-queue.mjs';

const actor = { accountId:'owner', deviceId:'pc', sessionId:'session', agentId:'agent',
  connectionId:'connection', grantId:'grant' };
const startRequest = () => ({ action:'start', workerId:randomUUID(), provider:'codex',
  model:'test-model', prompt:'PRIVATE_PROMPT_SENTINEL', context:'PRIVATE_CONTEXT_SENTINEL', timeoutMs:10000 });

function fixture(run, clock = Date.now) {
  const db = new DatabaseSync(':memory:');
  let local = actor;
  const providers = { codex:{ run } };
  const options = { db, providers, enabled:() => true, identity:() => local, now:clock };
  const queue = createApiWorkerQueue(options);
  return { queue, db, options, switchIdentity: id => local = id, close() { queue.close(); db.close(); } };
}

test('an exact owner review starts one job; receipts and progress omit all content', async () => {
  let calls = 0;
  const input = startRequest();
  const f = fixture(async ({ prompt, context, model }) => {
    calls++;
    assert.equal(prompt, input.prompt);
    assert.equal(context, input.context);
    assert.equal(model, input.model);
    return { text:'PRIVATE_RESULT_SENTINEL', model:'actual-model', usage:{ inputTokens:8 } };
  });
  try {
    const start = f.queue.request(actor, input, async () => true);
    assert.equal(start.state, 'awaiting_approval');
    assert.deepEqual(f.queue.request(actor, input), start);
    assert.throws(() => f.queue.request(actor, { ...input, context:'different' }), /id_conflict/);
    assert.equal(calls, 0);
    assert.equal(f.queue.ownerJobs()[0].context, input.context);
    assert.throws(() => f.queue.ownerDecision({ ...start, contextDigest:'stale', approve:true }), /job_unavailable/);
    assert.equal(f.queue.ownerDecision({ ...start, approve:true }).state, 'authorizing');
    await setImmediate();
    assert.equal(calls, 1);
    assert.throws(() => f.queue.ownerDecision({ ...start, approve:true }), /approval_invalid/);
    const { workerId } = input;
    const result = f.queue.request(actor, { action:'result', workerId });
    assert.equal(result.state, 'completed');
    assert.deepEqual(result.result, {text:'PRIVATE_RESULT_SENTINEL',actualModel:'actual-model',
      usage:{inputTokens:8,outputTokens:null,totalTokens:null}});
    const progress = f.queue.request(actor, { action:'events', workerId, after:1 });
    assert.deepEqual(progress.events.map(e => e.state), ['authorizing', 'running', 'completed']);
    const records = JSON.stringify({ progress, stored:f.db.prepare('SELECT * FROM api_worker_receipts').all() });
    assert.doesNotMatch(records, /PRIVATE_/);
    assert.throws(() => f.queue.request({ ...actor, grantId:'other' }, {action:'result',workerId}), /job_unavailable/);
    f.switchIdentity({ ...actor, accountId:'different' });
    assert.deepEqual(f.queue.ownerJobs(), []);
  } finally { f.close(); }
});

test('cancellation stays bound to one worker and discards its late result', async () => {
  let signal, release;
  const f = fixture(({ signal:workerSignal }) => {
    signal = workerSignal;
    return new Promise(resolve => { release = resolve; });
  });
  try {
    const first = f.queue.request(actor, startRequest(), async () => true);
    const second = f.queue.request(actor, startRequest(), async () => true);
    f.queue.ownerDecision({ ...first, approve:true });
    await setImmediate();
    assert.throws(() => f.queue.ownerDecision({ ...second, approve:true }), /device_busy/);
    assert.throws(() => f.queue.request({ ...actor, connectionId:'wrong' },
      {action:'cancel',workerId:first.workerId}), /job_unavailable/);
    assert.equal(signal.aborted, false);
    assert.equal(f.queue.request(actor, { action:'cancel',workerId:first.workerId }).state, 'stopping');
    assert.equal(signal.aborted, true);
    release({text:'late'});
    await setImmediate();
    assert.equal(f.queue.request(actor,{action:'result',workerId:first.workerId}).state, 'cancelled');
    assert.equal(f.queue.request(actor,{action:'status',workerId:second.workerId}).state, 'awaiting_approval');
  } finally { f.close(); }
});

test('send and result are fenced by live authority, and a recovered UUID cannot start again', async () => {
  const input = startRequest();
  let calls = 0, checks = 0;
  const f = fixture(async () => { calls++; return {text:'never forwarded after revocation'}; });
  try {
    const denied = f.queue.request(actor, startRequest(), async () => false);
    f.queue.ownerDecision({ ...denied, approve:true });
    await setImmediate();
    assert.equal(calls, 0);
    const start = f.queue.request(actor, input, async () => ++checks === 1);
    f.queue.ownerDecision({ ...start, approve:true });
    await setImmediate();
    assert.equal(calls, 1);
    assert.equal(f.queue.request(actor,{action:'result',workerId:input.workerId}).state, 'failed');
    const pending = startRequest();
    f.queue.request(actor,pending,async () => true);
    f.queue.close();
    const reopened = createApiWorkerQueue(f.options);
    try {
      assert.deepEqual(reopened.ownerJobs(), []);
      assert.equal(reopened.request(actor,pending).state, 'interrupted');
      assert.equal(reopened.request(actor,input).contentAvailable, false);
      assert.equal(calls, 1);
    } finally { reopened.close(); }
  } finally { f.close(); }
});

test('expired review cannot run, unsupported provider and ambient workspace fields are rejected', () => {
  let now = 1000;
  const f = fixture(() => assert.fail('expired job ran'), () => now);
  try {
    assert.throws(() => f.queue.request(actor,{...startRequest(),workspace:'/private'},async () => true), /request_invalid/);
    assert.throws(() => f.queue.request(actor,{...startRequest(),provider:'claude'},async () => true), /provider_unavailable/);
    const start = f.queue.request(actor,startRequest(),async () => true);
    now += 5 * 60 * 1000;
    assert.throws(() => f.queue.ownerDecision({ ...start, approve:true }), /approval_invalid/);
    assert.equal(f.queue.request(actor,{action:'status',workerId:start.workerId}).state,'expired');
    now += 15 * 60 * 1000;
    assert.equal(f.queue.request(actor,{action:'status',workerId:start.workerId}).contentAvailable,false);
  } finally { f.close(); }
});
