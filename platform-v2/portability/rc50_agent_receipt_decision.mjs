/**
 * Light Remote rc50: OFFLINE, FAKE-ONLY receipt decision model.
 * This module DOES NOT obtain locks, verify signatures, write receipts, or run OS work.
 * Never import it as production authority. Caller-supplied check flags are NOT proofs.
 * Intended to test one cross-platform policy before implementing native lock adapters.
 */
const ID = /^uat_[a-z0-9_-]{4,96}$/;
const HASH = /^[a-f0-9]{64}$/;
const STATES = new Set(['accepted', 'started', 'completed', 'uncertain', 'fenced']);
const OWN = Object.prototype.hasOwnProperty;
const owned = (o, k) => OWN.call(o, k);

function reject(reason) {
  return Object.freeze({ decision: 'DENY', reason, physicalExecutionAuthorized: false });
}
function noOp(reason) {
  return Object.freeze({ decision: 'NOOP', reason, physicalExecutionAuthorized: false });
}
function propose(reason, next) {
  return Object.freeze({
    decision: 'PROPOSE_DURABLE_MUTATION', reason, next,
    requiresFileAndDirectoryFsync: true, physicalExecutionAuthorized: false,
  });
}
function uatId(x) { return typeof x === 'string' && ID.test(x); }
function safeNumber(x) { return Number.isSafeInteger(x) && x >= 0; }
function snapshotOK(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || s.schema !== 1 ||
      !uatId(s.accountId) || !uatId(s.deviceId) || !uatId(s.agentId) ||
      !safeNumber(s.generation) || !safeNumber(s.grantRevision) ||
      !s.receipts || typeof s.receipts !== 'object' || Array.isArray(s.receipts)) return false;
  if ((s.generation === 0) !== (s.grantRevision === 0)) return false;
  if (Object.keys(s.receipts).length > 512) return false;
  return Object.entries(s.receipts).every(([key, row]) =>
    uatId(key) && row && row.commandId === key &&
    safeNumber(row.generation) && row.generation > 0 && row.generation <= s.generation &&
    STATES.has(row.status) && typeof row.digest === 'string' && HASH.test(row.digest)
  );
}
/** UAT-only: rejects corrupt restored snapshots before grant mutations. */
export function validSyntheticReceiptSnapshot(value){return snapshotOK(value);}
function clone(s) { return JSON.parse(JSON.stringify(s)); }
function baseCheck(s, req) {
  if (!snapshotOK(s)) return reject('INVALID_OR_CORRUPT_RECEIPT_SNAPSHOT');
  if (!req || typeof req !== 'object' || Array.isArray(req)) return reject('INVALID_REQUEST');
  // These are placeholders supplied by a future verified native boundary, NOT
  // cryptographic proofs or evidence the OS kernel lock is actually acquired.
  if (req.lockState === 'abandoned') return reject('ABANDONED_LOCK_REQUIRES_RECONCILIATION');
  if (req.lockState !== 'acquired') return reject('EXCLUSIVE_LOCK_NOT_PROVEN');
  if (req.storageHealth !== 'healthy') return reject('STORAGE_NOT_VERIFIED');
  if (!safeNumber(req.nowMs)) return reject('INVALID_WALL_CLOCK');
  return null;
}
function validFakeProof(p, s, now, type) {
  if (!p || p.kind !== type || p.verifiedBy !== 'synthetic_test_only' ||
      p.accountId !== s.accountId || p.deviceId !== s.deviceId ||
      p.agentId !== s.agentId || !safeNumber(p.generation) || p.generation === 0 ||
      !safeNumber(p.grantRevision) || p.grantRevision === 0 ||
      !safeNumber(p.notBeforeMs) || !safeNumber(p.expiresAtMs) ||
      p.expiresAtMs <= p.notBeforeMs || now < p.notBeforeMs || now >= p.expiresAtMs) return false;
  return true;
}
function validCommand(c, s, now) {
  return validFakeProof(c, s, now, 'fake_command') &&
    uatId(c.commandId) && HASH.test(c.digest || '') &&
    c.payload?.kind === 'fake_noop' &&
    typeof c.payload.message === 'string' && c.payload.message.length <= 120 &&
    Object.keys(c.payload).sort().join(',') === 'kind,message' &&
    c.expiresAtMs - c.notBeforeMs <= 60000 &&
    c.generation === s.generation && c.grantRevision === s.grantRevision;
}

/**
 * Pure policy decision. No I/O, locks, or actual side effects.
 * Never interpret PROPOSE as permission to touch the OS. It ONLY means
 * 'a trusted serializing boundary MAY persist this synthetic receipt update'.
 * All real permission checks remain missing until explicitly implemented.
 */
export function evaluateSyntheticReceiptDecision(snapshot, req) {
  const fail = baseCheck(snapshot, req);
  if (fail) return fail;
  const s = snapshot;
  const now = req.nowMs;
  if (req.operation === 'recover') {
    if (req.recoveryEvidence !== 'synthetic_snapshot_checked')
      return reject('RECOVERY_EVIDENCE_REQUIRED');
    const next = clone(s);
    let changed = false;
    for (const row of Object.values(next.receipts)) {
      if (row.status === 'accepted' || row.status === 'started') {
        row.status = 'uncertain'; changed = true;
      }
    }
    return changed ? propose('CRASH_RECOVERY_REQUIRES_DURABLE_RECONCILIATION', next)
      : noOp('NO_INFLIGHT_COMMANDS');
  }
  if (req.operation === 'advance_epoch') {
    const p = req.proof;
    if (!validFakeProof(p, s, now, 'fake_epoch') || p.expiresAtMs - p.notBeforeMs > 300000)
      return reject('INVALID_FAKE_EPOCH_PROOF');
    if (p.generation < s.generation) return reject('EPOCH_DOWNGRADE');
    if (p.generation === s.generation) {
      return p.grantRevision === s.grantRevision ? noOp('EPOCH_ALREADY_CURRENT')
        : reject('CONFLICTING_GRANT_REVISION');
    }
    const next = clone(s);
    for (const row of Object.values(next.receipts)) {
      if (row.status === 'accepted') row.status = 'fenced';
      else if (row.status === 'started') row.status = 'uncertain';
    }
    next.generation = p.generation;
    next.grantRevision = p.grantRevision;
    return propose('FAKE_EPOCH_ADVANCE', next);
  }
  if (req.operation !== 'accept' && req.operation !== 'start_fake' && req.operation !== 'complete_fake')
    return reject('UNSUPPORTED_OPERATION');
  const c = req.command;
  if (!validCommand(c, s, now)) return reject('COMMAND_INVALID_STALE_OR_EXPIRED');
  const old = s.receipts[c.commandId];
  if (req.operation === 'accept') {
    if (old) return old.generation === c.generation && old.digest === c.digest
      ? noOp('DUPLICATE_RECEIPT_NO_REEXECUTION') : reject('CONFLICTING_COMMAND_ID');
    if (Object.keys(s.receipts).length === 512) return reject('RECEIPT_CAP_REACHED');
    const next = clone(s);
    next.receipts[c.commandId] = {
      commandId: c.commandId, generation: c.generation, digest: c.digest,
      status: 'accepted',
    };
    return propose('FAKE_ACCEPT_RECEIPT', next);
  }
  if (!old || old.generation !== c.generation || old.digest !== c.digest)
    return reject('MISSING_OR_CONFLICTING_RECEIPT');
  if (req.operation === 'start_fake') {
    if (old.status !== 'accepted') return reject('COMMAND_NOT_SAFE_TO_START');
    const next = clone(s);
    next.receipts[c.commandId].status = 'started';
    return propose('FAKE_START_RECEIPT_ONLY', next);
  }
  if (old.status !== 'started') return reject('COMMAND_NOT_SAFE_TO_COMPLETE');
  if (req.resultEvidence !== 'synthetic_noop_result') return reject('FAKE_COMPLETION_EVIDENCE_REQUIRED');
  const next = clone(s);
  next.receipts[c.commandId].status = 'completed';
  return propose('FAKE_COMPLETE_RECEIPT_ONLY', next);
}

/** Factory for a minimal source-only fake snapshot. */
export function makeEmptySyntheticSnapshot() {
  return { schema: 1, accountId: 'uat_account_demo', deviceId: 'uat_device_demo',
    agentId: 'uat_agent_demo', generation: 0, grantRevision: 0, receipts: {} };
}
