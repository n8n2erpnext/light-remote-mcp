# Light Remote rc.50 — keep .mjs, modularize and scale safely

Decision date: 2026-10-10, all deployment experiments **UAT ONLY**.

## Decision
Keep native Node.js ESM (.mjs), Express 5 existing plugin facade, and current Operator HTTP/device transport. Do NOT rewrite working MCP/OAuth/Wall/Agent protocols in Fastify or another runtime simply to modernize syntax. React branch is an isolated preview, not a forced UI cutover. Modularize by domain with stable external API contracts; PostgreSQL holds durable authoritative state; Redis helps queues/cache/rate limiting, never payment or quota ledger.

## Legacy inventory / future target (source-derived)
| Legacy module or state | Postgres/Redis destination | Migration correctness gate |
| --- | --- | --- |
| account-registry.mjs / accounts.json | accounts, sessions, entitlements, verification tokens | keep account IDs, password hashes, existing session expiration, cookies and legacy OAuth issuer/secret; never force logouts |
| device-registry.mjs / devices.json | devices | retain device IDs and Wall approval relationship |
| device-access-grant-registry / device-access-grants.json | device grants (later schema) | explicit A/B authorization remains separate from account/team membership |
| device-connection-registry / device-connections.json | connection leases and sessions (later schema), Redis ephemeral presence | device reconnect and TTL precedence |
| agent-client-registry / agent-clients.json | client-to-account/operator bind registry (later schema) | revoke+renew isolation across client IDs |
| enrollment-registry / enrollments.json | enrollment challenges (later schema) | one-time use and expiry |
| pro-team-registry / pro-teams.json | teams, members, invitations, entitlements | 5 seats INCLUDING owner; independent trusted OAuth principal; 3 device workers shared |
| usage-registry / usage.json | usage_events idempotent ledger | owner-billed usage, no duplicate event/billable call |
| free-benefit-registry / free-benefits.json | installation identity / quota (later schema) | no false positives in shadow mode |
| license-key-registry / license-keys.json | licenses and redemptions (later schema) | redeemed keys and entitlements retained |
| account-notification-registry / account-notifications.json | messages, targeted recipients, read receipts (later schema) | schedule/expire and per-user read state |
| oauth.mjs in-memory usedCodes/usedRefresh/usedResume | Postgres one-time token consumption + Redis rate limits | PKCE, refresh replay defense; no cross-instance reuse |
| Paddle webhook + ERPNext | billing_events, outbox, charge/refund audit | signed webhook, idempotent provider event IDs, independent ledger and ERPNext reconciliation |
| Team SQLite WAL UAT simulator | worker_slots/jobs/usage_events (later adapter) | 3 slots, fencing generation, stalled job kill/retry and quota check; UAT simulator is NOT real execution |

**Important:** first SQL migration contains core tables but not every legacy field/table. It is a scaffold, NOT a full state migration and NOT production-ready.

## Allowed deployment topology
- Production ARM LXD `light-remote-direct`: untouched.
- Existing rc.50 plugin staging LXD `light-remote-rc50-uat`: untouched by database migration.
- New Docker Compose `lightremote-rc50-v2`: private network, dedicated PostgreSQL 17 and Redis 8 volumes, no published host port, no production credentials.
- Optional LXD `light-remote-rc50-v2` created for future API canary; network configuration is still under review, currently no traffic routing. DO NOT place it in public Traefik.
- Feature branch `feature/rc50-v2-platform` based on `3ad4467`. Previous `feature/rc50-web-react-ts-20261010` and owner Pro Team feature branch left intact.

## How to guarantee user continuity — staged transition
1. Snapshot source code + ALL live state files, encrypted token material and database exports through owner-authorized mechanism. Record file checksums/ownership without showing raw secrets. Confirm backup restoration and retention policy. No production data import by default.
2. Build a **read-only, opt-in** JSON export + schema-aware translator; test against synthetic/UAT fixtures, not customer data. Reject missing/ambiguous IDs and invalid token expiries. Map and reconcile every material field.
3. Add a single trusted event/outbox bridge to the legacy writer. The legacy writer remains THE ONLY authority; PostgreSQL receives replayable shadow events with monotonic checkpoints, unique event IDs, and conflict metrics. Do not enable parallel independent authoritative writers.
4. Shadow-read accounts, entitlements, devices, sessions and usage; compare row counts, IDs, hashes, expiries, grant invariants, and Paddle/ERPNext accounting. Require 0 unexplained mismatches; maintain unresolved queue for manual resolution.
5. Load test 100 -> 500 -> 1,000 *concurrent connections* with representative tools/queue mix, bounded workers/device, rate limits and PostgreSQL pool limits. Measure P95/P99, event-loop lag, Postgres active connections, Redis memory/eviction, queue delay and webhook idempotency. Do not equate online sessions with simultaneous remote commands.
6. Only after approved E2E UAT, issue a **separate owner-approved** canary release and shared session/token compatibility plan. Keep public OAuth issuer/audience, redirect URLs, device keys, Local Wall A/B, and MCP tool contracts identical. Create an explicit rollback checkpoint and stop-the-world writer fencing option for unreconciled failure.
7. Progressive rollout to a small approved set; monitor no re-login, no lost grant, usage reconciliation, no double billing, no external Webhook anomalies. Roll back traffic AND authoritative writes together (no split brain), then expand deliberately.

## Technical boundaries
- API service does not import database-specific code directly; handlers call domain service; service calls repository interface. PostgreSQL adapter lives in infra, uses explicit transaction, parameterized SQL, constrained pool and non-superuser role.
- Strict `LR_V2_DATA_MODE=uat-only` / explicit allowUat flag for initial connector. `verifyTarget()` rejects any DB not named `light_remote_rc50_uat` and DB superuser. The role creation needs separate authorized setup; it is not ready yet.
- Durable usage and billing use PostgreSQL transactions and unique event IDs. Redis has bounded TTL and fail-open/fail-closed policies per business domain: security authorization fails closed, display cache can degrade gracefully.
- No cross-account execution dispatch from Team simulator until verified principal proof, device lease fencing and local A/B all implemented.
- All services must start without Redis for read-only paths; quota mutations cannot silently treat Redis cache as the source of truth.
- Secrets stay in ignored mode-protected files or authorized secret manager; no check-ins, no print in logs, no bridge to user-visible pages.
- Existing `/account/api`, `/admin/api`, `/mcp`, OAuth and client protocols remain stable; stage can have independent hostname but must not re-register production plugin.

## Current implementation status
- Docker PostgreSQL 17/Redis 8 running healthy in private UAT network; independent persistent volumes. No host-exposed ports.
- SQL core v1 applied, synthetic rollback fixture validated no test data persisted.
- Modular ESM adapters with pure unit tests; **not imported by production or existing staging Operator**.
- Creation of a dedicated least-privilege DB application role was blocked by tool safety checks; DO NOT substitute the database superuser as app credentials.
- Full identity/session/Key/Team/Paddle schemas, shadow adapters, real device operator connectivity, customer migration, concurrent load tests and production promotion are STILL OPEN.
