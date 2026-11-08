# rc50 P0-C — opt-in, crash-conservative Fleet remote-effect write-ahead journal

**Date:** 2026-10-16 Asia/Ho_Chi_Minh
**Branch:** `feature/rc50-mjs-scale-20261011`
**Parent HEAD:** `18d2c0f7cf7302f0694f8003fb12ca74a5abc787`
**Scope:** actual feature-branch DEV Operator code, disposable UAT data only. **NOT** enabled in production and **NOT** a cutover release gate.

## Concrete deficiency removed

Previously, `unreconciledRemoteEffects` and `fleet.commands` were process-local. A timed-out/abandoned remote OS command could survive on Agent while an Operator crash/restart lost its RAM status; without a durable freeze marker, a restarted Operator could appear writable. A `process start` or `terminal start` response is also NOT an OS-side process-exit certificate: generic Agent `success` must not automatically clear an unknown effect.

## Implemented on real Operator/Agent-result boundaries

- `operator-host/dev-remote-effect-journal.mjs`: explicit DEV-only, individually fsynced, atomic 0600 JSON file. Schema v1 contains only validated account/device/node/job/command identifiers, never command payloads, customer data, tokens or secrets. Strict preexisting file/parent permission and schema checks; missing, linked, malformed, too large or pending journal is a startup denial. No auto-initialization or silent recovery.
- An owner must **explicitly provision an empty trusted UAT journal** before enabling; there is no default path. Enabling requires BOTH `LR_RC50_DEV_LOCAL_FREEZE=1` and `LR_RC50_DEV_REMOTE_EFFECT_JOURNAL=1`, with `LR_RC50_DEV_REMOTE_EFFECT_JOURNAL_PATH` pointing to that private existing file. These are dev-only test settings, not an instruction to enable on customer services.
- Atomic O_EXCL `<journal>.owner.lock` prevents a second same-host dev writer from opening the journal. File and directory fsync complete before operation. Live writers check that their still-open lock inode matches the filename. Stale locks persist after a crash; do not steal via PID, wall clock or TTL.
- `executor.mjs:enqueueForJob()` allocates a command ID and **durably records** the outbound effect before calling actual `FleetRouter.enqueue()`. Failure to journal means no command dispatch and new local admission is frozen. Failed Fleet enqueue after journal commit conservatively leaves pending evidence rather than risking a false safe state.
- The real `LocalIngressFreezeGate` sees the durable `pending` count in addition to Fleet queue/in-flight and earlier native/process/PTY/timeout censuses.
- `executor-routes-device-channel.mjs` deliberately DOES NOT automatically settle the journal upon generic Agent command completion. A successful start ACK, timeout, duplicate or deferred side effect may leave an active remote process. Clearing the journal needs future **independently authenticated Agent-side quiescence/effect evidence and owner reconciliation**, which is not yet implemented.
- A clean SIGTERM can release the ownership lock ONLY if journal empty, Fleet commands zero, memory timeout uncertainty zero and local freeze gate still `open`. Otherwise Operator exits nonzero with lock preserved (fail closed); a crash also preserves the stale lock.

## New isolated UAT and source integration tests

`platform-v2/test/operator-dev-remote-effect-journal.test.mjs` checks:
1. Actual `FleetRouter` plus fsynced journal persists a command before dispatch, survives attempted restart, and requires **explicit test-only** settlement after independent fixture reconciliation.
2. Injected write/fsync fault does not advance in-memory state and is not mistaken for dispatch.
3. Same-host O_EXCL owner conflict, stale lock, pending-release rejection and replaced lock inode detection.
4. Missing journal, unsafe mode, symlink and malformed schema fail closed.
5. A real isolated Operator Node process cannot start with unresolved persisted state.
6. A real isolated Operator Node process with an empty journal can healthcheck, cleanly SIGTERM, fsync and release the owner lock.
7. Source assertions validate actual write-before-enqueue integration and forbid premature automatic settlement on Agent-result route.

No customer Agent was contacted; tests use a private disposable directory, synthetic device IDs, no external network and no production credentials.

## Explicit unresolved P0 gates

**P0-A:** no authenticated globally authoritative PostgreSQL writer epoch/lease shared across Operator/Plugin/Fleet/Agents or rollback-safe remote device fence. O_EXCL protects only one local file on one host, not distributed consensus; a stale state-file rollback or malicious same-UID actor remains outside this proof.
**P0-B:** actual signed owner/Agent issuer chain and strict Wall integration still NOT accepted.
**P0-C:** 16/18 existing registry fsync writers previously audited; this additional dev journal is separate and DOES NOT change that 16/18 score. Full checkpoint generation, audit/outbox watermark, Agent-side effects, cross-service quiesce and durable effect reconciliation remain absent.
**P0-D:** no complete representative fake ARM64→HOMELAB AMD64 checkpoint/restore and guarded rollback with proven old-writer revocation.
**P0-E:** whole-system authenticated parity/signed release not accepted.

Previously policy-denied edits (PostgreSQL runtime fence adapter, two registry writer paths, Agent strict Wall launch, sealed restore runner) remain UNTOUCHED; no PTY or alternate tool was used to bypass denials. No deploy, no restart of customer services, no main merge.

**Next:** independently authenticated Agent completion/side-effect quiescence proof and distributed fencing, then durable journal reconciliation with owner approval. Until then all five P0 gates remain `NOT_READY`.
