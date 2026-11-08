# Gold P0 — Completed Fleet receipt recovery after Operator restart (2026-10-29)

## Source defect and scope
FleetRouter.completed stores a short-lived in-memory receipt. After Operator restarts, an Agent retry of a previously completed signed result can receive command_not_found even though PostgreSQL holds a committed terminal record. The existing disk fallback only recognizes node_command_abandoned, correctly denying false ACK but not recovering valid completion.

## Change
- New completedCommandReceiptFromDisk(commandId) in operator-host/executor.mjs checks existing Operator JSONL activity records for a recent exact node_command_completed event, and returns only trusted account/device/node/job identity and completion metadata. Invalid, stale, incomplete or nonmatching events are ignored.
- New source dependency in the signed device-channel route checks existing Fleet completed cache, then abandoned log receipt, then completed log receipt. Any abandoned receipt remains denied.
- A recovered completed log receipt never alone produces a successful ACK. The existing d5e7bb0 durable guard requires matching signed Agent principal, terminal Gold PostgreSQL job public snapshot, finish time, known terminal state and integer exit code.
- The public PG snapshot is returned directly; no re-dispatch and no fabricated terminal receipt.

## Evidence
- Real UAT event log (read-only) contained node_command_completed records with exact required field names and timestamps. Five inspected recent records matched the expected shape.
- selftest-gold-p0-completed-receipt-restart executes the actual recovery function in a sandbox: valid event, abandoned event, wrong command, malformed or incomplete records, expired records and empty log.
- selftest-gold-replay-receipt-durable now includes valid completed-log replay after cache loss and denies uncommitted/interrupted job despite the completed log receipt.
- Existing durable ACK, M6 terminal replay, Cancel and Gold ledger regressions PASS.

## Explicit limitation
The Operator event log is batched to disk. An abrupt crash before the node_command_completed record was appended may leave no disk mapping, so the retry still fails closed with command_not_found. This patch does not claim crash-proof completed replay when the log record was not persisted. Full guarantee would require a durable command-id-to-job mapping in PostgreSQL or a separately verified durable log receipt protocol; do not claim E2E Windows acceptance on this basis.

## Deployment boundary
Gold UAT only; preserve stable runtime until source/candidate checks, 4-service rollback snapshot and 3 historical claims verification. Production and installed Windows clients remain unchanged.
Pro Team independent real multiple A/B device test HOLD_OWNER_RESOURCES; historical 3 claims HOLD_EVIDENCE_AND_OWNER_AUTH; A/B V2 deferred.
