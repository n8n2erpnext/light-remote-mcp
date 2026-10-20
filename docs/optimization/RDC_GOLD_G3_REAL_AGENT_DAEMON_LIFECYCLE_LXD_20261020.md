# G3 Gold — Real Agent daemon lifecycle, SIGSTOP/SIGCONT, Local Wall, and bounded RSS

2026-10-20 | Gold branch `feature/light-remote-gold-rebuild-20261018`
Starting HEAD `4d721c0` | **G3 IN PROGRESS; this is a separate real-OS-process gate, not real enrolled-Operator E2E.**

## New scope
Previous G3 tests exercised real signed duplex and real Local Wall, but the Agent core was run in a fixture process. Add a bounded regression which launches the **unmodified real** `device-agent/operator-agent.mjs daemon` in independent OS child processes. Test authenticated Local Wall, independent spawn probe while alive, process freeze and recovery, periodic probe scheduling, and clean restart across two actual daemons. Never enroll a real account, touch public Hub, restart installed services, or act on production.

Source: `deploy/scripts/selftest-g3-agent-daemon-lifecycle.mjs` (Node built-ins, independent process, temp state under OS tmp mode 0700, auth config 0600, random password, private loopback Wall with dynamically allocated ephemeral TCP port, Cloud base/hub set to unreachable `127.0.0.1:1`, no enrolled device). The Local Wall remains authenticated (login CSRF and session cookie are actually exercised), not a disabled-auth fake. The Agent's native probe does `spawn(process.execPath, ['-e','process.exit(0)'])` periodically. All scratch files removed after execution.

Two rounds each:
1. Spawn real daemon; authenticate against actual Local Wall; assert `/api/status` has `executorProbe.ready=true`, `executorReady=true`, `enrolled=false` (dormant).
2. On POSIX only: `SIGSTOP` the *exact isolated child PID*, confirm Local Wall cannot answer while process is frozen (bounded 350ms timeout), always `SIGCONT` in finally, then assert the authenticated Wall becomes available with healthy executor truth again. No system or owner PID signaled.
3. Wait for next actual 5s-periodic independent spawn canary to finish, assert `checks>=2`, `probeTimeouts=0`.
4. Fetch rendered Wall HTML and require `spawn probe` UI hook. Send `SIGTERM` to child, assert exit code 0 and both daemon start/stop events; repeat with a fresh child, auth session, and state path.
5. Track sampled RSS from Linux `/proc/<child pid>/status`, report sample count and wall duration. A high-water sample on two ~5s daemons does *not* establish a production long-duration memory ceiling.

## Verified VPS-ARM (real Linux ARM64 Agent)
`node deploy/scripts/selftest-g3-agent-daemon-lifecycle.mjs`: all expected markers PASS for both rounds plus `G3_REAL_DAEMON_RESTART_NO_ORPHAN=PASS`.
- starts=2; shutdowns=2; SIGSTOP/SIGCONT=2; actual canary checks=4.
- wall-clock 10,423ms; peak sampled RSS 72,896 KiB; 82 RSS samples; Node v22.23.1.
- Exit=0, no stderr.

## Verified in live Gold UAT LXD namespace
**Actual container** `light-remote-gold-uat` Ubuntu ARM64, with only staged source under `/tmp/g3-real-daemon-lifecycle-20261020/`. Staged full `device-agent/`, `lib/`, `assets/`, VERSION and lifecycle test so the test launches the same code paths and packaged branding/icons; SHA256 of test script matches source: `28d14cc5c9aac8c56ad74a751ab557f58b9f8dfeb46e5d77d1c488d12894104f`. Ran genuine `node /tmp/g3-real-daemon-lifecycle-20261020/deploy/scripts/selftest-g3-agent-daemon-lifecycle.mjs` inside LXD.
- starts=2; shutdowns=2; SIGSTOP/SIGCONT=2; actual canary checks=4.
- wall-clock 10,389ms; peak sampled RSS 71,148 KiB; 82 samples; Node v22.23.3; all markers PASS.
- Only ephemeral Local Wall listener on 127.0.0.1; no business database writes, no installation or service replacement.

## CI and platform consistency
- New `gold-g3-real-agent-lifecycle` job in isolated Gold CI, 4-minute budget; checks actual child process not a unit stub.
- Native Client package workflows for Linux Desktop x64/ARM64 and macOS Intel/Apple Silicon additionally run the same real-process fixture. POSIX SIGSTOP/SIGCONT is applicable to macOS and Linux. Windows is intentionally **not claimed** for SIGSTOP semantics; previous Windows smoke checks remain separate.
- CI statuses are **PENDING until exact-source run/job/log verification**; no deployment or updater.
- Master Plan first-line stale G0-only status corrected; the implementation still follows original G3 acceptance plan.

## Existing limitation and next acceptance
The pre-existing `deploy/scripts/selftest-device-agent-cli.mjs` initially failed due to inherited real VPS-ARM identity and Wall host environment. Fixed only its child-process environment (not Agent runtime); subsequently **11/11 PASS on VPS-ARM and inside LXD**, see [G3 synthetic Agent CLI environment isolation](./RDC_GOLD_G3_SYNTHETIC_AGENT_CLI_ENV_ISOLATION_20261020.md). Do not confuse that mock-owner-signed fixture with live Gold Operator enrollment.
This test operates **unenrolled** on a private localhost Wall with a genuinely spawned Agent process, while the earlier signed protocol fixture uses an ephemeral in-memory EnrollmentRegistry. Neither replaces *normal owner-account approval and live service enrollment*. Still missing: current Gold Operator install alignment, owner-approved disposable identity, bounded enrolled process load/command execution, and official UAT signed channel fault/recovery; G4 is not accepted or started from this evidence.

Do not move/commit untracked `deploy/gold-uat/`, check-gold-db and uat-gold helper scripts; do not touch live production.
