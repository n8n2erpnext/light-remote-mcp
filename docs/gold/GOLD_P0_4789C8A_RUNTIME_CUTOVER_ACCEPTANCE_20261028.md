# Gold P0 — Uniform Runtime Cutover 4789c8a (2026-10-28)

## What actually changed
- Isolated Gold UAT LXD `light-remote-gold-uat`, **not production**.
- Uniform runtime transitioned from `c0c6977eb9c940c7af67f1d9887bf3f02de7d78b` to `4789c8a93f063cc38b9a0433bbee7d5bafb47589` in all four systemd units: Operator, Plugin, Wall, Process Supervisor.
- New deployed Wall code renders `stopping` as presentation state when a job is still running in the durable ledger but a verified Stop request is pending. Only signed terminal evidence can change the underlying job status to cancelled/another terminal result.
- Windows graceful stop source logic `362886f` exists in the deployed source tree but **existing installed Windows 10/11 Agents remain unchanged**. Do not conflate Gold Linux UAT runtime with the Windows installed-client version.

## Pre-cutover safety
- Git worktree clean; source HEAD 4789c8a.
- Zero personal jobs queued/running, zero direct managed Supervisor children.
- Three existing historical resource claims preserved; 2 running and 1 terminal_unknown.
- Candidate created under `/opt/light-remote-gold-uat-candidates/4789c8a93f063cc38b9a0433bbee7d5bafb47589`, correct symlinked Node dependencies.
- Seven targeted selftests PASS: real Wall render, Wall status model, signed Gateway Kill, Durable ACK, M3 recovery fail-closed, Windows graceful contract, M6 exact owner claim selection.
- Snapshot `p0-before-uniform-4789c8a-20261028` created, four original systemd override copies retained.
- Rollback manifest `/home/ubuntu/handoffs/GOLD_P0_UNIFORM_4789C8A_CUTOVER_20261028.txt`.

## Cutover and post-deployment evidence
- Four service restarts completed, each active/nonzero MainPID and same exact runtime SHA:
  - Operator PID 1337913
  - Plugin PID 1337960
  - Wall PID 1338000
  - Process Supervisor PID 1338157
- PostgreSQL38 readback after cutover: 3 historical resource claims intact (running:2, terminal_unknown:1), personal queued/running = 0.
- Acceptance marker `P0_4789C8A_FOUR_SERVICE_CUTOVER_PASS retained_claims=3`, no rollback invoked.
- Authorized Win11 `baolong123` existing session was resumed (no new A/B); harmless 90-second PowerShell test job `497b3419-cc5b-4386-a829-0f2cdf2de14e` launched, then official AI Cancel returned `stop_requested`, and official Gold Job read returned final `cancelled`, `stopRequestVerified:true`, `exitCode:130`. Stdout only `P0_4789_REGRESSION_STARTED`; no `UNEXPECTED_FINISH`.
- Gold Local Wall listens at configured NetBird address `10.192.135.61:5491`, not 127.0.0.1; unauthenticated GET / returns HTTP 303, /api/status returns 401 (expected authentication behavior). Operator Unix socket is present and capability sync reported success. Transient 502/device-channel failures were logged during startup; do not claim separate long-running 502 issue without new evidence.
- This does **not** yet constitute photographic physical Windows Local Wall UI `stopping` acceptance; Windows installed client remains rc49.

## Exact HOLD decisions and open P0
- `HOLD_OWNER_RESOURCES`: real Pro Team independent OAuth/A-B client E2E; owner does not have enough distinct devices. Do not ask for extra devices or mark synthetic PG fixture as physical PASS.
- `HOLD_EVIDENCE_AND_OWNER_AUTH`: release/recovery of 3 historical durable claims; do not delete/overwrite without valid signed terminal evidence or explicitly owner-approved, post-claim verified orphan recovery.
- A/B V2 redesign explicitly deferred.
- Windows graceful source and CI are PASS, isolated physical Win11 **source test** PASS, but updated Windows Agent installation/physical validation remain OPEN until expressly approved. Existing Windows installations and production are unchanged.
- Gold UAT live runtime 4789c8a is accepted; docs-only future Git commits do not change the deployed SHA.

## Prior evidence
- `/home/ubuntu/handoffs/GOLD_P0_GRACEFUL_STOP_WALL_HANDOFF_20261028.md`
- `/home/ubuntu/handoffs/GOLD_P0_OWNER_HOLD_DECISION_20261028.md`
- Windows native GitHub CI `40720243027` for 362886f SUCCESS; `40720721607` for d5e1ec8 SUCCESS.
