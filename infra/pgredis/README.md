# Gold PostgreSQL 17 + Redis 8 — isolated development

This is the replacement development data plane, **not production cutover**. It replaces discarded rc.50 test volumes with fresh isolated named volumes. Do not import rc.50 synthetic data or production secrets.

- Always use a unique `-p` project name and explicit secret paths. Never use `docker system prune`, shared credentials, published host ports or `redis FLUSHALL`.
- SQL `migrations/001..013` and the matching checksums in `migrations.lock.json` are carried unchanged from the previously tested rc.50 **synthetic UAT**. They are **not yet a production migration contract**. Do not rewrite historical migrations; version any change 014+.
- `POSTGRES_USER` is **bootstrap/migration owner only**, not the future Operator/Plugin application database role. Grant minimal privileges and prove revocation before enabling app connections.
- Redis serves cache, TTL, throttling and worker coordination; critical user/identity/billing/replay/outbox data belongs in PostgreSQL. Never claim migration completed while Operator/Plugin still write JSON.
- Separate app acceptance requires verified read/write through PostgreSQL/Redis, actual data import under maintenance, preservation of existing identifiers/revocations, no silent JSON fallback, rollback and approved cutover.
- Start and inspect with `LR_GOLD_PG_ENV=/absolute/path/postgres.env LR_GOLD_REDIS_CONF=/absolute/path/redis.conf docker compose -p lr-gold-20261017 -f infra/pgredis/compose.yml up -d`.
- PostgreSQL health check alone does not establish schema, privileges or API integration.
- Gold client Windows/macOS source must be reconciled with branch `codex/rc49-macos-robot-permissions@2eb1553` before product build; see `docs/releases/GOLD_SOURCE_RECONCILIATION_20261017.json`.
