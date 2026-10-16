# rc.50 DEV — crash-durable Agent effect inventory prototype

Date: 2026-10-16 Asia/Ho_Chi_Minh
Baseline: `35b31a81745e545c49203f3960d017b8a034a311`
Branch: `feature/rc50-mjs-scale-20261011`
Scope: completely isolated UAT module under `platform-v2/portability`. NO real Agent executable integration, Operator routing, production changes, or system migration.

## Problem confirmed by actual executable E2E

The real Agent's `process.start` command can ACK success and record `command finished` while a separately spawned process continues running. Even a signed observation of one exact native handle's exit cannot establish global writer fencing or all side effects' quiescence. Worse, after Agent restart its in-memory registry may be empty while prior OS children remain alive. The new DEV-only inventory records possible effects before spawn and preserves uncertainty, never inferring an absent child means completion.

## Implementation

`platform-v2/portability/dev-agent-effect-inventory.mjs`:
- Owner explicitly pre-creates a **0600 empty JSON v1 inventory** in a trusted directory. No automatic initialization, no unsafe file permissions, no symlinks, strict schema and max 512 records.
- Constructor fails closed if any unresolved inventory entries exist or an `O_EXCL` owner lock exists. A lock is fsynced together with its directory; stale locks are never stolen by PID/mtime.
- `arm()` writes a durable `intent` (full owner, commandId, effectId, process/terminal, nodeId, claimed generation, bootId) via atomic temp-file fsync, rename and parent directory fsync. **The caller must complete arm BEFORE actual OS spawn**; this proof applies to tests and a future explicitly authorized integration only.
- `recordSpawn()` links a handle and PID only after exact owner-scoped native registry verification. It remains unresolved even if the OS process finished before link. The implementation checks handle owner, PID and chronology.
- `recordExit()` requires the same native handle/PID/start timestamp and explicit valid `finishedAt`. If registry state disappeared after restart, or PID/owner mismatch, it rejects. Once observed, stage is `exited`, **but still unresolved**; no settlement/removal method exists.
- `inspectDevAgentEffectInventory()` allows inspecting a potentially crashed inventory without taking a new writer lease. Reports `intent`, `spawned`, `exited`, owner lock, `blocked`, and always `settlementAuthorized:false`.
- Any write exception OR a missing exact durability ACK poisons that inventory instance; in-memory stage advances only after confirmed durable write. Even ambiguous errors after actual successful fsync are treated as untrusted and prevent further mutation.
- `releaseClean()` is permitted ONLY when the inventory is truly empty and the live owner lock still matches. After any effect, even `exited`, it deliberately refuses. Future independently authorized human/owner reconciliation is needed; deleting the file/lock would be an unsafe bypass, not proof.

`platform-v2/test/agent-durable-effect-inventory.test.mjs` tests:
1. Durable intent BEFORE real OS Node process spawn, real native PID/handle, explicit active observation, actual exit; inventory remains blocked after the process ends.
2. Terminal registry using mock PTY provider: durable intent→spawn→exit; missing registry after restart refuses evidence.
3. Genuine separate Node process writes durable pre-spawn intent then exits nonzero. New owner cannot start from the remaining intent/lock.
4. Injected persistence failure **before** write blocks in-memory updates and forbids later writes.
5. Owner lock replacement, concurrent owner denial, insecure/symlink/malformed file denial and legitimate empty-journal lock release.
6. Ambiguous acknowledgement failure **after** a durable spawn-link write: file may advance while old process view remains behind, but instance is poisoned and new startup refuses its unresolved record.

## What this does NOT prove

This is a DEV prototype, not a production Agent-side write hook: no existing `device-agent/operator-agent.mjs` spawn/PTY route was modified. The OS inventory may lose track of detached descendants, external processes, filesystem/SCP/desktop effects, or cross-host writes. Even an exited entry has NOT been certified by an independent trust authority. A claimed `writerGeneration` and `bootId` do not establish a genuine epoch, old-writer revocation, or independent cryptographic attestation. Atomic per-file fsync is NOT a distributed transaction or consistent checkpoint.

The prototype deliberately cannot settle WAL. Do not interpret the tested error/crash scenarios as a full power-loss, filesystem durability, network partition, process-child orphan or cross-architecture restore acceptance. Subsequent stage evidence is durable locally, but there is no globally authorized retention/pruning policy yet.

## Next necessary path

- Obtain authorized access to integrate an effect inventory around actual Agent process/PTY starts **before spawn**, with durable boot identity and at-least-once recovery semantics across crash.
- Introduce independently authenticated WriterEpoch/lease with real cross-host old-writer fencing for Operator/Plugin/Fleet/Agent.
- Bind per-effect Agent signature to that generation and a durable replay/owner-verification ledger; only then design audited, owner-authorized reconciliation (not automatic on ACK) and full representative ARM64→x64 restore/rollback.
- Keep P0-A/B/C/D/E all **NOT_READY** until real cutover proof; never use previously blocked files through alternative routes.

No main merge, customer effect, service restart, production agent state, or production token is touched.
