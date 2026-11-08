# Gold Demo Readiness Gate — 2026-10-19

Branch: `feature/light-remote-gold-rebuild-20261018`. Latest known source checkpoint `4c7ac58` before this report.

## Current Gold isolated runtime

- VPS-ARM, Gold LXD `light-remote-gold-uat`, internal IP `10.192.135.61`.
- Gold service `light-remote-gold-plugin` listens on **127.0.0.1:5583 inside LXD only**. This is not a DNS/public endpoint.
- PostgreSQL, Redis, Gold Operator, Gold Plugin all active at observation.
- Production `light-remote-direct` LXD stays running; do not replace its ingress.
- HTTP (inside Gold LXD): `/`, `/account`, `/downloads`, `/support`, `/ai-guide` = 200; `/admin` unauthenticated = 303; unauthenticated `/account/api?action=me` = 401.
- Deployed Gold HTTP API script: `GOLD_HTTP_AUTH_AND_DEVICE_AFTER_SERVICE_RESTART=PASS`.

## Re-run of available repository selftests (13 scripts)

PASS:
- `selftest-gold-ab-native.mjs`
- `selftest-gold-agent-usage-native.mjs`
- `selftest-gold-analytics-native.mjs`
- `selftest-gold-connections-native.mjs`
- `selftest-gold-enrollment-native.mjs`
- `selftest-gold-job-ledger.mjs`
- `selftest-gold-plugin-pg-state.mjs`
- `selftest-gold-registry-persistence.mjs`
- `selftest-gold-session-redis.mjs`
- `selftest-gold-site-native.mjs`
- `selftest-gold-team-license-native.mjs`
- `selftest-v11-paddle-admin.mjs`

FAIL:
- `selftest-v11-paddle-billing.mjs`: `gold_paddle_pg_not_initialized` during `processEvent`; this legacy unit harness instantiates `PaddleBilling` without Gold native adapter. Correct the test harness to inject mock persistence when testing business logic, and separately test real event -> operator entitlement -> SQL durability on isolated LXD. Do not hide the failure.

The passing source tests above are mostly fake PostgreSQL/Redis simulations. They do not establish all-domain HTTP E2E acceptance.

## Paddle webhook code review

- `plugin-server/paddle-billing.mjs` checks `this.state.events[eventId]` before processing. Two concurrent deliveries of the same event can pass the check.
- `processEvent()` calls `this._persist()` but does not await its SQL commit; Plugin has an HTTP response flush middleware. Correct the awaited per-event durability and enforce a bounded single-writer processing lane or DB claim, with failure non-ack and replay safety.
- Existing `lib/gold-registry-persistence.mjs` `enqueue()` does not return the queued commit promise; make it return this pending promise to support explicitly awaited `_persist()`.
- Real PG Paddle row persistence already passed at commit `4c7ac58`, but complete signed webhook -> entitlement -> HTTP read -> restart -> read has not passed.
- Source modification via Light Remote was denied by the tool safety layer in this continuation. Never work around the rejection through a different execution path. GitHub REST connector file creation also returned 403 (integration permission only); VPS-ARM Git SSH push was previously successful.

## Public demo blockers / acceptance gate

1. Apply and verify Paddle webhook concurrency/durability/test correction through an authorized write operation.
2. Test actual canonical HTTP business paths against Gold LXD with PG17 and Redis8, including Team, License, OAuth, Support, Billing, fleet/job/agent path; write->read->restart->read and cleanup.
3. Ensure no JSONB generic business snapshots, no SQLite or private JSON registry fallback. Remaining filesystem writers in source must be classified as unreachable legacy paths or local secrets/logs; do not count a grep alone as proof of active runtime writes.
4. Configure **separate** Gold ingress only when app and API acceptance are satisfied. The VPS Traefik at 80/443 hosts existing services; do not overwrite live routing. Gold Plugin presently binds LXD loopback only, so a DNS A record by itself cannot serve Gold.
5. Confirm externally reachable HTTPS, account login and authorized admin routes before providing a domain mapping. No public demo URL is ready.

## Architecture constraints

Keep source branch and LXD independent of production. PostgreSQL owns canonical business records, Redis owns TTL/queues/leases/rate limits. Never use a global JSONB domain snapshot, and never use mock tests as final release acceptance.
