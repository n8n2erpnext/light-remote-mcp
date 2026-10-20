# G3 Gold — bounded TCP/Executor soak on VPS-ARM and real Linux UAT LXD

Date: 2026-10-20 | Branch `feature/light-remote-gold-rebuild-20261018`
Previous Gold HEAD: `0fde17f67bf0ee0435c729a8c6c2178956116d4b`.
Scope: **G3 performance/reliability measurements, not G3 gate completion**.

## Goal and safety boundary
Extend the existing real localhost duplex RED→GREEN evidence with repeatable, bounded multi-scenario soak and measured latency/RSS. Preserve authorized business state (PostgreSQL), Redis, Local Wall and existing Gold nodes. No device enrollments, A/B grants, production, billing, release/updater or long-running daemons modified.

New `deploy/scripts/soak-g3-duplex-readiness.mjs` launches three existing complete HTTP/NDJSON fixtures as separate OS processes, sequentially:
- `selftest-g3-duplex-reconnect-inflight.mjs`: TCP forced drop while command unresolved, no duplicate/replay, late result resumes.
- `selftest-g3-executor-hang-readiness.mjs`: fresh heartbeat with hung callback, deny new dispatch, late callback resumes.
- `selftest-g3-duplex-halfopen-watchdog.mjs`: accept valid hello then suppress incoming frames while socket stays open, bounded reconnect and healthy no-false-positive control.

Controls: bounded `--cycles` [1,24], each case capped at 30s and killed on timeout/oversize output, exact required PASS markers and exit code 0. Each child gets fresh ephemeral localhost-only listener, max sampled Linux RSS via /proc/status every 80 ms. Calculates per-scenario nearest-rank p50/p95 of **fixture process wall time**, not actual remote-command network latency. No external service or account credentials accessed. Source SHA-256 and child process exit are checked, but repeated short-lived processes are not evidence of no leak in one always-on Agent.

## Evidence: VPS-ARM, native Linux ARM64
Node v22.23.1, test `node deploy/scripts/soak-g3-duplex-readiness.mjs --cycles 3`:
- Total 9/9 processes PASS, all expected markers, no timeout, `totalDurationMs=62263`.
- Reconnect: p50 6217ms, p95 6222ms, max sampled RSS 64732 KiB.
- Executor hang: p50 6346ms, p95 6360ms, max sampled RSS 59088 KiB.
- Half-open watchdog: p50 8192ms, p95 8194ms, max sampled RSS 57520 KiB.
- `G3_BOUNDED_REAL_TCP_PROCESS_SOAK=PASS`.

## Evidence: actual Ubuntu ARM64 Gold LXD
Container `light-remote-gold-uat`, Node v22.23.3. Staged modules and soak fixtures **only** to `/tmp/g3-bounded-soak-20261020` (kept separate from installed Operator/Plugin). Source/staged soak script SHA-256 matches:
`e85a3ff62b42e34486e79b0f8f7271703f49db830ad85292982d2091d5d28082`.
Command `lxc exec light-remote-gold-uat -- node /tmp/g3-bounded-soak-20261020/deploy/scripts/soak-g3-duplex-readiness.mjs --cycles 2`:
- Total 6/6 processes PASS, all expected markers, no timeout, `totalDurationMs=42522`.
- Reconnect: p50 6216ms, p95 6225ms, max sampled RSS 62936 KiB.
- Executor hang: p50 6325ms, p95 6332ms, max sampled RSS 55784 KiB.
- Half-open watchdog: p50 8193ms, p95 9228ms, max sampled RSS 55680 KiB.
- `G3_BOUNDED_REAL_TCP_PROCESS_SOAK=PASS`.
- After soak real Gold Operator Unix IPC `GET /v1/fleet` HTTP 200, PostgreSQL 17/Redis/Operator/Plugin/Wall 5/5 active. No services restarted and no installed code replaced.

## CI integration
The Gold-only `.github/workflows/gold-g3-operator.yml` now has an independent `gold-g3-bounded-soak` job (Linux GitHub hosted runner, Node 22.23.2, 2 cycles; 6-minute upper job timeout). Trigger includes the soak script itself. Exact SHA CI success/log markers must be verified after pushing; no release or deploy allowed.

## Explicit blocker: fully enrolled physical/service Agent G3 E2E
Live Gold UAT `/v1/fleet` returned two fresh leaves with `executorReady=null`, which is legacy/unknown, **not** independent executor readiness proof. Trying to access isolated Plugin `http://10.192.135.61:5583/api/operator` returned HTTP 403 `Invalid Host` from the MCP SDK host guard. Do not spoof Host, disable DNS rebinding protection, or use a production identity to force enrollment. Valid trusted Gold UAT access/enrollment flow and owner authorization must be completed before the disposable enrolled Agent fault-injection gate. This checkpoint does not claim such enrollment, real A/B pairing, real Agent restart/wake, independent OS executor probe or service-lifetime resource soak.

**G3 remains OPEN.** Next: use properly authorized UAT Plugin endpoint, enroll a disposable separate Linux Agent with its own identity, test authenticated readiness/failover and reclaim state, and run a bounded long-running Agent soak. Then only close G3 when the acceptance evidence supports it; G4 effect reconciliation remains separate.


## Verified hosted Gold CI after push
Source [`2d88354e56dd8c956e07d9baff0b4ddaa759a29d`](https://github.com/n8n2erpnext/light-remote-mcp/commit/2d88354e56dd8c956e07d9baff0b4ddaa759a29d) triggered [Gold G3 Operator Regression #3](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39417743179). Exact run jobs: **4/4 SUCCESS**, not just started:
- `gold-operator-contract`: SUCCESS.
- `gold-uat-server-bundle (x64)`: SUCCESS.
- `gold-uat-server-bundle (arm64)`: SUCCESS.
- `gold-g3-bounded-soak`: SUCCESS; inspected job log for all six `G3_SOAK_CASE=PASS` markers, summary, and `G3_BOUNDED_REAL_TCP_PROCESS_SOAK=PASS`. Hosted Linux x64 Node v22.23.2, 2 cycles / 6 processes / totalDurationMs 42361. p95: reconnect 6192ms, hang 6301ms, half-open 9208ms; max sampled RSS 68232 KiB.
These hosted results do **not** close the missing enrolled-Agent + independent liveness gate. Production unchanged.
