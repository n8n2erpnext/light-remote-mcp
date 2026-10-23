# Gold Windows Local Wall stall after Remove/re-link — 2026-10-23

## Observed symptoms
Owner confirms Device Remove followed by enrollment/A-B succeeded on Gold UAT, but Windows Local Wall on 127.0.0.1:5491 remained at connecting / loading device / loading sessions; Permissions remained at Device policy authority Loading. Similar appearance to previous RM integration stall, not automatically proven to be the same root cause.
Owner-supplied Windows Agent log (07:40-09:55 UTC) shows early device_binding_not_found and repeated enrollment/poll 503 gold_postgres_persistence_unavailable, throttling 429 and timeout, then later pairing-code requests without those initial 503. This establishes chronology, not the outcome of individual status requests.

## Gold server findings
Gold UAT Operator, Plugin, Wall services active. Native PostgreSQL contains one old Windows Device owner-removed tombstone and one new Windows enrollment online since about 09:53 UTC, approved policy revision 1. Operator Fleet Unix-socket inspection after re-link showed channelFresh=true, executorReady=true and dispatchReady=true, with no active sessions, queued or inflight commands on the Windows leaf. Gold Operator journal after 09:48 restart did not show new Device native persistence failures in the inspected window. This is now a Windows local UI/agent problem rather than demonstrated ongoing PostgreSQL failure.
Official production Windows connector offline after client switch. Gold connector requires a new owner A/B. Direct Windows performance profiling/localhost timing unavailable; source-level mechanisms below are strong suspects, not measured physical root-cause proof.

## Source-level bugs and changes
1. operator-agent.mjs statusView() reads PLATFORM_ADAPTER.installedCapabilities() on every GET /api/status (home auto-refreshes every 10 seconds) and GET /api/policy-status (Permissions initial load). Windows installedCapabilities called commandExists for roughly two dozen binaries, and platform-adapters/shared.mjs used spawnSync where.exe without timeout or cache. A stalled Windows child spawn can synchronously block the same Node event loop serving all Local Wall HTTP/EventSource traffic and coexist with RM execution.
2. shared.mjs Windows binary discovery now uses the local PATH/PATHEXT file metadata rather than spawning where.exe, excluding remote UNC paths and caching results for 60 seconds. Non-Windows subprocess existence checks have a 1.5-second upper bound. windows.mjs installed-capability inventory is memoized for 60 seconds. Explicit Refresh capabilities invalidates both caches; no supported or approved permissions are auto-changed.
3. wall-status-cache.mjs formerly waited for remote signed status until the observer lane finished (could queue behind RM/activity before fetch timeout). Home now receives local device state within about 1.2s plus truthful remote_status_pending when the remote observer is slow, while only one background remote request stays in flight. The cache still reports actual rate limits, stale data and signed fresh results without inventing an active session.

## Verified on VPS-ARM (source and fixtures only)
selftest-gold-windows-wall-nonblocking-inventory PASS: executable PATH metadata detection and caching, manual invalidation, local Permissions fast path, /api/status returns without waiting for a deliberately unresolved observer request, embedded Permissions JavaScript parses.
selftest-g3-redis-wall-status-rate PASS: observer Redis ceilings, single-flight, 429/stale handling and recovery.
selftest-infra-capability-catalog PASS: OS supported versus installed privileges.
selftest-gold-owner-wall-browser PASS: real Chromium login and owner approval behavior.
Packaged Client Core version 0.9.0-rc.49, 89 files, SHA verification and selftest-packaged-local-wall PASS: icons, fonts, main Wall, Permissions, Approve, Settings routes. Existing client/core-files.json includes all changed modules.

## CI / rollout policy
Only isolated branch feature/gold-m6-integrated-20261023 changed. Gold Operator CI includes new regression. Windows Tray Client workflow now triggers staging builds on this Gold integration branch and runs the regression on windows-latest. Build using GitHub Actions ONLY; no hand-crafted installer or production tag.
Real-device acceptance remains OPEN pending passing Windows CI and intentional install/test of the Gold UAT candidate. Do not modify production rc.47. Test initial status and policy HTTP response time, JS pageerror and SSE on the physical Windows device; if problems remain inspect event-loop lag and DesktopBridge/RM lifecycle on that exact artifact. No automatic enrollment, device deletion or M6 four-service cutover. One historic Windows Gold managed process claim remains subject to separate owner-authorized reconciliation.
