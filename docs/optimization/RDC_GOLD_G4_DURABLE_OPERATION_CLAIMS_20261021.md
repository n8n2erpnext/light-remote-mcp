# Light Remote Gold G4 — Durable PostgreSQL operation claims, no blind replay
Date: 2026-10-21. Branch: `feature/light-remote-gold-rebuild-20261018`.

## Owner direction
Finish G Plan in order after G3. Owner will return for manual permission/LXD tests. The Gold LXD cannot operate host LXD without delegation; this is an expected boundary, not a release blocker. **Production must remain untouched.** No PTY/sudo/alternate command routing to avoid local or platform policies.

## Actual G4 defect
`operator-host/executor.mjs` protected `operationId` using an in-process `Map` with a default six-hour TTL. `GoldJobLedger` stored job metadata in PostgreSQL but only queued asynchronous writes *after* the effect was allowed to start. Following an Operator restart, the same `operationId` could be re-issued as a second shell/fs/SCP/process/terminal/search/desktop operation even if the first effect occurred but its ACK was lost. Exactly-once effects for arbitrary shell commands cannot be guaranteed.

## Minimal Gold-only correction
- `lib/gold-job-ledger.mjs`: add `reserve(job)` that obtains a dedicated PG connection, enters `BEGIN`, takes transaction-scoped `pg_advisory_xact_lock(hashtext(account/device),hashtext(operationId))`, queries existing `lr_gold_job_records`, and, only if there is no record, inserts a **minimal metadata-only running claim** and commits **before dispatch or process spawn**. No script/stdout/stderr/secrets in PostgreSQL; a SHA-256 operation fingerprint and `effectState=unknown` are recorded in existing `public_view` JSONB metadata (canonical job table, not substitute storage). No schema change or new migration.
- If the same scoped operation is still in this Operator's jobs map, return the same job; if fingerprint differs, HTTP 409 `operation_id_conflict`; if PG knows an operation but Operator cannot reconstruct the execution/effect from memory after restart, HTTP 409 `operation_effect_unknown`, **no new command**. Caller should inspect the authorized original job receipt before choosing a new operation ID. PG storage outage fails closed.
- Applied guard to all **seven** Gold tool operation families: exec, filesystem, process, terminal, SCP, search, desktop. `startJob` and the signed update maintenance route became properly async/awaited to respect the reservation barrier. Internal one-off helper updates remain their existing separately scoped path.
- `plugin-server/tool-error-classification.mjs` classifies G4 errors as `operation_reconciliation`, `retryable:false`, with explicit next action. Does not change OAuth, device final deny, local Wall or platform pre-dispatch filters.
- Existing single-writer operator PG advisory lock remains; the per-operation transaction additionally serializes races between requests in that writer and guards future bounded multi-writer scenarios.

## Source / Gold real PostgreSQL evidence
- New `deploy/scripts/selftest-g4-gold-durable-operation-claim.mjs`: first reservation writes once; a new Ledger instance reusing the same PG mock reads prior record and never reinserts; account/device isolation; PostgreSQL unavailable fail-closed; all seven source admission paths have the durable guard. **PASS**.
- **Real isolated Gold LXD PostgreSQL 17 smoke:** using the existing `gold-uat` app role and protected URL, reserve a synthetic account/device/operation, instantiate a second ledger, assert same original job ID and only one PG record; remove exact synthetic row afterward. **`G4_REAL_GOLD_POSTGRES_CLAIM_ONCE=PASS`, `G4_REAL_GOLD_POSTGRES_DUPLICATE_RECONCILIATION=PASS`**. First test run could not read root-owned `/tmp` source fixture; corrected the *fixture file's read mode only*, then PASS. No service permissions or Gold DB grants changed.
- Existing Gold G1/G3 tool errors, rate handler, Duplex transport, strict admission and JS syntax regressions PASS. Gold G3 CI includes G4 regression.
- **No live deployment claimed yet here unless a later section confirms exact installed SHA**, and actual signed live same-operation retry after Operator restart remains a distinct acceptance test.

## Limits / next gates
- This is **at-most-once admission of an operationId under a durable claim**, not a guarantee that an external shell effect occurs once or can be rolled back. A crash between claim and execution intentionally results in UNKNOWN, preserving safety but requiring owner/Agent reconciliation.
- Concurrent claim semantics should also receive a real PostgreSQL two-client race check; evaluate performance of existing account/time index for large job histories in G6. Existing PostgreSQL table holds the claim and the canonical job record; no extra JSON registry.
- G4 still needs owner/Team billing charge-event reconciliation and positive deployment E2E before DONE. Then G5 SCP/CAS and G6 full soak.
- Preserve immutable Gold backups and all four unrelated untracked deploy UAT files; never stage them.
