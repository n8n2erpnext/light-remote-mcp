# Light Remote rc.50 data platform UAT

**Isolated evaluation only.** This stack does not publish host ports, does not change production services or accounts, and must not be connected to official MCP endpoints. The official plugin and production Operator keep their current storage.

- `postgres:17-alpine`: transactional source of truth for future account/session/device/Team/usage/billing/jobs/audit
- `redis:8-alpine`: cache, queue, rate-limits and ephemeral invalidation; not a billing ledger
- Docker Compose isolated `internal: true` network; separate project volumes; resource limits; per-environment secrets ignored by git
- `sql/001_core.sql`: additive schema designed for UAT only, applied explicitly after a clean database is ready
- No automatic conversion of production JSON state. We will implement independent migration/verify/rollback before any cutover.

Commands (from directory, only after generating `secrets/postgres.env` and `secrets/redis.conf`):

```sh
docker compose -p lightremote-rc50-v2 -f compose.yml up -d
docker compose -p lightremote-rc50-v2 -f compose.yml ps
docker compose -p lightremote-rc50-v2 -f compose.yml exec -T postgres psql -U lr_rc50_uat -d light_remote_rc50_uat < sql/001_core.sql
docker compose -p lightremote-rc50-v2 -f compose.yml exec -T postgres psql -U lr_rc50_uat -d light_remote_rc50_uat -c "SELECT version FROM lr_schema_migrations ORDER BY version;"
```

Hard rules: Never place passwords in source or logs. No public port mapping. Never point production or original rc.50 staging to this database. Test backup and restore before any import. Migrations must be additive and idempotent; old JSON remains authoritative until independently verified.

## New progress in this UAT
- `sql/002_usage_monthly.sql` adds transactional monthly usage totals (fast per-owner quota read). Event IDs remain durable and idempotent.
- `src/storage/postgres.mjs` wraps transactions, parameterized SQL and the event+monthly total in one transaction; a trusted authorization callback is REQUIRED before any billed usage is written.
- `src/storage/redis.mjs` is namespaced/TTL-only cache. Neither it nor Redis queues may be used as the money or quota ledger.
- `bash scripts/check.sh` exercises 7 native Node.js unit tests, PostgreSQL schema v1/v2 (idempotent), SQL fixtures with ROLLBACK, and network/port confinement.
- `MIGRATION_STRATEGY.md` explains preservation of active sessions/keys and the long phased transition without touching production.
- `../docs/LIGHT_REMOTE_MJS_SCALE_SYSTEM_AUDIT_2026-10-11.md` is the full source-derived scale audit, with MJS-only plan and priorities.
- A dedicated least-privilege app DB role has NOT been provisioned: tool security blocked that action. Don't connect an application with PostgreSQL superuser credentials. No live data was imported.

## 2026-10-10 continuation — synthetic data only
- Migrations `003_auth_device_communications.sql`, `004_tenant_binding_guards.sql`, `005_team_seat_guard.sql` add a complete first-cut auth/device/Team binding skeleton and database-enforced seat limits.
- A Team owner consumes one of the five seats even when not duplicated in `team_members`. A row-locked trigger rejects the sixth active seat; transactional UAT tested.
- A Team member's A/B grant can reference the owner's connection but a direct agent-client cannot borrow another account's grant or use a `team-member` grant as a device binding.
- `PgUatRepository.recordUsage` uses a PostgreSQL advisory transaction lock for owner/month, explicit trusted authorization and budget callback, and an idempotent event+monthly total write in the same transaction. Zero budget means no new calls. This is still UAT-only and not wired into real tool metering.
- `RedisUatAuxiliary.rateHit` is a namespaced atomic Lua fixed-window limiter; Redis failures throw instead of granting unlimited requests.
- `test/concurrent_team_seats.py` checked 8 actual concurrent join attempts on a temporary synthetic team: 4 accepted, 4 denied, all fixture records removed.
- `bash scripts/check.sh` applies migrations 1–5 repeatedly, runs Node unit tests and four SQL rollback fixture groups plus the independent concurrency fixture; validates healthy private DB services with NO published ports.
- `UAT_DATA_PROVENANCE.md` documents and checks that no production data has been used. The unprivileged app role remains pending; never use a database owner as an application identity.

## 2026-10-11 — Worker/outbox transaction hardening (synthetic UAT only)

- Added `sql/006_worker_outbox_leases.sql`: PostgreSQL worker claim with 3 slots/device, lease token **hash** and monotonic generation, expiry/reclaim, stale completion/renewal rejection, transactional job-finished/lease-expired outbox. Database never dispatches a real OS process.
- Added `sql/007_worker_function_permissions.sql`: revokes PostgreSQL default `PUBLIC EXECUTE` from all 6 worker/outbox functions; functions remain `SECURITY INVOKER`. Adds unique optional outbox dedupe key.
- Added `sql/test_worker_outbox_rollback.sql`: synthetic owner/member/job/slot tests, wrong token/generation denial, stale lease reclamation and expiry, finish exactly once, outbox claim/ack/retry/stale acknowledgement; all within BEGIN/ROLLBACK.
- Added `sql/test_worker_function_acl.sql`: asserts none of those functions is exposed to PUBLIC or elevated SECURITY DEFINER.
- Added `test/concurrent_worker_outbox.py`: actual 8 concurrent PostgreSQL worker requests -> exactly 3 unique slots and 5 wait. Actual 8 outbox consumers -> 8 unique claims. Generated `uat_workers_*` fixture records are deleted explicitly in finally and checked clean.
- Added `src/storage/worker-uat.mjs`: Node.js ESM coordinator with injected PostgreSQL adapter, mandatory verified UAT database, explicit trusted claim/outbox callback, bound SQL parameters, generation-bound claim/renew/finish and outbox ack/retry; NOT imported by any live Operator or public API.
- Added `test/worker-uat.test.mjs`: five fail-closed policy and parameter binding tests.
- `scripts/check.sh` now runs all 13 native Node.js unit tests, migration 001–007 idempotently, 5 synthetic SQL rollback contract groups, SQL function ACL guard, two concurrent fixture suites, and Docker internal-network/no-published-port check.
- **Important security limitation**: SQL worker function currently permits only owner=actor claims; member execution is explicitly blocked until trusted OAuth principal, per-member A/B grant, worker fencing AND OS/bridge termination are integrated. The database lease alone cannot stop already running commands on a device.
- No production state was opened/read/imported/copied, no real account/device/job is sent to this database, no official MCP plugin/production/staging Operator changes, no client/updater/policy changes. All test ids/emails are synthetic and rollback/cleanup verified.
- Least-privileged PostgreSQL app role remains unavailable (earlier tool protection); **do not** connect an application with database owner credentials or bypass this restriction. No benchmark for 1,000 concurrent agents has been performed.
