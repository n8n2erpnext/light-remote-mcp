# rc.50 P0-C — real orphan after Agent SIGKILL and DEV pre-spawn ordering gate

Date: 2026-10-16 Asia/Ho_Chi_Minh
Baseline SHA: `32ef323bc6099f8fa18819774a9be1489d2f9881`
Branch: `feature/rc50-mjs-scale-20261011`
Scope: disposable, local UAT only. No production Agent code modified, no production processes/sessions or user-owned state accessed.

## Threat actually reproduced

A remote command may spawn an independently living OS child, after which the Agent process can abruptly die before it has durably associated the child's PID/handle with the effect. Its next process-memory inventory is empty even while the child continues running. A signed `command finished`, signed missing-handle claim or empty registry is **not** evidence the child is gone; a writer cutover must refuse.

## Actual Linux process SIGKILL UAT

Two new files:
- `platform-v2/test/agent-effect-crash-worker.fixture.mjs`: a completely disposable Node worker opens the DEV crash-durable inventory, writes/fsyncs an `intent`, calls actual `NativeProcessRegistry.start` to create an **independent OS Node child**. The child is bounded to exit naturally within 12 seconds and carries a cryptographically random argument marker. The worker writes a test-only cleanup marker at mode 0600, fsyncs the marker and parent, then **kills its own PID with SIGKILL** (no graceful Agent shutdown). For the `after-link` case, it uses the new DEV pre-spawn gate to persist `spawned` first. For the `before-link` case, it crashes immediately after native spawn, before linking PID in durable inventory.
- `platform-v2/test/agent-orphan-after-sigkill.test.mjs`: runs worker in separate Linux process, confirms it died specifically from SIGKILL, confirms independent OS child still RUNNING by checking `/proc/<pid>/cmdline` and unique marker. Reads durable inventory in new process and asserts unresolved and owner lock retained. New inventory owner refuses start; newly empty native process registry refuses to sign an exit observation for lost handle. UAT cleans up **only its precisely marked child**; bounded child lifetime is a second protection. No known device/network/host PID is touched.

Both variants:
- `before-link`: inventory remains `intent` with no PID, even though a real child is alive; new owner is rejected. This is the **hardest crash gap** and denies even attempting side-effect re-execution.
- `after-link`: inventory remains `spawned` with linked PID/handle, even though in-memory Agent is gone; new owner is rejected. The mere known PID is not sufficient evidence of quiescence.

These test-only markers are never considered authoritative recovery data. The real product does not currently have this pre-spawn journal wired into its Agent binary. The tests do not assert that the prior Agent hardware lost power or that every possible descendant process is accounted for; they reproduce Linux SIGKILL exactly on an isolated worker.

## Executable DEV pre-spawn gate

`platform-v2/portability/dev-effect-pre-spawn-gate.mjs` exports `startDevTrackedAgentEffect` for **non-production** callers. It enforces:
1. Validate exact owner/account/device/session/agent matches between inventory intent and native spawn request BEFORE touching inventory or spawning.
2. `inventory.arm()` writes a fully durable pre-spawn intent or throws; on failure `registry.start()` is **never** called.
3. Only after durable arm, call `registry.start()` for process/terminal and record native PID+handle via `inventory.recordSpawn()`.
4. Failure/ambiguity at or after spawn keeps the intent unresolved. Return explicitly `settlementAuthorized:false`. There is no clear/setttle/remove API.

`platform-v2/test/dev-effect-pre-spawn-gate.test.mjs` tests wrong owner fails before durable write, fsync failure denies spawn, native spawn failure retains intent and refuses restart, and real native Linux Node child passes gate then exits while inventory remains unresolved. The disposable crash worker's after-link case uses this same gate.

## Remaining limitations

Still missing: genuine independently authorized WriterEpoch and global old-writer revocation, actual DEV gate integration into Agent executable (prior strict Agent launcher source edits remain blocked), crash-consistent boot/inventory provenance, all-descendants/exec/PTy/fs/scp/desktop effect coverage, durable cross-process replay detection, legitimate owner-approved journal reconciliation, signed agent quiescence/cutover certificate and full ARM64→HOMELAB x64 restore/rollback. An OS child might keep writing to other durable resources even after Agent dies. This deliberately fails closed rather than guessing.

P0-A/B/C/D/E all NOT_READY. No main merge or production deploy.
