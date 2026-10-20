# G3 Gold — Device Duplex half-open receive watchdog
Date: 2026-10-20 | Branch: `feature/light-remote-gold-rebuild-20261018` | G3 **PARTIAL** — candidate on Gold source, not installed client.

## Exact continuation
Read `RDC_HANDOFF_CURRENT.md` and `RDC_GOLD_G3_FLEET_READINESS_LXD_20261020.md` first. G3 phase 1 Fleet Router channel-freshness in real Linux LXD Operator passed, source `d7d60c3`; latest start HEAD `9fcf5c0`. The owner asked to continue the latest G plan, and to include Linux Server `light-remote-gold-uat`, not only Windows. Do not reopen G2 already accepted or promote Gold to production.

## RED — real TCP, not a fake Fleet state
New `deploy/scripts/selftest-g3-duplex-halfopen-watchdog.mjs` runs a Node HTTP server on ephemeral `127.0.0.1`. A valid duplex hello-ack is sent, then the first TCP stream stays open while the server **stops all outgoing frames**; it still accepts incoming request data. The client reports ready indefinitely and never reconnects. On original source the fixture exited **1** at `G3 condition timed out`. No actual owner network or production route interrupted.

## Minimal Gold source patch
File: `lib/device-duplex-client.mjs`.
- Add bounded receive-idle watchdog (default `responseIdleMs=35000`, bounded 3000–120000 ms for test injection).
- Mark server activity on recognized incoming frames only. Keep monotonic `performance.now()` internally to avoid wall-clock corrections; public `lastInboundAt` is diagnostic only.
- If a ready, open duplex stream receives no server frame within window, emit bounded `device_duplex_response_stale` diagnostic and destroy **only that duplex request**. Existing reconnect loop, server resume, tracked ACKs and replay remain unchanged.
- Stop watchdog when heartbeat/stream ends or client closes. Healthy inbound heartbeat frames prevent false reconnect; do not interpret client outbound sends as server readiness.
- Expose read-only `responseIdleMs`, `receiveStaleDisconnects`, `lastInboundAt` in `status()` for observability.
- No server policy change, A/B grant change, billing, DB, Redis, updater, Fleet route or production mutation.

## GREEN evidence (isolated)
1. VPS-ARM Node v22.23.1 source regression: `G3_HALF_OPEN_STREAM_WATCHDOG_RECONNECT=PASS`, `G3_HEALTHY_SERVER_FRAMES_PREVENT_FALSE_RECONNECT=PASS`, `G3_HALF_OPEN_DIAGNOSTICS=PASS`. Source syntax and `git diff --check` PASS.
2. Prior real TCP lost-response G2 fixture PASS (three markers) and G3 Fleet stale inFlight fixture PASS (four markers), plus v08/v11 Fleet 7 regressions PASS. `G3_ARM_WORKTREE_REGRESSION=PASS`.
3. **Real Linux Server LXD staging:** `light-remote-gold-uat`, Ubuntu ARM64, `/tmp/g3-halfopen-20261020/lib/device-duplex-client.mjs` + `deploy/scripts/selftest-g3-duplex-halfopen-watchdog.mjs`. Executed inside container, all three new G3 markers PASS. Module SHA-256 matches ARM worktree: `452af2d9578af124260a16a21d1034ff6b0b872708c38366143580e8a0fc5132`. This is a **local TCP fixture inside actual LXD**, not full live-device transport injection.
4. Real Gold Operator Unix IPC `GET /v1/fleet` HTTP 200. Units `postgresql@17-main`, `redis-server`, `light-remote-gold-operator`, `light-remote-gold-plugin`, `light-remote-gold-wall` all systemd active. PostgreSQL `pg_isready` accepting connections; Redis `redis-cli ping` returned NOAUTH because authentication is required, so do not claim an authenticated Redis PING.
5. Wired new test into Windows, Linux, macOS Gold CI package checks and change-path triggers. Verify hosted CI statuses and SHA-scoped artifacts **after push**. CI does not install on owner devices or constitute owner E2E.

## Strict limitations and next gate
- This watchdog detects **missing inbound frames** on an otherwise-open connection, not a transport that sends normal heartbeats while the Agent executor cannot accept/finish commands.
- Fleet `dispatchReady` remains router-eligibility only; G3 still needs **Agent/executor readiness evidence**, half-open between Operator and execution, verified treatment of unknown result after dispatch, disposable Gold node fault injection and bounded watchdog/resource soak.
- No owner Windows client install, macOS real E2E (deferred), physical network cut, full Gold Agent live stream deployment, production or public endpoint update.
- No rollout of modified client library to existing installed Windows/Linux/macOS services in this checkpoint. `/tmp/g3-halfopen-20261020` is an isolated Gold LXD staging fixture and may be reused; do not delete other UAT assets.
- Update `RDC_HANDOFF_CURRENT.md`, then commit only this patch, regression, 3 CI workflow edits and documentation. Preserve pre-existing untracked `deploy/gold-uat/` and UAT helpers. Record exact commit and CI result after verification.
