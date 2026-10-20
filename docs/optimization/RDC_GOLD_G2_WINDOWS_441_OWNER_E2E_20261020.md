# G2 — Owner Windows Gold #441 installed E2E acceptance (2026-10-20)

## Target, provenance, scope
- Owner confirmed installation of Gold Windows build #441, [Windows Actions run #441](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39384420309), source commit `b48ee1b8e2ca4a0668baf5a78cfdb60849a6cf67`.
- Official authorized Light Remote Gold plugin confirmed Windows x64 device online, session active. No remote upgrade, installer change, enrollment reset, service restart, production change or broad process cleanup was performed.
- Windows Local Wall `http://127.0.0.1:5491/login` returned HTTP 200, listener active. Installed `agent/lib/native-process.mjs` includes `LIGHT_REMOTE_MANAGED_PROCESS_HELPER` and `job-object-kill-on-close`.
- Source identity: installed Windows JS line endings normalized CRLF→LF **in memory only**; SHA-256 `75f0171da26f02bcbce5364ef1b00a6bc020a4d88eda25deb5ad4950f6c43fa4` equals **exact** `git show b48ee1b:lib/native-process.mjs | sha256sum`. New Gold HEAD differs because a later POSIX fix was merged, and must not be used as the #441 identity.

## Actual Windows RED→GREEN live tests
1. **Natural parent exit with descendant (prior real RED):** Owner-scoped Gold NativeProcess ran a PowerShell parent spawning a benign PowerShell child sleeping 100s, PID `10080`. Parent naturally exited with `state=finished`, `exitCode=0`, `treeContainment=job-object-kill-on-close`. Separate read-only `Get-CimInstance Win32_Process` found child **GONE**. No manual kill was needed. **PASS**.
2. **Stop(false) process tree:** A separate parent spawned child PID `8924`. Gold `stop_process(force=false)` recorded `stopRequested=true`, `stopForce=true` (Windows taskkill is forceful), `treeStopMethod=taskkill-tree`, containment `job-object-kill-on-close`. Parent ended `stopped`, exit code 1 as expected for forceful termination. Separate Windows PID check: child **GONE**. **PASS**.
3. **Timeout process tree:** Another parent spawned child PID `13192`; `timeoutMs=6500`. Registry returned `state=timeout`, `timedOut=true`, `stopForce=true`, `treeStopMethod=taskkill-tree`. Separate Windows PID check: child **GONE**. **PASS**.
4. **stdin/stdout/EOF/exit code:** Gold NativeProcess read one line from stdin and echoed the marker `GOLD_441_PIPE_OK`; after process_input(data + eof), output contained expected READY/ECHO/DONE, `stdinState=closed`, `state=finished`, `exitCode=0`. **PASS**.
5. **No leaked session resources:** Gold list_processes returned four finished/stopped/timeout fixtures with **0 active**, list_terminals returned **0 active**. **PASS**.

## Acceptance and remaining G plan
- **G2 Windows #441 natural parent exit + descendant containment = OWNER DEVICE PASS.** This advances beyond hosted Windows CI #441 evidence. Previously observed Windows orphan is no longer reproducible in the owner Gold test.
- Windows lifecycle smoke (natural exit, stop, timeout, stdin/stdout, bounded cleanup) passes; no uncontrolled children were left. These are short-lived functional acceptance tests, not multi-hour soak or physical cable/network loss tests.
- Windows CI #441 also verified nested job object and shutdown cleanup on hosted runner, but no owner machine shutdown/reboot was performed.
- **G2 stays IN PROGRESS**: unexpected physical network cut and reconnect, prolonged resource soak (G6 measurement), difficult PTY missing PID/onExit across process failure; **macOS owner-device E2E deliberately deferred by owner**.
- Gold branch now also contains separate POSIX natural-parent reaping commits `2178797` and related docs; this Windows checkpoint tests installed #441 only and does not alter Linux deployment.
- Production untouched. Preserve unrelated Gold UAT untracked files.
