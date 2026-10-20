# Gold G2 — Windows managed process per-job containment candidate
Date: 2026-10-20 | Branch: feature/light-remote-gold-rebuild-20261018 | G2 IN PROGRESS

## RCA and proven RED
- Real Gold Windows managed PowerShell parent exited naturally with code 0; its marked child PID 10376 was still alive afterward. Guarded fixture cleanup was successful. `taskkill /T` on a stopped/nonexistent parent is not reliable ownership of descendants.
- Installed AgentHost already uses CreateKillOnCloseJob() and AssignProcessToJobObject() for the whole Agent tree, but that job lasts as long as AgentHost, not per NativeProcess job.

## Candidate implementation, NOT yet live owner-device acceptance
- New `client/windows-native/GptOperator.Client/ManagedProcessEnvelope.cs` adds a private `--managed-process` invocation to existing native client WinExe; no extra downloaded binary, separate service, or elevated token.
- Windows helper uses CreateProcessW with CREATE_SUSPENDED, inheritable standard IO handles and CREATE_NO_WINDOW; immediately assigns the suspended child to a dedicated KILL_ON_JOB_CLOSE Job Object using the existing native AgentHost Win32 interop; resumes, waits for true child exit code, then closes the Job Object, terminating remaining descendants even if shell exited naturally.
- Fails closed on CreateProcess / job attach / resume errors. A child started but not successfully attached to a Job Object is terminated; never left suspended/unmanaged. Child stdin/stdout/stderr inherit Agent pipes. Existing script capability checks and owner scopes are unchanged.
- `AgentHost.CreateStartInfo()` passes an in-package absolute helper path via `LIGHT_REMOTE_MANAGED_PROCESS_HELPER` only to its own authorized Agent child. `NativeProcessRegistry.start()` wraps Windows child launch only when that trusted process-level env var exists; otherwise preserves existing direct behavior. View metadata `treeContainment=job-object-kill-on-close` vs `none` / `posix-process-group` makes fallback explicit.
- Existing stop/timeout/Agent close still use the constrained registry-owned PID and taskkill-tree on Windows, and the Job Object handle closes if the helper is forcibly terminated. This candidate does not change PTY/ConPTY or the native command policy.
- New `deploy/scripts/selftest-g2-windows-job-object-natural-exit.mjs`: real Node parent creates real Node descendant then exits naturally, confirms stdout, exit code 0, and descendant death. The same test runs nested inside an outer helper-managed Job Object to model AgentHost -> per-job nested Job Object.
- Windows Gold CI adds staged native helper env, new natural-exit test, and existing Windows stop/timeout/shutdown tree regressions. A fail blocks artifact. The helper WinExe must have inherited piped standard handles on Windows: only Windows CI can verify this; Linux reports the test skipped.

## Acceptance boundaries
- Existing completed CI #438 (`1dbf630`) proved PTY no-onExit PID reconciliation 3/3 PASS on Windows runner. Linux x64/arm64 CI #276 also PASS. None of that proves new Job Object helper candidate.
- New helper source has passed Linux static JS syntax and legacy Linux native process regressions, but requires actual Windows .NET compilation and hosted tests before acceptance. Do NOT install helper on owner's Windows prior to green CI, independent review, and owner approval.
- Real installed Windows E2E must repeat natural-parent-exit and stop/timeout with no orphan; verify absolute helper path, nested job compatibility, stdin/stdout forwarding, bounded memory/latency. G6 will measure wrapper overhead.
- macOS real-device E2E deferred by owner. Abrupt physical network cut remains out of scope of controlled session hold/reconnect tests. Production unaffected and G2 remains OPEN.
