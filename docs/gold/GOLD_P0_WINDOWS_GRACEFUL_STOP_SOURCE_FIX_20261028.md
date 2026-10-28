# Gold P0 Windows graceful Stop — source fix and release boundary

## Observed P0 bug
- Physical Win10 and Win11 `light_remote_stop_process(force:false)` returned `stopForce:true`, `treeStopMethod:taskkill-tree`: `NativeProcessRegistry._signal` always passed `/PID <PID> /T /F`, even for requested SIGTERM.
- The existing Windows process-tree selftest encoded immediate force as its expected result. Linux POSIX graceful + timed escalation tests passed.

## Corrective source behavior
- `NativeProcessRegistry._signal` now requests local Windows `taskkill.exe /PID <owned PID> /T` without `/F` for first graceful attempt; no unsafe standalone parent `child.kill('SIGTERM')` fallback on Windows.
- If the process has not finished in the Windows-specific 3-second grace window, request `taskkill.exe /PID <same owned PID> /T /F`; `stopForce` becomes true only when a forced method was successfully issued.
- If the initial non-forced request is unavailable, keep `stopping` and escalate on the bounded deadline, with a clear diagnostic event. If even `/F` cannot be confirmed, **do not kill the parent alone** unless the original job is owned by the trusted Job Object wrapper; emit `process_tree_stop_force_unverified`/escalation failure, retaining uncertainty.
- Original owner scoping, process ID validation, Windows job containment, POSIX SIGTERM->SIGKILL, and 3 historical PG resource claims remain unchanged.
- Updated `selftest-g2-windows-process-tree.mjs` checks initial `stopForce:false`, eventual descendant termination and truthful result; new `selftest-gold-windows-graceful-stop-contract.mjs` asserts no `/F` in first request, bounded escalation and parent-only fallback rejection. Added to Windows-native CI.

## Evidence and outstanding gates
- Source on isolated Gold branch. Linux test suite `selftest-gold-windows-graceful-stop-contract`, `selftest-g2-process-stop-escalation`, `selftest-g2-process-child-tree`, Gold Job Control and Durable ACK PASS.
- **Real Windows native CI and physical installed Win10/Win11 with the new module are NOT yet PASS until verified.** Gold UAT runtime remains 4/4 `c0c6977`; installed clients unchanged. Do not claim physical graceful control from old client.
- Pro Team real independent A/B and historical owner-claim release explicitly HOLD at owner's request. A/B V2 deferred.
