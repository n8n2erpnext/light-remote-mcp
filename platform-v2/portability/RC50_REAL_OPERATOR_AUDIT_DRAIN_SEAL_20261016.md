# rc50 P0-C — local Operator audit durable seal BEFORE freeze ACK

**Date:** 2026-10-16 Asia/Ho_Chi_Minh.
**Feature:** `feature/rc50-mjs-scale-20261011`. **Base:** `cd88c72935bbbfd208402b0e9d0376cb234ce85f`.
**Scope:** Operator local source behavior in isolated development. No production Operator restart, no Agent command and no customer data changes.

## Failure found in REAL runtime ordering

Previously `LocalIngressFreezeGate` announced `frozen/drained` as soon as tracked HTTP and `jobs` map census reached zero. The dev Operator batches audit events in `diskQueue`, scheduled for async fsync by `AuditAppendBarrier`. A finished job might have queued a final audit event without that event yet reaching disk. A checkpoint started immediately after the `frozen` ACK could omit the audit tail — a real P0-C durability gap, even though the append helper itself already fsyncs every committed batch.

## Implemented
- `lib/local-ingress-freeze.mjs`: optional `beforeDrained` callback. When present, after previously accepted HTTP+jobs are all complete, the gate invokes a ONE-TIME asynchronous seal and remains in `freezing` while it executes. Only after successful seal and a second pending-work census does the gate mark `frozen` and resolve all waiters. If seal fails, it latches the original error, rejects all awaiting freeze callers, leaves `phase=freezing` forever and refuses new work; subsequent calls return the same error. Read-only health can show `sealing` and `sealFailed` without disclosing raw IO error text. Without `beforeDrained`, the existing Plugin/local freeze behavior remains backward compatible.
- `operator-host/executor.mjs`: wires `beforeDrained:()=>flushDiskRecords()` to the REAL shared gate. `flushDiskRecords()` cancels scheduled timer, dequeues pending audit lines into `AuditAppendBarrier.enqueue` and waits for durable `appendDurableAuditBatch` (file fsync + parent directory fsync). If no batch pending, it flushes the already queued `AuditAppendBarrier` tail. Thus the local frozen ACK cannot predate this operator audit fsync.
- `platform-v2/test/local-freeze-audit-seal.test.mjs`: real append-barrier plus fsynced audit file test with pending Operator job and delayed I/O, confirming freeze waits until AFTER the audit write is committed. An injected fsync failure confirms no drained ACK, pending waiters reject, and freeze remains closed. Structural source test ensures the REAL Operator gate is wired to the actual batch/flush barrier.
- `writer-freeze-readiness.json` and `audit_writer_freeze_readiness.py`: protect the actual runtime binding from being silently dropped; a new negative regression in `test_writer_freeze_readiness.py` rejects removal of the audit seal marker. The dependency remains `barrier_proven=false` because this does NOT prove global writer authority nor consistent multi-file checkpoint.

## Limits
1. **Local only.** Only Operator audit-file flush is covered. It does NOT fence other processes, remote Agent side effects, Redis, PostgreSQL, independent JSON writers or OAuth/billing/outbox workers. Startup marker remains subject to failed-write-before-crash issue.
2. The callback waits for existing in-process audit work at the moment of local freeze; other timers or external writers not counted in the census could still produce activity. Do not assume a globally stable watermark or transactional snapshot.
3. No real owner, device, signed grant or billing webhook tests. No production impact. The previously safety-blocked registry writer paths and PG runtime fence adapter were NOT modified or circumvented.
4. This closes a **specific ordering bug** but cannot graduate P0-C or any other hard release gate. `p0-release-gate.py --require-ready` must still fail with exit 3.

## Verify on VPS-ARM feature branch
```sh
node --check lib/local-ingress-freeze.mjs
node --check operator-host/executor.mjs
node --test platform-v2/test/local-freeze-audit-seal.test.mjs
node --test platform-v2/test/*.test.mjs
python3 -B platform-v2/test/test_writer_freeze_readiness.py
python3 -B platform-v2/test/test_p0_release_gate.py
python3 -B platform-v2/portability/audit_writer_freeze_readiness.py
```
The full suite after the initial implementation was 56/56 Node PASS and 11/11 writer negative guards PASS. After adding the new source-coverage negative test, writer guards should be 12/12; rerun before commit. Release guard remains NOT_READY, fsync 16/18, global writer=false.

Native ARM64 and x64 GitHub CI must be checked on the **new commit SHA** after push before calling it green. HOMELAB dev checkout must be fast-forwarded separately if desired; it is currently on the previous `cd88c72` checkpoint.

## Next
The next necessary gate is **independently authenticated shared writer authority and multi-plane freeze/snapshot**, not more local audit seals. The PG runtime adapter and selected backup/restore tasks had been tool safety-blocked: an approved path must be established before implementation. Do not use alternate tools to evade them.
