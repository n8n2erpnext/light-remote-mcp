# rc50 P0 — Separate public Ed25519 verifier + SCRAM-authenticated PostgreSQL origin writer

**2026-10-13 · VPS-ARM · disposable PostgreSQL17 Compose + ephemeral in-RAM fake Ed25519 signers. SOURCE-ONLY UAT.**

## Objective and measured improvement

Previously `lr_uat_commit_owner_channel_origin` was called as `SET ROLE lr_uat_origin_verifier` **from the scratch database administrator**, while the source test signer verified the packets it created. This checkpoint now:
1. Generates fake Wall and device-channel signed packet pairs in an ephemeral **signer** subprocess, with no private keys in output.
2. Runs a separate **public-key-only Node verifier** process, which parses strict signed Wall/channel packets, checks both Ed25519 signatures, matches public SPKI SHA fingerprints against **PostgreSQL-derived pins**, and verifies DB state: pending A/B request, owner account/session, enrolled device public hash, exact request creation and expiration, connected channel, pinned nonrevoked issuers, unused decision nonce and **pre-stored intended grant ID**. Only digest and receipt metadata are returned, `productionIssuerAuthorized:false`, `physicalExecutionAuthorized:false`.
3. Creates a random-password SCRAM role `lr_uat_origin_service_login LOGIN NOINHERIT` in the **throwaway database**, grants membership in `NOLOGIN` verifier with `INHERIT FALSE, SET TRUE`, and uses actual PostgreSQL **TCP password authentication over the container's non-loopback private Docker IP**. Wrong password must fail, right password must yield `current_user=lr_uat_origin_service_login` before `SET ROLE`, and login cannot read pins or EXECUTE legacy issuer without the authorized role switch.
4. Submits the verified fake origin receipt to the existing `SECURITY DEFINER` atomic issuer **as that SCRAM-authenticated login**, including 2 concurrent connections competing for the same request. Result is still 3 generations, all pending signing.

The **trusted DB state** in this experiment is retrieved by the Python UAT supervisor (which has scratch DB-admin authority), then passed to the separate Node verifier. This is NOT production-grade end-to-end trusted identity transport; a real protected verifier must retrieve expected data through an authenticated read-only service identity and preserve the exact verification-to-commit boundary.

## New / changed code

- `owner_channel_origin_verifier_acl_uat.sql`: one synthetic LOGIN role (no inherit), permitted to SET ROLE verifier only. Other three principals still NOLOGIN, default PUBLIC EXECUTE revoked, protected owner SECURITY DEFINER function.
- `owner_channel_authenticated_intents_uat.sql`: a **scratch-only** immutable request→intended grant/session table, seeded before signing. Used to derive verifier expectations from the DB, rather than trusting self-declared grant ID in the packet. Production request-intent persistence must be separately designed and authenticated.
- `synthetic-owner-channel-db-proof.mjs`: opt-in `--synthetic-envelope-only` outputs complete signed packets plus **public** SPKI, no private keys; old `--synthetic-only` digest-only CLI remains.
- `synthetic-owner-channel-verify-only.mjs`: a separate Node verifier which never calls `generateKeyPairSync` or signs data. Strictly UAT; requires `LR_RC50_UAT_ONLY=1`; checks both Ed25519 signatures and private scratch-DB expected-state fixture.
- `verify_owner_channel_origin_transaction_pg_uat.py`: adds private role password creation via psql stdin, holds random secret only in Python RAM / a 0600 **scratch-container-only** file, and authenticates via non-loopback internal Docker TCP using SCRAM. No password is placed in command arguments, Git, logs, Docker env or delivered response. It now invokes the restricted issuer as the authenticated role for actual successful origin issuances and concurrent duplicate attempt. Public-key-only verifier runs in its own subprocess, and the submitted digest/provenance tuple must match its output.
- `test_synthetic_owner_channel_verify_only.mjs`: **13/13 PASS** independently signed packet test cases: valid two-key chain, forged Wall/channel signature, stale pin, wrong request window, session/grant swap, revoked session, consumed nonce and expiry, CLI missing opt-in and no private key exposure.
- `test/test_scram_public_owner_verifier_source.py`: **10/10 PASS** source guards for never accessing production runtime, SCRAM connection, password isolation, real restricted writer calls and crypto-source separation.

## Critical Postgres authentication discovery

An initial attempt used `psql -h 127.0.0.1` **from inside PostgreSQL container**. A deliberately wrong password was nevertheless **accepted** in that scratch fixture. This is consistent with an existing trusted loopback route and is a serious gotcha: setting `password_encryption=scram-sha-256` or storing SCRAM hashes does **NOT** force every host route to check credentials. No production server setting or `pg_hba.conf` was modified.

The test was changed to reject localhost and connect to the private Docker network address (`hostname -i`, excluding 127.* / ::1). On this route, wrong password now fails with `password authentication failed`, correct password succeeds, and sessions have a distinct principal. A real production deployment must explicitly audit `pg_hba.conf`, require TLS/mTLS as applicable, disallow unintended trust routes, scope certificates/role credentials, and test access from **separate service containers/hosts**. This UAT client still runs inside a privileged scratch PostgreSQL container for convenience, so it is NOT a production trust boundary.

## Actual acceptance

```bash
python3 -B platform-v2/portability/verify_owner_channel_origin_transaction_pg_uat.py --confirm-synthetic-only
node --test platform-v2/portability/test_synthetic_owner_channel_verify_only.mjs platform-v2/portability/test_synthetic_owner_channel_db_proof.mjs platform-v2/portability/test_real_wall_owner_approval_http_uat.mjs platform-v2/portability/test_synthetic_channel_approval_attestation.mjs
python3 -B platform-v2/test/test_scram_public_owner_verifier_source.py
python3 -B platform-v2/test/test_owner_channel_verifier_acl_source.py
```

Observed on approved VPS-ARM: **15/15 PG origin**, **6/6 ACL runtime**, **5/5 SCRAM authentication** and **1 extra public verifier tamper/pin/intent bundle PASS**. **51/51 focused Node**, **10/10 new source guards** and **10/10 old ACL source guards** PASS. Private PG Compose is torn down via `down --volumes --remove-orphans` and has **no host-published ports**. Previous UAT `verify_issuer_origin_pg_uat.py` was untouched by fixture SQL changes; can be rerun independently.

## Do NOT promote

- Not an authentic owner Local Wall B-code approval. All signers are fake and ephemeral; session/pin/intent data were seeded by an administrator in a disposable database.
- SQL still **does not cryptographically verify Ed25519**; it trusts the SCRAM-login verifier after signature verification. A compromised verifier login can still forge digest tuples. Verifier credential isolation, mutual authentication, SQL role review, protected producer identity and authorization are not production-ready.
- This test's public verifier gets DB expectations from an administrator-controlled harness, not from a secure read-only PG pool. Also signing and verification occur in separate subprocesses but on the same VPS. A service/container separation + TLS/CA pin and rotation design remains.
- No guarantees for offline clock rollback, instant revocation, two-host split-brain fencing, Windows/macOS native locks or real Agent PTY, RM, SCP, process/update side-effect guards.
- NO production DB roles, migration, Agent, Operator, Local Wall, web, billing, existing rc50 service, public ports or customer data were changed. **GLOBAL_WRITER_FENCE_NOT_READY / production cutover NOT_READY.**

## Next P0

Use a **separate nonproduction verifier service container** with a read-only authenticated DB login for fetching expected state (no scratch-superuser dependency), and independent writer login confined to one verified commit procedure. Test TLS/pg_hba route, key pin bootstrap/rotation, forged producer, credential compromise, replay and crash before promotion. Then stage Local Wall authenticated owner event, Agent canary physical side-effect gating and single-writer cross-host rehearsal. Preserve `.mjs` Node and Express 5.
