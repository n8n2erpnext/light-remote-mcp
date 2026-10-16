# rc50 P0-C — Real Operator audit write failure immediately fences new dev ingress

**Date:** 2026-10-16 Asia/Ho_Chi_Minh. **Branch:** `feature/rc50-mjs-scale-20261011`. **Parent:** `2307454e5bc75276314b889beac3f83a2ac83b64`.

**Scope:** Actual rc50 dev Operator, isolated fake environment ONLY. No production restart, OAuth/Paddle transaction, real device enrollment, customer data or Agent command.

## Actual uncovered failure

The previous Operator `AuditAppendBarrier` correctly latched an async failed durable audit append but its real `onFailure` callback **only logged to stderr**. Existing `queueDiskRecord` callers deliberately ignored rejected async flushes; without an explicit owner freeze, the real Operator could keep admitting new HTTP mutations after a known audit failure. This creates an unauditable window and invalidates P0-C checkpoint/replay reasoning. The earlier `beforeDrained` seal fixed only the *freeze acknowledgement* ordering, not audit failures happening under ordinary active traffic.

## Implementation

In actual `operator-host/executor.mjs`, `AuditAppendBarrier.onFailure` continues to log the error and additionally calls `localFreezeGate.freeze()` **ONLY when `LR_RC50_DEV_LOCAL_FREEZE=1`**. The real gate was already wired to `beforeDrained:()=>flushDiskRecords()` and its durable local marker. Thus:
1. The first failed async file+parent-directory audit append is latched by AuditAppendBarrier.
2. The callback immediately moves the local gate from `open` to `freezing`, blocking NEW HTTP mutation admission. The attempt to persist a local marker is synchronous and fsynced.
3. The completion seal sees the pre-existing barrier failure, rejects waiters, and preserves `phase=freezing`, `sealFailed=true`, `drained=false`. Read-only `GET /healthz` remains accessible without printing raw I/O errors. The current process cannot silently reopen after failure.
4. If writing marker itself fails (for example ENOSPC), the gate STILL stays `freezing` in this process and logs a separate marker_write_failed; the failure is **NOT** proof of crash/restart fencing. Owner reconciliation and global authority remain required. No automatic restart or marker deletion.
5. **When dev opt-in is absent**, the new callback does not call freeze, leaving production default behavior unchanged. Do NOT represent this as a production-wide audit guarantee or an Agent-side fence.

## Real process fault-injection UAT

`platform-v2/test/operator-audit-failure-runtime.test.mjs` launches the genuine `operator-host/executor.mjs` child process using explicit fake environment variables, isolated Unix socket/state/log/freeze directories and `OPERATOR_INTEGRATED_HOST=0`. After real `/healthz` signals OPEN, the test makes only the disposable `operations.jsonl` pathname a DIRECTORY to induce `EISDIR` during `appendDurableAuditBatch`. It then issues `GET /v1/plugin/sessions?accountId=`, which produces a harmless `invalid_account_id` exception and genuine asynchronous `executor_error` audit event — no real account, session, agent, billing or remote job.

Evidence asserted from the actual Operator:
- Real audit append fails asynchronously and logs `[disk] append failed`.
- Protected marker exists with mode `0600`, local health reports `freezing`, `sealFailed=true`, `drained=false`, `markerDurable=true`.
- New `GET /v1/capabilities` gets HTTP 503; read-only `GET /healthz` still 200.
- The test terminates only its own child and deletes all disposable fake files in `finally`.

The `writer-freeze-readiness.json` dependency source markers and source audit/negative tests now require both `if(!localFreezeGate.enabled)return;` and `void localFreezeGate.freeze().catch(` to prevent accidental loss of this real dev mechanism while still keeping the dependency `barrier_proven=false` (global invariants are not proven).

## Verified before commit

```
node --check operator-host/executor.mjs                    # PASS
node --test platform-v2/test/operator-audit-failure-runtime.test.mjs   # 1/1 PASS
node --test platform-v2/test/*.test.mjs                   # 57/57 PASS
python3 -B platform-v2/test/test_writer_freeze_readiness.py          # 14/14 PASS
python3 -B platform-v2/test/test_p0_release_gate.py                  # 8/8 PASS
python3 -B platform-v2/portability/audit_writer_freeze_readiness.py  # NOT_READY, 16/18 fsync, no global writer
git diff --check                                           # PASS
```

## Explicit remaining P0 blockers

**A:** No independently authenticated global writer epoch, rollback-proof revocation or Agent-side fence across Operator/Plugin/Fleet/PTY. PG runtime writer-fence adapter was previously tool blocked and was **not** retried through another interface.

**B:** Real owner approved A/B to independent verifier/issuer/Agent trust chain not E2E verified.

**C:** Local audit failure now fences new Operator dev requests, but two JSON registry writers remain unproven fsync (previously tool blocked), other background/Agent operations may mutate, and no global multi-plane consistent snapshot/watermark is implemented. Marker fsync failure before crash can reopen.

**D:** Native ARM64 and real HOMELAB AMD64 share the same Git SHA and passed fresh PostgreSQL17/Redis8 schema/rollback UAT, but no true source-fenced ARM-state→HOMELAB complete fake-state restore/rollback.

**E:** CI and native real-process smoke are prerequisites only, not full authenticated production E2E/release rollback evidence. **`--require-ready` must remain nonzero, all five gates NOT_READY.**

No production, main branch, known safety-blocked registry/writer/backup files or previously denied commands were changed.
