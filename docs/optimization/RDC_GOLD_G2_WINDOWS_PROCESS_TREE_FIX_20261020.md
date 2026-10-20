# Gold G2 — Windows NativeProcess descendant orphan, RED → patch → CI
Date: 2026-10-20 | Gold-only branch feature/light-remote-gold-rebuild-20261018 | G2 IN PROGRESS

## Real Windows Gold RED
- Authorized DESKTOP-VA16D27 win32/x64, official Light Remote Gold MCP.
- Managed PowerShell parent spawned a PowerShell child running Start-Sleep -Seconds 90, which reported PID 1956.
- Calling stop_process(force=false) returned stopping/stopRequested=true, but a separate read-only Get-CimInstance Win32_Process check found PID 1956 still ALIVE.
- The fixture child was immediately cleaned with a tightly guarded Stop-Process command, matching the exact Start-Sleep command line. Cleanup confirmed, no other process changed.
- Root cause: NativeProcessRegistry._signal used Node child.kill on Windows, targeting only the parent and leaving descendants.

## Gold-only source patch
- lib/native-process.mjs: for an active registry-owned Windows numeric PID, call System32/taskkill.exe /PID <owned PID> /T /F using argv-based spawnSync, no shell, hidden window, bounded 3000ms. The API does not accept arbitrary PID to kill.
- Successful tree termination request records treeStopMethod=taskkill-tree and stopForce=true (Windows taskkill /F is forceful). The existing child exit event remains authoritative for finishedAt.
- Failure falls back to direct child.kill and emits a sanitized process_tree_stop_fallback event; no invented tree cleanup claim. POSIX process groups unchanged.
- Metadata treeStopMethod is additive to view(). The bounded synchronous taskkill call and failure fallback require later soak analysis.
- Limitation: descendants whose parent has naturally exited already may no longer be discoverable by taskkill; longer-term Win32 per-job Job Object remains to evaluate.

## Automated regression
- New deploy/scripts/selftest-g2-windows-process-tree.mjs runs actual parent+descendant processes on win32. It asserts no live descendants after normal stop(false), timeout, and runtime close(); tracks fixture PIDs and cleans in finally.
- .github/workflows/windows-native-client.yml runs the regression inside its bundled runtime smoke on a hosted Windows runner; failure blocks installer publication.
- ARM Linux runs the Windows-only script as SKIP_NON_WINDOWS (not PASS); prior G2 Linux process-tree, escalation, timeout, shutdown, NativeProcess regressions pass unchanged.

## Pending acceptance
- Windows CI hosted runner pass and SHA-scoped artifact are pending until observed. The owner's installed Windows runtime has not yet been patched. Do not mark G2 complete.
- Windows native orphan after an already-exited parent, network interruption, PTY lost-onExit, macOS live E2E, and G6 resource profiling remain open.
- Production and user enrollment unchanged. G1 variable upstream pre-dispatch refusals remain separately unresolved.

## Additional live Windows Gold baseline (same owner's device, current installed runtime)
- A separate managed PowerShell NativeProcess slept 25 seconds with 2100ms timeout. Gold output returned state=timeout, timedOut=true, signal=SIGTERM, and only G2_WINDOWS_TIMEOUT_STARTED (never the after-timeout marker). No active jobs remained.
- Interactive PowerShell ConPTY: started at 82x25, resized via official tool to 112x35, echoed G2_WIN_PTY_RESIZE_OK, received interrupt while running Start-Sleep, accepted a follow-up command G2_WINDOWS_PTY_INTERRUPT_RECOVERED and exited 0. Final list_processes/list_terminals showed 0 active resources.
- Large output with *slow reader*: one managed Windows PowerShell wrote 5,898,268 stdout and 5,898,240 stderr bytes, exited 0. Each bounded 4 MiB buffer reported truncatedBefore=true, baseOffset=1,703,964 stdout and 1,703,936 stderr, with per-stream cursor offset truthfulness. No crash.
- These are actual Gold MCP Windows x64 device E2E results, but they exercise the owner's *currently installed* client predating Windows descendant-tree source fix d72124e. Do not credit them as live evidence of that new fix.
- Linux Actions #275 and macOS Actions #235 completed SUCCESS for source d72124e. Windows Actions #437 is still in_progress at the latest observation; hosted stop/timeout/shutdown tree results are pending.
- No production, enrollment, updater or owner's installed source files changed by these tests.

## Hosted CI acceptance — source d72124e (2026-10-20)
- Windows [Actions #437](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39375307225) completed SUCCESS. Confirmed directly in Windows job log: G2_WINDOWS_PROCESS_TREE_STOP_NO_ORPHAN=PASS; G2_WINDOWS_PROCESS_TREE_TIMEOUT_NO_ORPHAN=PASS; G2_WINDOWS_PROCESS_TREE_SHUTDOWN_NO_ORPHAN=PASS.
- Full installer and compact installer installed/tested and then uninstalled successfully on hosted Windows. SHA-scoped artifact light-remote-windows-x64-d72124e082d1d0e056f15efada6d7a16227a849f (~328 MB GitHub artifact envelope) uploaded and not expired. This is hosted Windows evidence, NOT an owner-device patched-client test.
- Linux [Actions #275](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39375307385) SUCCESS and macOS [#235](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39375307406) SUCCESS for the same source. No production releases or updater channel changes.
- Remaining G2: owner installs updated Gold Windows UAT for real patched stop-tree acceptance; Windows natural parent exit leaving grandchildren (taskkill may no longer be able to identify them), macOS real owner device PTY, unexpected physical transport cut, missing onExit / resource-soak behavior. G2 stays IN PROGRESS.
