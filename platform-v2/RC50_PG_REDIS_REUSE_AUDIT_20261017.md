# RC.50 PostgreSQL/Redis source reuse audit — 2026-10-17

## Owner decision

Do not reimplement verified rc.50 SQL or transactional repository logic. Preserve RC.50 work as source references, and adapt it deliberately to the new independent Gold data plane. **Gold must use PostgreSQL for all business-durable data; Redis for ephemeral coordination. No JSON/SQLite business-store fallback.**

## Reused verbatim (byte verified from uncommitted legacy worktree)

Original root: `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform` at Git HEAD `554296649e2580ec36897452ce8042e20a08b4a0`.

- `platform-v2/src/storage/postgres.mjs`: exact rc.50 SQL, transactional advisory locking and parameterized account, owner/Free/Team quota, usage, and outbox repository.
- `platform-v2/src/storage/redis.mjs`: exact rc.50 TTL cache, atomically incremented fixed-window limiter, fail-closed denial.
- `platform-v2/src/storage/worker-uat.mjs`: exact rc.50 PG worker slots, lease generation and outbox acknowledgement/retry.
- `platform-v2/src/identity/free-rotation-uat.mjs`, `oauth-replay-uat.mjs`, `pg-rotation-store-uat.mjs`: existing rotation and one-time identity proof/replay prototypes.
- Five original `platform-v2/test/*.test.mjs` counterpart suites; **30/30 focused tests PASS** on Gold in one command, no DB service required (in-memory test fixtures).
- Existing `infra/pgredis/migrations/001..013` + checksum lock were ALREADY byte-identical to the rc.50 source (13/13), no new incompatible SQL fork **at the time of this historical audit**. Gold subsequently appended migration 014 for Plugin announcements without changing 001..013.

## Limits documented by the ORIGINAL code, not speculation

- Original `PgUatRepository` constructor enforces `allowUat===true`, database `light_remote_rc50_uat` and role `lr_rc50_app`. This is intentionally **not a production-grade Gold connection**. `verifyTarget` also denies superusers.
- Original `RedisUatAuxiliary` requires `allowUat===true` and `lr:rc50:uat:...` prefix. This is not an actual shared Gold Redis connection.
- Original `WorkerUatCoordinator` requires that UAT PG repository and trusted authorization callbacks. Do not mistake its fixture tests for live Fleet/Operator dispatch.
- Original source `operator-host/team-durable-dispatch-uat.mjs` uses `node:sqlite` as a **staging-only simulator**. It is intentionally **NOT ported** into Gold runtime.
- At original rc.50 worktree's `operator-host/executor.mjs`, only opt-in DEV WriterEpoch reservation PG connections were identified. No import of these `platform-v2/src/storage` repository classes by production Operator/Plugin, and existing JSON registry writers remained active.
- Original `platform-v2/MIGRATION_STRATEGY.md` and `portability/BACKUP_CONSISTENCY_DESIGN.md` both explicitly state PostgreSQL/Redis are UAT scaffold rather than authoritative storage for real Operator/Plugin. PG+Redis real cross-host dump and restore is **proven for synthetic fixtures**, not complete app state.

## Remaining engineering acceptance for all-PG/Redis Gold

1. Provision a separate Gold DB/roles and private Redis with legitimate owner-approved Docker capability; never reuse `rc50_uat` DB/roles or production credentials. Earlier run was denied `target_node_capability_missing`; do not bypass.
2. Adapt and validate original repository interfaces to a Gold-specific DB identity/role, without downgrading least-privilege gates. Connect to actual PG17/Redis8, apply checksum-verified migrations.
3. Refactor the real synchronous JSON-backed registries to call Gold PostgreSQL transaction-backed domain services, including all Operator account/session/device/enrollment/A-B/usage/Team/notification/licenses and all Plugin OAuth replay, Paddle, announcement/analytics, Google OAuth and support-outbox records. **No fallback to files** in Gold-only mode.
4. Confirm all real API routes and worker quota/outbox are wired, run process restart, stale token, revocation, payment idempotency and independent process/DB tests on a single signed commit; check no SQLite/JSON business writer remains in the actual launched services.

**Status:** source and contract reuse verified and committed. **Not an operational PG-only deployment.** This audit does not authorize a production cutover or claim one was done.
