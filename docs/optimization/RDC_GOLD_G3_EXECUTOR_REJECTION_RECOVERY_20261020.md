# G3 Gold — Duplex executor rejection must not wedge live dispatch
Date: 2026-10-20 | Branch `feature/light-remote-gold-rebuild-20261018`
Baseline source HEAD: `1e76cc6`; G3 phase 1 (Fleet channel freshness) and half-open transport watchdog already accepted. Status: **G3 partial; executor reject path RED→GREEN**, not full gate completion.

## Root cause: fresh channel, executor callback rejects, no result
`lib/device-duplex-client.mjs::_runCommand()` previously used `Promise.resolve().then(()=>this.onCommand(command))` without mapping rejections to protocol results. Its caller only logged `device_duplex_command_failed`. The server `operator-host/device-duplex-session.mjs::commandPump` waits for result settlement before polling again; the independent frame reader still receives heartbeat, refreshing `FleetRouter.touch()`. A single Agent executor callback failure could therefore leave `inFlight` stranded and stall the next command while channel freshness still appeared healthy.

This is separate from prior G3 fix for stale transport when inFlight > 0, and from the receive-idle watchdog. It is not a claim that the Agent executor is always executable merely because a heartbeat arrived.

## RED — real HTTP streaming duplex and FleetRouter
New `deploy/scripts/selftest-g3-duplex-executor-rejection.mjs` binds a local ephemeral HTTP server on 127.0.0.1 and wires the real `handleDeviceDuplexSession`, `DeviceDuplexClient`, and `FleetRouter`. The authenticated test client receives the first command, deliberately rejects the `onCommand` Promise, while heartbeat remains active. On the original Gold source the test **failed exit code 1**: `executor rejection left Operator command pump waiting despite healthy heartbeat`. This is not a mock that directly toggles a Fleet state. No real user shell command is run.

## Minimal correction
In `lib/device-duplex-client.mjs`, normalize an uncaught `onCommand` rejection into a bounded result on **the same commandId**, with:
- `status=error`, `exitCode=125` (valid protocol exit code).
- `executionOutcome=unknown`, `data.errorCode=executor_unhandled_rejection` and `data.executionOutcome=unknown`.
- Redacted generic stderr; no exception message, command input, private data, or stack sent to server.
- Cached result travels via existing result ACK/replay and `FleetRouter.complete`; a previously queued command can progress, without extra A/B, policy widening, command retries, or fabricating exactly-once side effects.
- Existing dedupe and `result===undefined` behavior remain unchanged. A later `onCommand` hanging indefinitely is **NOT** fixed here.

## GREEN evidence
1. VPS-ARM real localhost duplex:
   - `G3_EXECUTOR_REJECTION_RETURNS_UNKNOWN_RESULT=PASS`
   - `G3_FRESH_CHANNEL_EXECUTOR_RECOVERS_WITHOUT_STALL=PASS`
   - 0 unhandled rejections, second command succeeds, original inFlight count returns to 0.
2. VPS-ARM other regressions PASS: prior G3 half-open watchdog (3), G3 Fleet stale channel (4), prior G2 TCP lost response (3). Node syntax, `git diff --check`, Python YAML parsing of three OS workflows PASS.
3. Actual Ubuntu ARM64 LXD `light-remote-gold-uat`: isolated staged files under `/tmp/g3-executor-recovery-20261020/` (`lib/device-duplex-client.mjs`, `operator-host/device-duplex-session.mjs`, `device-duplex-transport.mjs`, `fleet-router.mjs`, new fixture). Ran same HTTP duplex test **inside LXD**, both G3 executor markers PASS. Source/staged client module SHA-256 match `c6079f313f9d07e9688dfe9fef6a1c971b35a4c2ce2d631f844a849c3e36f7c8`.
4. Real Gold LXD Unix Operator socket `GET /v1/fleet` HTTP 200, service units `postgresql@17-main`, `redis-server`, `light-remote-gold-operator`, `light-remote-gold-plugin`, `light-remote-gold-wall`: five `active`. No live Gold Operator or Device Agent source replaced; no service restarted.
5. Pushed exact Gold source [`4ab4cc9621760967f78b20c8b10c2d43bd41a4ff`](https://github.com/n8n2erpnext/light-remote-mcp/commit/4ab4cc9621760967f78b20c8b10c2d43bd41a4ff), no release tag or production updater change.
   - Linux [Actions #283](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39408569566): x64 and ARM64 jobs **SUCCESS**; both logs inspected and show `G3_EXECUTOR_REJECTION_RETURNS_UNKNOWN_RESULT=PASS`, `G3_FRESH_CHANNEL_EXECUTOR_RECOVERS_WITHOUT_STALL=PASS`, plus previous G3 half-open/stale tests.
   - macOS [Actions #241](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39408569553): Intel x64 and Apple Silicon arm64 jobs **SUCCESS**; both job logs inspected and contain both new G3 markers and prior half-open watchdog marker.
   - Windows [Actions #445](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39408569582): native runtime smoke/installer job in progress at checkpoint; no overall PASS claimed yet. Windows CI is **not** actual installed owner-device acceptance.
   - The CI does not prove Agent/Executor that hangs without rejecting; this is still OPEN.

## Boundaries
No installation on owner Windows/macOS, no public production deploy/update, no billing/Team/A-B/grant/policy change, no PostgreSQL/Redis migration, no hardening bypass. Existing Gold untracked `deploy/gold-uat/` and UAT helpers left untouched.

**G3 STILL OPEN:** callbacks that never settle (executor hangs while heartbeat is fresh); distinguishing Agent executor admission/capacity from router channel freshness; real disposable Gold node fault injection, replay ambiguity and watchdog soak. Do not claim operation exactly-once after an exception; `executionOutcome=unknown` is intentionally conservative. macOS owner-device E2E deferred and G2 physical network cut deferred by owner.
