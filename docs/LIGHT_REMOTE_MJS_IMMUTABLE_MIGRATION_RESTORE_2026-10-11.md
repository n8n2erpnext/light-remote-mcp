# Light Remote rc.50 — Immutable migration and PostgreSQL restore UAT checkpoint
**Date:** 2026-10-11 · **Branch:** `feature/rc50-mjs-scale-20261011`
**Owner requirement:** Keep Node.js ESM `.mjs`, scale incrementally using PostgreSQL/Redis and do **not** access, mirror, import, or migrate production customer/device/session/Paddle/ERPNext data.

## Why this change
Before this checkpoint, `platform-v2/scripts/check.sh` re-executed SQL 001–007 on every test run. Versions 008–012 were applied manually. Running all old SQL again on startup/deploy is NOT a sound production migration strategy: functions/triggers could be silently replaced, schema history has no immutable source checksum, and partial failures are difficult to audit.

**This work adds a separate, isolated UAT-only runner. It has NOT been wired to production deploy, Operator, plugin/MCP, app start, or CI.**

## Implemented
- `platform-v2/sql/migrations.lock.json`: versioned manifest that pins the exact SHA-256 contents and sequence of SQL 001–012, no gaps. Existing historical files are now FROZEN. Make future changes only by adding 013+, never rewrite an applied migration.
- `platform-v2/scripts/migrations_uat.py`: explicitly scoped to the Docker container `lightremote-rc50-v2-postgres-1`, migration administrator `lr_rc50_uat`, and either `light_remote_rc50_uat` or a *strictly patterned ephemeral restore UAT* DB. Refuses wrong DB, unhealthy PG, published ports or non-internal network before SQL.
  - `plan`: read-only, displays applied/pending versions and whether historical hashes are attested.
  - `verify`: fail-closed for missing checksum baseline, holes, unknown versions, changed source hash, incomplete/mismatched DB checksum history and pending SQL; no writes.
  - `apply`: applies **only missing** SQL versions using psql errors-as-fatal, then writes a matching checksum row. Re-running with versions current is a no-op. Uses host `flock` for this single-host UAT migration process.
  - `attest-existing`: explicit one-time legacy *synthetic UAT* checksum baseline; cannot run for restore DB or run twice.
  - The migration ledger table `lr_schema_migration_hashes` lives only in the isolated UAT database. It records present source SHA-256; **attestation does not prove SQL hashes at their historical application times**. A clean DB replay/restore rehearsal supplies independent compatibility evidence.
- `platform-v2/scripts/rehearse_restore_uat.py`: creates 2 random scratch DBs inside the **isolated UAT PostgreSQL cluster**; builds source schema from SQL 001–012; inserts **synthetic-only** Free account, device, family and billable usage; takes a temporary in-memory `pg_dump -Fc`, restores into the second scratch DB, revalidates checksums/schema and proves event replay is idempotent while new charges work. Both temporary DBs are dropped at the end. No customer data, no persistent backup archive or production instance.
- `platform-v2/test/test_immutable_migrations_uat.py`: four purely local tests for checksum drift, unlisted SQL files, missing/drifted DB hashes, version holes, and non-UAT database rejection.
- `platform-v2/.gitignore`: ignores generated Python bytecode.

## Executed, independently verified
- Fresh 12-file migration replay on temporary source database: PASS.
- Temporary custom-format PostgreSQL backup (about 131 KB), full restore to second scratch DB: PASS.
- Restored `lr_usage_events` and `lr_free_family_monthly` exactly match fake source: PASS.
- Replay of already charged event after restore returns duplicate; new event increments restored quota: PASS.
- Scratch database removal: PASS, count 0 afterward.
- Explicit `attest-existing` on legacy **synthetic UAT database** succeeded for 12 historical hashes, clearly labeled as an attestation of *current* SQL source, not proof of its historic execution.
- `verify` now reports `RC50_IMMUTABLE_MIGRATIONS_VERIFY_PASS: 12 versions`.
- `apply` on up-to-date UAT DB performs no schema migrations, reports 12 versions PASS.
- `python3 platform-v2/test/test_immutable_migrations_uat.py`: **4/4 tests PASS**.
- Existing `bash platform-v2/scripts/check.sh` still PASS: **26/26 Node unit tests**, all baseline SQL and synthetic contention checks.
- v8–v12 usage/Free/Team/rotation SQL rollback contracts PASS.
- UAT account and usage tables remain **empty**; PG migration and checksum tables both have 12 versions.

## Operational usage — only on the approved isolated UAT VPS
```bash
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform
python3 platform-v2/scripts/migrations_uat.py plan
python3 platform-v2/scripts/migrations_uat.py verify
# Apply ONLY when a brand new numbered migration is intentionally approved:
python3 platform-v2/scripts/migrations_uat.py apply
python3 -B platform-v2/test/test_immutable_migrations_uat.py
python3 -B platform-v2/scripts/rehearse_restore_uat.py
```

## Remaining safety/scale gates (NOT DONE)
1. The immutable runner must be reviewed as a separate database-admin deployment task before any CI or service startup integration. Old `check.sh` still intentionally replays 001–007 in test; new migration 008–012 SQL/restore tests are not integrated into GitHub CI. Previous attempts to edit CI/runner were tool-blocked; no workaround attempted.
2. The local `flock` serializes only this **single UAT host**; a future multi-node migrator requires a server-side exclusive advisory session lock or equivalent migration orchestration.
3. The restore exercise is a **temporary full custom-format dump and restore of fabricated data**, not proof of live point-in-time recovery, WAL archiving, retention policy, offsite encrypted backup, physical replica failover, app connection pool reconnection, or 1,000 user scale.
4. Least-privilege `lr_rc50_app` and `lr_rc50_rotation_verifier` roles are **not provisioned**. The UAT migration owner is privileged and must never be used as an application DB account; earlier tool access restrictions remain respected.
5. OAuth/process-local replay state, Team owner A/B signing/agent fencing, legacy account/usage JSON writer and ERPNext/Paddle state have NOT been migrated or exercised end-to-end via UAT API. Do not cut over any customer traffic.
6. Production data snapshot, read, import, shadow sync, dual-writing or change of client auth/claims requires separate explicit owner approval and a measured rollback plan.

## Resume
- Working tree: `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform`.
- Parent checkpoint: `760c1b49c284c332af2bfb340c53c5a5562effa2`.
- Continue with the dedicated, legitimately authorized non-superuser DB app identities and synthetic API/worker end-to-end integration; do not attempt to bypass earlier privilege provisioning blocks.
