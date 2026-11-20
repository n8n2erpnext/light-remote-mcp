import { normalizeWorkerRequest, workerActorKey, workerError, workerRequestDigest, safeWorkerError } from '../lib/api-worker-request.mjs';

const activeStates = new Set(['awaiting_approval', 'authorizing', 'running', 'stopping']);
const approvalWindowMs = 5 * 60 * 1000;
const resultWindowMs = 15 * 60 * 1000;
const maxLiveRows = 32;
const maxReceipts = 4096;
const maxParallel = 2;
const maxGroupWorkers = 2;
const maxGroupTimeMs = 120000;
const maxActiveTimeMs = 120000;

// SQLite stores a content-free receipt. The actual review text and result
// live on this device in memory. A restart loses content and fences replays.
export function createApiWorkerQueue({ db, identity, enabled, providers, readCheckpoint, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS api_worker_receipts(
    worker_id TEXT PRIMARY KEY,
    actor_key TEXT NOT NULL,
    digest TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS api_worker_groups(
    group_id TEXT PRIMARY KEY,
    actor_key TEXT NOT NULL,
    snapshot_digest TEXT NOT NULL,
    worker_count INTEGER NOT NULL,
    reserved_ms INTEGER NOT NULL
  )`);
  db.prepare(`UPDATE api_worker_receipts SET state='interrupted',finished_at=?
    WHERE state IN ('awaiting_approval','authorizing','running','stopping')`).run(now());
  const receipts = db.prepare('SELECT * FROM api_worker_receipts WHERE worker_id=?');
  const receiptCount = db.prepare('SELECT COUNT(*) AS total FROM api_worker_receipts');
  const insert = db.prepare('INSERT INTO api_worker_receipts VALUES(?,?,?,?,?,NULL)');
  const update = db.prepare('UPDATE api_worker_receipts SET state=?,finished_at=? WHERE worker_id=?');
  const groupRecord = db.prepare('SELECT * FROM api_worker_groups WHERE group_id=?');
  const reserveGroup = db.prepare(`INSERT INTO api_worker_groups VALUES(?,?,?,1,?)
    ON CONFLICT(group_id) DO UPDATE SET worker_count=worker_count+1,reserved_ms=reserved_ms+excluded.reserved_ms`);
  const rows = new Map();
  const running = new Map();
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
      ...(row.workGroupId?{workGroupId:row.workGroupId}:{}),
      state: row.state,
      provider: row.provider,
      requestedModel: row.model,
      timeoutMs: row.timeoutMs,
      contextDigest: row.approvalDigest,
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
      row.context = null;
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
      return { mode:'text-review',requiresOwnerApproval:true,maxConcurrent:maxParallel,maxPerProvider:1,
        maxActiveTimeMs,groupBudget:{maxWorkers:maxGroupWorkers,maxReservedMs:maxGroupTimeMs},
        timeoutMs:{min:10000,max:90000},
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
      const context=resolveReference(req);
      const created = {
        id: req.workerId, actor: { ...actor }, digest, provider: req.provider,
        approvalDigest:req.memoryCheckpoint?workerRequestDigest({digest,context}):digest,
        model: req.model, timeoutMs: req.timeoutMs, workGroupId:req.workGroupId, input: req, context, authorize,
        createdAt: now(), finishedAt: null, state: 'awaiting_approval',
        events: [], controller: new AbortController(), error: null, result: null
      };
      persistAdmission(created,actorKey);
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

  function resolveReference(req) {
    if(!req.memoryCheckpoint)return req.context;
    try{
      const record=readCheckpoint?.(req.memoryCheckpoint);
      if(record?.integrity!=='home_ed25519_verified'||typeof record.body!=='string'||
        !/^[a-f0-9]{64}$/.test(record.contentHash))throw workerError('checkpoint_unavailable');
      const context=JSON.stringify({checkpoint:req.memoryCheckpoint,title:record.title,
        body:record.body,contentHash:record.contentHash});
      if(Buffer.byteLength(context)>48000)throw workerError('checkpoint_unavailable');
      return context;
    }catch{throw workerError('checkpoint_unavailable');}
  }

  function persistAdmission(row,actorKey) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if(row.workGroupId){
        const snapshotDigest=workerRequestDigest(row.context);
        const group=groupRecord.get(row.workGroupId);
        if(group && (group.actor_key!==actorKey||group.snapshot_digest!==snapshotDigest)) {
          throw workerError('group_scope_conflict');
        }
        if(group && (group.worker_count>=maxGroupWorkers||group.reserved_ms+row.timeoutMs>maxGroupTimeMs)) {
          throw workerError('group_budget_exhausted');
        }
        reserveGroup.run(row.workGroupId,actorKey,snapshotDigest,row.timeoutMs);
      }
      insert.run(row.id,actorKey,row.digest,row.state,row.createdAt);
      db.exec('COMMIT');
    } catch(error) {
      db.exec('ROLLBACK');
      throw error;
    }
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
        context: row.context
      } : {})
    }));
  }

  function ownerDecision({ workerId, contextDigest, approve }) {
    sweep();
    const row = rows.get(workerId);
    if (!row || !isCurrent(row.actor) || row.approvalDigest !== contextDigest) throw workerError('job_unavailable');
    if (approve === false) {
      stop(row, 'cancelled');
      return view(row);
    }
    if (approve !== true || row.state !== 'awaiting_approval') throw workerError('approval_invalid');
    if (running.size>=maxParallel||running.has(row.provider)) throw workerError('device_busy');
    const reserved=[...running.values()].reduce((total,job)=>total+job.timeoutMs,0);
    if(reserved+row.timeoutMs>maxActiveTimeMs)throw workerError('device_budget_busy');
    transition(row, 'authorizing');
    running.set(row.provider,row);
    void run(row).catch(()=>{
      // A receipt-store failure after provider start leaves the effect uncertain.
      // Discard private buffers. The durable prior receipt still prevents replay.
      row.result=null;
      row.input=null;
      row.context=null;
      row.authorize=null;
      row.error='api_worker_receipt_unavailable';
      row.state='interrupted';
      row.finishedAt=now();
    });
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
      if(row.input.memoryCheckpoint&&resolveReference(row.input)!==row.context)
        throw workerError('checkpoint_changed');
    };
    const monitor = async () => {
      try {
        await verify();
        if (!signal.aborted && running.get(row.provider)===row) {
          checkTimer = setTimeout(monitor, 2000);
          checkTimer.unref?.();
        }
      } catch {
        if (running.get(row.provider)===row) stop(row, 'authority_lost');
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
        prompt: input.prompt, context: row.context, model: input.model,
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
      if (running.get(row.provider)===row) running.delete(row.provider);
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
