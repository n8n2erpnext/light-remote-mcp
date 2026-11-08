# Gold Connection Lifecycle GC — 29 October 2026

## Owner-approved requirements

This change belongs to Gold **connection lifecycle**, not Pro Team or the Oct-28 P0 feature gate. Owner requested automatically retiring stuck jobs after **60 minutes** of the device being offline, regardless of platform or user/AI session, triggered by (1) network loss/stale channel, (2) connection lease expiry, or (3) owner disconnect on Local Wall. Free connection cap becomes **12h**, Pro **48h**, VIP remains **72h**. The independently owner-approved A/B authorization maximum stays **24h**; connection lifetime is not A/B authorization lifetime. Existing leases are not retrospectively extended by source changes.

## Implementation

Branch `feat/gold-connection-gc-reconciler-20261029`, based on P0 accepted commit `89e6a86`. Code:
- `operator-host/device-connection-registry.mjs`: caps 12/48/72h.
- `lib/gold-connection-job-reaper.mjs`: connection-device-neutral server worker, default 60-minute offline grace, 10s scan / max 128 devices per scan, keyset cursor fairness and PG advisory locking. Source: latest connection history, heartbeat/last-seen, and authenticated channel freshness. Explicit reconnect and fresh channel fail closed. Rechecks the channel immediately before commit.
- `operator-host/executor.mjs`: standalone lifecycle GC module wired to Gold Operator under `OPERATOR_CONNECTION_JOB_GC_ENABLED=1` (default **OFF**), with optional `OPERATOR_CONNECTION_JOB_GC_OFFLINE_MS`, `OPERATOR_CONNECTION_JOB_GC_SCAN_MS`, `OPERATOR_CONNECTION_JOB_GC_BATCH`. Flushes pending job ledger writes before GC, retires in-memory Fleet commands after durable commit; no agent-side timer or per-platform cleanup.
- `platform-v2/sql/040_gold_connection_job_gc_fences.sql` + locked hash manifest: unresolved OS effects stay in durable resource fences (also if process ID is unavailable) while the stale server-side M4 claim and M3/ledger jobs are retired.
- `lib/gold-device-resource-locks.mjs`: admission checks those fences under device PG lock before admitting conflicting work, and a *real* verified terminal receipt can resolve its specific PID fence and create the authentic durable ACK. No fake terminal receipts, no SQL bypass.
- Job ledger state becomes `interrupted` + `effectState:unknown`, `signedResultVerified:false` for unconfirmed execution. M3 QUEUED becomes finished with `offline_gc_before_dispatch`; M3 RUNNING becomes unknown with `offline_gc_unknown`. Each unresolved claim/running crash window gets audit. Original account/session/device scope preserved.
- Crash windows covered: (a) normal M4 claim with PID, (b) M4 claim with no PID, (c) scheduler RUNNING with no M4 claim yet, (d) ledger RUNNING with neither scheduler nor M4 record. Last case fences `device:unknown` as device-wide fail-closed.

## Tests and acceptance boundaries

Source tests passed:
- `selftest-v09-device-connection.mjs`: Free12/Pro48/VIP72, plan expiry and disconnect semantics;
- `selftest-v11-device-connection-renewal.mjs`: connection renewal and immutable 24h A/B absolute cap;
- `selftest-gold-connection-job-gc.mjs`: eligibility, 60m delay, network/lease/disconnect, reconnect guards, no fake ACK, M4 fence admission, signed terminal fence resolution;
- Existing M4 resource policy, job-control stop, durable ACK and Wall Kill gateway tests passed.
- In **separate disposable DB** `lr_gold_gc_check_20261029` (NEVER `light_remote_gold_dev`), executed migration 040, real SQL transaction, dry-run, live GC one offline synthetic device and one online synthetic device; 4 durable fences for claim and missing-claim crash cases; 4 audit events; 0 forged receipts; queue and running terminal states preserved; repeat sweep idempotent. Executed independent M4 admission + verified terminal test: a signed receipt releases only its exact fence; unknown PID/device-wide fence remains. Disposable DB dropped, count 0.
- Read-only dry-run of existing Gold UAT `light_remote_gold_dev` reported 1 expired/closed historical device eligible; claims before=1, after=1 (no mutation).

## Critical limitations / non-claims

**Not deployed or enabled on Gold UAT / production.** Current Gold UAT runs runtime `7f46dea`, schema39, with existing unrelated resource claim unchanged. Migration040 and feature flag must be applied together in a controlled UAT rollout, not against production by accident.

Server-side stale job and claims GC **does not by itself prove an OS process stopped**. The server must not silently unblock a different job writing the same workspace while unresolved effects might survive offline. This implementation therefore retains durable resource fences, potentially including a device-wide fence for a completely unknown execution. A later trusted signed terminal receipt with matching process identity can resolve its fence, but UNKNOWN without process identity needs a separate secure **automatic reconnect inventory/epoch reconciliation** or owner-mediated disposition. Until that mechanism is implemented and tested, do not represent this work as guaranteeing fully unattended 100% restoration of all device execution slots. Do not set a fixed TTL that blindly clears safety fences.

Deployment gates: (1) schema migration lock validation, (2) realistic offline/reconnect load/race testing, (3) signed Agent reconnect handling for no-PID fences, (4) Operator admission/queue E2E on UAT, (5) owner approval of Gold UAT enabling, (6) separate production release. Pro Team five-seat remains **FROZEN**; no Pro Share billing/guest execution enabled; P0 remains PASS.
