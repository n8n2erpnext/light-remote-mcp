# Light Remote rc50 P0 — PostgreSQL single-writer generation / transactional fence UAT

**Status:** isolated PostgreSQL 17 dev UAT experiment, **not** a product-wide migration guarantee. Date: 2026-10-12. The current MJS and Express 5 runtime, OAuth, billing, Agent, Fleet, PTY and filesystem continue unchanged.

## Exact isolation and change scope

Owner authorized Docker activity confined to the rc50 development environment. Before any database write, inspected `docker compose -p lightremote-rc50-v2 -f platform-v2/compose.yml ps --format json` and the internal network. The PostgreSQL and Redis services are healthy; Compose source labels point to this rc50 worktree, no host port is published, `lightremote-rc50-v2_private` is internal. A `psql` preflight confirmed `current_database()=light_remote_rc50_uat`, `current_user=lr_rc50_uat`, and synthetic schema initially `ABSENT`.

New SQL installed **only** in `light_remote_rc50_uat.lr_rc50_epoch_synthetic`: one singleton writer-authority table and four `SECURITY INVOKER` UAT functions `start_writer_uat`, `assert_writer_uat`, `renew_writer_uat` and `fence_writer_uat`. No roles created/altered, no existing migration changed, no public table modified, no schema copied, no backup taken. The existing immutable `platform-v2/sql/migrations.lock.json` still lists versions 1–13 and `public.lr_schema_migrations` max remains 13. The synthetic schema intentionally remains for rc50 P0 tests; last observed state `generation=5, state=fenced, holder=NULL`. No production instance or billing DB accessed.

Files:
- `uat_writer_epoch.sql`: completely namespaced, isolated UAT definitions. **Not** an automatically applied migration or a deploy step.
- `test_writer_epoch_uat.sql`: transaction-local fail-closed checks (writer A, stale/foreign writer rejection, explicit fence A→B, expired lease), ending `ROLLBACK;`. This test does not persist its state changes.
- `verify_writer_epoch_concurrency_uat.py`: verifies EXACT Compose project, healthy unexposed Postgres and UAT DB/user, then races two real independent `docker compose exec -T ... psql` processes against the singleton. Exactly one wins, one receives error. A third process executes an admitted DB transaction while a concurrent fence waits for its row-share lock; stale generations then fail, new holder only enters with higher generation. Leaves the synthetic row explicitly FENCED.
- `../test/test_pg_writer_epoch_source_guard.py`: six local negative/source guard tests ensure synthetic schema scope, `SECURITY INVOKER`, `FOR SHARE` and `FOR UPDATE`, no automatic expired lease takeovers, rollback-only SQL fixture, historical migration lock unchanged.

## Observed checks (do not extrapolate)

1. Installed `uat_writer_epoch.sql` into the isolated dev database: `BEGIN; CREATE SCHEMA; CREATE TABLE; INSERT 0 1; CREATE FUNCTION` ×4; `COMMIT;` — **PASS**.
2. Transaction-only SQL fixture: **PASS** `RC50_SYNTHETIC_PG_EPOCH_PASS initial=1 first=2 fenced=3 new=4`; `BEGIN / DO / ROLLBACK`.
3. True two-process race and separate transaction lock test: **PASS** `RC50_PG_WRITER_EPOCH_CONCURRENCY_PASS`, exactly one winner, foreign holder and stale generation denied, fence waits for admitted DB transaction, new writer strictly higher, final state fenced.
4. Post-check: `epoch=5,state=fenced,holder=NONE`, `schema_version_max=13`, `public_epoch_objects=0` — **PASS**.
5. Offline SQL source checks **6/6 PASS**.
6. Worktree Git guards and code-only incremental bundle recorded in the handoff.

## The precise guarantee demonstrated

In the same PostgreSQL transaction as its mutation, an admitted writer must call `lr_rc50_epoch_synthetic.assert_writer_uat(holder,generation)` and **abort if false**. The function `SELECT ... FOR SHARE` holds a PostgreSQL row lock until the transaction commits; fencing uses `FOR UPDATE`, so it waits for already admitted DB mutations, then increases `generation` and rejects subsequent stale claims. There is **no automatic takeover just because the old lease expired**: expiry fails closed; an explicitly authorized fence is required.

## Limitations / fail-closed boundaries

- The SQL is a **simulation of fencing protocol semantics**. It is not wired into any production/dev Operator HTTP mutation, Plugin OAuth/Paddle billing, audit logger, device command execution, PTY, JSON storage or support outbox. It cannot stop a remote computer that already accepted a command. Neither the SQL nor the UAT database controls Wall A/B grants. Product-wide single-writer authority remains **NOT_READY**.
- Any application DB mutation that does not call the guard **in the SAME transaction** bypasses the barrier. A preflight guard followed by a separate SQL transaction is a TOCTOU race.
- This UAT uses the sole `lr_rc50_uat` DB role with owner privileges. `fence_writer_uat` is **NOT owner-authenticated** by SQL and does not implement an admin/auditor privilege model. Prior least-privilege role provisioning was safety-blocked and remains untouched.
- External JSON, webhook delivery, remote commands and filesystem effects cannot join a PostgreSQL transaction. Real cutover requires independently fenced ingress, durable outbox, PTY/job drain, monotonic epoch propagated to clients, and reconciliation. Source and destination may never be active concurrently.
- No cross-host move, restores, AES-GCM runtime validation, dual Docker stacks or production secret/state transfer occurred. Prior safety-blocked operations must never be rerun by PTY or alternate interface.

## Next legitimate P0 implementation

1. Design rc50 **integration adapters** requiring a generation token checked in the same PostgreSQL transaction for actual UAT mutations; do not enable or serve until explicit dev-only opt-in, host labels, owner authorization and test coverage. SQL role separation must receive permission review.
2. Build a **generation-scoped outbox** for side effects outside PostgreSQL. A command dispatched before fence must be safely drained; a command not yet dispatched must be denied or reauthorized under new generation. Reconcile outbox IDs, A/B grant revocation, usage, billing provider idempotency, terminal jobs and future Redis rate state.
3. Integrate the existing synthetic `FreezeEpochGuard`, shadow FreeBenefit JSON durability fixture and synthetic journal watermark with a **test-only coordinator**, without confusing process-local ACKs for durable cross-plane evidence.
4. Independently validate signed ARM64/AMD64 release artifact package when available; no runtime production cutover while barriers are missing.
