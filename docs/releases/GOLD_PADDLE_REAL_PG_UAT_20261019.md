# Gold Paddle — PostgreSQL 17 real persistence UAT (2026-10-19)

Branch: `feature/light-remote-gold-rebuild-20261018`.
Dedicated LXD: `light-remote-gold-uat`, private address `10.192.135.61`.
Production LXD `light-remote-direct` was not changed.

## Test boundary

This verifies **actual native relational Paddle adapter durability**, not live Paddle webhook/API integration.
No Paddle SDK API call, checkout, capture, adjustment/refund, email notification or live purchase was performed.

## Actual real PostgreSQL observations

- `GOLD_PADDLE_UAT_PREFLIGHT` returned exactly zero rows for all three Paddle tables and the synthetic UAT account.
- The test inserted one synthetic account under `example.invalid`, two synthetic webhook event records (`subscription.created`, `transaction.completed`), one subscription and one pending refund via `GoldNativePaddle.store.write()`.
- `GOLD_PADDLE_REAL_PG17_WRITE_READ=PASS`: `GoldNativePaddle.open()` retrieved all records with exact IDs, statuses, timestamps, synthetic transaction reference, currency and amount. SQL-level `jsonb_typeof` checks verified that polymorphic provider result payloads are JSONB objects, while subscription status/identity and refund transaction identifiers have typed relational columns.
- Restarted **Gold-only** `light-remote-gold-operator` and `light-remote-gold-plugin` systemd services; both active.
- `GOLD_PADDLE_REAL_PG17_AFTER_RESTART=PASS`: all records and results still present with expected values after service restart.
- `GOLD_PADDLE_REAL_PG17_CLEANUP=PASS`: exact synthetic rows removed from all three Paddle tables and the synthetic account.
- Restarted Gold-only Operator/Plugin again; both active. Final `GOLD_PADDLE_UAT_PREFLIGHT` showed events=0, subscriptions=0, refunds=0, syntheticAccounts=0.

Reproducible source: `deploy/scripts/uat-gold-paddle.mjs`; stages `preflight|write|read|cleanup`. No real provider credentials are printed or used. Write stage refuses any existing Paddle records; cleanup verifies exactly expected synthetic data and counts before deletion.

## Relational schema

Migration `024_gold_paddle_native.sql` defines:

- `lr_gold_paddle_events` — unique event identifier, event type, processing timestamp, polymorphic per-event result JSONB.
- `lr_gold_paddle_subscriptions` — unique subscription identifier, account FK, status, event type and update timestamp.
- `lr_gold_paddle_refunds` — adjustment identifier, transaction reference, account FK, subscription reference, status, requester, reason, timestamps and flexible processing-result JSONB.

This is **not** a generic JSONB billing snapshot. Transaction details in the event's processing-result object are not a separately accepted relational transaction ledger. Do not report complete transaction accounting on this evidence.

## Outstanding

1. HTTP real signed Paddle webhook ingestion, idempotent replay, refund transitions, and webhook-to-entitlement update.
2. Independent transaction/payment accounting and ERPNext reconciliation.
3. Complete Gold public frontend reverse proxy/domain readiness; no public URL is ready for DNS.
4. Other Gold domains including Pro Team full HTTP acceptance. A previous Pro Team HTTP inspection tool invocation was denied by safety; do not bypass that denial.
5. Full-system SQL writer audit and API write→read→restart→read acceptance.

**Result:** Paddle native PG persistence durability PASS; full Paddle business/API and all-domain Gold cutover NOT YET ACCEPTED.
