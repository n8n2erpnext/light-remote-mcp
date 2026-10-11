# Data provenance / anti-production-import guard — 2026-10-10

**Hard requirement:** Do not read, copy, import, reconcile, or shadow-sync any production account/session/device/Paddle/ERPNext data into rc50-v2 during this phase. The following assets use synthetic fixtures exclusively.

- Backend source lives in an independent Git worktree, branch `feature/rc50-v2-platform`.
- Docker project `lightremote-rc50-v2` uses dedicated `pgdata` and `redisdata` volumes and `internal: true` networking, with no published ports.
- No Operator/API process (production OR current rc50 staging) uses these containers. No service is wired to the new DB.
- Five additive PostgreSQL migrations: 001 core; 002 monthly usage aggregate; 003 OAuth/AB/device/agent/license/notification/audit; 004 cross-account binding guards; 005 five-seat Team trigger.
- SQL tests use unique `uat_` IDs and `example.invalid` emails inside explicit BEGIN/ROLLBACK, then assert no fixtures remain.
- `test/concurrent_team_seats.py` commits *only generated synthetic* `uat_parallel_<random>` IDs for concurrent test and deletes EXACT those IDs in a finally block, then asserts cleanup. It never opens a production file, uses production endpoints or reads a production DB.
- Node tests use fake DB/Redis clients and no account records.
- Final UAT database row counts checked: accounts 0, devices 0, sessions 0, usage 0, billing 0, teams 0, OAuth tokens 0, audit 0. Migration registry entries 1–5 remain (schema metadata only).
- Provisioning a least-privilege app DB role remains unauthorized/blocked; do not use bootstrap owner role as live API credentials. Only DBA-style UAT synthetic SQL tests currently touch the DB.
- This environment is NOT claimed to handle 1,000 live agents or be approved for production.

Next allowed work WITHOUT production data:
1. Add synthetic-only compatibility fixtures matching legacy JSON schema and test account/session/grant invariants in memory.
2. Add owner-approved least-privilege UAT DB role and integration test against synthetic records only; no alternative elevated app connection.
3. Test transaction/lease fencing/queue recovery with worker simulators; test Redis loss and stale lease behavior.
4. Load test at 100/500/1000 simulated connections using fake accounts/device transports; report P95/P99 and resource headroom, never infer results from unit tests.

Owner approval required before accessing/snapshotting/copying any production state.

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
