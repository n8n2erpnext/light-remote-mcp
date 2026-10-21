# Gold M5 — Independent Process Supervisor for Agent Restart (2026-10-21)

**Scope:** first Linux/Unix Supervisor slice, feature-flagged and **OFF by default**. Builds on [M2 real download overlap and cancellation](./RDC_GOLD_M2_LONG_COMMAND_BACKGROUND_FIRST_SLICE_20261021.md) and [M5 Owner Processes Local Wall](./RDC_GOLD_M5_OWNER_PROCESS_WALL_20261021.md). This is **Agent-restart continuity**, NOT general machine-reboot persistence or durable background execution across Supervisor restart. It is not a Pro/Team multi-Agent scheduler.

## Architectural reason

Previously `NativeProcessRegistry` lived inside `device-agent/operator-agent.mjs`; its shutdown `close()` deliberately kills children. Process metadata in PostgreSQL alone would not save an executing curl/build when that Agent is restarted. Separating an IPC endpoint without separating the OS service/cgroup is also insufficient: systemd may kill all children in the same service cgroup.

## Code implementation

- `device-agent/process-supervisor.mjs`: standalone **separately managed OS service**, owns its own `NativeProcessRegistry` (bounded to 16 active process by default), process stdout/stderr ring, process tree and deadline. Binds a **Unix domain socket** in a preexisting user-owned `0700` runtime directory; Unix socket and opaque random-token file are `0600` and owner-checked. It accepts a small bounded JSON request, authenticated by token and device enrollment identity read from its local state file, not caller-supplied account claims. Rejects cross-owner process calls and invalid operations; local adapter enforces hard deny and currently approved capabilities again before each start. `list-device` is an explicit owner-device local Wall route that never returns command scripts.
- `device-agent/process-supervisor-client.mjs`: Unix-socket transport with finite request/response size and timeout. When Supervisor mode is enabled and socket unavailable, **fail closed** with an error. No silent re-launch under Agent's legacy registry, which could duplicate a command.
- `device-agent/operator-agent.mjs`: only if `LIGHT_REMOTE_PROCESS_SUPERVISOR_SOCKET` and `LIGHT_REMOTE_PROCESS_SUPERVISOR_TOKEN_FILE` are provided on supported POSIX platform, device Agent delegates managed process start/input/output/stop/list to the independent Supervisor *after* existing per-Agent approved device/session capability and shell hard-deny logic. The Agent's other unmodified native/PTY/desktop paths retain current behavior. The owner Local Wall's actual Process Manager may inspect/stop the same Supervisor registry on the device; wall-only companion without shared callback is not falsely shown as active.
- `operationId` follows the launch into Supervisor. Owner/session/Agent-scoped hash replay returns the **same existing processId** after lost ACK; same operationId with different script/cwd/timeout/shell receives `operation_id_conflict` (409). Capacity bounded and guarded; registry owner policy remains strict.
- `client/core-files.json` includes both new source modules; package source/target SHA parity retained. Existing Windows clients untouched: Supervisor opt-in is not enabled on Windows.

## Verified source checks

- `selftest-gold-m5-process-supervisor-agent-restart.mjs` launches a **standalone Supervisor child OS process** in a private temp runtime directory; a separate first Node Agent-client OS process launches `sleep 25` then exits, a second client reconstructs from the socket and sees that *same OS PID/processId still running*. Replay of same `operationId` returns same processId; mismatched replay rejects; foreign Agent stop and wrong owner device reject; wrong 256-bit token returns unauthorized; stop confirms actual OS process `stopped`. Owner fixture state and socket/token perms are audited; all child processes/temp files cleaned.
- Source/CI smoke: packaged client-core **84** files (up from 82), `stage-client-core --verify` parity PASS, `selftest-packaged-local-wall.mjs` PASS, previous M2 downloader classifier and M5 Local Wall HTTP/CSRF/real child stop fixtures PASS.
- CI and physical LXD acceptance to be appended with exact SHA/run IDs after the source is pushed, not assumed.

## Secure Gold UAT service rollout requirements

1. Install the supervisor in **a separate systemd unit/cgroup**, `User=gold-uat`, `Group=gold-uat`, `RuntimeDirectory` at `0700`, socket/token only under that path, `NoNewPrivileges=yes`, normal process limits, no new network listeners or privileged credentials. It must **not** be `PartOf=light-remote-gold-wall.service` or tied to Operator restart.
2. Start/check Supervisor before adding the socket/token environment override to the Gold UAT Wall Agent. Verify actual Agent process environment, live operator ↔ leaf readiness, and ability to run concurrent independent exec during supervised download.
3. Run a **bounded real process** in a shared owner workspace, restart **only Agent Wall service**, then reconnect and confirm the same `processId` and OS PID keep executing and are stop/readable. Confirm no duplicate launch, and no active/queued/in-flight leftovers after cleanup.
4. LXD services use `PrivateTmp=yes`; different systemd units can see **different** private `/tmp` mounts. Use shared explicitly authorized owner workspace for this UAT, not `/tmp`, and do not claim filesystem namespace equivalence for future users until solved. This is a release gate, not a reason to disable the existing sandbox without separate approval.
5. Persist target / flags only on isolated Gold UAT with verified candidate source/systemd/PG backup and rollback. Never restart production or install Windows/macOS clients by this task.

## Remaining requirements

- Windows Supervisor service / Job Object ownership and **actual graceful cancellation** (currently `taskkill /T /F` even for force:false), macOS independent service lifecycle, installer upgrades and authenticated local transport for each OS.
- Resume/status after Supervisor service crash/restart or machine reboot; persistent structured job/attempt snapshots and safe UNKNOWN outcome reconciliation (not merely reading a stale PID), process output durable storage and exactly-once lease fencing.
- Resource and worker accounting per device/Team, user-controlled cancel from Fleet Wall, Live Job Manager, Free1/Pro3/Team5 active Agent scheduler, Team owner-billed call quota implementation. Team cross-account execution remains disabled.
