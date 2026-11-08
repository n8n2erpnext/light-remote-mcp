# Gold Paddle HTTP/Operator/PostgreSQL integration UAT — 2026-10-19

Branch: `feature/light-remote-gold-rebuild-20261018`.
Scope: Gold-only VPS-ARM LXD `light-remote-gold-uat` (private `10.192.135.61`). Existing production `light-remote-direct` unchanged.

## Fixed in canonical Gold source

- Serialized Paddle event processing in the single-writer Plugin; max 128 pending deliveries, then 503.
- Require provider event identifier; duplicate event IDs execute side effects once.
- `GoldRegistryPersistence.enqueue()` returns its actual PostgreSQL commit promise; webhook processor awaits persistence before reporting success.
- When a commit fails, in-memory event state cannot falsely acknowledge a retry: fail closed until Plugin restart.
- Never grant Pro from a `subscription.created` event when the subscription's status is not active or trialing.
- Modernized legacy `selftest-v11-paddle-billing.mjs` to inject test-only persistence rather than hitting the Gold fail-closed default.
- Gold empty support outbox no longer attempts to access the production backoffice configuration when there are no due deliveries or pending status checks. **Actual support delivery remains unconfigured in the Gold UAT**; no live ERPNext operation was performed.

## Tests actually performed

- 14 Gold/legacy source selftest scripts: **14/14 PASS** (many use mocked PG/Redis, so not end-to-end acceptance).
- `selftest-gold-paddle-serialized.mjs`: concurrent duplicate serialized, persistence error fails closed, 128-pending overload rejected: **all PASS**.
- `selftest-v11-paddle-billing.mjs`: historical checkout, grant/cancel/refund/mail business unit checks: **PASS**.
- Real Gold LXD `uat-gold-paddle-operator-http.mjs`:
  1. Preflight: synthetic account free, Paddle event/subscription/refund tables empty, authenticated `/account/api?action=me` returns free: **PASS**.
  2. Synthetic `subscription.created` event through `PaddleBilling.processEvent`, real Unix-socket Operator admin entitlement route, GoldRegistryPersistence and actual PostgreSQL 17: Pro granted; authenticated HTTP shows Pro; duplicate ignored: **PASS**.
  3. Restart both Gold Operator and Gold Plugin: SQL and authenticated HTTP still show Pro and recorded event: **PASS**.
  4. Synthetic `subscription.canceled` through real Operator and SQL: Pro revoked to free; exact synthetic Paddle rows removed: **PASS**.
  5. Restart Gold services again and repeat clean preflight: free account, zero Paddle rows: **PASS**.
  6. Gold Plugin reloaded with updated source; `/healthz` 200; PostgreSQL, Redis, Operator and Plugin active: **PASS**.

The synthetic provider event did NOT traverse the external signed HTTP webhook endpoint and never contacted Paddle. No purchase, charge, refund, invoice, notification email or real ERPNext integration was sent.

## Still required for Gold demo acceptance

- Exercise an actual signed HTTP Paddle webhook using isolated sandbox configuration and confirm account state durability, strict provider verification and retry behavior. Current real flow validates business processing but not signature ingestion.
- Complete end-to-end coverage of Team, License redemption, Google OAuth, Support delivery, usage, Fleet/Job and A/B against the isolated PostgreSQL/Redis runtime. Prior source fake tests cannot substitute.
- Run active-writer audit and classify any remaining JSON/SQLite fallback code. No generic JSONB canonical state snapshot is allowed.
- Public HTTPS staging ingress has **not** been configured. Gold Plugin is bound only to `127.0.0.1:5583` within LXD. VPS-ARM 80/443 are already used by production Traefik; do not overwrite its routing. No public demo DNS target is ready.

## Repeatable script

`deploy/scripts/uat-gold-paddle-operator-http.mjs`
with `GOLD_PADDLE_FLOW_STAGE=preflight|write|read|cleanup`. Requires explicit `LR_GOLD_INSTANCE_ID=uat19`, private DB auth files and Gold Operator socket. Do not run against production.
