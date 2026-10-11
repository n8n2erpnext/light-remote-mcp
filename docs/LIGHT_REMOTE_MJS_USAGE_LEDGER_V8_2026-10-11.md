# Light Remote MJS-only — PostgreSQL usage ledger v8 (synthetic UAT)
Date: 2026-10-11, Asia/Ho_Chi_Minh

## Scope / non-negotiable data boundary
No production account, device, key, session, usage, billing, Paddle, ERPNext or live registry was read, copied, imported or shadow-synced during this work. The real MCP/Operator/API and existing rc50 staging service still use their previous storage. Work was strictly in `feature/rc50-mjs-scale-20261011` on independent PostgreSQL 17 and Redis 8 UAT containers with an internal-only Docker network (no published host ports).

## Bug discovered and fixed in the isolated UAT model
The initial SQL schema `lr_usage_events` enforced `UNIQUE(job_id)` and the old experimental JS repository treated repeated `job_id` as an idempotency collision. A job may contain multiple individually billable tool calls, so using job ID as the charge deduplication key undercounts calls and obscures usage.

The correct event identity is a unique, deterministic `event_id` per *billable action*, while `job_id` is optional nonunique trace context. Replaying the same event ID with exactly the same payload is a no-op; replaying it with changed payload is rejected. An event ID must be stable across retries, not generated anew each time a tool call retries.

## Files and behavior
- `platform-v2/sql/008_usage_event_idempotency.sql` is an additive migration for already-initialized UAT. Drops old unique job index; makes nonunique job index; introduces `lr_usage_budgets` and `lr_charge_usage_uat` function. SQL function uses transaction-scoped advisory lock by owner/month, idempotent event lookup, owner/account/device/job verification, authoritative monthly budget in PostgreSQL, atomic detail+aggregate writes and revokes `PUBLIC EXECUTE`. Team-member actor is **deliberately rejected** until trustworthy owner+member OAuth principal AND separate Local Wall A/B approval are available.
- `platform-v2/sql/001_core.sql`: UAT baseline amended to create the nonunique job index, avoiding regression when repeated schema checks run after several tool calls in the same job. **Before any future real migration, move to an immutable versioned migration runner instead of rerunning all initial SQL files.**
- `platform-v2/sql/test_usage_event_rollback.sql`: creates ONLY synthetic accounts/device/job/usage, verifies three independently billable events in one job, replay/no-double-charge, quota exceeded, wrong actor/device, altered-event conflict, and ROLLBACK with zero fixture rows.
- `platform-v2/test/concurrent_usage_quota.py`: 16 actual parallel PostgreSQL requests to synthetic owner, quota 6; 6 accepted, 10 denied; replay all accepted event IDs returns false, count remains exactly 6; finally deletes only uniquely generated `uat_quota_*` rows.
- `platform-v2/src/storage/postgres.mjs`: `chargeUatEvent()` calls only the verified UAT SQL function using parameterized SQL. Any connection must pass `verifyTarget()` before reads/writes; validation enforces DB name `light_remote_rc50_uat`, role `lr_rc50_app` and no superuser. App-level callback metering `recordUsage()` is **test-only** and not enabled by default. No process imports this module into the live Operator.
- `platform-v2/test/storage.test.mjs`: explicit role gate, no pre-init writes, multi-event per job, replay/tamper tests, SQL-bound function mock and disabled test-only callback path.

## Verified UAT outcomes
- `bash platform-v2/scripts/check.sh` PASS: 17/17 Node tests, old migrations 001–007, five SQL rollback groups, Team/worker/outbox concurrency, internal-only network, healthy PG/Redis.
- Migration 008, its SQL rollback suite and synthetic 16-way concurrency test PASS when run **manually and separately**. The current check.sh and remote GitHub workflow do NOT automatically execute migration 008 or its new SQL/concurrency tests; prior security tooling blocked editing CI/runner and this work did not bypass that boundary.
- Targeted legacy tests PASS: usage v09, renewal v11, owner-index 5000 synthetic, Free 10k, PRO Team invite quota, Team OAuth proof, Paddle billing.
- After tests, UAT tables: accounts=0, jobs=0, usage_events=0, usage_monthly=0, usage_budgets=0, outbox=0. PostgreSQL UAT has migration metadata up to version 8. `lr_charge_usage_uat` PUBLIC EXECUTE=false.

## Still open / gates before production
1. A least-privilege `lr_rc50_app` role has **not** been provisioned; prior tool safety blocked it. DO NOT use the bootstrap DB owner as application credentials or work around access restrictions. SQL fixture tests run through the isolated UAT database owner *only as UAT migration/test administration*, not through an application connection.
2. Need a legitimate DB app role, UAT canary service with real application connection, automatic versioned migrations + clean-DB restore, source-compatible legacy fixture translator **using fabricated records**, and true multi-instance API integration tests. No production data snapshot/import authorization exists.
3. Need Free device-family cross-account 10k quota semantics and owner-paid PRO Team member budget/real A/B proof in SQL. Current SQL function intentionally supports owner-actor synthetic charges only.
4. PostgreSQL-ledger SQL fencing does not alone cancel OS processes or protect an already-running job. Real device-side lease enforcement remains.
5. No 100/500/1000-connection load benchmark, client cutover, producer/webhook release or GitHub CI pass. Original staging React preview may remain deployed separately; React rewrite source branch has been retired, not promoted.
