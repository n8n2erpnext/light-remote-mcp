# 2026-10-17 Gold — Team grant source reconciliation

**State:** SOURCE-LEVEL AUTHORIZATION CONTRACT INTEGRATED, **NOT** live Team end-to-end or PostgreSQL persistent acceptance.

## Provenance

- Existing production `operator-host/device-access-grant-registry.mjs` contained modern 24h hard-expiry, per-OAuth-Agent A/B binding and owner-reapproval behavior.
- Imported purpose-scoped `device` versus `team-member` authorization from the vetted Team source `feature/free-benefit-pro-team-20261010@6ab88ec`, preserving the modern owner approval/expiry rules.
- Tightened `activeForDevice` to expose only the owner/device-purpose grant, **never a Team member grant**; Team-specific lookup stays `activeTeamGrant`. Existing member grants may not masquerade as owner's grant in Local Wall responses.
- Ported three source tests into this branch. Added negative assertions that a Team-only grant never appears as device owner grant, and owner grant remains visible when coexisting with a Team grant. No production permissions modified.

## Focused source tests PASS, executed on the candidate branch

1. `selftest-pro-team-seats.mjs`
2. `selftest-team-member-auth.mjs`
3. `selftest-pro-team-invite-budget.mjs`
4. `selftest-v09-device-pairing.mjs`
5. `selftest-v09-pairing-connect-flow.mjs`
6. `selftest-v09-homelab-wall-access.mjs`

All six finished exit 0 under the same source worktree, including Team A/B 24h expiration and owner pairing/reconnect checks.

## Explicit unresolved legacy tests

- `selftest-v09-device-access-grant.mjs` FAIL at its old expectation that approving Agent A automatically consumes Agent B's pending grant. This contradicts the newer deployed per-Agent scoped grant policy. **Do not revert security semantics to satisfy a stale expectation.**
- `selftest-v11-device-connection-renewal.mjs` FAIL when expecting renewal to extend the grant beyond the newer 24-hour absolute expiry policy. **Do not remove the hard cap.**
- These old test contracts need formal migration to modern expectations, not arbitrary green edits. Existing denial of unrelated P0 aggregate/full regression remains binding.

## Still NOT accepted

- Team routes not yet fully integrated with production V4/R4 Operator and Plugin; no live Team A/B flow executed.
- Backend durable state still includes JSON, so the promised PostgreSQL-only business persistence is not implemented or tested.
- Gold Windows/macOS rc49 library mismatch remains and related tests fail. Previously denied client replacement must not be bypassed.
- Isolated PG17/Redis8 stack activation remains blocked by `target_node_capability_missing` on the device; no role, auth or SQL runtime verification.

This is a **bounded source + unit-test acceptance point**, not a statement that the complete gold release is ready.
