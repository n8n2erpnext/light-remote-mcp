# G3 Gold — Hung Executor readiness with fresh channel
Date: 2026-10-20 | Branch: `feature/light-remote-gold-rebuild-20261018` | Status: **G3 phase candidate; not gate completion**
Predecessor HEAD: `0322869` (G3 executor rejection recovery source `4ab4cc9`, docs checkpoint). Production and owner-installed clients are out of scope.

## Root cause / behavior boundary
Prior G3 fixed a TCP channel that stayed open without incoming frames and a callback that **rejected**. An executor callback that **never settles** remained invisible to Fleet: the live authenticated client heartbeat continued, `channelFresh=true`, and `FleetRouter.touch()` admitted new jobs even though `device-duplex-session.mjs::commandPump` awaited the previous command result. The existing Operator exec timer eventually abandons/marks its remote job at `timeoutMs + 2*FLEET_CHANNEL_TTL_MS`, which **does not cancel or prove termination** of the underlying Agent effect. Avoid treating server job timeout as proof of safe replay.

## RED fixture (real localhost duplex + router)
`deploy/scripts/selftest-g3-executor-hang-readiness.mjs` binds an ephemeral HTTP streaming duplex on `127.0.0.1` using the **real** `handleDeviceDuplexSession`, `DeviceDuplexClient`, `FleetRouter`. A first callback returns an intentionally unresolved Promise while Agent heartbeats continue. Baseline source `0322869` RED with exit code 1: `unsettled execution needs bounded degraded evidence`. No real OS shell or customer process is stopped.

## Minimal correction — negative evidence only
1. `lib/device-duplex-client.mjs`: per-command bounded, monotonic-independent setTimeout detects an unresolved callback after a duration derived from the Operator command's exec timeout plus **20s**; a command with a valid 2-hour timeout is not labeled hung merely at 10 minutes. Non-exec operations use 10min + 20s conservative default. Test can inject `executionStaleMs` 1s–7.3Ms. No timer auto-kills or fabricates a result; same pending promise and commandId persist. `unresolvedExecutions`, `executorDegraded`, `executorStallDetections`, `activeCommands` are bounded diagnostic state. The existing result/ACK/replay mechanism still handles late completion. The idle duplex close does not swap away a client that has active commands.
2. `device-agent/operator-agent.mjs`: signed Agent duplex hello/heartbeat and long-poll status transmit `executorReady=false` **only when** unresolved active execution is detected; otherwise true. Manual drain and Local Wall owner authorization remain independent. No command text or secrets in readiness diagnostics.
3. `operator-host/executor-routes-device-channel.mjs`: forward the Agent-supplied boolean from authorized stream hello, subsequent authenticated heartbeats, and authenticated fallback long-poll.
4. `operator-host/fleet-router.mjs`: keep **three separate truths**: fresh authenticated channel, existing owner/Agent drain, and Agent self-reported executor status. Explicit false yields `readinessReason=executor_unavailable`, `dispatchReady=false`, and bounded `target_node_executor_unavailable` 409 on new admission. `poll()` does not dispatch/redeliver while executor-unavailable. Legacy absent boolean remains `null` (UNKNOWN; not a claim of proven executor health). Missing fields in a fallback poll cannot silently reset an existing explicit false. Explicit true after observed late completion recovers admission, subject to existing grants and local final deny.
5. This is **negative self-reported readiness**, not an independent OS-level executor liveness probe or proof of remote shell completion. It never changes device policy, A/B, OAuth, capability admission, consent, billing or operator job ledger.

## Green evidence
- VPS-ARM source with real local duplex fixture:
  `G3_HUNG_EXECUTOR_FRESH_CHANNEL_ADMISSION_DENIED=PASS`
  `G3_UNCERTAIN_EFFECT_NOT_REPLAYED_OR_FAKE_COMPLETED=PASS`
  `G3_LATE_EXECUTOR_COMPLETION_RECOVERS_WITHOUT_DUPLICATE=PASS`
- Prior G3 Fleet stale inFlight 4 markers, duplex half-open watchdog 3, and executor rejection recovery 2, plus v08/v11 Fleet regressions: PASS. Node syntax for all touched modules, three CI YAML parse and `git diff --check`: PASS.
- **Actual Linux Server LXD:** container `light-remote-gold-uat` RUNNING ARM64. Staged source in `/tmp/g3-executor-hang-20261020` without replacing installed modules. The real duplex fixture ran **inside this LXD**, all three new markers PASS. Staged `lib/device-duplex-client.mjs` SHA-256 `a3a8dbc34a100aace2f175e95062f3fb0abc46afe6e9dfcefea9fa49ebf890be`, staged `operator-host/fleet-router.mjs` SHA-256 `33f76997f9c6facfec9dbd3cd68df9e94f555dc45e7ade2a50e11d13cc193b4b`, both equal VPS-ARM worktree hashes.
- Real Gold Operator Unix IPC `GET /v1/fleet` HTTP 200; PostgreSQL 17, Redis, Gold Operator, Plugin and Wall service units **5/5 active**.
- Source [`fa59f879e5a91edadc1cb85abb13337f9e8b7fa2`](https://github.com/n8n2erpnext/light-remote-mcp/commit/fa59f879e5a91edadc1cb85abb13337f9e8b7fa2) pushed to Gold branch.
  - Linux [Actions #284](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39411369717): **x64 and ARM64 SUCCESS**, inspected both full job logs. Each contains all 3 new hang-readiness PASS markers.
  - macOS [Actions #242](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39411369871): ARM64 **SUCCESS**, all 3 markers verified; Intel x64 **IN PROGRESS** at checkpoint.
  - Windows [Actions #446](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39411369674): full native/package/installer workflow **IN PROGRESS** at checkpoint.
  - Hosted CI is not an installed owner-device acceptance; no client updated.

## Limitations / next work
- The watchdog is intentionally a conservative heuristic relative to each command's timeout; for unbounded native FS/desktop operations, 10min+20s is not an authoritative operation deadline. A stuck JS event loop cannot send heartbeat; that is a transport liveness failure and is distinct.
- If callback never completes, `executorReady=false` stays until recovery/restart; it does not free the command, assume an effect did not happen, or automatically retry. Server timeout may report a failed/unknown job but cannot cancel an external shell effect. G4 must reconcile effect ambiguity across process death/restart.
- Still needed before **full G3 accepted**: controlled fault injection on a disposable **real enrolled** Gold Linux node (not the current operator's own Windows device), successful authenticated reconnect with actual Agent, independent executor/Agent probes beyond self-report, bounded soak and resource measurements. G2 macOS physical + unexpected owner physical network interruption remain deferred.
- Preserve unrelated untracked files `deploy/gold-uat/`, `deploy/scripts/check-gold-db.mjs`, `uat-gold-account-device.mjs`, `uat-gold-http-api.mjs`. Do not modify production `light-remote-direct`, public routes, Paddle Live, production plugin or user machines.
