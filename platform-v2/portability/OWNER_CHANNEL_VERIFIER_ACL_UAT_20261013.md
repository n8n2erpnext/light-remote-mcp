# Light Remote rc50 P0 — Restricted verifier → atomic owner/channel grant ACL

**2026-10-13 · VPS-ARM · SOURCE-ONLY PostgreSQL UAT. No production database/Agent changes.**

## Design objective

Previous commit `35b3c54` proved a one-transaction nonce + owner/channel evidence + A/B grant + device epoch + pending outbox contract with disposable Ed25519 test keys and a *database-superuser* caller. It did not prove that an external client could not bypass the new procedure by calling the legacy `lr_uat_issue_direct_owner_grant` or editing trusted pins and grant epochs directly.

This UAT introduces a restricted **PostgreSQL function EXECUTE boundary**. No real verifier service or authenticated network login is installed; the roles are exercised by `SET ROLE` from the disposable scratch database administrator. PostgreSQL still **DOES NOT verify Ed25519**, and a compromised verifier role can submit signature-shaped proof digests.

## Implementation

`platform-v2/portability/owner_channel_origin_verifier_acl_uat.sql` is applied only after original 001–013 migrations and existing two UAT SQL files to a **random private ephemeral PostgreSQL-only Compose project** with no published ports:

- `lr_uat_origin_untrusted` — `NOLOGIN NOINHERIT`, no grant issuer EXECUTE and no table mutation.
- `lr_uat_origin_verifier` — `NOLOGIN NOINHERIT`, only EXECUTE on the new `lr_uat_commit_owner_channel_origin`; no direct legacy issuer EXECUTE, no `lr_uat_trusted_origin_verifier_pins` read/write, no direct device writer floor update, no ability to create objects in `public`.
- `lr_uat_origin_function_owner` — distinct `NOLOGIN NOINHERIT` owner of the `SECURITY DEFINER` protected entrypoint, with explicit table SELECT, required `UPDATE(column)` for `SELECT...FOR UPDATE` and mutations, INSERT into ledger/grant/outbox, and EXECUTE on the older issuer **solely within the new wrapper**.

The UAT revokes PUBLIC EXECUTE for all functions in the scratch `public` schema, revokes PUBLIC CREATE on `public` schema, explicitly grants only the new wrapper to the verifier, and pins its `search_path=pg_catalog,public,pg_temp`. This prevents a client-created `pg_temp.lr_ab_requests` from shadowing the real request relation in the `SECURITY DEFINER` function. It does **not** make the function immune to every PostgreSQL SECURITY DEFINER pitfall.

The existing `verify_owner_channel_origin_transaction_pg_uat.py` now applies ACL by default in its `--confirm-synthetic-only` main flow. Calls that submit already independently verified fake Wall/channel proofs use `SET ROLE lr_uat_origin_verifier`, including two competing issuer connections. Test administrator is retained only for fixture setup, intentional mutation scenarios, role revocation tests and final checks. The original function `verify(pg,hardened_acl=False)` still defaults to its earlier behavior if imported by other isolated tests.

## Actual UAT acceptance

```bash
python3 -B platform-v2/portability/verify_owner_channel_origin_transaction_pg_uat.py --confirm-synthetic-only
python3 -B platform-v2/test/test_owner_channel_verifier_acl_source.py
python3 -B platform-v2/test/test_owner_channel_atomic_origin_source.py
node --test platform-v2/portability/test_synthetic_owner_channel_db_proof.mjs platform-v2/portability/test_real_wall_owner_approval_http_uat.mjs platform-v2/portability/test_synthetic_channel_approval_attestation.mjs
```

Observed **15/15** existing atomic origin cases PASS under restricted role; **6/6** new ACL runtime cases PASS: only verifier can EXECUTE protected wrapper, untrusted/direct legacy issuer prohibited, verifier direct pin read/update and epoch update prohibited, `public` schema CREATE prohibited, temp-table shadow attempt does not hijack transaction, REVOKE immediately blocks fresh verifier connection, and selective regrant allows invoking wrapper but cannot replay a consumed grant. **10/10 new ACL source guards**, **10/10 older origin source guards** and **38/38 focused Node tests** PASS. No scratch `lr-uat-move-*` containers or volumes retained after cleanup.

During development, the SQL role owner needed column-level UPDATE grants for tables locked with `SELECT ... FOR UPDATE`, while verifier/untrusted received none. One test invocation of `REVOKE` initially supplied 14 instead of the actual 13 `text` parameters, corrected and rerun; all runtime ACL cases PASS.

## Threat model limitations and rollout blockers

1. **Not a real authenticated verifier service.** UAT creates only NOLOGIN roles in a disposable database. Test superuser switches roles; there is no dedicated TLS/mTLS-authenticated service identity, tenant-isolated pool, credential rotation, signer key custody or trusted origin producer.
2. **No Ed25519 verification in SQL.** The Node fixture independently checks fake cryptographic packets, then sends their digests to a SQL `SECURITY DEFINER` procedure. Anyone who obtains the verifier EXECUTE capability can submit fake signatures/digests; SQL enforces only hash shape, trusted pin matching and relational state. Production must authenticate an isolated verifier service and restrict its access to no-bypass, signature-verified commits; ideally keep proof validation behind a single authenticated boundary.
3. **The `SECURITY DEFINER` role is powerful by design** and needs real PostgreSQL security review (default EXECUTE, schema search path, extension/operator shadowing, PL/pgSQL invocation, row-level security, tenant isolation, sensitive logs and migrations) before production. A database owner/superuser can always bypass test ACLs.
4. **No real owner B-code event or device channel signature** is produced by the running Local Wall/Agent. Auth-disabled Local Wall approval is *local-device trust*, not authenticated owner consent; cannot promote it automatically to owner grant proof. No real device private keys/issuer keys participated.
5. **Global single-writer across hosts, Windows/macOS native locks, signed production lease/receipt, real Agent physical side effects and production migration remain NOT_READY.** No real Agent, Operator, Local Wall, OAuth, billing, production roles, production PostgreSQL, k3s or live services modified.

## Next engineering checkpoint

Integrate the **actual authenticated Local Wall approval callback** with an opt-in nonproduction proof producer and independently authenticated verifier service, with persistent owner/session and device-channel key pins sourced from trusted enrollment. Test complete signature verification before the restricted PG caller obtains EXECUTE, plus key compromise/revocation, disconnect/reconnect and denied local-only mode. Only then add canary physical-side-effect gating and cross-host writer fencing. Keep Node.js ESM `.mjs` and Express5; avoid a TS/Fastify rewrite.
