# Gold M6 — Native terminal ACK journal for Windows/macOS (2026-10-22)

## Scope and boundary

Continue after `c48be59` (Linux Supervisor PostgreSQL ACK/replay). User explicitly paused Pro 3+1/Team multi-user testing until additional real devices/people are available. This change is **source/CI only** and is **not a Gold UAT, production, or installed native client rollout**. No billing/Team/account/authorization changes; PostgreSQL schema remains 035 pending controlled UAT cutover.

## Engineering

- `lib/native-terminal-receipt-spool.mjs`: a local, owner-private **device-only** journal of completed native process receipts, stored below `dirname(OPERATOR_AGENT_STATE)/terminal-journal` with restrictive POSIX permissions, atomic file replacement, fsync of file and parent directory (POSIX). No process script, stdout, path, OAuth token, key, or raw PID is persisted. This is NOT an Operator/Plugin JSON backend, and does not replace canonical PG17/Redis8.
- Journal never records an OS process merely because the Agent restarted. It records only an actual `NativeProcessRegistry` `process_finished` event, which now includes `finishedAt`; on abrupt Agent death while OS work is unresolved, no terminal proof exists and Gold retains `UNKNOWN` worker claim.
- Strict processId, owner accountId and enrolled deviceId validation; cap 4096 unacknowledged receipts and bounded oldest-first batch of 32. Exact `{processId,state,finishedAt}` ACK match only; failure to write journal or ACK fails closed and preserves unacknowledged evidence. Replayed exact ACK is idempotent.
- `device-agent/operator-agent.mjs` selects Linux Supervisor journal when enabled and the new private native journal otherwise. Signed duplex heartbeat, poll and pulse ACKs from the existing M6 Operator protocol now fsync the native receipt ACK before it is removed from replay. No artificial OS termination claim, no new server trust endpoint.
- The new module is included in `client/core-files.json` so release bundles contain the dependency on Windows/macOS (and native fallback Linux).
- **Windows/macOS note:** Node's native fsync/rename is used on the local filesystem. POSIX directory fsync is used where supported; Windows directory fsync is not requested. This source does not prove disk-controller power-loss resilience on every filesystem. Windows actual runtime execution was attempted through Gold connector but queued behind existing resource claim; no bypass or cleanup of unrelated jobs. macOS physical test not run.

## Verification

- `node --check` Agent, core NativeProcessRegistry, new spool and selftest PASS.
- `node deploy/scripts/selftest-gold-m6-native-terminal-spool.mjs`: 46 owner-scoped receipts retained across new journal instances/restart, oldest-first 32 ACK, remaining 14 replay, duplicated/mismatched ACK refusal, one real bounded Node OS process exit producing fsynced terminal proof, bundle and Agent integration PASS on Linux host.
- Regression `selftest-gold-m6-terminal-replay.mjs`, `selftest-gold-m6-resource-metrics.mjs`, `selftest-gold-m6-process-stop.mjs` PASS.
- GitHub CI Gold Operator workflow updated to include new cross-platform journal test; final workflow status must be verified separately.
- Windows Gold owner device temporary test artifacts only under `C:\Users\Admin\Documents`: `gold-m6-native-terminal-receipt-spool.mjs` and `gold-m6-native-windows-test.mjs`. Test job was queued at last observation; do not claim PASS without receiving actual stdout/terminal status.

## Important limitations and next steps

1. An Agent crash *while* a process is still running cannot be retroactively treated as terminal; the lease MUST remain UNKNOWN until a signed trustworthy device OS receipt or separate verified rescue mechanism.
2. A full disk or blocked journal save is a fail-closed error. The owner should see a diagnostic and no automatic claim cleanup.
3. For physical Windows/macOS acceptance, run the spool test on each OS, sign/push a real process terminal through Gold UAT (after schema 035 migration and controlled Agent/Operator rollout), then check exact PG claim release + ACK ledger + no duplicate dispatch. Preserve Pro Team and 3+1 physical test pause.
4. Investigate old Windows resource claim through normal worker lifecycle after owner-authorized cleanup; do not bypass a queue to force a test.
5. Resource CPU/RAM/I/O metrics can follow once these receipts are stable.

Roll back with branch commit revert before any client deployment. No schema migration or server services restarted in this iteration.
