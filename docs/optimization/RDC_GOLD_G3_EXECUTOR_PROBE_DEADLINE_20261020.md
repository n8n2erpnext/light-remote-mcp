# Gold G3 — Executor probe deadline, stale evidence and late-result fencing
Date: 2026-10-20 | Branch: `feature/light-remote-gold-rebuild-20261018`
Starting HEAD: `b8053cf`. Status: **G3 partial RED→GREEN; signed enrolled Agent E2E remains open**.

## Reason to continue G3 here
The independently spawned Node canary introduced by `007ac71` was real but had two residual failure modes:
1. `ExecutorReadinessProbe.check()` awaited `runner()` without an outer deadline. A native spawn bridge or future injected runner that never settles would leave `pending` stuck forever, blocking a startup check or further probe cycles. Its subprocess function has a timeout, but the generic supervisor cannot assume every runner returns.
2. After an initial successful canary, an Agent that stopped completing periodic probes could keep advertising `executorReady=true` forever based on a historic success. A fresh channel heartbeat is insufficient evidence of current executor spawn ability.

## Controlled RED
New `deploy/scripts/selftest-g3-executor-probe-deadline.mjs` injects a runner returning an unresolved Promise, while the Fleet transport remains fresh. Before the fix it exited without satisfying the top-level await (Node exit 13) when driven with `timeout 4s`; it never produced a definitive negative readiness response.

## Corrective implementation
Updated `lib/executor-readiness-probe.mjs`:
- Generic probe supervisor now races any runner (including a never-settling Promise) against its own bounded deadline: 1000–20000 ms. Outcome becomes a failed canary, no customer command is executed/cancelled/retried. Records `probeTimeouts` and maintains the existing consecutive-failure threshold for degradation.
- A late success/error from an expired attempt is observed but never allowed to mutate subsequent readiness, so a later successful probe can safely recover.
- Adds an evidence freshness bound `maxAgeMs` (default 3 probe intervals + per-check timeout, clamped 15s–15.5min). A previously successful canary older than this returns `ready=false, state=stale`, preventing new dispatch through the existing Fleet `executor_unavailable` gate even if TCP heartbeat continues.
- `stop()` invalidates pending generation and resets readiness to unknown for restart semantics. Improves child spawn error race so an error before timer registration doesn't leave an extraneous timeout. Changes do **not** affect A/B, policy, Cloud state, credentials, entitlement, Wall or production.

## Real evidence
VPS-ARM Ubuntu ARM64 Node:
- `G3_HUNG_PROCESS_CANARY_FAILS_CLOSED_WITH_FRESH_CHANNEL=PASS`
- `G3_EXPIRED_CANARY_LATE_RESPONSE_CANNOT_REVERT_RECOVERY=PASS`
- `G3_OLD_EXECUTOR_PROBE_GOES_STALE_FAIL_CLOSED=PASS`
- Prior four independent probe markers, G3 executor hang and live TCP reconnect markers all PASS.
- Node syntax and `git diff --check` PASS.

Actual `light-remote-gold-uat` LXD ARM64:
- Staged source in isolated `/tmp/g3-probe-deadline-20261020`, **did not replace installed Operator or Agent**.
- Executed both real-Node canary fixture and the new deadline/staleness fixture **inside** the LXD. All seven probe markers PASS.
- `lib/executor-readiness-probe.mjs` source/staged SHA-256 matches `f36e014d93b3591420082d9c317828eac6ec52a261d846d614193ed4b430c0a1`.
- Live Gold Operator Unix socket GET /v1/fleet HTTP 200, PostgreSQL17/Redis/Operator/Plugin/Wall **5/5 active**.

## Cross-platform packaging
The source is already in `client/core-files.json` and both host installer file lists. Added the new deadline/staleness regression to Linux Desktop x64/ARM64, macOS Intel/Apple Silicon, Windows native smoke and dedicated Gold Operator CI. Exact SHA CI outcome pending until verified after push. macOS/Linux physical Agent E2E is still NOT proven.

## Open gate
G3 still requires a truly enrolled disposable Linux Agent using the normal authorized owner session, signed channel fault injection, cancellation/reconnect and an OS-level view that can distinguish executor process from transport. Prior UAT attempts verified `https://gold.light-remote.thaiduy.digital` canonical origin, but transferring a test account credential to the container was blocked. Do not bypass this; no enrolled Agent was created. Long-lived process RSS/suspend-wake is not established by these short-lived fixtures. G4 independent effect reconciliation has not begun.

Preserve unrelated Gold UAT untracked helper files. No production deploy/restart and no owner-client auto-update.
