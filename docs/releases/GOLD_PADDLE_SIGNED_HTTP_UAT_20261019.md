# Gold Paddle signed HTTP webhook UAT — 2026-10-19 (PARTIAL; cleanup blocked)

Branch `feature/light-remote-gold-rebuild-20261018`. Isolated `light-remote-gold-uat`, internal Plugin loopback `127.0.0.1:5583`, PostgreSQL 17/Redis 8.

## Verified (actual Paddle SDK and local HTTP)

- `deploy/scripts/uat-gold-paddle-signed-http.mjs` runs a temporary Express HTTP endpoint with the actual canonical `registerPaddleWebhook` handler and real Paddle SDK HMAC verification. Only a synthetic `pdl_sdbx_apikey_...` value and test-only webhook secret are supplied. Checkout is disabled. There are **no network calls to Paddle**.
- Gold Plugin service was stopped **only while the temporary single-writer test endpoint ran**, then restarted; production `light-remote-direct` remained untouched.
- POST to `/billing/paddle/webhook` with incorrect HMAC: **HTTP 400**, no SQL event, no paid entitlement.
- POST valid, locally signed `subscription.created`: **HTTP 200**, webhook result `action=granted`, real Gold Operator updated synthetic account to Pro, PostgreSQL persisted one event and one subscription row.
- POST the exact same signed event: **HTTP 200** with `duplicate=true`; SQL event count remained one.
- After restarting the normal Gold Plugin, `GOLD_PADDLE_FLOW_AFTER_SERVICE_RESTART=PASS`: SQL and authenticated `/account/api?action=me` still reported the synthetic account as Pro, with expected event/subscription rows.
- Gold Operator, Plugin, PostgreSQL and Redis all active.

## Explicit incomplete state — DO NOT expose public demo

The tool safety layer denied the operation intended to send the synthetic signed `subscription.canceled` event and remove UAT records. It was **not retried through an alternate transport or privileged path**.

Verified read-only UAT residue (exactly scoped to synthetic test):
- Account `gold-native-uat-20261019@example.invalid`: plan **Pro**.
- Signed test event rows: **1**.
- Signed test subscription rows: **1**.

The account uses only UAT synthetic identity; no actual billing charge was created. These synthetic records must be revoked/cleaned via an authorized operation before demo acceptance. **Do not promote this state, re-use it as a legitimate subscriber, or expose Gold publicly.**

`deploy/scripts/uat-gold-paddle-signed-http.mjs` has a cleanup stage prepared but **not executed or verified**. It enforces explicit Gold instance ID `uat19` and synthetic-only signature secret. `deploy/scripts/uat-gold-paddle-operator-http.mjs` accepts `GOLD_EXPECT_SIGNED=1` to verify the signed-event record across restart.

## Remaining Gold release work

Public signed-webhook route acceptance also needs negative/replay tests after service restarts and correct cleanup confirmation. Full Gold release additionally requires cross-domain API E2E (Team, Enrollment/A-B, License, Usage/Fleet/Job, support and OAuth), active-writer/JSON fallback audit, and isolated HTTPS ingress with valid DNS/TLS. None of those is silently marked done. No verified public Gold demo URL is available.
