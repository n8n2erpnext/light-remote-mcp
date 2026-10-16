# rc.50 P0-D: actual PostgreSQL17 / Redis8 synthetic cross-host restore, ARM64 → x86_64

Date: 2026-10-16 Asia/Ho_Chi_Minh
Parent branch SHA: `c585e549713252d7cf057d25ab81e6c83cbbf477`
Feature branch: `feature/rc50-mjs-scale-20261011`
Release gates: **P0-A/B/C/D/E all NOT_READY**. This is not a production copy, cutover or writer fencing acceptance.

## What was executed on two owner-authorized physical hosts

Unlike the prior 13 JSON fixtures, this run exported and restored ACTUAL engine-native backup formats with deliberately invented rows:
- VPS-ARM `aarch64`: Docker cached `postgres:17-alpine`, `redis:8-alpine`, offline Compose `platform-v2/portability/compose.uat.yml`, a completely private project `lr-rc50db-1a2b3c4d5e6f-src`. Internal Docker network, **no host-published ports**, fresh 0600 synthetic PG/Redis passwords, isolated Compose volumes.
- The source creates `rc50_fixture(id, label)` with invented key `88c99be583cb` and value `synthetic-owner-revoked-and-paid`; inserts a synthetic Redis key `lr:rc50:synthetic:88c99be583cb=17`. The driver checks both via real `psql` and authenticated real `redis-cli`.
- Source exports PG via actual `pg_dump -Fc --no-owner --no-acl` and Redis via actual `SAVE`, copying real `dump.rdb` from ephemeral Redis. It verifies PG magic `PGDMP` and RDB magic `REDIS`.
- The generated artifact is `/home/ubuntu/lr_rc50_db_crosshost_1a2b3c4d5e6f/rc50-real-db-synthetic.zip`, containing a strict two-file inventory and manifest. PostgreSQL custom dump 1771 bytes, Redis native RDB 127 bytes. Full artifact SHA-256: `6b6fbfbb719d8e87f3a6ddfa1031c679f6fc614a595bfc29e571c9ebd8c5524e`.
- The source driver **removed its private containers, volumes and internal network** with `docker compose down -v --remove-orphans` before returning. It did NOT touch running production PG/Redis, which may be managed elsewhere.
- As the installed Light SCP chunk API still fails for small files (see below), we sent **only these invented backup artifacts** as a Base64URL-encoded text file via authorized Light Remote read/write, then decoded on HOMELAB. The target independently confirmed the exact same SHA-256.
- HOMELAB `x86_64`: cached same image tags, `docker compose v5.6`; a separate totally private project `lr-rc50db-a1b2c3d4e5f6-dst` under `/home/thaiduy/rc50-portability-uat`, independently generated credentials/volumes. Restored PostgreSQL dump via `pg_restore`, SQL-selected the **exact invented fixture**, and loaded the source RDB into new Redis (stop -> copy -> start), validating exact key and value through authenticated Redis CLI.
- HOMELAB actual result: `realPgRestore:true`, `realRedisRdbLoad:true`, `sourceArch:aarch64`, `destArch:x86_64`, `writerWasEverEnabled:false`, `cutoverAuthorized:false`. Driver then removed **only** its random UAT project's containers and volumes. Post-run enumerations for `lr-rc50db-*` found no remaining UAT containers or volumes.

## DEV implementation in the feature branch

`platform-v2/portability/real_pg_redis_cross_host_uat.py` is a standalone Python3 stdlib-only driver. It accepts explicit `source`, `verify` and `restore` commands guarded by `--confirm-synthetic-only`, requires a brand-new root matching `lr_rc50_db_crosshost_<12hex>`, uses only known `compose.uat.yml`, never publishes host ports, enforces an internal network, never pulls images and tears down only a validated random Compose project.

Archive verifier is fail-closed: exact expected ZIP members, no duplicates or unknown paths, capped per-member pre-decompression size, fixed v1 manifest, deny any `authWriterFence` or `cutoverAuthorized` claim, source/destination hostname difference, SHA-256 for each native artifact plus whole-archive SHA, PG and Redis binary magic. Source and destination independently generate secrets; credentials never transported.

`platform-v2/test/test_real_pg_redis_cross_host_uat.py` adds nine **offline** negative/contract tests covering exact file set, same-host denial, PG/RDB tamper, forged fencing, ZIP traversal, oversized member, malformed magic/hash, private root restrictions. These do NOT run real Docker in CI; real source and restore were executed on the two actual host machines. Workflow `.github/workflows/rc50-mjs-scale.yml` now runs these nine tests in all three isolated/native jobs. The baseline existing full Node UAT and 8 JSON state crosshost tests remain.

## SCP chunk tool failure independently reproduced

- The installed Light Remote tool `light_remote_scp` begins a **five-byte** upload of `hello` to a private HOMELAB UAT filepath with correct full SHA-256 `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`.
- Calling advertised `light_remote_scp_upload_chunk` with index 0 and canonical Base64URL `aGVsbG8` returned **`scp_invalid_sha256`** (HTTP 400), despite the tool schema providing no optional per-chunk `sha256` input. A separate real ZIP attempt previously failed likewise. Both UAT transfers were **canceled without commit**.
- New `platform-v2/test/light-scp-missing-chunk-hash-uat.test.mjs` directly tests actual `lib/light-scp-file.mjs`: when `sha256` is truly omitted from `putUploadChunk`, bytes are accepted, downloaded, and full-file SHA is checked on commit. An explicit blank/invalid chunk sha is rejected, and incorrect 64-hex hash is rejected. This source library behavior PASS + installed tool runtime failure narrows the likely issue to **SCP tool wrapper/serialization or intermediate adapter passing an unintended bad hash**, but that exact hop has NOT been instrumented or proven yet. No weakening of SHA validation, and NO production SCP fix is claimed.

## Release gates still open

P0-A: no global authenticated WriterEpoch/lease or old-host revocation across all writers.
P0-B: independent owner Local Wall B issuance and Agent verification not accepted.
P0-C: complete durable Agent/process/PTY/SCP/desktop remote effect quiescence, 18/18 fsync, WAL reconciliation still missing.
P0-D: genuine database-format crossing of two machines **now PASS for invented fixture rows only**. Still no consistent full legacy Operator/Plugin actual-registry snapshot, signed authentic freeze, fenced source, real production billing/OAuth state or activated rollback acceptance.
P0-E: no production-equivalent OAuth→A/B→RM/PTY/SCP/Paddle/billing signed release.
No production rollout or main merge. Existing policy-denied writer/Agent source locations untouched.
