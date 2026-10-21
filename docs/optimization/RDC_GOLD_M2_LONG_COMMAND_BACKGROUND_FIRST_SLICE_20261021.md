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
