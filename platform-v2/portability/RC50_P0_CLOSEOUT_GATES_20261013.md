# rc50 P0 CLOSEOUT — no more incremental synthetic-only victory laps

**Update 2026-10-13 — real dev Operator + Plugin local ingress freeze/drain:** [LOCAL_INGRESS_FREEZE_DRAIN_UAT_20261013.md](./LOCAL_INGRESS_FREEZE_DRAIN_UAT_20261013.md). Shared opt-in local `SIGUSR2` gate now rejects new HTTP requests before routing, keeps exact GET /healthz readable, counts accepted HTTP and support-outbox work, and pauses Operator heartbeat/reaper timer during freeze. **7/7 local gate tests and 41/41 platform Node tests PASS.** This is NOT a global writer epoch, and does NOT drain remote Agent/PTV/RM/SCP/Fleet jobs or create a crash-persistent checkpoint. P0-A and P0-C remain PARTIAL/NOT_READY; all five signoff gates remain open.

**Update 2026-10-13 (latest):** [16/18 real Operator+Plugin writer durability batch](./REGISTRY_DURABILITY_16OF18_20261013.md): 11 additional writer paths now use synchronized atomic replace plus file and parent-directory fsync (7 Operator, 4 Plugin), on top of previous 5. **16/18 fsync-proven, 2/18 remaining blocked** (account state and device connection); global writer fence and consistent multi-file snapshot still unproven. Both blocked paths remain unchanged; no alternate-tool circumvention. **All five P0 closure gates remain open**.

**Source audited:** 2026-10-13 on feature/rc50-mjs-scale-20261011, VPS-ARM, NO production/staging modification.
**Owner requirement:** scale portability should be prepared now (ARM→AMD / larger server / future k3s), not immediately demonstrate 5k real users or migrate live traffic. Preserve Node ESM (.mjs), Express 5 and existing protocol. P0 is completed only when executable end-to-end acceptance and rollback are defensible, not because another primitive passes in isolation.

## Why P0 has run for two days
The progression from independently signed Wall+channel proof → PG replay/epoch → locally signed verifier receipt → PG mock grant/outbox was all NONPRODUCTION tests. Good component-level evidence, **no real Operator/Plugin/Fleet writer fence, no independently authenticated verifier-stage, no real A/B device approval, no cross-host integrated recovery**. After 5628450 we must stop inventing a next small synthetic P0; prioritize product-facing gates and permission blockers.

## Finite P0 gates (all must be demonstrably PASS for rc50 *foundation*, not production cutover)

| Gate | Definition of done | Current evidence | Current state |
| --- | --- | --- | --- |
| P0-A WRITER | Every Operator/Plugin/Fleet/PTY mutator hits a single authoritative epoch/revocation fence. Old writer cannot mutate after handoff. Guard applies to background timers, webhooks and jobs. | 14 Operator + 4 Plugin JSON writers without proven fsync/fence; PG epochs proved in disconnected UAT; in-memory Fleet/PTY authority exists. | BLOCKED/NOT_READY |
| P0-B IDENTITY | Real isolated dev authenticated OAuth→Local Wall A/B→signed channel→issuer with independent SCRAM/mTLS principals, tested replay, expired/revoked grant, wrong account/device and true signer key custody. | Synthetic Ed25519+PG transactions PASS; verifier-stage trust, prod-like OAuth PG and protected real grant path not wired. HTTP Docker runner previously blocked. | BLOCKED/NOT_READY |
| P0-C DURABILITY | All durable registries/keys/audit/outbox committed before checkpoint ACK; freeze ingress, pause pump, drain/cancel PTY and jobs, capture monotonic audit/outbox watermark. No hidden mutators. | THIS PATCH adds real dev Operator audit append file+dir fsync; 7/7 new fault-injection tests PASS, 8/8 barrier tests PASS. 14+4 registry writers still not fsync-proven, no entire-process quiesce. | PARTIAL/NOT_READY |
| P0-D PORTABILITY | Immutable ARM64/AMD64 dev artifacts, source→different-host consistent fake data/keys/PG/Redis/JSON restore, equality/revocation/Team/Free/usage/billing/outbox checks, old-authority fence, reconnection and guarded rollback. | Several separate private same-host synthetic cold-move tests PASS, NO real cross-host comprehensive acceptance or dual-writer rollover proof. | NOT_READY |
| P0-E RELEASE | UAT integration gates (including real OAuth, A/B, RM/PTV/SCP policy, billing side-effect isolation), CI on correct feature SHA, documented release/rollback and operator alerting. | Component tests and static audits; rc50 runtime/CI release gate not demonstrated. | NOT_READY |

## Execution order from here
1. **Close C + A in live dev branch**: introduce tested shared durable JSON writer for 18 registries, fail-closed audit/usage/ACL sync and an enforceable freeze/fence hook at mutation boundaries. Use isolated dev only; avoid touching production state. Existing 14+4 source inventory is the regression contract, not proof.
2. **Close B** using independent service SCRAM identity with PG-backed source context, receipt consumption and true dev A/B authorization, only where tool policy permits. Do not repeat already passing synthetic nonce/signature tests.
3. **Close D** with reproducible ARM→AMD dry-run and cross-host restore of **fake** state and disposable signing key material, not live customer data. Verify job tombstones, no resurrected grants, usage/billing idempotency and new host only-writer under fault injection.
4. **Close E** using actual rc50 integration/regression CI and deliver one release package and rollback runbook. Distinguish failed/external permission blockers from code failures; do not evade tool denials via PTY/alternate connectors.

## This checkpoint: first runtime-path fix (NOT P0 completion)
- Real `operator-host/executor.mjs` dev path now imports `appendDurableAuditBatch` (not a synthetic stand-in). It runs inside existing `AuditAppendBarrier` promise chain, which latches disk failure; file+parent directory `fsync` before successful ACK.
- New `operator-host/durable-audit-append.mjs` accepts only absolute filename + nonempty string, opens NOFOLLOW, appends UTF-8 batch, syncs file, closes handle, syncs parent directory, propagates failure. Refuses symlink and bad directory. This does not automatically close/fence other business mutators after audit failure, nor prove a global audit watermark.
- New `platform-v2/test/test-durable-audit-append.mjs` **7/7** real temp-file and injected fsync fault tests PASS; prior `test-audit-append-barrier.mjs` **8/8** PASS.
- Updated `writer-freeze-readiness.json` + source gap audit to track the *actual* durable append helper and still return `status=NOT_READY`, `fsync_proven=0` for the **18 JSON registries** and `single_writer_authority_proven=false` — this is intentional, not a false red result.
- `platform-v2/test/test_writer_freeze_readiness.py` **10/10** PASS.
- Full safe `node --test platform-v2/test/*.test.mjs` **34/34** PASS. `node --check operator-host/executor.mjs`, `git diff --check` PASS.
- No production runtime start/restart, real device commands, user data, secrets, DB migrations, Git main, HTTP Docker integration or tool-bypass. New helper alone is not a multi-file snapshot barrier.

**Critical stop rule:** no more claims P0 PASS while any gate is BLOCKED/NOT_READY. New synthetic components must directly remove an identified gate, not create another indefinite series.
