# Gold G3 — Owner Windows #453 installed and live readiness acceptance (2026-10-21)

Canonical branch: `feature/light-remote-gold-rebuild-20261018`
Worktree HEAD at start: `5c5cbc4474f24902286733aecc25143173133259`
Gold LXD installed immutable candidate: `15eed24fa400feccfb6156df7959c78a8aa437af`
Target: owner-authorized Gold Windows `DESKTOP-VA16D27` and isolated `light-remote-gold-uat`.
Production is out of scope and unchanged.

## Observed facts after owner completed the physical Windows installation

- Gold connection helper: authorized Windows is **online**, previously held session resumed through official Gold session control. Official Light Remote separately resumed existing VPS-ARM session.
- Installed `agent/lib/executor-readiness-probe.mjs` = **present**, SHA256 `400D72BB65FD7187CA17ACD1A08C7F50C998CE61B6D23501A52D6074365ACDAF`.
- Installed `agent/device-agent/operator-agent.mjs` contains the probe import, SHA256 **`C5E8523F5076467C7313F8CDD3F1EBAAC60829A94DA72031C5B1100C772163E9`**. Old legacy sha `D0B81354D7ED9FD6F826EA547851BFBBC2804C1A1F9F603F80B3A45998722C5A` is NO LONGER installed.
- Installed version text still reports `0.9.0-rc.49`; source/module inspection, not semver label, is evidence of migration.
- Windows physical Agent daemon process count = **1**, Scheduled Task `LightRemoteDeviceAgent` **Running**.
- Gold LXD PostgreSQL 17, Redis 8, Operator, Plugin and Wall all **active (5/5)**; Fleet `ok=true`, **2/2 fresh outbound** and **2/2 explicit `executorReady=true`**, unknown=0, false=0, queued=0, inFlight=0 at audit. `requireExecutorReady=false` / strict remains OFF.
- **PASS (live Windows dispatch):** Gold plugin `light_remote_exec` through the paired Windows runtime returned completed job, `exitCode=0`, exact read-only marker `G3_GOLD_WINDOWS_453_LIVE_SIGNED_EXEC=PASS`, matching hostname and UTC timestamp. This is real installed-device execution, not a CI test; no external effects.
- **PASS (MCP session hold/resume with in-flight job):** an already admitted 6-second read-only command was running, Gold session held, job completed with `exitCode=0`, session resumed, complete stdout recovered once and contained the one expected marker `G3_GOLD453_INFLIGHT_COMPLETION_SINGLE_MARKER_01`. Session reconnectCount incremented. This proves MCP session/result recovery, **NOT physical Agent TCP disconnect/reconnect, exactly-once external side-effects, or cryptographic nonce rotation**.
- The earlier blocker `BLOCKED_EXECUTOR_EVIDENCE` is resolved. Do not reuse that status for current live readiness.

## Incomplete / blocked, do not overclaim

- A 5-sample live latency benchmark via Gold tools was **refused pre-dispatch by the ChatGPT platform** (no batch samples; no invented p50/p95). No alternate execution route attempted.
- Preparing a specialized Gold-only guarded Operator restart script was also **refused pre-dispatch before file creation**. No Gold Operator restart, Agent duplex reconnect fault, or late-receipt recovery from real transport loss occurred during this checkpoint. Do not execute an alternate wrapper/PTY to bypass that refusal.
- We have not separately verified real transport cryptographic hello/nonce rotation by instrumented evidence; successful Gold plugin dispatch is not, by itself, proof of every Ed25519 protocol invariant.
- Sustained installed-agent soak with latency sample count, RSS and reconnect/late results, physical fault-injection and no-duplicate external effect are still OPEN. **Strict `OPERATOR_REQUIRE_EXECUTOR_READY=1` remains OFF** until Gold-only zero-work maintenance + backup/rollback and all required gates pass.
- Do not say G3 DONE or open G4. No user-visible production changes; no owner identity/enrollment changes.

## Next immediate ordered steps

1. Preserve achieved 2/2 readiness, source hashes and Windows installed receipt. Do not reinstall build #453 or rerun G2/earlier CI fixtures.
2. Legitimately authorized, Gold-only bounded physical Agent ↔ Operator reconnect (separate from MCP hold) with verified signed hello/nonce, before/after zero-work preflight, 10 consecutive health samples and rollback. If platform admission denies it, record BLOCKED and stop rather than rerouting.
3. Bounded enrolled-Agent TCP fault/late-result, no duplicate dispatch, measured p50/p95 with N, RSS/orphan and honest UNKNOWN for uncertain effects.
4. **Only after those gates**, Gold UAT service-only controlled strict admission enablement (`OPERATOR_REQUIRE_EXECUTOR_READY=1`), verify unknown/false 409 and true admitted, then mark G3 DONE. Preserve production separation.

See [Master Handoff](./RDC_GOLD_MASTER_HANDOFF_20261021.md), [Current Handoff](./RDC_HANDOFF_CURRENT.md), [previous #453 artifact and Gold promotion](./RDC_GOLD_G3_WINDOWS_453_AND_PROMOTION_20261021.md).
