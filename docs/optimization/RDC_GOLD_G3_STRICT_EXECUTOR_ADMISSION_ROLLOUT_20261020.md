# Gold G3 — Optional strict Executor Readiness admission and rollout

Date: 2026-10-20. Gold branch `feature/light-remote-gold-rebuild-20261018`, baseline HEAD `80b6d3e`.

## Design reason
Source Gold G3 `FleetRouter` records `executorReady=null` when no Agent probe signal exists but continues to report `dispatchReady=true` for compatibility. This is explicitly **not evidence of executor health**; the installed Gold UAT Operator has 2 fresh leaves with no independent readiness signals. Updating only Operator source would retain optimistic admission, and enabling a strict gate before client upgrades could interrupt these two legacy Agent leaves.

## Implementation: deliberate, reversible admission policy
- `FleetRouter({requireExecutorReady:false})` keeps existing default client compatibility and delivery semantics without changing historic users.
- When `requireExecutorReady:true` (Operator env `OPERATOR_REQUIRE_EXECUTOR_READY=1`), an authenticated Agent with missing `executorReady` is `readinessReason=executor_unknown, dispatchReady=false`; new enqueue fails HTTP 409 `target_node_executor_unknown`. An explicit false still maps to `executor_unavailable`; explicit true allows dispatch if channel fresh and not draining.
- Critical: a subsequent heartbeat/poll that omits `executorReady` does **not** preserve a prior healthy signal in strict mode. Previous unknown/non-current proof must not be reused as authorization. In compatibility mode, the prior behavior remains unchanged.
- No in-flight job is falsely completed or replayed by readiness transitions. Standard Fleet routing, policy, consent, A/B, session and account checks remain authoritative.
- Read-only `GET /v1/fleet` gains `requireExecutorReady` so UAT tests can verify the *active* policy, not merely assume an environment variable was configured. Default remains false until a coordinated Gold-only rollout.

## RED / GREEN evidence
`deploy/scripts/selftest-g3-strict-executor-admission.mjs` — six cases PASS on VPS-ARM:
1. Unknown Agent probe is kept offline for new dispatch despite fresh signed channel.
2. Explicit healthy Agent can accept and dispatch.
3. Missing subsequent heartbeat cannot reuse earlier success.
4. Explicit failure blocks new dispatch.
5. Recovery does not fabricate completion of unresolved work.
6. Legacy compatibility remains opt-in (source default non-strict).

Previously accepted `selftest-v08-fleet-router.mjs`, `selftest-g3-executor-hang-readiness.mjs`, `selftest-g3-duplex-reconnect-inflight.mjs`, and Ed25519 enrollment+signed duplex also PASS on this patch. Gold Operator CI contract runs this test on the pushed source.

## Deployment gate — NOT AUTO-ENABLED
Current installed `light-remote-gold-uat` source hashes differ from branch source, and 2 leaves are still legacy/unknown; *do not set strict env yet* without an isolated Agent rollout and coordination. Recommended sequence:
- Stage a source-hash pinned, versioned complete UAT release alongside running installation, verify dependencies and checksum, take rollback snapshot.
- Test upgraded Operator/Plugin on an **isolated UAT-only runtime** and verify authenticated routing + independent readiness signal from a disposable owner-approved Gold Agent.
- Once all connected UAT Agents advertise `executorReady:true`, set `OPERATOR_REQUIRE_EXECUTOR_READY=1` on **Gold UAT only**, restart under a bounded planned maintenance window with zero in-flight jobs, confirm Fleet shows strict=true and no unknown fresh nodes.
- If a legacy Agent is intentionally retained, leave strict disabled or explicitly drain that Agent; do not silently break its jobs and do not declare G3 complete.
- Do not enable on production, remove local policy boundaries, bypass device approval, transfer credentials to evade tool safety, or start G4 until acceptance.
