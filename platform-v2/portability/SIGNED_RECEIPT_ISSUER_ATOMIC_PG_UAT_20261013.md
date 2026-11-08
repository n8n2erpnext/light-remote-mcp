# rc50 P0 — Atomic simulated signed receipt, nonce, grant and outbox PostgreSQL UAT

**Date:** 2026-10-13 Asia/Ho_Chi_Minh; **target:** VPS-ARM `direct-arm-local`; **scope:** disposable private PostgreSQL 17 fixtures ONLY. No live owner consent, production grants or OS control.

## Why
The previous `49f069e` signed-receipt crypto fixture verified fake Wall/channel Ed25519 proofs and pinned verifier key, but the receipt could be revalidated repeatedly and had never been consumed in PostgreSQL. The previous `970cda2` global nonce schema could serialize claims but was not atomic with receipt/grant/outbox. This checkpoint models both inside **one synthetic PostgreSQL transaction**, without changing the existing product migration/issuer endpoints.

## Files
1. `uat_signed_receipt_issuer_transaction.sql`:
   - Three scratch NOLOGIN roles: `lr_uat_receipt_stage_role` INSERT-only into fake verified stage table, `lr_uat_receipt_issuer_role` EXECUTE-only on `lr_uat_commit_staged_receipt(TEXT)`, and `lr_uat_receipt_tx_owner` NOLOGIN owner of that SECURITY DEFINER function.
   - Tables: `lr_uat_receipt_verifier_pin`, `lr_uat_receipt_request`, `lr_uat_receipt_verified_stage`, `lr_uat_receipt_grant`, `lr_uat_receipt_provenance`, `lr_uat_receipt_outbox`. Fake grant/outbox rows explicitly have `physical_execution_authorized=FALSE`.
   - Protected transaction locks receipt and fake owner request `FOR UPDATE`, verifier pin `FOR SHARE`; refuses consumed receipt, revoked session/device or verifier pin, key revision mismatch, trusted Wall/channel digests, grant/account/device/session/ownership mismatch, signed decision older than 10 seconds or expired.
   - **In that SAME transaction**, calls preceding `lr_uat_record_global_nonce` (locks fake device/account writer authority row, checks epoch, inserts globally unique nonce and advances monotonic generation), enforces signed expected next generation, then inserts grant, provenance, outbox, updates request state and receipt `claimed_at`. A failed constraint or later outbox error raises exception and rolls back **all tables**.
   - `SECURITY DEFINER` fixed search_path and explicit EXECUTE grants. Role SELECT / INSERT gates are asserted in UAT. PG `FOR SHARE` row lock requires UPDATE ACL for underlying NOLOGIN function owner; issuer login is not given direct table UPDATE.
2. `synthetic-signed-receipt-stage-fixture.mjs`: opt-in `LR_RC50_UAT_ONLY=1` Node fixture generates ephemeral fake Wall/channel Ed25519 signatures, verifies them with `synthetic-owner-channel-verify-only.mjs` through `signSyntheticVerifiedOriginReceipt`, signs a fake verifier decision, validates the signed receipt with an independently pinned fake public key, and outputs only fake attested row fields. **No private key in output**, no caller-supplied `verified:true` accepted, no SQL connections, no real B-code/Agent.
3. `verify_signed_receipt_issuer_pg_uat.py`: random project-scoped internal-only `postgres:17-alpine` Compose, uses existing version-lock migrations and prior nonce ledger schema, seeds fake request/key/producer, invokes Node fixture as an independent process for each test case, stages result under mock verifier role, invokes issuer function under separate NOLOGIN mock issuer role via SQL `SET ROLE`. Supports concurrent real PostgreSQL sessions, injected SQL outbox constraint error and rollback BEFORE COMMIT. Auto-cleans generated volumes/containers.
4. `test/test_signed_receipt_issuer_transaction_source.py`: 14 source guards and opt-in/ACL/atomicity invariants.
5. This report and `README.md` index.

## Real test outcomes on VPS-ARM

```sh
python3 -B platform-v2/portability/verify_signed_receipt_issuer_pg_uat.py --confirm-synthetic-only
# exit 0, stderr empty:
# RECEIPT_TX PASS 01 private PG17, migrations, NOLOGIN SQL roles
# RECEIPT_TX PASS 02 stage/issuer/untrusted ACLs separated
# RECEIPT_TX PASS 03 first receipt, nonce, grant/provenance/outbox in ONE PG tx
# RECEIPT_TX PASS 04 same signed receipt cannot commit twice
# RECEIPT_TX PASS 05 explicit ROLLBACK before COMMIT leaves no state; retry succeeds
# RECEIPT_TX PASS 06 revoked verifier pin prevents nonce and grant
# RECEIPT_TX PASS 07 stale fake writer epoch denies all writes
# RECEIPT_TX PASS 08 two independent PostgreSQL sessions race; ONE issuer wins
# RECEIPT_TX PASS 09 duplicate global nonce cannot generate any grant
# RECEIPT_TX PASS 10 intentionally failing outbox constraint AFTER nonce/grant
#                    rolls back receipt, nonce, provenance and generation
# RECEIPT_TX PASS 11 revoked owner session or device denies all writes
# RECEIPT_TX PASS 12 rotated verifier key epoch or expired receipt denied
# RC50_SIGNED_RECEIPT_ISSUER_SYNTHETIC_PG_UAT_PASS production=false
# RC50_SIGNED_RECEIPT_PRIVATE_COMPOSE_CLEANED

python3 -B platform-v2/test/test_signed_receipt_issuer_transaction_source.py
# 14/14 static guards PASS
node --test platform-v2/test/test_synthetic_verifier_issuer_receipt.mjs
# 12/12 Node crypto tests PASS (previous contract, unchanged)
git diff --check
# PASS
```

An initial fixture run failed at the first issuer commit because PostgreSQL row-lock semantics require UPDATE on the pinned verifier table; the synthetic NOLOGIN SECURITY DEFINER owner was missing those privileges. Changing its pin lock to `FOR SHARE` and granting the necessary table UPDATE only to the **NOLOGIN function owner** fixed this; issuer login still gets EXECUTE only and cannot update pin. Full scratch UAT was rerun and completed PASS. No failed project remains; every run uses finally-cleanup.

## Scope boundaries — not production-ready

**CRITICAL trust gap:** The `stage` role is treated as a trusted **mock verifier identity**. Although fake Ed25519 signatures are genuinely created and verified by Node before stage insert, PostgreSQL does **not** verify the signature on that row. A compromised/malicious holder of the stage role can fabricate attestation fields. Only a future separate authenticated verifier service (key custody, securely pinned principal and strict DB ACL) can be authorized to stage. The UAT uses scratch DB administrator `SET ROLE`, **not independent network SCRAM client credentials**, and cannot claim actual service-to-service authentication. The product issuer must not trust caller-provided digests or true flags.

The fake writer epoch is `lr_uat_replay_authority` inside the disposable database, not the Operator/Plugin/Fleet/PTY global writer. A/B device approval request rows and actual signed outbox/Agent receipt are **not** updated. This UAT creates separate fake grant/provenance/outbox tables only, never OS effects or real device commands.

The earlier persistent HTTP verifier Docker integration was **tool-blocked** and was not attempted using PTY, another connector, shell rewriting or a wrapper. New UAT uses **the independently permitted private PostgreSQL scratch fixture** only; it does not connect the previously blocked HTTP service.

No deployment, live owner consent, private keys, production customer data, Paddle/ERPNext, DNS, Git main, real Agent/PTV/SCP/desktop operations, multi-host native ARM64↔AMD64 data restore, TLS/HBA or K3s cutover. **GLOBAL_WRITER_FENCE_NOT_READY** and production migration **NOT_READY**.

## Exact P0 remaining
1. Bind approved verifier receipt to an **independently authenticated SCRAM/mTLS verified staging identity**, provisioned only after actual signed Wall/channel evidence is checked against DB-owned context; issuer/producer cannot mint a receipt by digest or request values. Recheck verifier public pin and revocation atomically at commit.
2. Replace the isolated simulated nonce/epoch and fake grants/outbox with the actual platform-authorized scope only AFTER hardening: require a real global single-writer epoch covering Operator/Plugin/Fleet/PTY and default-deny real Agent side effects. Validate crash/reconnect/rollback and device-wide claims.
3. Resolve the previously blocked persistent HTTP Docker producer/verifier integration through an authorized path only; do not try to evade tool safety. Add authenticated producer transport, TLS/CA, local signed owner B decision and legitimate Agent device-channel ACK.
4. Validate multi-host PostgreSQL+Redis+JSON data quiescence, native artifacts, billing state and rollback on nonproduction before any production migration. Keep Node ESM `.mjs` + Express 5; no premature TS/React/Fastify rewrite.
