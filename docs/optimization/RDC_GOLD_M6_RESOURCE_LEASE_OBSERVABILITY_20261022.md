# Gold M6 — Resource lease audit & terminal receipt recovery (2026-10-22)

## Scope and constraints

Continue M6 on `feature/light-remote-gold-rebuild-20261018` after commit `5354aa9`. Owner explicitly paused Pro 3+1 physical concurrency and Pro Team/multi-user UAT until real devices/participants are ready. No Team tests this slice. Runtime Gold UAT and production are not upgraded by this source change.

## Implemented

1. New `ownerDeviceResourceMetrics` in `lib/gold-device-resource-metrics.mjs`, invoked by already owner-signed Fleet `fleet-jobs` route. SQL is parameterized and filtered by **both** verified owner `account_id` and the devices enrolled under the same owner (no browser-selected scope). Only server-provided capacity is exposed, not a global free-slot promise.
2. PostgreSQL `lr_gold_device_resource_claims` + `lr_gold_job_records` grouped by device, and `lr_gold_personal_agent_work` queued reasons. Fields: owner worker weight, claim count, real running process lease count, claims without process ID, queued/resource wait/Agent slot wait, claims older than 1h, review-required claims linked to interrupted/unknown/error job outcomes, oldest claimed timestamp, worker budget. **No raw resource keys, process identifiers, commands, paths, tokens, unrelated account claims.**
3. Fleet Wall `/jobs` now renders a read-only **Device worker leases** table; warnings are observational. Every resource metric reports `releasePolicy=signed_terminal_receipt_only`, `scope=owner_claims_only`. An old claim is **not** automatically orphaned; a missing in-memory job after restart is **not** a terminal worker receipt.
4. Existing Agent `refreshProcessTerminalReceipts` used a stable `slice(-32)`, which could starve older finished process receipts when a device had more than 32 retained. It now keeps at most 64 eligible terminal records and `nextProcessTerminalReceipts()` transmits rotating batches of 32 *per signed heartbeat/poll/duplex payload construction*, not per 5s cache timer. This expands eventual visibility for retained journal receipts without raising per-message limits.
5. **Still fail closed:** `GoldDeviceResourceLocks.releaseVerifiedTerminal` is the only existing release path and requires signed device context + process ID matching worker lease + terminal status + positive finishedAt. No DB delete, restart-based mass unlock, manual lease release, or fabricated OS completion was added.

## Validation

- Source syntax checks for Operator route, Agent, projection and Fleet Wall PASS.
- `selftest-gold-m6-resource-metrics.mjs`: query ownership/device SQL predicates, no unsafe SQL mutation, redacted UI view, old/UNKNOWN lease observation, 64-record terminal batch rotation and browser JS syntax PASS.
- Regression: `selftest-gold-fleet-jobs-m6.mjs` and `selftest-gold-m6-process-stop.mjs` PASS.
- Live Gold UAT **EXPLAIN** read-only with nonexistent account validated the actual PostgreSQL 17 schema and both resource+queue aggregate queries (no PG table changes, writes or physical Team tests).
- CI Gold Operator workflow includes this test; post-push workflow outcome must be separately verified.

## Remaining technical risks / next checkpoints

- Supervisor `list-device` currently returns at most 64 processes; rotation solves oldest-32 starvation **within retained 64**, but does not recover receipts evicted from Supervisor journal/views or a disconnected device. No ACK/replay queue or signed snapshot coverage proof across >64 processes yet.
- Underlying lease may remain UNKNOWN indefinitely if terminal proof was never observed. Do not interpret age warning or `reviewRequiredCount` as permission to delete.
- Requires controlled physical UAT before acceptance: device Agent process restart with a benign managed process, Owner Fleet read-only status, one signed terminal receipt and subsequent exact PG claim release, Windows/macOS/Linux parity; keep Team and multi-Agent test paused.
- Further M tasks: signed durable terminal receipt ACK/replay cursor, timeout/unknown handling for owner Stop after Operator restart, bounded per-device CPU/RAM/IO stats from signed Agent telemetry, only after security review.

## Rollback and handoff

No schema migration or Gold UAT/production service restart in this slice. Revert branch commit to restore prior Fleet job view/terminal selection. Preserve existing Gold account, approvals, sessions, Device IDs, Pro plan and Pro Team OFF.
