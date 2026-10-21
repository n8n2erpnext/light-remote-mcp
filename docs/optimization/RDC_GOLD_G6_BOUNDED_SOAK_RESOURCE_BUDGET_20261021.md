# Gold G6 — Bounded TCP/Executor soak, latency and RSS budget (2026-10-21)

## Goal and boundary
G Plan target: controlled performance, resource budgeting, multi-process reconnect/slow consumer behavior; no automatic output ring-cap increase. Production and owner devices unchanged. The user will manually revisit LXD/sudo/policy-sensitive tests after G Plan code.

## Verified Linux ARM64 VPS-ARM source soak (real localhost TCP, real child processes, NOT a Gold owner-enrolled Agent)
Executed `node deploy/scripts/soak-g3-duplex-readiness.mjs --cycles 6` against the Gold branch: **18/18 cases PASS, 124,509 ms**. Three scenarios, six independent child processes each:
- Device Duplex TCP drop while Executor holds a command: duration p50 **6218 ms**, p95 **6225 ms**, sampled peak RSS **65016 KiB** (462 Linux /proc VmRSS samples).
- Hung Executor readiness and recovery with late completion: p50 **6331 ms**, p95 **6358 ms**, sampled peak RSS **59136 KiB** (469 samples).
- Half-open stream watchdog/reconnect: p50 **8189 ms**, p95 **8228 ms**, sampled peak RSS **57848 KiB** (609 samples).

All 18 cases exit 0 with required markers and bounded stdout/stderr. A transient official Light Remote `target_node_draining` error occurred during attempts to write the documentation while the soak was active; read-only device inspect subsequently reported `state=online,draining=false`, and retry on **same authorized device** completed. This was a transient Fleet condition, not a reason to bypass policy or switch route. No fixture needed sudo/host LXD privileges.

## Gold G6 CI budget enforcement
Existing `deploy/scripts/soak-g3-duplex-readiness.mjs` now checks:
- max per-case duration **27s** by default (bounded within its pre-existing 30s hard timeout);
- max sampled Linux child RSS **192 MiB** by default; Linux must yield at least one RSS sample;
- unchanged 32KiB stdout / 8KiB stderr fixture output bounds and bounded child process lifecycle.
Budget values are opt-in configurable for CI and run only in source soak; no changes to the product's established 4MiB/16MiB output caps or runtime behavior. Gold Operator CI runs a short `--cycles 2` suite and the existing SCP/CAS regression tests.

This 18-process source soak is a **reproducible bounded reliability baseline**, not a multi-day real enrolled Windows/macOS stability SLA, exact Agent RSS budget, or intrinsic LLM token decoding acceleration. Previous paired real MCP benchmark N=8 production vs Gold measured Gold p50/p95 advantage and one-call inline stdout but is not a large-sample production capacity SLO. Earlier physical Gold Windows device Duplex reconnect/lost receipt was tested separately under strict ON.

## Deployed Gold runtime checkpoint (2026-10-21)
Source `0210cabb4a7dbd9ed839ff97a25dcb83b1894ed4` was promoted to isolated Gold UAT after immutable source SHA verification, protected backup and 10/10 Gold health checks; 5/5 services and 2/2 explicit ExecutorReady remained active with strict and inline ON. The G6 child-process budget guard is a **CI/source-soak test**, not an additional limiter inside a live device Agent. Production was not restarted/reconfigured.

## Remaining owner release gates
- Refresh published external MCP tool schema if exposing optional `expectedSha256`; verify signed installer across Windows/macOS/Linux Desktop from exact Gold source.
- Real multi-agent 24h+ session/receipt/RSS soak and authenticated Gold Wall visual SCP acceptance are deferred for owner-driven testing; do not represent these as passed.
- Keep G6 source budget CI gated and exact pinned immutable Gold deployment, retain prior UAT backups and source parity.
