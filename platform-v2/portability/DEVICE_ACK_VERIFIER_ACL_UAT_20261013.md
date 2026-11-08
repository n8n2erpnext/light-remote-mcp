# rc50 P0 — Scratch-only verifier PostgreSQL ACL and protected ACK function

**2026-10-13 · VPS-ARM · Synthetic PostgreSQL Compose ONLY · NOT DEPLOYABLE.**

## Purpose

Previous checkpoint `882f45f` proved Ed25519 device proof-of-possession ACK with one Node verifier-only process, and a scratch PostgreSQL transaction that records a signed ACK, immutable nonce and receipt. The private fixture called `lr_uat_commit_signed_device_ack` as the database administrator. That does not establish least-privilege authorization. This checkpoint tests a restricted PostgreSQL execution boundary **only within a random, private disposable Compose instance**. It does not provision any production role, replace an actual authentication source or guarantee that the caller did cryptographic verification.

## Files

- `device_ack_verifier_acl_uat.sql` (new): apply **AFTER** migrations 001–013, `issuer_origin_uat.sql`, `issuer_publisher_uat.sql` and `device_signed_ack_uat.sql`, and **NEVER** to production. Creates three PostgreSQL roles as `NOLOGIN NOINHERIT`:
  - `lr_uat_ack_untrusted` — no function or direct table mutation permissions;
  - `lr_uat_ack_verifier` — may execute **only** `lr_uat_commit_signed_device_ack`, and cannot read enrolled-device tables, call legacy unsigned ACK, grant new device access, or update challenge rows directly;
  - `lr_uat_ack_function_owner` — non-login `SECURITY DEFINER` owner with narrowly specified `SELECT`, `INSERT`, `UPDATE(column)` and private legacy ACK helper permissions needed to atomically commit a *preverified* ACK.
- The UAT revokes `PUBLIC` EXECUTE on all scratch `public` schema functions and `PUBLIC` CREATE on schema `public`. The approved wrapper is deliberately `SECURITY DEFINER`, with fixed `search_path=pg_catalog,public,pg_temp` to avoid untrusted temporary-table name shadowing.
- `verify_signed_device_ack_pg_uat.py` (updated): applies scratch ACL, validates role privileges, actually `SET ROLE lr_uat_ack_verifier` to commit a signed fake ACK, tries untrusted direct API and table manipulation, revokes then restores `EXECUTE`, checks exact signed ACK replay, and runs a malicious same-name session-local temp-table shadow negative test. All tests are run in a new ephemeral PostgreSQL client connection as selected role. **No real device/owner or live database was used.**
- `test/test_signed_ack_acl_source.py` (new): 9 source guards confirming only synthetic scope, NOLOGIN role separation, revocations, signer-not-wired and the search path boundary.
- `portability/README.md` indexed.

## Measured acceptance on VPS-ARM

```bash
python3 -B platform-v2/portability/verify_signed_device_ack_pg_uat.py --confirm-synthetic-only
python3 -B platform-v2/test/test_signed_ack_acl_source.py
python3 -B platform-v2/test/test_synthetic_device_signed_ack_source.py
node --test platform-v2/portability/test_synthetic_device_lease_ack.mjs platform-v2/portability/test_synthetic_outbox_lease_publisher.mjs
```

- **12/12** synthetic PostgreSQL grant provenance + concurrency steps PASS.
- **12/12** signed device ACK PostgreSQL and separate Ed25519 verifier E2E steps PASS.
- **7/7** additional restricted-ACL runtime steps PASS: narrow verifier call, no legacy/untrusted table rights, grant issuance blocked, NOLOGIN roles and denied client wrapper, revocation immediate on next session, restored narrow grant and protected `pg_temp` search order.
- **9/9** new ACL source guards PASS; prior device ACK source guards and Node crypto suites PASS.
- One initial failure identified that `SELECT FOR UPDATE` requires UPDATE privilege on a locked table (even when only reading), so the scratch `NOLOGIN` owner was given a single permitted UPDATE column per locked relation. The verifier/client role was not given those column rights. Fresh E2E then PASS.
- No scratch `lr-uat-move-*` containers/volumes remain after `down --volumes --remove-orphans`; stable private rc50 UAT stack remains separate.

## Security truth and remaining blockers

1. **Roles are NOLOGIN fixture principals**, exercised through `SET ROLE` by the scratch superuser. This is an ACL proof, NOT real authenticated service connection mapping, TLS client identity, credential rotation or production proxy. No PostgreSQL production role was created.
2. The protected function still trusts the verifier caller's signed digest and signature-shaped input. **PostgreSQL does not verify Ed25519 cryptography.** If a malicious actor gains the verifier execution capability, the SQL function alone cannot prove a valid device signature. A real production verifier must authenticate to PostgreSQL using a protected identity with restricted privileges **after** signature verification, and its service credentials must never be exposed to callers.
3. Legacy unsigned ACK function has its `PUBLIC` privilege revoked **in the scratch DB**, but a superuser/object owner can still invoke it; this is unavoidable in a database administered by a privileged identity. A production deployment needs separate protected function/table owner, carefully scoped DB roles, RLS as appropriate, auditable management, and assurance no untrusted actor is a database owner or superuser.
4. The `SECURITY DEFINER` wrapper is a test risk surface: keep fixed search_path, schema CREATE restrictions and only narrow privileges; revoke all unnecessary direct table/function rights. The search path test proves one malicious same-name temporary-table case, not a comprehensive PostgreSQL privilege escalation audit.
5. No real Local Wall B-code, owner session, device enrollment private key, protected issuer signer, revocation push, native Windows/macOS locks or real Agent side effects are connected. `GLOBAL_WRITER_FENCE_NOT_READY`; safe two-host cutover remains **NOT_READY**.

## Next P0

Build a **real authenticated owner-approval provenance receiver specification and isolated tests** that verifies the Local Wall approval event and device-channel ACK against trusted PostgreSQL account/device/session state in one fenced transaction. Then design a protected verifier service identity, enforce signed lease issuance/ACK without exposing SQL EXECUTE privileges, and run Windows/macOS native lock acceptance in test devices. Keep the production wire protocol, Node ESM `.mjs`, Express5 and current live agents unchanged.
