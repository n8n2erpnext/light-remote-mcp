# rc50 P0 — PostgreSQL synthetic global nonce replay ledger

**Date:** 2026-10-13 Asia/Ho_Chi_Minh. **Scope:** isolated, synthetic **PG17-only** UAT. NO persistent HTTP verifier, NO real A/B owner proof, NO issuer grant wiring and NO production migration.

## Motivation and precise boundary

Prior `71111f2` protects a local HMAC nonce journal using one owner-only file lease. This cannot coordinate many independent verifier hosts. A PostgreSQL primary can uniquely serialize nonce claims via a row lock and unique constraints, and atomically roll back the nonce insert **with other SQL operations in the same transaction**.

**This experiment implements and proves ONLY the PostgreSQL atomic replay/epoch claim primitive.** It is intentionally **not** connected to `lr_uat_commit_owner_channel_origin`, real writer credentials, Local Wall consent, operator/fleet or the persistent HTTP fixture previously blocked by tooling.

## Added files
- `uat_global_nonce_ledger.sql`: standalone UAT-only schema:
  - `lr_uat_replay_authority(account_id,device_id,writer_epoch,claim_generation,fenced)`: one authority row per account/device, locked with `FOR UPDATE`; simulated epoch/fence, **NOT** the real global writer epoch.
  - `lr_uat_replay_producer(producer_id,account_id,device_id,key_sha256,state)`: fake scoped producer registry, revoked/active only. SQL does not verify cryptography or possession of any HMAC key; `key_sha256` is a caller-supplied equality check, **not an authentication mechanism**.
  - `lr_uat_global_nonce_ledger`: immutable-by-contract record with `PRIMARY KEY(producer_id,nonce_hex)`, unique request ID, unique `account_id,device_id,claim_generation`, 32-hex nonce, 64-hex message digest, writer epoch, owner/device scope, signed timestamp and server commit time. No cleanup/expiry job that might enable replay.
  - `lr_uat_record_global_nonce`: `SECURITY INVOKER` narrow SQL contract (PUBLIC EXECUTE revoked), validates fake producer scope, active key/epoch, time window (30s), fenced flag, locks authority+producer, increments claim_generation, writes global nonce. Uniqueness failure rolls back the generation increment. Never returns a grant or signature; actual trust is NOT implemented. `search_path=pg_catalog,public,pg_temp`.
- `verify_global_nonce_ledger_pg_uat.py`: entirely separate PostgreSQL scratch harness using a randomized `lr-uat-move-<random>-src` Docker Compose project. PostgreSQL17 image from local cache, internal-only private network with **no published port**, randomized credentials and versions 001–013 checksum-locked UAT migrations. Never touches production. Starts and stops only the generated project and volumes. Uses two actual concurrent psql connections for replay race; uses `VERBOSITY=terse` locally so genuine SQL error cause is not truncated by historical generic 450-char stderr tail.
- `test/test_global_nonce_ledger_source.py`: 12 source-only structural guards (not a substitute for PG runtime).
- This report and `README.md` navigation.

## Actual acceptance on VPS-ARM

```sh
python3 -B platform-v2/test/test_global_nonce_ledger_source.py
# 12/12 PASS

python3 -B platform-v2/portability/verify_global_nonce_ledger_pg_uat.py --confirm-synthetic-only
# exit 0; empty stderr; all nine named groups PASS:
# LEDGER 01: PG17 private fixture/migrations + schema
# LEDGER 02: first global nonce persisted with generation 1
# LEDGER 03: duplicate nonce/request and rollback of counter update
# LEDGER 04: missing producer/scope, fake key, stale writer epoch, bad nonce,
#            expired message TTL all rejected
# LEDGER 05: revoked producer and fenced authority denied
# LEDGER 06: explicit ROLLBACK removes both nonce and generation; retry succeeds
# LEDGER 07: epoch bump rejects old writer epoch and permits matching new epoch
# LEDGER 08: two real psql processes race on same producer/nonce;
#            EXACTLY ONE winner and exactly one generation advancement
# LEDGER 09: NOLOGIN observer cannot SELECT table or EXECUTE function
# RC50_PG_GLOBAL_NONCE_LEDGER_SYNTHETIC_UAT_PASS production=false issuer_wiring=false
# RC50_PG_GLOBAL_NONCE_LEDGER_PRIVATE_COMPOSE_CLEANED
```

One intermediate UAT invocation reported a false test failure because the shared generic helper truncates stderr and removed the unique-constraint name. A **local** terse psql-query helper fixed error diagnostics (no SQL predicate relaxed), then the **entire scratch UAT was rerun and passed** with no stderr; failed stack was cleaned automatically.

## Security and correctness limitations

1. **Simulated global replay within one PostgreSQL primary only.** It is not cross-primary consensus, failover monotonic proof or the deployed writer fence. The fake authority table is separate from real owner/grant authority; no production role or client can execute this SQL by default.
2. The fake producer key SHA-256 stored alongside provided caller key SHA-256 is **not real authentication**. A compromised/privileged SQL caller could claim arbitrary nonce. No mTLS, OAuth, key rotation/revocation transport or cryptographically signed verified issuer decision. Binding an externally signed verifier receipt remains P0.
3. **Not in same transaction as real grant.** This UAT proves nonce claims and its own generation increment are atomic, and a client can COMMIT or ROLLBACK; it does not prove global nonce claim + actual A/B grant + device generation + outbox are atomic together. A future protected single-transaction wrapper must be designed/tested with exact issuer roles and trust boundary.
4. `writer_epoch` here is a **synthetic local table value**, not the origin `lr_uat_device_authority_floor` or platform-wide Operator/Fleet/PTY writer generation. Claims of general multi-host fencing or ready migrations are forbidden.
5. No existing HTTP Docker service runner integration was attempted, no prior denied command rerouted by PTY or alternate app. All generated private PostgreSQL volumes removed. No real Agent/owner/session/customer/device data, keys, production billing, DNS, ERPNext, Paddle, main branch, or deployed stack altered.

## Next steps

- Model a **cryptographically authenticated fake verifier→issuer receipt** bound to producer identity, request/grant/account/device, nonce, proof digest, expected writer epoch/generation and strict expiry; independent fake public verifier key and single-use receipt table. SQL must not treat caller-provided digest as signature proof.
- Integrate receipt consumption and SQL nonce claim **inside the same fenced grant transaction**, with reader/writer privileges clearly separated, and test parallel issuers / crash before COMMIT / stale key epoch using only disposable UAT.
- Resolve previously blocked persistent HTTP Docker runner integration through an approved workflow only. No PTY workaround.
- Plan TLS/HBA, real owner B-code authenticated origin, Agent OS-effect canary, native ARM64+AMD64 and consistent cross-host backup/rollback. **GLOBAL_WRITER_FENCE_NOT_READY** / production cutover **NOT_READY**.

Architecture remains Node.js ESM `.mjs` + Express 5; no TS/React/Fastify replacement.
