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

## Owner-installed Gold Windows UAT real-device acceptance (2026-10-20)
- Owner confirmed installing the updated Gold Windows build #437. Official Gold helper resumed authorized Windows device DESKTOP-VA16D27 session from hold/agent_inactive to active; device online.
- Executing Local Wall GET /login returned HTTP 200; 127.0.0.1:5491 listener PID 5152 belongs to installed Light Remote MCP runtime/node.exe. This is a live Windows process, not CI fixture.
- Installed agent/lib/native-process.mjs contains taskkill-tree and treeStopMethod. Its raw Windows SHA differs from Unix source only because all 73 line endings were converted to CRLF. After CRLF→LF normalization in memory (NO write), Windows installed file SHA-256 = 002828fe3d10b3aa69298122f3841e6f60e71c88e69e68a2798b4f2b31498fbf, exactly matches Gold source SHA. Bundle version identity confirmed by content, not merely its name.
- LIVE STOP: Gold light_remote_process started a PowerShell parent with a child Start-Sleep 110, child PID 3800. Gold stop_process(force=false) reported state stopping, stopRequested=true, stopForce=true, treeStopMethod=taskkill-tree. Separate Get-CimInstance Win32_Process found G2_437_CHILD_GONE. Parent then reported stopped; nonzero exitCode=1 is expected for forced taskkill, not success status 0.
- LIVE TIMEOUT: independent parent+child process with timeoutMs=6500 emitted G2_437_TIMEOUT_CHILD_PID=10376. Gold process_output returned state=timeout, timedOut=true, treeStopMethod=taskkill-tree, stopForce=true. Separate Get-CimInstance found G2_437_TIMEOUT_CHILD_GONE. Both fixture descendants verified absent.
- Final Gold list_processes returned 2 finished entries, 0 active; list_terminals returned 0 active. A transient target_node_draining rejection occurred during the first bulk listing, but a helper status check confirmed session active/device online and repeat listing succeeded.
- **G2 installed Windows stop-tree and timeout-tree real-device acceptance = PASS.** No manual kill cleanup was needed, no unrelated processes were touched, and no installed files/services/enrollment/updater were modified during test.
- Boundaries still OPEN: parent exits *naturally* before child (taskkill cannot traverse an already vanished parent), PTY missing onExit, reconnect after abrupt physical transport cut, macOS live device validation, longer G6 soak/performance. Windows shutdown cleanup is supported by hosted #437 regression, but no reboot or service restart was performed on owner's PC. Do not prematurely close G2.
