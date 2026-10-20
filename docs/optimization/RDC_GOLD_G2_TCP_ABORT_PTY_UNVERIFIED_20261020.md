# G2 Gold — TCP lost-response and PTY missing exit evidence
Date: 2026-10-20 | Branch: `feature/light-remote-gold-rebuild-20261018` | Status: candidate, CI pending

## Source of work
Continue [RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md](./RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md) and [Windows #441 owner E2E](./RDC_GOLD_G2_WINDOWS_441_OWNER_E2E_20261020.md). Windows #441 real machine confirmed per-job Job Object, natural parent exit, stop, timeout, stdout/stdin, no active jobs. Linux POSIX tree cleanup was separately accepted. Owner explicitly deferred macOS real-device testing.

## Reproduction and patch — PTY no PID + lost onExit
Old `NativeTerminalRegistry.prune()` repeatedly sent `SIGKILL` on each prune for an idle/hard-TTL terminal with no PID and no `onExit`. The registry had no evidence that termination had occurred, but would continue calling kill indefinitely while the unverified row occupied capacity.

New `deploy/scripts/selftest-g2-pty-missing-pid-exit.mjs` reproduces the condition using an injected PTY provider with `pid=null`, no callback until explicitly invoked. RED failed because no `terminationStopAttemptedAt` or `terminationUnverifiedAt` was surfaced.

Gold-only patch `lib/native-terminal.mjs`:
- One bounded expiry kill request (instead of unbounded kill loops); keep previous `state=expired` contract.
- If PID is missing, record `terminationUnverifiedAt` immediately. If PID is known, retry PID evidence check after stop grace and record unverified if still no exit evidence.
- Emit a sanitized `terminal_exit_unverified` event with `PTY_EXIT_EVIDENCE_MISSING`. Separate `terminal_expiry_kill_failed` event has generic `PTY_KILL_ERROR`; do not expose command/terminal content.
- Preserve `finishedAt=null`, `exitCode=null` and the active terminal slot until a real `onExit` or PID disappearance proves exit. Do **not** declare success to free capacity. Explicit stop and runtime shutdown retain their existing behaviors.
- On late `onExit`, `finishedAt` and `exitEvidence=onExit` become available and capacity is released. Prior `expired` cause remains visible.

ARM Node regression GREEN: `G2_PTY_MISSING_PID_ONEXIT_FAIL_CLOSED`, `G2_PTY_MISSING_PID_NO_REPEATED_KILL`, `G2_PTY_LATE_ONEXIT_RECOVERY_RELEASES_SLOT` all PASS. Prior missing `onExit`, owner isolation, resize/signal and hard TTL regressions PASS.

## Transport interruption without endangering owner devices
New `deploy/scripts/selftest-g2-transport-drop-job-survival.mjs` uses real 127.0.0.1 ephemeral TCP sockets and a real `NativeProcessRegistry` child. It cuts the client response socket **after process admission but before ACK completes**, re-queries the same process using an independent new TCP connection, verifies process and cursor data under the correct owner (wrong owner rejected), then stops the owned job and checks zero active processes.

ARM GREEN:
- `G2_TCP_ABORT_AFTER_DISPATCH_JOB_SURVIVES=PASS`
- `G2_TCP_RECONNECT_OWNER_STATE_AND_OUTPUT=PASS`
- `G2_TCP_RECONNECT_CANCEL_AND_CLEANUP=PASS`

This is an isolated real TCP-abort harness, **not** a physical cable/network disconnection, a Hub/Bridge remote reconnect, a claim of exactly-once side effects or a replay-safe external shell effect. Physical owner network interruption remains OPEN; G3/G4 handle channel readiness and effect ambiguity.

## CI / boundaries
Both Windows native packaged-runtime smoke and Linux x64/ARM64 package smoke run the two new fixtures. Windows uses bundled runtime; the tests remain owner-independent and do not touch user processes or external network. YAML/syntax/diff checks and existing ARM regressions PASS. Hosted Windows/Linux results must be checked by actual run SHA before calling CI acceptance.

No changes on Windows owner's installation, HOMESV, Gold LXD services, public production, license/billing or updater. macOS physical E2E deferred. G2 remains IN PROGRESS. Preserve unrelated untracked Gold UAT fixtures.

## Remaining
- Verify Windows and Linux CI pass; investigate timeout/compatibility failures if needed.
- Instrument actual Hub/Bridge/channel (G3) without equating Online with dispatch readiness; preserve A/B and owner checks.
- Controlled short resource soak (G6), real unexpected network cut on a disposable isolated Gold node (not owner Windows), and macOS physical test later with owner.

## Hosted CI acceptance — exact source cab8013 (2026-10-20)
- Source commit `cab8013f2516ca395f4b15d2efa47ec7f3f525dd` built on Windows [Actions #443](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39400783470) **completed SUCCESS** and Linux [Actions #280](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39400783477) **completed SUCCESS** (both x64 and ARM64).
- Full Windows runner logs (203,740 bytes) explicitly confirm ALL SIX: `G2_PTY_MISSING_PID_ONEXIT_FAIL_CLOSED=PASS`, `G2_PTY_MISSING_PID_NO_REPEATED_KILL=PASS`, `G2_PTY_LATE_ONEXIT_RECOVERY_RELEASES_SLOT=PASS`, `G2_TCP_ABORT_AFTER_DISPATCH_JOB_SURVIVES=PASS`, `G2_TCP_RECONNECT_OWNER_STATE_AND_OUTPUT=PASS`, `G2_TCP_RECONNECT_CANCEL_AND_CLEANUP=PASS`.
- Windows native/compact installer build, full install/self-test, rollback/uninstall, compact install/uninstall and artifact upload completed SUCCESS; artifact `light-remote-windows-x64-cab8013f2516ca395f4b15d2efa47ec7f3f525dd` (328,179,155 bytes) uploaded and not expired. Do not confuse #443 hosted CI with a user Windows installation.
- G3 identified SOURCE-ONLY preflight: `operator-host/fleet-router.mjs::_state` currently treats `inFlight.size>0` as online even after `lastSeenAt` exceeds channelTtlMs, potentially mislabeling channel dispatch readiness. Reproduce in G3 RED fixture before any behavioral change. Distinguish active work from fresh authenticated channel presence and Owner/device presence. No G3 runtime modification in this checkpoint.
- **G2 remains IN PROGRESS** for owner-deferred physical network interruption, macOS real E2E and longer soak; no production deployment or owner Windows upgrade was performed.
