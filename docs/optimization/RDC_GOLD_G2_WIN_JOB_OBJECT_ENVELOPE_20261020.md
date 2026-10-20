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

## Hosted CI iteration notes (2026-10-20)
- Initial Gold Windows Actions #439 failed at a C# compile error `CS0819` in the new helper (`var created = false, assigned = false;`), fixed to `bool created = false, assigned = false;` in `b51922d`.
- Hosted Windows #440 successfully compiled the native helper, but the natural-exit test fixture failed because its Node parent retained a child handle without `.unref()`; this was a fixture error, not established Job Object failure. A follow-up Gold commit `06aed22` added child `.unref()` so the parent can actually exit naturally.
- Latest branch commit `b48ee1b` ensures Windows CI executes the natural-exit fixture; [Windows Actions #441](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39384420309) has completed `Publish native tray client` and `Native client bundled runtime smoke` with SUCCESS. These stages include tests for natural parent exit, nested Job Objects, stdin/stdout forwarding and prior stop/timeout/shutdown; final installer workflow and artifact were still in progress at this observation. Do not claim full CI SUCCESS until final status is confirmed.
- There has been **no** installation of this candidate on the owner's Windows device or any production update. The owner can continue using prior Gold #437 until the new artifact is proven.

## Gold CI iteration evidence
- Windows #439 on 44ca89a **FAILED at C# compilation**: `ManagedProcessEnvelope.cs(121,9) error CS0819` from `var created=false, assigned=false`; corrected with explicit `bool` in commit b51922d.
- Windows #440 on b51922d built native helper but **FAILED at the new natural-exit regression**: fixture Node parent still referenced its child. The test was not yet modeling a naturally exiting parent. Changed fixture to `c.unref()` in commit 06aed22; did not reinterpret #440 as product validation.
- Source-only fixture change did not trigger Windows workflow because existing `paths` filtered out the regression. Commit b48ee1b added both Windows G2 regression paths to Windows workflow triggers. Windows [#441](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39384420309) was correctly triggered, native publish and full bundled runtime smoke **SUCCESS**. Full installer built; compact / install tests pending at time of initial observation. No installed owner client modifications.
- The new fixture additionally verifies stdin EOF, stdout and exit code, and nested helper composition. `#441` bundled runtime smoke success is hosted Windows evidence. Final artifact and owner-installed real Windows E2E are separate gates.

## Final hosted Windows CI verdict — commit b48ee1b
- Windows Tray Client [Actions #441](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39384420309) completed **SUCCESS** at SHA `b48ee1b8e2ca4a0668baf5a78cfdb60849a6cf67`.
- Read complete job log (202,676 bytes) and individually verified 7/7 PASS: `G2_WINDOWS_JOB_OBJECT_NATURAL_PARENT_EXIT_NO_ORPHAN`, `G2_WINDOWS_JOB_OBJECT_STDOUT_AND_EXIT_CODE`, `G2_WINDOWS_JOB_OBJECT_STDIN_STDOUT_PASSTHROUGH`, `G2_WINDOWS_JOB_OBJECT_NESTED_AGENT_HOST_COMPAT`, `G2_WINDOWS_PROCESS_TREE_STOP_NO_ORPHAN`, `G2_WINDOWS_PROCESS_TREE_TIMEOUT_NO_ORPHAN`, and `G2_WINDOWS_PROCESS_TREE_SHUTDOWN_NO_ORPHAN`.
- Full installer build/install/self-test/rollback/uninstall and compact installer build/install/cache verification/uninstall all completed PASS. SHA-scoped artifact `light-remote-windows-x64-b48ee1b8e2ca4a0668baf5a78cfdb60849a6cf67` uploaded (328,170,570 bytes), not expired.
- This resolves the natural-parent-exit orphan **in hosted Windows CI**, not yet on the owner's installed Gold Windows runtime. No automatic installation, production release, updater-channel modification or reboot was performed.
- macOS owner-device E2E remains explicitly deferred. G2 remaining work includes installed Windows #441 acceptance, abrupt physical transport interruption/reconnect, resource/exit handling on actual devices and any follow-on failures. Do not close G2 on hosted CI alone.

## CI acceptance — Windows #441 SUCCESS, 2026-10-20
- Gold final candidate code commit `b51922d`; test fixture correctly unrefs naturally spawned child in `06aed22`; CI trigger path filter fixed in `b48ee1b`. This is one functional code candidate with subsequent regression/trigger corrections; no production merge or release.
- [Windows Actions #441](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39384420309) **completed SUCCESS**, source `b48ee1b8e2ca4a0668baf5a78cfdb60849a6cf67`.
- Read real hosted Windows job logs and confirmed **all PASS**: `G2_WINDOWS_JOB_OBJECT_NATURAL_PARENT_EXIT_NO_ORPHAN`, `G2_WINDOWS_JOB_OBJECT_STDOUT_AND_EXIT_CODE`, `G2_WINDOWS_JOB_OBJECT_STDIN_STDOUT_PASSTHROUGH`, `G2_WINDOWS_JOB_OBJECT_NESTED_AGENT_HOST_COMPAT`, `G2_WINDOWS_PROCESS_TREE_STOP_NO_ORPHAN`, `G2_WINDOWS_PROCESS_TREE_TIMEOUT_NO_ORPHAN`, `G2_WINDOWS_PROCESS_TREE_SHUTDOWN_NO_ORPHAN`, and `G2_PTY_LOST_ONEXIT_NATURAL_PID_RECONCILED`.
- Native publish, bundled runtime, package tests, full installer build/canary install/updater/rollback/uninstall, compact build/canary install/uninstall, hash and artifact upload all completed successfully.
- Downloadable GitHub Actions artifact (not production release): `light-remote-windows-x64-b48ee1b8e2ca4a0668baf5a78cfdb60849a6cf67`, 328170570-byte artifact envelope; GitHub artifact id 12247725131, not expired at check.
- **Owner Windows still runs previous #437 client** at last verified owner-device acceptance; #441 has NOT been installed on the owner machine. New per-job natural-parent-exit orphan bug is **CI PASS / owner-device E2E PENDING**. Do not claim G2 CLOSED, do not upgrade/overwrite owner client without explicit approval.
- Linux #278 on b51922d SUCCESS; macOS physical owner-device E2E explicitly deferred by owner. G1 intermittent provider rejections remain separate.
