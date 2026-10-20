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
