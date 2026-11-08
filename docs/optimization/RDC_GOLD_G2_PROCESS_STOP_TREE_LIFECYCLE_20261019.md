# G2 NativeProcess Lifecycle — bounded stop and process-tree cleanup
Date: 2026-10-19 | Gold isolated LXD | Branch `feature/light-remote-gold-rebuild-20261018`
Starting source commit: `15af90a` (G5 SCP inline patch). **G2 still IN PROGRESS.** G1 unresolved refusals remain separate. Do not advance to G3 yet.

## Problem / evidence-first RED before fix
1. `NativeProcessRegistry.stop(force=false)` sent a single `SIGTERM` and returned immediately. A managed real Node child with a `SIGTERM` ignore-handler was **still running 520ms later**, with no escalation timer. Repro: `deploy/scripts/selftest-g2-process-stop-escalation.mjs` failed exit 1 (red), printed `G2_GRACEFUL_STOP_IGNORED_TERM_STATE=running`. Fixture explicitly cleaned up with force kill.
2. Managed POSIX shell process used `bash -lc` with a child `sleep 30`. Stopping its shell (process parent) left `sleep` **alive**, RED: `G2_TREE_PARENT=stopped CHILD_ALIVE=true` in `deploy/scripts/selftest-g2-process-child-tree.mjs`. Fixture cleaned up the child PID explicitly. This reproduced an orphan after interrupted wait, independent of SCP progress or upstream safety refusals.

## Minimal fix in `lib/native-process.mjs`
- Add bounded `stopGraceMs` (default 750ms, clamp 50–5000). Normal stop requests signal SIGTERM, sets `state=stopping` and `stopRequested=true`; if still active after the grace, sends SIGKILL and marks `stopForce=true`. Real child `exit` remains authoritative for `finishedAt`, `signal` and final `state=stopped`; no falsely completed job on mere stop request.
- POSIX (Linux/macOS) native process spawn uses `detached:true` to place job into its own process group. SIGTERM/SIGKILL on stop and timeout target `-processGroupId` so shell and ordinary subprocess descendants are signaled together. Group escalation may still run after the leader exits, because descendants might otherwise survive; no new command endpoint, capability relaxation or PTY bypass. Windows uses prior child.kill semantics unchanged (no process-group claim).
- Keep bounded buffer, stdin EPIPE fix, timeout metadata, ownership checks, process IDs and protocol compatibility. `view()` adds `processGroupId`, `stopRequested`, `stopForce` for observability. No new state persistence; no JSON/SQLite business state.
- Known limitations: spawned descendants which create independent sessions/groups can escape a process-group signal; this does not assert OS-wide containment. Windows descendant-tree termination remains unverified and needs separate bounded solution/test, not inference from Linux.

## Automated acceptance
- RED stop ignored SIGTERM exit 1 -> GREEN `G2_GRACEFUL_STOP_ESCALATES_TO_SIGKILL=PASS`.
- RED shell-child orphan exit 1 -> GREEN `G2_PROCESS_CHILD_TREE_STOP=PASS`.
- New `deploy/scripts/selftest-g2-lifecycle-edge-cases.mjs`: invalid binary spawn returns typed `error/127`, >512KiB stdout produces bounded ring `truncatedBefore/baseOffset`, owner isolation, timeout of process ignoring SIGTERM yields `state=timeout` after SIGKILL, PTY hard-TTL and terminal owner isolation: all PASS.
- Existing `selftest-v10-native-process.mjs`, `selftest-g2-process-stdin-epipe.mjs`, `selftest-g2-process-output-drain.mjs` (6/6 x1MiB), and `selftest-v10-native-terminal.mjs`: PASS; `node --check` and `git diff --check` PASS.

## Gold deployment and live MCP acceptance
- Deployed **only** `lib/native-process.mjs` to isolated `light-remote-gold-uat/opt/light-remote-gold-uat`, preserved `gold-uat:gold-uat` ownership. Source/Gold file SHA-256 match. Restarted only Gold Operator and Gold Local Wall (Agent process).
- 5/5 Gold services PostgreSQL/Redis/Operator/Plugin/Wall active. NetBird Gold Wall 303 auth, Gold Preview account 200, production 200. No public production service or production Wall changed.
- Official Gold MCP live start `bash` job with child `sleep`, read `G2_PROCESS_TREE_CHILD` output, `light_remote_stop_process(force=false)` -> `stopping`; subsequent `process_output` reported `stopped`, and read-only `/proc/<child>/stat` check showed child **gone**.
- Official Gold MCP live Node ignored SIGTERM after printing readiness; stop(force=false) initially `stopping`, later `process_output` reported **`state=stopped, stopRequested=true, stopForce=true, signal=SIGKILL`**. This proves bounded escalation after restart, not just local unit.
- All test commands were benign, isolated Gold process operations; no permission boundary bypass, no production edits.

## Remaining G2 acceptance before G3
1. **Windows/macOS actual runtime tests**: invalid executable, stop, timeout, PTY resize/signal and natural exit / ConPTY handle release, accounting for platform behavior. The existing shell adapters' unit tests are NOT live Windows/macOS acceptance. Windows descendant/orphan control remains a known gap.
2. Slow stdout/stderr consumer, process cancellation during reconnect, orphan after interrupted waiting/capacity pressure, stop/restart state reconciliation, bounded memory/process count; compare p50/p95 and RSS in later G6, do not invent metrics.
3. PTY hard-stop missing event and group/terminal cleanup, integration with Agent/Wall actual PTY viewer still need targeted longer regressions.
4. G1 unknown pre-dispatch refusals remain `UNRESOLVED` and **must not** be treated as native process policy failures or routed through PTY.
5. Gold source must be committed/pushed with checkpoint; verify branch/worktree before moving on. Preserve unrelated untracked `deploy/gold-uat/` and UAT helper scripts.

## Rollback
Restore the previous `lib/native-process.mjs` file from earlier Gold commit, copy just that file into the Gold LXD, restart Gold Operator and Gold Wall, recheck 5/5 service health. Do not touch public production.
