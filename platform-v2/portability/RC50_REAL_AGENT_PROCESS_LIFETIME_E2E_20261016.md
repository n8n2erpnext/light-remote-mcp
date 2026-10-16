# rc.50 P0-C — real executable Agent process-lifetime E2E (isolated ARM64 UAT)

Date: 2026-10-16 Asia/Ho_Chi_Minh
Parent baseline: `0dda4c7a4121e369a5c32714bec30e44add7d5c8`
Branch: `feature/rc50-mjs-scale-20261011`
Scope: real Operator executable AND real Agent executable (not Agent emulator), both private localhost UAT children on VPS-ARM. Not production and not a two-host cutover.

## Why this matters

The previous signed HTTP test used a fake Agent which signed an `ok` result but never executed an actual OS command. Real `device-agent/operator-agent.mjs` processes `process.start` by spawning an independently living child through `NativeProcessRegistry`; the Agent's `command spool` becomes `finished` and it emits an authenticated completion result **while the spawned process can still be active**. That is the precise false-quiescence hazard for remote migration, and until now it was demonstrated only indirectly.

## Executable UAT evidence

New `platform-v2/test/operator-real-agent-process-wal-e2e.test.mjs` starts:
- Real `operator-host/executor.mjs` with explicitly opt-in DEV freeze plus a pre-provisioned, private, 0600 durable Fleet remote-effect WAL.
- Real `device-agent/operator-agent.mjs daemon` with wholly synthetic, private `device.json`, temp Ed25519 identity, private command spool, temp local Wall port and no updater. No real user device credentials/state are read.
- A loopback-only `127.0.0.1` transient HTTP bridge which **only** proxies authenticated `poll`, `result`, `fleet-intent`, `update-report` to the disposable Operator's Unix socket; there is no external hub or Internet side-effect.

Flow tested:
1. Actual Operator enrollment/approval and signed Agent connection, then Agent daemon's automatic signed poll.
2. Real sealed `/v1/process` operation with `process.start` executing **only** an isolated, harmless `exec /bin/sleep 12` in the private UAT directory. A real OS process is spawned and its PID/NativeProcessRegistry handle are returned.
3. The actual Agent signs a command result, Operator verifies and accepts it. The actual Agent spool `cmd_*.json` now records `state:'finished'`, while a SECOND signed real Agent `process.list` still reports the same OS child with `finishedAt:null`.
4. A THIRD signed real Agent `process.stop(force=true)` terminates the isolated process; a FOURTH signed `process.list` verifies the child acquired a real `finishedAt` timestamp. This prevents UAT test contamination.
5. The Operator's DEV WAL nevertheless has all 4 un-reconciled outbound command IDs; a legitimate OS stop ACK still does **not** establish cross-service cutover safety or an authoritative write-generation receipt.
6. Real Operator SIGUSR2 freeze remains `freezing` with `pendingExternal>=4`, durable marker and `/readyz=503`. After Agent and Operator terminate, the journal owner lock remains and restart is refused.
7. Cleanup includes process-stop through the real Agent and defensive PID-checked /proc cleanup on test errors, plus isolated child/port/temp state cleanup.

Crucial distinctions: this is actual Agent binary/device-worker/native process execution with signed protocol on **one** isolated ARM64 host. It does NOT establish macOS/Windows parity, two-node WAN/network behavior, external A/B approval issuer, agent-signed OS-effect quiescence receipt, a global writer lease or a valid checkpoint/restore. It does NOT touch a real user's Agent or production services.

## Remaining P0 gates

P0-A NOT_READY: global authenticated writer epoch/lease and fencing across Operator, Plugin, Fleet, Agent; none implemented.
P0-B NOT_READY: independent signed Local Wall owner issuer and deployed Agent strict verifier not accepted; prior policy-denied edits untouched.
P0-C NOT_READY: this real E2E **proves command ACK is not quiescence** and DEV journal continues fail-closed. No independently authenticated Agent process-exit certificate bound to global generation, no audited durable settlement; 16/18 prior registry writers fsync-proven.
P0-D NOT_READY: no complete cross-host representative fake ARM64→HOMELAB x64 state restore+rollback under global old-writer revocation.
P0-E NOT_READY: no production-equivalent authenticated OAuth/A-B/remote desktop/PTY/SCP/billing signed release.

No production deployments or main merge. Previously denied writer/Agent strict Wall/restore paths remain untouched. The only newly authored runtime activity is the test's subprocesses in private UAT directories, not a production integration rollout.
