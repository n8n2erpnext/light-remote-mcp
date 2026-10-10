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
- A dedicated least-privilege app DB role has NOT been provisioned: tool security blocked that action. Don't connect an application with PostgreSQL superuser credentials. No live data was imported.
