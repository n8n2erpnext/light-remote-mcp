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
