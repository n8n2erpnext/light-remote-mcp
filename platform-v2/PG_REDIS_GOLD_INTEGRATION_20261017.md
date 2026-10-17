# Gold PostgreSQL / Redis connection and Notification persistence — 2026-10-17

## What was added

- `platform-v2/src/storage/gold-data-plane.mjs`: real Node `pg` and `redis` clients, accepting only independently scoped Gold credentials from 0600 files; PostgreSQL database must be `light_remote_gold_dev`, non-superuser application role `lr_gold_app`. Checks exact 1..13 installed migration versions, Redis PING and an isolated TTL/NX/read/delete probe. If either backend fails, it closes connections and throws; **no JSON or Redis-to-in-memory fallback**.
- `platform-v2/src/storage/notifications-pg.mjs`: replacement of JSON-file notification persistence using the existing RC.50 `lr_notifications` / `lr_notification_reads` schema, parameterized inserts/queries, recipient/plan/group audience filters, atomic mark-read idempotency and no file-backed storage.
- Existing `operator-host/executor-routes-account.mjs` now awaits Notification repository methods, maintaining compatibility with legacy synchronous test repositories and asynchronous PostgreSQL storage.
- Operator now supports an **explicit development-only opt-in**, `LR_GOLD_NOTIFICATIONS_PG=1`, that opens verified Gold PostgreSQL/Redis connections and instantiates `GoldPgNotificationRepository` before opening its socket. Missing credentials, wrong database/role/schema, or Redis failure abort startup rather than silently falling back to JSON. No other domain switches to PostgreSQL through this flag.
- `deploy/scripts/selftest-gold-notification-pg-mode.mjs` proves fail-closed startup without the independent authorization/configuration and validates every awaited route. `deploy/scripts/probe-gold-data-plane.mjs` is a credential-redacted operator-owned live connection probe; it is **not yet runnable** against actual Gold DB until legitimately provisioned.
- `platform-v2/test/gold-data-plane.test.mjs` adds unit tests for database identity, role, schema versions, credential file permissions, Redis readiness/namespace and cleanup, connection failure, and PostgreSQL notification contract.

## Current verification

- **35/35** Node test cases PASS across five preexisting rc.50 source suites and new Gold suite.
- Existing Notification route, OAuth/Team and isolated Operator/Plugin smoke tests PASS.
- Unit suites use injected pools and Redis clients; **no actual new Gold PG17/Redis8 instance was contacted**. The independent Docker startup was previously denied with `target_node_capability_missing`; do not bypass using alternate routes or omitted capability.
- Actual Operator/Plugin still instantiate JSON-backed registries, including account, sessions, device, grants, Team, notifications, payment records and Plugin OAuth/outbox. There is **no complete PG-only production runtime** yet.
- No SQLite business adapter has been imported into Gold runtime. The rc.50 `team-durable-dispatch-uat.mjs` SQLite simulator remains historical reference only.

## Verified schema-migration executor — follow-up

- `platform-v2/src/storage/gold-migrations.mjs` reads the immutable 13-file RC.50 manifest, independently SHA-256 verifies each SQL payload, rejects unexpected files and nontransactional input, and executes only under a PostgreSQL session advisory lock. It requires database `light_remote_gold_dev`, role `lr_gold_migrator` (not the application role and not superuser). Existing versions are checked before applying, and every applied version is verified in the schema ledger.
- `deploy/scripts/apply-gold-migrations.mjs` is a real, owner-gated CLI for the future Gold database. Requires `LIGHT_REMOTE_GOLD_INDEPENDENT=1`, `LR_GOLD_MIGRATIONS_APPROVED=1`, `LIGHT_REMOTE_GOLD_ROOT` and a 0600 migrator URL file referenced by `LR_GOLD_MIGRATOR_URL_FILE` under that root. It does not provision a database, create users, touch live production or start Docker. Database provisioning and role grants must be reviewed and performed separately.
- `platform-v2/test/gold-migrations.test.mjs` 4/4 PASS: locked manifest, corruption rejection, first-time 13-file sequence, idempotent replay, role/DB/superuser denial, drift detection and advisory-lock cleanup on failure. Unconfigured CLI fails closed.
- Migration tests use an injected mock PG client. **No Gold database was migrated** because the required isolated database is not running and Docker start has previously been denied by local Light Remote policy.
## PostgreSQL application-role hardening — 2026-10-17

- `platform-v2/src/storage/gold-permissions.mjs` validates **all 35 tables** and **14 application/trigger functions** against the exact locked 13-migration source and live PostgreSQL catalog, requires database `light_remote_gold_dev`, non-superuser migrator `lr_gold_migrator` and app `lr_gold_app` without superuser/database-create/role-create/replication/bypass-RLS rights or migrator membership.
- Within one guarded PostgreSQL transaction it denies PUBLIC table/sequence grants, allows `USAGE` but not `CREATE` on public schema for the app, grants business table operations on 34 domain tables, restricts `lr_schema_migrations` to read-only, and grants only eleven explicit SQL worker/quota/rotation functions to the app. The three internal trigger functions are **not directly executable** by the app. A post-grant effective privilege audit rejects excess DDL, ledger writes and unexpected function execution.
- Updated `deploy/scripts/apply-gold-migrations.mjs` requires **both** `LR_GOLD_MIGRATIONS_APPROVED=1` and `LR_GOLD_PERMISSIONS_APPROVED=1`; it performs schema then role grants with separate guarded transactions. It **never** creates DB/roles, and no real DB migration was executed.
- Updated `verifyGoldSchema` in `gold-data-plane.mjs` to reject a Gold application role with schema CREATE, migration ledger write or migrator membership, even if the 13 migration versions match.
- `platform-v2/test/gold-permissions.test.mjs` adds four tests for table/function allowlists, effective grants, role/member/catalog rejection, and full transactional rollback. Combined prior test suite: **43/43 PASS with mocked PostgreSQL/Redis clients**, plus separate Operator/Plugin isolated smoke PASS.

**Operator owns separate migrator/app credentials and must establish actual database privileges on the isolated PostgreSQL server before Gold production acceptance. This code is a tested provisioner/validator, not evidence the database exists.**
## Strict next gates

1. Legitimately provision/start Gold database containers and a non-superuser app role. Apply immutable 1..13 migrations and prove actual two-service PG/Redis connections; environment URL files and role grants must be created by the authorized owner-side provisioner.
2. Replace all synchronous registry/file-backed business writers and Plugin OAuth/Paddle/outbox paths with transactional PG services; ensure no silent JSON fallback in Gold mode. Distinguish permissible **config/key files** and static JSON documents from business-record databases.
3. Wire `GoldPgNotificationRepository` into the verified actual DB connection only after the remaining account identity and lifecycle is PG-authoritative. Test database read/write, restart, cancellation/read-state and revocation.
4. Resolve rc.48/rc.49 client source mismatch and test full API+device+Team A/B, then operate a separately deployed instance with **production fully online but deliberately not shared**. Only call it Gold after every acceptance gate passes.

**Status: source checkpoint only — not a deployed PG/Redis-only system.**
