# Light Remote rc.50 — Paddle Pro Team sandbox checkpoint
Date: 2026-10-10, Asia/Ho_Chi_Minh

## Approved offers
Pro: USD 20/month, USD 200/year.
Pro Team: USD 55/team/month, USD 550/team/year, owner + 4 member seats.
Team owner retains Pro personal benefits; invited member plans remain unchanged.
Three concurrent workers per shared device; member Team calls owner-billed.
Team member-call sizing range 20,000–25,000/month remains experimental;
the isolated UAT grant is 5,000 calls/month.

## Implemented in source, OFF by default
- plugin-server/paddle-sandbox-offers.mjs: 4 unique configured Paddle price IDs; product classified by real subscription/transaction item; price verified via Paddle price amount, USD currency, billing interval, active status.
- plugin-server/paddle-sandbox-team-coordinator.mjs: verified subscription snapshot grants owner Pro + Team; downgrades/halt status revoke only source-matched Team grants; expiry bounded by Paddle nextBilledAt. Never upgrades invited users.
- plugin-server/paddle-billing.mjs: sandbox flag and options, offer-specific backend checkout, authenticated Paddle subscription readback, idempotent webhook record, PRO_TEAM ERPNext purchase/refund payloads and retained fee. Existing monthly Pro route unchanged when flag disabled.
- plugin-server/account-portal.mjs: authenticated same-origin offer checkout action accepting ONLY product and period; never browser accountId or arbitrary priceId.
- operator-host/pro-team-registry.mjs: expectedSource guard for Team grant revocation; executor-routes-account.mjs supports it.
- deploy/scripts/selftest-paddle-sandbox-team-coordinator.mjs and selftest-v11-paddle-team-sandbox.mjs: fake clients and security checks.
- deploy/paddle-sandbox.env.example: feature toggle and price ID slots.

## Sandbox activation prerequisites
Configuration required in isolated rc.50 staging only:
LIGHT_REMOTE_PADDLE_ENV=sandbox
LIGHT_REMOTE_PADDLE_API_KEY = sandbox secret
LIGHT_REMOTE_PADDLE_CLIENT_TOKEN = sandbox token
LIGHT_REMOTE_PADDLE_PRO_PRICE_ID = USD20/month
LIGHT_REMOTE_PADDLE_PRO_YEARLY_PRICE_ID = USD200/year
LIGHT_REMOTE_PADDLE_TEAM_MONTHLY_PRICE_ID = USD55/month
LIGHT_REMOTE_PADDLE_TEAM_YEARLY_PRICE_ID = USD550/year
LIGHT_REMOTE_PADDLE_WEBHOOK_SECRET = sandbox webhook secret
LIGHT_REMOTE_PADDLE_TEAM_SANDBOX_ENABLED=false (until verified)
LIGHT_REMOTE_PADDLE_TEAM_UAT_CALL_BUDGET=5000

No sandbox credentials or price IDs were added, and no Paddle transaction
was created in this task. Checkout buttons remain disabled for Team and yearly.
Production checkout, billing, Paddle Live and ERPNext were untouched.

## Safety and limitations
An owner with an existing active paid Pro subscription CANNOT start another
Pro Team checkout, avoiding duplicate subscriptions. The system currently
returns paddle_subscription_change_required. In-place Paddle subscription
plan change and proration ARE NOT YET IMPLEMENTED.

The default Pro path is unchanged with the Team feature toggle disabled.
A pending/duplicate checkout reconciliation and actual Paddle sandbox E2E
are further milestones. Real Team remote job execution remains disabled.

## Tests
- Earlier rc.50 source-only staging pretest using fake Paddle client:
  14 legacy Pro groups + 11 Team groups + 6 entitlement/price groups PASS.
- Latest source adds Paddle prices.get amount/currency/cycle verification.
  Transfer/testing of this latest addition into staging was blocked by the
  tool's safety check. It is NOT claimed staging-tested yet.
- Latest pure source pricing/permission suite PASS; JavaScript syntax PASS.
- Regression for other Team and account features ran, with a test-only
  intermittent SQLite temporary-folder cleanup issue. Cleanup retry was
  hardened; rerun was PASS for that suite.

## Next steps
1. After authorized source transfer, retest latest sandbox SDK path in LXD.
2. Obtain four VERIFIED Paddle SANDBOX price IDs and secure staging-only key.
3. E2E sandbox checkout, signed webhook, owner Pro+Team grant, cancellation,
   paused/past_due, ERPNext order/refund, fee reconciliation.
4. Implement verified in-place Pro -> Team, Team -> Pro subscription change
   and transparent Paddle proration. Do not create a second subscription.
5. Obtain owner approval before enabling checkout or merging production.
