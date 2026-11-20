import { normalizeWorkerRequest, workerActorKey, workerError, workerRequestDigest, safeWorkerError } from '../lib/api-worker-request.mjs';

const activeStates = new Set(['awaiting_approval', 'authorizing', 'running', 'stopping']);
const approvalWindowMs = 5 * 60 * 1000;
const resultWindowMs = 15 * 60 * 1000;
const maxLiveRows = 32;
const maxReceipts = 4096;

// SQLite stores a content-free receipt. The actual review text and result
// live on this device in memory. A restart loses content and fences replays.
export function createApiWorkerQueue({ db, identity, enabled, providers, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS api_worker_receipts(
    worker_id TEXT PRIMARY KEY,
    actor_key TEXT NOT NULL,
    digest TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`);
  db.prepare(`UPDATE api_worker_receipts SET state='interrupted',finished_at=?
    WHERE state IN ('awaiting_approval','authorizing','running','stopping')`).run(now());
  const receipts = db.prepare('SELECT * FROM api_worker_receipts WHERE worker_id=?');
  const receiptCount = db.prepare('SELECT COUNT(*) AS total FROM api_worker_receipts');
  const insert = db.prepare('INSERT INTO api_worker_receipts VALUES(?,?,?,?,?,NULL)');
  const update = db.prepare('UPDATE api_worker_receipts SET state=?,finished_at=? WHERE worker_id=?');
  const rows = new Map();
  let running = null;
  let closed = false;

  function isCurrent(actor) {
    const local = identity();
    return !closed && enabled() && local?.accountId === actor.accountId && local?.deviceId === actor.deviceId;
  }

  function assertCurrent(actor) {
    if (!isCurrent(actor)) throw workerError('device_or_module_unavailable');
  }

  function view(row) {
    return {
      workerId: row.id,
      state: row.state,
      provider: row.provider,
      requestedModel: row.model,
      timeoutMs: row.timeoutMs,
      contextDigest: row.digest,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
      error: row.error
    };
  }

  function transition(row, state, error = null) {
    const at = now();
    const finishedAt = activeStates.has(state) ? null : at;
    update.run(state, finishedAt, row.id);
    row.state = state;
    row.finishedAt = finishedAt;
    row.error = error;
    row.events.push({ seq: row.events.length + 1, state, at });
    if (finishedAt !== null) {
      row.input = null;
      row.authorize = null;
    }
  }

  function stop(row, reason) {
    if (row.state === 'awaiting_approval') {
      transition(row, reason === 'timeout' ? 'expired' : 'cancelled');
      return;
    }
    if (['authorizing', 'running'].includes(row.state)) {
      transition(row, 'stopping');
      row.controller.abort(workerError(reason));
    }
  }

  function sweep() {
    for (const row of rows.values()) {
      if (row.state === 'awaiting_approval') {
        if (now() >= row.createdAt + approvalWindowMs) stop(row, 'timeout');
        else if (!isCurrent(row.actor)) stop(row, 'authority_lost');
      }
      if (row.finishedAt !== null && now() >= row.finishedAt + resultWindowMs) rows.delete(row.id);
    }
  }

  const sweepTimer = setInterval(sweep, 30000);
  sweepTimer.unref?.();

  function request(actor, input, authorize) {
    assertCurrent(actor);
    const actorKey = workerActorKey(actor);
    const req = normalizeWorkerRequest(input);
    if (req.action === 'capabilities') {
      return { mode:'text-review',requiresOwnerApproval:true,maxConcurrent:1,timeoutMs:{min:10000,max:90000},
        providers:Object.entries(providers).map(([provider,value])=>({provider,...value.status?.()})) };
    }
    sweep();
    const existing = receipts.get(req.workerId);
    if (existing && existing.actor_key !== actorKey) throw workerError('job_unavailable');
    const row = rows.get(req.workerId);
    if (req.action === 'start') {
      const digest = workerRequestDigest(req);
      if (existing) {
        if (existing.digest !== digest) throw workerError('id_conflict');
        return row ? view(row) : recovered(existing);
      }
      const provider = providers[req.provider];
      const providerState = provider?.status?.();
      if (typeof provider?.run !== 'function' || typeof authorize !== 'function' ||
          providerState?.configured === false || providerState?.enabled === false) {
        throw workerError('provider_unavailable');
      }
      if (rows.size >= maxLiveRows) throw workerError('queue_full');
      if (receiptCount.get().total >= maxReceipts) throw workerError('receipt_store_full');
      const created = {
        id: req.workerId, actor: { ...actor }, digest, provider: req.provider,
        model: req.model, timeoutMs: req.timeoutMs, input: req, authorize,
        createdAt: now(), finishedAt: null, state: 'awaiting_approval',
        events: [], controller: new AbortController(), error: null, result: null
      };
      insert.run(created.id, actorKey, digest, created.state, created.createdAt);
      created.events.push({ seq: 1, state: created.state, at: created.createdAt });
      rows.set(created.id, created);
      return view(created);
    }
    if (!existing) throw workerError('job_unavailable');
    if (!row) return recovered(existing);
    if (req.action === 'cancel') stop(row, 'cancelled');
    if (req.action === 'events') return { ...view(row), events: row.events.filter(e => e.seq > req.after) };
    if (req.action === 'result' && row.state === 'completed') return { ...view(row), result: structuredClone(row.result) };
    return view(row);
  }

  function recovered(receipt) {
    return {
      workerId: receipt.worker_id, state: receipt.state, contextDigest: receipt.digest,
      createdAt: receipt.created_at, finishedAt: receipt.finished_at, contentAvailable: false
    };
  }

  function ownerJobs() {
    sweep();
    return [...rows.values()].filter(row => isCurrent(row.actor)).map(row => ({
      ...view(row),
      ...(row.state === 'awaiting_approval' ? {
        agentId: row.actor.agentId,
        prompt: row.input.prompt,
        context: row.input.context
      } : {})
    }));
  }

  function ownerDecision({ workerId, contextDigest, approve }) {
    sweep();
    const row = rows.get(workerId);
    if (!row || !isCurrent(row.actor) || row.digest !== contextDigest) throw workerError('job_unavailable');
    if (approve === false) {
      stop(row, 'cancelled');
      return view(row);
    }
    if (approve !== true || row.state !== 'awaiting_approval') throw workerError('approval_invalid');
    if (running) throw workerError('device_busy');
    running = row;
    transition(row, 'authorizing');
    void run(row);
    return view(row);
  }

  async function run(row) {
    const { signal } = row.controller;
    const deadline = setTimeout(() => stop(row, 'timeout'), row.timeoutMs);
    deadline.unref?.();
    let checkTimer;
    const verify = async () => {
      const assertAvailable=()=>{
        assertCurrent(row.actor);
        if(providers[row.provider].enabled?.()===false)throw workerError('provider_disabled');
      };
      assertAvailable();
      if (await row.authorize(signal) !== true) throw workerError('authority_lost');
      assertAvailable();
      signal.throwIfAborted();
    };
    const monitor = async () => {
      try {
        await verify();
        if (!signal.aborted && running === row) {
          checkTimer = setTimeout(monitor, 2000);
          checkTimer.unref?.();
        }
      } catch {
        if (running === row) stop(row, 'authority_lost');
      }
    };
    try {
      await verify();
      transition(row, 'running');
      const provider = providers[row.provider];
      const input = row.input;
      checkTimer = setTimeout(monitor, 2000);
      checkTimer.unref?.();
      const result = await provider.run({
        prompt: input.prompt, context: input.context, model: input.model,
        timeoutMs: input.timeoutMs, signal, verify
      });
      signal.throwIfAborted();
      await verify();
      if (typeof result?.text !== 'string' || !result.text.trim() || Buffer.byteLength(result.text) > 24000) {
        throw workerError('result_invalid');
      }
      const usage = {};
      for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) {
        const value = result.usage?.[key];
        usage[key] = Number.isSafeInteger(value) && value >= 0 ? value : null;
      }
      row.result = {
        text: result.text,
        actualModel: typeof result.model === 'string' ? result.model.slice(0, 160) : null,
        usage
      };
      transition(row, 'completed');
    } catch (error) {
      if (closed) return;
      if (signal.aborted) {
        const code = safeWorkerError(signal.reason);
        transition(row, code === 'api_worker_cancelled' ? 'cancelled' : 'interrupted', code);
      } else {
        transition(row, 'failed', safeWorkerError(error));
      }
    } finally {
      clearTimeout(deadline);
      clearTimeout(checkTimer);
      if (running === row) running = null;
    }
  }

  return { request, ownerJobs, ownerDecision, close() {
    if (closed) return;
    clearInterval(sweepTimer);
    for (const row of rows.values()) {
      if (activeStates.has(row.state)) transition(row, 'interrupted', 'api_worker_shutdown');
      row.controller.abort(workerError('shutdown'));
    }
    closed = true;
    rows.clear();
  } };
}
