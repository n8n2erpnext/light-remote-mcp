# Light Remote rc.50 — Signed Free device rotation proof (MJS-only UAT)
**Date:** 2026-10-11
**Scope:** isolated synthetic UAT only; Node.js ESM `.mjs`, no React rewrite, no production data or service changes.

## Why
The earlier Free 10,000-calls/family ledger (migration 009) deliberately relies on a **server-trusted family mapping**, and the legacy FreeBenefitRegistry calls a `verifyRotationProof` callback. Neither implementation yet establishes how to link a replacement device safely. Blindly accepting a client family ID or automatically merging unrelated families would let a Free user escape the shared allowance.

## New components
- `platform-v2/src/identity/free-rotation-uat.mjs`: `FreeRotationVerifierUat`, crypto verifier with **both old and new device Ed25519 SPKI public keys** obtained from the injected trusted identity registry (never from the request), authenticates **both owner account contexts** through a required trusted callback, issues a cryptographically random 32-byte nonce, and demands two signatures over one canonical domain-separated challenge. Only a nonce SHA256 is stored; challenge lifetime is 120 seconds, SQL caps it at 5 minutes.
- Signed message fixes challenge ID, nonce, old/new device IDs, old/new owner IDs, source **Free family** ID, old/new Ed25519 key fingerprints, issued/expires timestamps. Changing any component invalidates signatures.
- `platform-v2/src/identity/pg-rotation-store-uat.mjs`: injectable PostgreSQL store for *only* `light_remote_rc50_uat` and future dedicated **`lr_rc50_rotation_verifier` non-superuser role**. It binds SQL placeholders and refuses reads/writes until role/database verification. This role has NOT been provisioned, so no real app DB connection has been made.
- `platform-v2/sql/012_signed_rotation_proof.sql`: synthetic UAT device public-key registry, single-use challenge digest, and rotation audit. The `lr_finalize_free_rotation_uat` function locks challenge and both device identities, checks owner/key fingerprints/source family/TTL, rejects already-bound target devices, and binds only a **previously unbound** new device to its signed source family. No existing family is merged and no monthly family usage is reset. It rejects replay and grants no `PUBLIC EXECUTE` privilege.
- `platform-v2/test/free-rotation-uat.test.mjs`: challenge/Ed25519 proof tests; nonce tampering, swapped signatures, changed public key, changed family, pre-bound target, expiry, missing owner approvals, wrong DB role all fail closed.
- `platform-v2/test/pg-rotation-store-uat.test.mjs`: future DB role gate/parameterized SQL and no-operation-before-initialization tests.
- `platform-v2/sql/test_signed_rotation_rollback.sql`: synthetic transaction checks reuse, invalid hash, target-family conflict, signed source-family mismatch, audit creation, and no reset of the existing monthly cap; explicit `ROLLBACK`.
- `platform-v2/test/concurrent_signed_rotation.py`: two parallel PostgreSQL claims targeting the same replacement device; precisely one is linked, one rejected, one audit row, and all generated test records deleted in `finally`.

## Verifications and evidence
- Existing `bash platform-v2/scripts/check.sh`: **26/26 Node tests PASS** (including 8 rotation tests), old SQL migrations/transaction fixtures, Team seats, worker queue/outbox regression, healthy internal-only DB containers.
- Manually ran PostgreSQL v12 migration and v12 synthetic SQL rollback: PASS.
- Actual two-request PostgreSQL rotation race: 1 linked, 1 blocked, cleanup PASS.
- Manually re-ran v8–v11 SQL rollback suites and Free/Team concurrent charging tests: PASS.
- Last verified UAT migration version: **12**.
- Last verified UAT row counts: accounts, devices, family devices, identity keys, rotation challenges, audit, usage events and outbox **all zero**. Production customer data was not read, mirrored, copied, or imported.
- Future DB roles `lr_rc50_app` and `lr_rc50_rotation_verifier` absent. `lr_finalize_free_rotation_uat` has `PUBLIC EXECUTE=false`.
- SQL migrations 008–012 and rotation contention test are currently **manual UAT tasks**, not automatically covered by the existing CI runner; Node rotation tests are automatically picked up by the existing `test/*.test.mjs` pattern. GitHub remote CI/push is not verified.

## Trust and deployment boundaries
**Do not wire this directly to production.** The current test has two distinct guarantees:
1. Node tests verify actual Ed25519 signatures against synthetic registered keys and a required owner-auth callback.
2. PostgreSQL tests verify durable one-time/mapping/family accounting constraints with synthetic challenges treated as *already verified*. The SQL finalize function itself does **not** perform Ed25519 verification. Therefore a future verifier role MUST be the only principal authorized to insert/consume challenges or link devices, and app/API roles must never directly mutate those tables. Create privileges via a separately authorized security review, not a tool-safety workaround.

The verifier has NOT been connected to Light Remote's enrollment certificates, owner OAuth principal, Local Wall/Agent transport, device identity key rotation, or real device lifecycle. Owner approval is presently an injected test callback, not a validated production sign-in approval. An old device that has been lost/erased cannot sign; that needs a separate owner-reviewed recovery path, not a fallback that silently skips signatures. Different-owner rotation must require two independent, authenticated owner approvals.

Never accept an arbitrary device public key or `familyId` from the requesting client. Device keys must be derived from trusted enrollment, preserving the existing Ed25519 device certificate contract. Before offering device rotation in the product, implement the authenticated challenge delivery over the mutually authorized channels, verify both signers, bind the verified UAT challenge to a narrowly permissioned DB role, test key revocation and owner changes, then run real end-to-end synthetic-device testing.

## Scale implications and next gates
- Since the destination must be **unbound**, there is no unresolved two-family historical counter merge, and source-family usage remains intact after rotation. Existing already-bound devices/families require a separate **merge + historical usage reconciliation** design with explicit locks and owner authorization; this work intentionally declines them.
- PostgreSQL role provisioning remains blocked/unapproved; do not use DB owner for application SQL or attempt to bypass controls.
- Before multiple Operator replicas, migrate remaining OAuth one-use state, account/session registries and fleet queue from process-local memory/JSON into durable repositories while preserving owner A/B device grants and client OS-side fencing.
- Run representative 100/500/1000 simulated users/sessions with P95/P99 metrics only after isolated API and device simulators work. This is a cryptographic and transaction correctness test, not an HTTP/RPS scale benchmark.
- Any production snapshot/import/cutover requires separate explicit owner authorization.

## Resume on owner-approved VPS-ARM
```bash
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform
git status --short && git branch --show-current
bash platform-v2/scripts/check.sh
node --test platform-v2/test/free-rotation-uat.test.mjs platform-v2/test/pg-rotation-store-uat.test.mjs
docker exec -i lightremote-rc50-v2-postgres-1 psql -v ON_ERROR_STOP=1 \
 -U lr_rc50_uat -d light_remote_rc50_uat < platform-v2/sql/test_signed_rotation_rollback.sql
python3 platform-v2/test/concurrent_signed_rotation.py
```
