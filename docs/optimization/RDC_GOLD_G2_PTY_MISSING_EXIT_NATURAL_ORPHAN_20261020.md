# Gold G2 — Missing PTY onExit, Windows natural-exit orphan and reconnect
Date: 2026-10-20 | Branch: feature/light-remote-gold-rebuild-20261018 | G2 IN PROGRESS

## Goal and scope
Follow RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md gate G2. Owner deferred **macOS real-device** testing; do not call the gate complete. Production, Windows owner client installer/updater and account enrollment stay unchanged.

## RED — Windows natural parent exit leaves orphan
- Official paired Gold Windows x64 DESKTOP-VA16D27, authorized session active.
- Managed PowerShell parent started a benign PowerShell child with `Start-Sleep -Seconds 75` and unique `G2_NATURAL_PARENT_EXIT_FIXTURE_20261020` marker; output captured child PID 10376 and parent naturally exited with state=finished, exitCode=0.
- A separate read-only Win32_Process lookup immediately confirmed child PID 10376 still ALIVE after parent exit. Guarded cleanup matched BOTH powershell.exe name and the unique fixture command-line marker, then stopped only that child; output `G2_NATURAL_CHILD_FIXTURE_CLEANED`. No background fixture left intentionally.
- Gold code taskkill.exe /PID <managed parent> /T /F fixes stop/timeout *while parent is live* but does not reliably own descendants after the parent already exits. **This is a verified open defect.** Do not add speculative PID scans, kill unrelated user PIDs, or mark G2 Windows tree containment PASS in this case.
- Candidate follow-up: Windows per-job Win32 Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, bounded handle ownership, no breakaway by default; need safe compatibility with Node spawn, output piping, process registry owner checks, system restart and installer. Must be RED→GREEN on hosted Windows and then owner Gold installed client. This is a design direction, NOT implemented here.

## Small G2 instrumentation/correctness patch — missing terminal onExit
- `lib/native-terminal.mjs` now exposes `exitEvidence` in view and terminal_finished events. Real onExit callback sets `exitEvidence=onExit`; when callback is lost but a registered PID is observed gone, `_syncExit` sets `exitEvidence=pid_disappeared`, emits `terminal_exit_reconciled`, finalizes and releases active capacity. Exit code remains null when not observed; never invent exitCode 0.
- New `deploy/scripts/selftest-g2-pty-missing-exit.mjs`: injected PTY provider wraps a **real** child process, never invokes onExit callback; tests natural exit and force-after-stop PID reconciliation, null unknown exit code, bounded slot cleanup and emitted reconciliation event; cleans any fixture PIDs in finally.
- Gold ARM Linux executed new regression, old native terminal, G2 lifecycle and NativeProcess regressions: all PASS. Windows and Linux GitHub Actions workflows now run the new test (Windows with bundled Node). macOS live-device validation deferred per owner; no macOS changes requested.
- Limit: if a PTY exposes no valid PID AND never fires onExit, exit cannot be proven. Such a terminal must not be reported as successfully exited; additional backend instrumentation is needed. Abrupt network outages remain untested.

## Controlled Gold Windows resume/cancel — live pass
- Gold Windows managed PowerShell printed `G2_WIN_HOLD_READY` then entered Start-Sleep 60. Official Gold hold_session transitioned active→hold, session_control returned active and incremented reconnectCount to 3. Process_output showed the SAME managed process still running and its prior output intact.
- `stop_process(force=false)` returned `stopping`, treeStopMethod=taskkill-tree; follow-up process_output confirmed `state=stopped`, stopRequested=true. list_processes showed 0 active jobs. This proves **controlled session hold/resume**, not abrupt physical network loss.

## Checklist / next actions
1. Commit/push only PTY source, regression, Windows+Linux Actions and handoff. Await Windows/Linux CI results; no owner client upgrade required for this instrument-only change.
2. Implement and verify Windows per-job containment for natural-parent-exit orphan; do not ship a pseudo-fix using blind process enumeration. Gold staging only; no production modifications.
3. Later macOS real-device E2E, missing-PID PTY diagnosis and abrupt disconnect/reconnect. Keep G2 OPEN and record blockers before G3. G1 upstream pre-dispatch refusals remain separate.
4. Preserve pre-existing untracked `deploy/gold-uat/` and Gold UAT scripts.
