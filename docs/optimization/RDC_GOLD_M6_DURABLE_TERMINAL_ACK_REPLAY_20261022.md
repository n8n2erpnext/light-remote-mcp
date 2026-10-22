# Gold M6 — Durable terminal receipt ACK/replay (2026-10-22)

## Scope, status, invariants

Owner asked to continue M and explicitly paused personal Pro 3+1 / Pro Team physical UAT until more devices and human testers are ready. This slice continues Gold branch `feature/light-remote-gold-rebuild-20261018` after `40773a3`. **Source/CI only: NOT Gold UAT or production deployed.** Keep previous four owner-approved Gold OAuth clients and grants unchanged.

Invariant: **terminal receipt ACK is returned only after the corresponding canonical PostgreSQL device resource claim has been released and the terminal receipt ACK is DURABLY recorded in the same transaction, or when an exact matching durable ACK was already recorded.** An unknown process, unpersisted launch or mismatching terminal timestamp never receives ACK. Device must retry until it sees ACK; no age-based unlock. No snapshot JSONB tables, no personal/Team quota changes.

## Implementation details

- New reviewed migration `platform-v2/sql/035_gold_terminal_receipt_acks.sql`: native relational `lr_gold_terminal_receipt_acks` with PK `(account_id,device_id,process_id)`, immutable `job_id`, terminal state and `finished_at_ms`, explicit app SELECT/INSERT grants. Migration manifest SHA locked and authorized `apply-gold-db.mjs` manifest length raised from 34 to 35. **Migration not applied on running Gold UAT.**
- `GoldDeviceResourceLocks.acknowledgeVerifiedTerminal()` acquires original per-device PostgreSQL advisory lock, deletes matching `worker_state=running` claim by owner/device/process, inserts exact terminal ACK, reads it back and COMMITs together. Duplicate receipt returns `{acked:true,released:false}`; missing/mismatching receipt returns `{acked:false,released:false}`. On DB failure ROLLBACK and no ACK.
- Operator `reconcileSignedTerminalProcessReceipts()` first waits for any in-flight process-launch claim transaction, then uses atomic ACK+release and returns only successfully committed ACK values. Existing background process stop/output/list receipt handling also uses the same atomic method so it cannot pre-delete a lease before the signed heartbeat arrives.
- Device channel routes return `terminalReceiptsAck` in **signed identity-scoped** poll, pulse and duplex heartbeat ACKs. Existing Fleet/Agent identity verification stays unchanged; no new externally callable anonymous ACK endpoint.
- Durable Linux Supervisor journal now has `unackedTerminals()` (oldest-first bounded 32, not recent-64-only) and `ackTerminals()` (match account/device, processId, terminal state and exact finishedAt; persist via existing private fsync/atomic rename journal). IPC `list-device-terminals` and `ack-device-terminals` retain the Supervisor socket secret and local device enrollment boundary.
- Gold Agent uses unacknowledged Supervisor journal receipts when Supervisor is enabled; on a verified Operator response it saves ACK in Supervisor before removing from future batches. Lost HTTP ACK, Operator crash or Agent/Supervisor restart therefore replays still-unacknowledged terminal receipts. If Supervisor/journal unavailable, errors fail closed; the non-Supervisor path still uses bounded 64-record memory rotation and is **not durable**. Do not claim Windows/macOS parity yet.

## Validation performed

- Node syntax checks all changed Agent/Supervisor/Operator/PG files: PASS.
- `selftest-gold-m6-terminal-replay.mjs`: 41 journaled terminal records, oldest 32 ACK, simulated Supervisor restart, replay remaining 9, duplicate ACK idempotent, unproven terminal rejected, PG atomic release+ACK and exact duplicate/mismatched receipt, SQL migration SHA contract, signed transport integration anchors: PASS.
- Existing `selftest-gold-m5-supervisor-restart-journal.mjs`, `selftest-gold-m5-process-supervisor-agent-restart.mjs`, `selftest-gold-m6-resource-metrics.mjs`, `selftest-gold-m6-process-stop.mjs`: PASS.
- `git diff --check`: PASS. Gold Operator CI workflow updated, **post-push result unverified**.
- No UAT DDL, service restart, process stop or new A/B approvals in this turn.

## Follow-up gates

- Apply migration 035 only through Gold UAT migrator after verified backup and controlled cutover; upgrade Operator AND Linux Supervisor/Agent together. If Operator with new ACK code is rolled out before schema 035, it will fail to ACK and retain worker lease (fail closed). Validate actual signed heartbeat/poll/duplex ACK + journal purge + exact PG row transition.
- Extend durable private receipt spool/ACK support to Windows/macOS non-Supervisor Agent variants without creating JSON/SQLite **server-side** runtime fallback or forged receipts.
- Audit Supervisor journal cap 2048: old unacknowledged records cannot be silently evicted; when full it must remain explicit fail-closed. Add bounded metrics to Fleet Wall for pending terminal ACK count after real rollout.
- Preserve Pro Team OFF and owner-paused 3+1 UAT.

### Files

`lib/gold-device-resource-locks.mjs`, `operator-host/executor.mjs`, `operator-host/executor-routes-device-channel.mjs`, `lib/supervisor-job-journal.mjs`, `device-agent/process-supervisor.mjs`, `device-agent/process-supervisor-client.mjs`, `device-agent/operator-agent.mjs`, `platform-v2/sql/035_gold_terminal_receipt_acks.sql`, `platform-v2/sql/migrations.lock.json`, `deploy/scripts/apply-gold-db.mjs`, `deploy/scripts/selftest-gold-m6-terminal-replay.mjs`, `.github/workflows/gold-g3-operator.yml`.

Rollback is source revert before migration, or dedicated Gold UAT candidate rollback after full schema and service rollout. Never delete the ACK ledger or release held claims as a shortcut.
