# Light Remote rc.50: durable Team worker/quota UAT

This module is NOT enabled for real device execution. The SQLite
store allows staging tests to prove invariants the in-memory Team simulator
cannot prove.

## Storage guarantees

- Local SQLite with BEGIN IMMEDIATE, WAL, FULL synchronous and busy timeout.
- Three device-level slots shared by modeled owner and Team member jobs.
- Persistent slot generation (fencing) and cryptographic lease tokens.
- Stale worker cannot renew/complete/release a reused slot in this store.
- Atomic owner/month Team quota debit with worker acquisition.
- Exact retry key: owner + actor + agent + device + operation ID.
- Fingerprint mismatch rejected; exact retries never charge twice.
- No automatic replay on process restart. Timed-out jobs keep their debit.
- Revocation fences active simulated jobs and does not refund quota.

## Security boundaries and limitations

- The authorize callback must be trusted and synchronous. Callers must
  recheck OAuth actor/agent, Local Wall A/B consent, owner plan, Team
  entitlement and device ownership just before every claim.
- budgetFor must be authoritative; do not accept limits from client.
- Never expose lease tokens to MCP or untrusted accounts.
- There is NO connection to DeviceWorkerLimiter, real owner scheduler,
  live device execution, customer UsageRegistry, or Paddle. The operator
  executor does not import this module.
- Fencing a DB lease does NOT kill a real OS command. Real enablement
  requires device-side generation verification and process cancellation.
- SQLite serializes cooperating writers on ONE local filesystem.
- Modeled quota debits occur at dispatch claim time. A commercial ledger
  needs explicit accepted-not-run, cancellation and refund semantics.
- In-memory UAT queues are NOT crash durable. Need an operation outbox.
- revoke() is not automatically subscribed to team grant changes yet.
- Real permission revocation must propagate to trusted scheduler and device.

## Test

Run: node deploy/scripts/selftest-team-durable-dispatch-uat.mjs

Tests use temporary SQLite files and competing independent Node processes.
They verify shared 3 slots, owner metering, cross-process quota, exact retry,
persistent restart recovery, UTC month rollover, stale lease fencing and
revocation. No actual device job is launched.

## Further milestones

Build a unified owner/member real scheduler with durable outbox, process-level
device fencing, A/B rechecks on every transition, usage reconciliation,
owner-facing usage audit and explicit owner approval before production rollout.
