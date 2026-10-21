# Gold M2 — long-running shell auto-background, first code slice

**Date:** 2026-10-21. **Scope:** code+test / Gold UAT opt-in for **ordinary Internet curl/wget downloads and long build commands**, not Light SCP. Part of [Gold Multi-Agent master plan](./RDC_GOLD_MULTI_AGENT_JOB_SCHEDULER_MASTER_PLAN_20261021.md) and [prior real Windows curl #464 evidence](./RDC_GOLD_MULTI_AGENT_EXISTING_LIMITS_BASELINE_20261021.md).

## Rationale / real baseline
On older Windows Agent Gold rc.49, real `curl.exe` downloading official GitHub Windows build #464 through normal `exec` caused `target_node_draining` for even unrelated `exec` and `process` while it was running. Same real Internet download via existing `light_remote_process` admitted a second `exec` successfully. Linux Gold Agent signed-pulse fix eliminates false drain but still serializes long `exec` behind the command poll loop.

## Implementation (Gold opt-in, compatibility)
- `operator-host/long-running-exec-policy.mjs` implements conservative, advisory **command boundary hints** for:
  - **Internet downloading** `curl`, `curl.exe`, `wget`, `wget.exe`, `aria2c`, `axel`, `rclone`, `azcopy`, `bitsadmin`, PowerShell `Invoke-WebRequest` / `Invoke-RestMethod` / `iwr` / `irm` / `Start-BitsTransfer`.
  - **Source fetching** `git clone/fetch/pull/lfs pull/submodule update`.
  - **Package/dependency activity** `npm/pnpm/yarn/bun install/ci`, pip, Python pip/build, uv/poetry, apt/dnf/yum/apk/pacman, winget/choco/brew and similar.
  - **Build/test** `npm/pnpm/yarn/bun run build/test/dev/watch`, `dotnet`, `cargo`, `go`, `make`, `ninja`, `cmake --build`, `gradle/gradlew`, `mvn`, `docker/podman build/pull/push/compose build/up`, pytest/ctest.
  - **Large transfer/media/archives and persistent streams** `rsync/scp/sftp/robocopy/pg_dump/pg_restore/tar/7z/ffmpeg`, `docker logs -f`, `tail -f`, etc.
- `executionMode=auto|foreground|background` added to official `light_remote_exec` MCP schema and adapter. When `OPERATOR_MANAGED_LONG_EXEC=1`, `auto` selects background for recognized shell commands; `foreground` retains synchronous behavior; `background` explicitly detaches **any allowed command** including unknown long scripts. Non-opted environments always remain foreground by default and reject explicit background as `exec_background_not_enabled`.
- For a selected background command, Operator **validates the full normal exec route and capability policy first**, then launches via the existing G4-reserved `startProcessOperation`, which forwards a short process-start command to the device. This reuses the signed device channel, NativeProcessRegistry's **per-Agent owner scope**, process tree containment, buffer quotas, max 16 simultaneous managed processes (default), input/output/list/stop tools and OS-local hard-deny.
- The signed poll/duplex long-command lane is released after **process launch acknowledgement**. Users must get `data.processId` / `data.process.processId`, read using `light_remote_process_output`, and request cancel using `light_remote_stop_process`. The Operator `jobId` is the **durable launch receipt only** (`jobRole='process_launch'`), **NOT** an assertion that the background command has completed. For a foreground exec, existing `jobId` continues to represent command completion.
- A completed successful launch additionally returns `data.executionMode='background'`, `data.lifecycle='managed_process'`, `data.commandState`, `data.processId`, `data.launchJobId`. The existing process status reports true ongoing/completed work and actual exit.
- **Security is not relaxed.** A forbidden PowerShell `-EncodedCommand`, missing OS capability, lack of A/B grant, unsafe path or foreign Agent access must still fail under original policies. Heuristics are **not** authorization and can have false negatives/positives; use explicit mode. Unsupported shell grammars cannot be parsed perfectly.
- The background process registry is **in memory** on the device and `close()` stops child processes on Agent shutdown. Automatic restarts/resume, PostgreSQL-recorded full execution lifecycle, proactive progress percentage, owner Wall job list/cancel and Free/Pro Agent execution scheduler are separately outstanding M3–M6; do **not** claim durable background task or completed Multi-Agent support now.
- Pro Team `crossAccountExecutionEnabled=false`; all Team seats, billing, quotas and entitlement remain untouched. The user-approved free/pro session limits from M3 are independent.
- Opt-in flag controlled on Operator **only**; new schema optional, remains backward compatible with older plugin clients, older Windows/macOS/Linux agents need no M2 code change because `process` already works.

## Minimum bounded evidence and release gate
1. Unit: detector groups including `curl/wget/Invoke-WebRequest/git/npm/build`; no `echo curl` false positive, explicit mode and opt-in guards. CI in Gold G3 Operator regression.
2. CI: full Gold Operator regression / Windows and macOS build jobs for same commit. Gold LXD candidate must stage from immutable SHA with rollback verified before switching.
3. Real Gold MCP: `light_remote_exec` using `curl` or `wget` creates a managed process with nonempty `processId`, leaves node not draining; another unrelated `exec` completes **while first is still running**; `light_remote_process_output` reports stdout/actual state; `light_remote_stop_process` terminates only own process. Use controlled, bounded downloads (rate/timeout), clean partial file; test `foreground` still stays foreground with flag; `auto` for short script remains unchanged.
4. At least one Windows owner **physical** test using official build #464 download on installed old Agent to prove Operator-side remap solves false drain, **without installing another client**; do not claim completed if not performed.
5. Do not claim Team 5 agents, Pro 3 agent scheduler, or restarted-durable jobs until separately accepted. Production unchanged.

## Checkpoint updates
- On success append exact SHA, OS/device, CI ids, elapsed/timeouts and outcomes to this document and `RDC_HANDOFF_CURRENT.md`.
- Unrelated worktree UAT files must remain untouched. No broad load tests or changes to production deployment.

## Real installed Gold acceptance — completed, 2026-10-21

### Commits / CI / deployment
- `b905c3eb7a6ba02bc6784b724c9e4bc922e21331`: M2 long-command hints, Operator `exec(auto|foreground|background)` to owned NativeProcess start, MCP schema/helper changes and classifier regressions.
- During first Gold physical curl UAT we identified a **real response gap**: `/v1/execute` returned launch success but did **not** expose `data.processId`; process could only be found through list. Patched with `9d7f0ec66541d121c6f7d0866de2c30913fa3fc0`: `/v1/execute` now includes `data:job.resultData` as other device-access execute endpoints already did. Repro and correction verified by the official Gold MCP plugin on real leaf devices.
- Original M2 branch CI: Gold Operator [39595467915](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39595467915) all 6 jobs SUCCESS; Windows [39595468171](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39595468171) SUCCESS; macOS x64/arm64 [39595467818](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39595467818) both SUCCESS.
- Fix commit Gold Operator CI [39596271824](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39596271824) **all 6 jobs SUCCESS**. Source staged from verified git archive in immutable LXD path; package-lock parity PASS; **per-commit** guarded backup of source/systemd/local state and PostgreSQL dump verified; `G3_GOLD_CUTOVER_NO_ACTIVE_JOBS=PASS`; prior override snapshot PASS; final source `9d7f0ec` cutover with strict executor admission ON and **10 consecutive healthy samples** PASS.
- The UAT systemd flag `OPERATOR_MANAGED_LONG_EXEC=1` is enabled via isolated operator-only `97-m2-managed-long-exec.conf`; preexisting `OPERATOR_SCOPED_SESSION_LIMITS=1` remains ON. **Production and owner client binaries not modified**, Pro Team cross-account remains disabled.

### Real Internet curl — Linux Gold UAT (PASS)
- Gold MCP `light_remote_exec(auto)` launched *actual* `curl -fsSL --limit-rate 16k --max-time 50 ... https://speed.cloudflare.com/__down?bytes=4194304`; returned `data.executionMode=background`, `data.lifecycle=managed_process`, `data.processId=lp_daIoAlnkk0Tjqk1vYg91-q4u`, `data.commandState=running`, `launchJobId=0803fd72-4354-43b9-97c9-732612710d00`, initial launch exit 0. This does NOT assert completed transfer.
- Verified process `running` before a separate ordinary short `exec`, `M2_CONCURRENT_EXEC_DURING_REAL_CURL=PASS` exited 0, then verified the same curl process **still `running`**. No false drain.
- Owner-scope `stop_process(force:false)` requested, process confirmed `stopped`; the controlled partial received **495,616 bytes**, deleted afterward.

### Real Internet wget — Linux Gold UAT (PASS)
- Gold MCP `light_remote_exec(auto)` launched actual `wget --quiet --limit-rate=16k --timeout=15 --tries=1 -O ... https://speed.cloudflare.com/__down?bytes=4194304`, returning `data.processId=lp_U8QEVS5lLcedvkewnauWR4Uu`, `data.executionMode=background`, launch exit 0.
- Process **running** before and after another short `exec` with `M2_CONCURRENT_EXEC_DURING_REAL_WGET=PASS`, exit 0. Stop requested, verified `stopped`; test partial **544,448 bytes**, deleted. No unrelated job touched.

### Real build #464 curl — Windows owner DESKTOP-VA16D27 (PASS)
- Same official `Windows Tray Client build #464` GitHub Actions [run 39580015765](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39580015765), artifact ID `12336506021`. Ephemeral signed archive download URL obtained through GitHub integration. **No installer run.**
- On preexisting **Gold rc.49 `6729f5d`** Windows Agent, PowerShell `curl.exe --limit-rate 96k --max-time 45 ...` with Gold `exec(auto)` returned `data.processId=lp_7v4cgUd40cIqtXS7QPJJwYxJ`, `executionMode=background`, `commandState=running`, launch receipt exit 0. Signed URL omitted to avoid credential disclosure.
- While download remained `running`: independent PowerShell exec printed `M2_WINDOWS_SECOND_EXEC_DURING_BUILD464_CURL=PASS` and exited 0. Re-checked same process **still running** afterward. The **previously reproduced `target_node_draining` denial did NOT occur** on the new Operator-side auto-managed route.
- Requested `stop_process(force:false)`, confirmed `stopped`; actual Windows `treeStopMethod=taskkill-tree`, `stopForce=true` **even though force=false**. This is an existing M5 cancellation semantics defect, not a graceful-cancel success. Partial artifact **3,293,184 bytes** deleted. Client version unchanged.

### Final cleanup/health
- All owned curl/wget and Windows build #464 managed processes were verified `stopped`; both new Gold MCP sessions closed; no active process test remains. Linux and Windows test partial files deleted. Final Fleet 2/2 leaves `fresh=true`, `executorReady=true`, `draining=false`, `queued=0`, `inFlight=0`, `activeSessions=0`; strict readiness ON. Gold Operator/Plugin/Wall/PostgreSQL/Redis 5/5 active, both opt-in flags ON.
- **Scope closure:** M2 **first slice physical end-to-end acceptance PASS** for curl/wget and background launch/stop on Windows/Linux, including build #464 Internet artifact. **NOT FINISHED:** independent restart-durable Supervisor, true graceful Windows cancel, owner Wall progress/controls, real 1/3/5 multi-Agent admission, per-project resource locks and real Team member cross-account/billing. The `jobId` confirms launch, not command completion; use `processId` for status/output/stop.
