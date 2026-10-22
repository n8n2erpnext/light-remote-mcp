# Gold M6 — LXD UAT schema 035, staging and four-service cutover
2026-10-22 — Authoritative checkpoint

## Changes actually applied

- Gold business-code SHA `a7d1d9631eafae036fea253af01e77c3ead0ae90` packaged via immutable Git archive and staged at `/opt/light-remote-gold-uat-candidates/a7d1d9631eafae036fea253af01e77c3ead0ae90`. Stager reports PASS for source, lockfile, candidate tests; running services unchanged.
- LXD Gold UAT verified backup at `/var/backups/light-remote-gold-uat/pre-g3-a7d1d9631eafae036fea253af01e77c3ead0ae90`: live code, state including Supervisor journal, original three units, PostgreSQL custom dump. Additional Supervisor unit + overrides archived, appended to SHA256SUMS and verified. No backup bytes exported to public destinations.
- Gold UAT PostgreSQL `light_remote_gold_dev` applied **schema 035** via dedicated `lr_gold_migrator` with reviewed manifest. Versions 1–34 reported already applied; 35 applied. Read-only verification: MAX(version)=35; ACK relational table `lr_gold_terminal_receipt_acks` exists; initial rows 0. This additive schema change did NOT restart services. No production database touched.
- Gold M6 candidate selftest `selftest-gold-m6-terminal-replay.mjs` PASS inside isolated LXD.

## Runtime remains unchanged (important!)

- Existing UAT service sources still mixed: Operator/Wall `5421b97`, Plugin `b99cd64`, standalone Process Supervisor `5deb1d6`; the new M6 candidate `a7d1d96` is **staged, NOT live**.
- UAT Fleet read-only observation: **1 active Windows session**. PostgreSQL: **9 queued QUEUED_AGENT_SLOT**, **1 queued RESOURCE_LOCKED**, **1 running resource claim**. Do not infer these records are safe to cancel or claim the backing OS process is stopped.
- New UAT-only `deploy/scripts/gold-m6-uat-four-service-cutover.sh` (separate from obsolete G3 three-service cutover) checks LXD hostname, exact SHA, immutable candidate, verified backup, schema 035, four units, no existing 99 override, **zero PG in-progress/queued work, zero worker claims, zero Fleet active sessions/commands**, and preserved strict executor readiness before any service mutation. Default is read-only preflight.
- LXD preflight returned **exit 4: `M6_PG_WORK_BUSY:11`**, correctly refusing to mutate runtime. No service restarted, no unsafe worker release, no SQL queue rewrite.
- Future apply mode requires both `GOLD_M6_CUTOVER_MODE=apply` and `GOLD_M6_CUTOVER_OPT_IN=1`. It snapshots four unit configs, writes reversible 99-m6 overrides, restarts Operator → Supervisor → Plugin → Wall, verifies all four units/effective entrypoints and 10 consecutive health samples, with rollback to previous overrides if unhealthy. Rollback does not drop schema 035.

## Next M checkpoint

1. Keep owner-paused Pro Team and 3+1 multi-Agent UAT paused. No new A/B approvals.
2. Diagnose 11 pending records and 1 live session via authorized normal lifecycle; avoid direct SQL DELETE/force-finished, and avoid stopping an unidentified live job. The existing active claims are a **real cutover gate**.
3. When owner-authorized UAT runtime is idle, rerun read-only preflight then coordinated four-service apply. Validate signed ACK/replay, exact PG claim transitions, Fleet Wall CPU/RAM/Agent I/O on owner browser, and one benign process. Do not use mass synthetic Team test.
4. No new production changes, Pro Team stays OFF. Any loss of signed terminal receipt is UNKNOWN and must retain lease.

Relevant checkpoints: `RDC_GOLD_M6_DURABLE_TERMINAL_ACK_REPLAY_20261022.md`, `RDC_GOLD_M6_SIGNED_DEVICE_TELEMETRY_20261022.md`, and `RDC_HANDOFF_CURRENT.md`.
