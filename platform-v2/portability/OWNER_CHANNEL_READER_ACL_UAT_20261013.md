# rc50 P0 — Synthetic PostgreSQL trusted-context reader ACL (2026-10-13)

**Scope:** VPS-ARM dev worktree `feature/rc50-mjs-scale-20261011`; ephemeral PostgreSQL17 Compose, synthetic owner/channel packets. This is **not** an authenticated production Local Wall owner-origin service, not a production DB migration, and not physical Agent authority.

## Continuation from 3288b73

The previous `SCRAM_PUBLIC_ORIGIN_VERIFIER_UAT_20261013.md` checkpoint still sourced expected owner/session/grant/pin context through a **privileged Python scratch harness** and passed the JSON to an independent public-key-only Node verifier. This step removes the privileged **read** for the hardened UAT execution path.

Added:
- `owner_channel_origin_reader_acl_uat.sql`: fixture-only `lr_uat_origin_reader_login LOGIN NOINHERIT` (randomized SCRAM password), distinct `lr_uat_origin_context_owner NOLOGIN NOINHERIT` with SELECT permissions required by exactly one `SECURITY DEFINER` JSONB lookup `lr_uat_get_owner_channel_context(request_id,nonce_sha256)`. Explicitly revokes PUBLIC EXECUTE. The reader login receives EXECUTE on this lookup only, **not** table SELECT, write, verifier SET ROLE or legacy grant issuer EXECUTE.
- `verify_owner_channel_origin_transaction_pg_uat.py`: executes context lookup using SCRAM via PostgreSQL container's **non-loopback private Docker IP**, with separate 0600 scratch-container password from the writer. It supplies the result to an independent Ed25519 verify-only Node subprocess. The old privileged `load_trusted_origin` fallback is retained only for its non-hardened/test-import mode; the `--confirm-synthetic-only` entrypoint uses the reader role.
- `platform-v2/test/test_owner_channel_reader_acl_source.py`: 7 focused static source guards (distinct principals, SQL privileges, function and nonce constraints, synthetic boundary).
- This design note and README index.

## Measured UAT
```sh
python3 -B platform-v2/test/test_owner_channel_reader_acl_source.py
# Ran 7 tests: OK
python3 -B platform-v2/portability/verify_owner_channel_origin_transaction_pg_uat.py --confirm-synthetic-only
# READ PASS 01/02/03; ORIGIN PASS 01..15; AUTH PASS 01..05;
# ACL PASS 01..06; VERIFY PASS 01
# RC50_OWNER_CHANNEL_ATOMIC_ORIGIN_SYNTHETIC_UAT_PASS production=false
# RC50_OWNER_CHANNEL_ATOMIC_ORIGIN_PRIVATE_COMPOSE_CLEANED
```
The first augmented runtime attempt exposed a **test-order issue**: the test tried to SET ROLE `lr_uat_origin_verifier` before that role existed. The synthetic project cleaned up correctly. Changed the early negative probe to the already-created non-login read context owner, and verified reader→issuer SET ROLE denial **after** installing the issuer ACL. A full rerun then ended **exit 0** with empty stderr. No live accounts/secrets were used. Existing Node signer tests were not rerun because that source was unchanged.

## Trust boundaries and limitations
- Both reader and writer authenticate with SCRAM on the fixture container private IP; neither is a distinct service container, and the same local test supervisor still seeds fixtures and handles passwords. No verified TLS/CA/certificate bootstrap or production `pg_hba.conf` audit.
- Reader ACL narrows privileged access, but the context lookup accepts an arbitrary synthetic request ID. A real service requires per-caller authorization, trustworthy authenticated request intent and scoped DB row access. It must never accept untrusted session/pin/grant JSON from a remote caller.
- The Node public verifier still consumes a JSON context forwarded by the Python harness; an end-to-end protected verifier service trust channel is not proven. A compromised writer role can still fabricate proof digest-shaped values; PostgreSQL does not validate Ed25519 signatures.
- Read/verify/commit are not one atomic transaction. SQL's protected issuer must revalidate request, session, device, nonce, epoch and grants under locks; race prevention is not provided by the read API.
- All Wall/channel signers and enrolled/public pins are fake, seeded by a scratch administrator. No real B-code owner consent, real Agent receipt/physical command authorization, encrypted customer backup, cross-host split-brain resolution, or production cutover has been proven.
- No production/staging restart, deploy, DNS, systemd, main branch, customer state, Paddle, ERPNext or real credential changes. Isolated fixture Compose is torn down after test.

## Next P0
1. Make verifier its **own private nonproduction service/container**, with read-only authenticated context retrieval and an separately authenticated issuer writer; test service compromise/isolation, nonce and pin revocation, network/HBA/TLS routes and process kill between verify and commit.
2. Bind intent to real Local Wall authenticated owner approval on an explicitly opt-in nonproduction path; test local-trust-only denial.
3. Only after formal review, canary side-effect gating on Agent under signed A/B, writer generation and durable local receipt. Keep real PTY/RM/SCP disabled until fail-closed is established.
4. Independent ARM64/AMD64 artifact native ABI qualification, complete backup consistency across JSON/PG/Redis and real cross-host cutover remain outstanding. Maintain `GLOBAL_WRITER_FENCE_NOT_READY`.

All development remains Node.js ESM `.mjs` + Express 5. The historical master handoff and prior PASS checkpoints are preserved.
