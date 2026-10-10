# Light Remote rc.50 — keep MJS, modular PostgreSQL/Redis UAT
Date: 2026-10-10 (Asia/Ho_Chi_Minh)

## Owner decision
Do NOT force a full rewrite of old web/API/MCP to React/TypeScript/Fastify just for syntax reasons. Keep working Node.js .mjs, refactor domains/service/repository boundaries progressively. React preview branch is isolated and was NOT promoted. Preserve existing production customer accounts, cookies, OAuth sessions/PKCE/refresh, devices, Local Wall A/B and Paddle/ERPNext while adding Postgres durable store/Redis ephemeral cache.

## Source / boundaries
- Worktree: `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform`
- Branch: `feature/rc50-v2-platform` created from React-preview snapshot `3ad4467`, source untouched until this branch; production main and active Pro Team branch unchanged.
- Canonical plan: `platform-v2/MIGRATION_STRATEGY.md`
- Stack: `platform-v2/compose.yml`, `sql/001_core.sql`, `sql/002_usage_monthly.sql`, `sql/test_core_rollback.sql`.
- Domain adapters: `platform-v2/src/storage/postgres.mjs`, `redis.mjs` (require explicit UAT mode, fail-closed).
- Tests: `bash platform-v2/scripts/check.sh`.
- New Docker project `lightremote-rc50-v2`, services `postgres:17-alpine` and `redis:8-alpine` on `lightremote-rc50-v2_private` internal Docker network, zero published ports; separate named volumes; dedicated credentials in ignored `platform-v2/secrets`.
- Docker Compose limits: PostgreSQL 768 MiB/0.75 CPU, Redis 384 MiB/0.30 CPU. UAT sizes only, NOT production sizing.
- Separate LXD `light-remote-rc50-v2` created for future isolated API work; LXD DHCP did not assign IPv4; guest-only 10.192.135.66 network config trial was attempted, but NOT verified as routable. Container was STOPPED to avoid excess usage. No proxy/public endpoint wired. Existing rc50 staging and production untouched.

## Confirmed test outcome
- PG and Redis healthy with healthchecks; published Docker Ports = null; network `internal:true`.
- SQL core 001 and 002 applied. SQL transaction fixture tests two synthetic accounts, Team membership, three worker slots, rejects fourth slot, idempotent usage and payment event, ROLLBACK; final synthetic rows = zero.
- 7/7 Node.js adapter unit tests PASS: target DB/superuser restriction, transactions and rollback, account uniqueness, authorized usage, idempotency, Redis namespace and TTL.
- PostgreSQL monthly aggregate is updated atomically with accepted event, duplicate events never increase quota twice.
- **These are infrastructure/schema/mock tests, not actual production migration or benchmark throughput.**
- A least-privilege application role creation operation was blocked by tool safety. Do not try to bypass or point server to DB superuser. Future owner-authorized DB role + connection tests required.
- PostgreSQL/Redis have NO connections from legacy Operator, existing staging plugin or production.
- Existing rc50 React preview endpoint is still separate and unchanged.

## Unfinished
- Full schema parity beyond first 2 migrations: device grants, OAuth one-time token replay, leases, Team invitations/notifications, license redemption, Paddle/ERPNext ledger details.
- Non-mutating snapshot exporter, per-domain import translator for non-sensitive synthetic fixtures, checksums + reconciliation, replayable shadow event feed, failback strategy, backup/restore verification.
- Owner-authorized least-privilege DB role & connection, real local integration tests, workload-specific load tests then selective feature canary.
- GitHub write permission previously 403 for feature branch; local commits and bundle backup required until resolved.
- No production cutover without explicit owner approval and zero unresolved data/session/billing mismatches.

## Continuation — synthetic-only PostgreSQL/Redis hardening (2026-10-10)
- Explicit OWNER CONSTRAINT: absolutely no production JSON/account/session/keys/device/paddle/erp data may be read, copied or imported into this rc50-v2 stack. All DB work uses synthetic fixtures in `platform-v2`; see `platform-v2/UAT_DATA_PROVENANCE.md`.
- Added SQL `003_auth_device_communications.sql`: hash-only OAuth one-time token consumption registry, device connections/AB requests/grants, agent clients/bindings, enrollment, licenses, notifications, audit. No live production copy.
- Added `004_tenant_binding_guards.sql`: enforce device connection ownership at DB level, allow separate Team member AB grant for owner's device without accidentally equating the member with device owner, and prevent cross-actor direct agent bindings / team-member grants being used as direct device grants.
- Added `005_team_seat_guard.sql`: team row-lock trigger enforces max 5 seats INCLUDING owner, rejects sixth member, protects cap shrink below occupancy, supports revocation/reuse.
- Added SQL rollback-only fixtures `test_auth_device_rollback.sql`, `test_tenant_binding_rollback.sql`, `test_team_seats_rollback.sql`. Existing `test_core_rollback.sql` unchanged except prior monthly checks. All fixtures PASS and rollback.
- Added actual multi-connection test `test/concurrent_team_seats.py` with 8 concurrently arriving synthetic member joins: exactly 4 accepted / 4 rejected; unique generated `uat_parallel_` IDs all deleted in finally; cleanup and zero leftovers confirmed.
- Hardened `PgUatRepository.recordUsage` to REQUIRE trusted `authorizeUsage` AND `budgetFor` callback; within a single PostgreSQL transaction it acquires owner/month advisory lock, rejects changed-payload idempotency keys, enforces remaining monthly cap and only then writes event+aggregate exactly once. This is source-only with fake DB unit tests, NOT yet connected to PostgreSQL as live app (no least-privileged application role).
- Added UAT Redis atomic fixed-window Lua `INCR`/`EXPIRE` limiter with strict namespace and fail-closed backend errors. Redis remains non-authoritative for money and quota.
- `platform-v2/scripts/check.sh`: 8/8 Node unit tests, migrations 1–5 idempotently, all four SQL rollback contract groups, eight-way real PG seat race, network confinement/health checks all PASS. GitHub workflow script updated but GitHub CI not verified (write access previously 403).
- UAT PostgreSQL row-count check: accounts=0, devices=0, sessions=0, usage=0, billing=0, team=0, oauth_tokens=0, audit=0. Migration versions 1..5 only.
- PostgreSQL17/Redis8 Docker healthy on `lightremote-rc50-v2_private` internal-only network; no published ports. Separate experimental LXD `light-remote-rc50-v2` remains stopped.
- Last HTTPS health checks: production=200 TLS verification 0, existing rc.50 staging=200 TLS verification 0. No production code, route, proxy, installer, or customer settings changed.
- PENDING: authorized least-privileged UAT app DB role (earlier blocked; do NOT bypass), end-to-end app-to-DB tests; synthetic legacy contract/diff fixtures; OAuth and AB replay lifecycle test, billing ledger E2E; load test 100/500/1000 simulated sessions and network loss; full Postgres backup/restore. NO production data migration yet.
