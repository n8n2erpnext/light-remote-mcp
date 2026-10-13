# rc50 P0 — Isolated issuer origin transaction + receipt crash-point testing

**2026-10-13 · VPS-ARM · UAT ONLY. NOT real Wall owner verification; NOT a production migration.**

## Why this checkpoint exists

The existing `lr_ab_requests` and `lr_ab_grants` tables (migration 003) do not, by themselves, guarantee an immutable 1:1 origin link from a verified owner-approved request to one issued direct device grant. `lr_devices.owner_account_id` in migration 001 and composite tenant constraints in migration 004 are relevant, but an actual owner B-code and device identity are not yet proven by a trusted SQL transaction. The separate prior synthetic Ed25519 Agent gate and fake Wall grant chain already PASS; the critical missing acceptance includes transactional issuer provenance and interrupted receipt writes.

## New isolated PostgreSQL issuer prototype

`issuer_origin_uat.sql` runs **only after migrations 001–013 on a disposable private PostgreSQL Compose database**. It adds scratch tables for:

- `lr_uat_owner_approval_evidence`: fabricated, already-approved owner/session/request evidence; **does not authenticate a real human**.
- `lr_uat_device_enrolled_key`: simulated device public-key SHA256 pinned to a real typed device reference. The *caller cannot supply its fingerprint to the issuer function*.
- `lr_uat_device_authority_floor`: persistent per-device generation/grant revision, initialized once in the fixture.
- `lr_uat_grant_provenance`: UNIQUE request ID and UNIQUE grant ID, bound owner/device/fingerprint and the generation/revision issued.
- `lr_uat_lease_signing_outbox`: one source-of-truth pending row per grant/request. **The SQL creates no signature; status remains `pending`.**

The function `lr_uat_issue_direct_owner_grant(request_id,grant_id)` locks the joined request, mock owner evidence, session, connection, device and enrolled key with `SELECT ... FOR UPDATE`. It fails closed on pending/already-consumed A/B request; wrong owner, member purpose, revoked device, revoked owner session, stale request approval, closed/expired connection or invalid enroll key; it also checks request/session times. The **same PostgreSQL transaction** bumps the device generation and grant revision, creates `lr_ab_grants`, inserts the immutable provenance, appends a pending signing-outbox row and marks the A/B request consumed. Unique constraints and row locks prevent duplicate issuance or concurrent reuse. SQL exceptions roll the entire transaction back; no production roles or source migrations were edited.

`verify_issuer_origin_pg_uat.py --confirm-synthetic-only` creates one uniquely named `lr-uat-move-*-src` PostgreSQL-only Docker Compose project with no host ports, a private local generated database password, 13 checksum-verified original migrations, and fabricated owner/device/request/session IDs. It executes the SQL prototype and tests negative/positive/replay behavior. It destroys only that scratch project and its volumes on normal exit; it never touches the preexisting rc50 UAT PostgreSQL or Redis containers. Its acceptance output is `RC50_ISSUER_ORIGIN_PG_SYNTHETIC_UAT_PASS signing_status=pending production=false`.

### Observed PostgreSQL UAT — 10/10 PASS

1. Isolated fixture rows seeded, no signing keys.
2. Pending A/B request cannot mint grant.
3. Owner evidence must match the device owner.
4. Revoked owner session fails closed.
5. Revoked device enrollment blocks issuance.
6. One transaction creates grant, generation, consumed request, provenance and pending outbox.
7. Replayed request cannot double-mint or increment writer epoch.
8. Reused grant ID fails and rolls back without changing epoch.
9. Independently approved second request receives increasing generation/grant revision.
10. No fake `signed` outbox row is asserted before external signing.

## AgentReceiptAuthority synthetic journal fault injection

The existing Linux fake worker is extended **only** for `bound_start` in a private UAT fixture by `LR_RC50_SYNTHETIC_FAULT_STAGE`. Exactly four controlled fail-stop checkpoints are available: `after_write`, `after_file_fsync`, `after_rename` and `after_dir_fsync`. The worker immediately self-`SIGKILL`; it cannot issue a real physical OS command.

A pre-rename crash leaves a temporary file. On later entry, the worker detects the unexpected `.authority.<pid>.<nonce>.tmp` and fails closed with `ambiguous_persist_residue_requires_owner_reconcile` rather than silently discarding it. The TEST supervisor then examines/removes only the stale private fixture file before initiating `bound_recover`. After-rename crash shows a STARTED fake receipt, which recovery converts to UNCERTAIN; the other two phases find ACCEPTED and also conservatively quarantine it. Across all four phases, repeat `bound_start` is denied; stable kernel lock inode and independent contender still behave as expected. A spoofed JSON `testCrashAt` does not trigger the environment-only injector. The injection environment does not affect `bound_accept` or another real/native path.

`test_synthetic_bound_persist_faults.mjs` has **7/7 PASS** on Linux VPS-ARM. These are **SIGKILL process crashes, not sudden power loss**: after-rename but before fsync-directory is still ambiguous under a real disk power cut and cannot be claimed durable merely because a new process reads it. Tests do not cover hostile filesystem tampering, real hardware flush lies, all network filesystem semantics or Windows NTFS/macOS APFS.

## Admission gates still NOT READY

- **Real Wall owner issuer:** an owner entering B at Local Wall is not authenticated by this SQL. Production needs a protected and transactionally validated approval event, immutable request→grant FK/provenance, verified owner session/device enrollment public key and a separately protected issuer signing key.
- **PG fencing + signer custody:** scratch per-device high-watermark proves SERIALIZATION only inside this one disposable database; it is not a globally authenticated writer across two active hosts. Outbox is `pending`, with no cryptographic publisher, signed lease delivery, revocation push or key rotation yet.
- **Native execution:** real Agent duplex/polling, PTY/process, desktop, SCP, filesystem and updater remain entirely **unwired**. The synthetic journal stores fake `fake_noop` receipts with `physicalExecutionAuthorized:false`. The environment fault knob is prohibited in production.
- **Cross-platform:** Windows secured Global mutex / Session0 + desktop and `WAIT_ABANDONED`; macOS native lock and TCC state; clock rollback resistance; physical device crash windows; real two-host restore/partition tests remain pending.
- **Do not publish test role/security model:** the SQL function is `SECURITY INVOKER` by default in a database accessible only to the scratch UAT owner. No production role can be inferred from this test, and privileged PostgreSQL role provisioning was not attempted.

## Commands from canonical rc50 worktree

```bash
node --test platform-v2/portability/test_synthetic_bound_persist_faults.mjs
python3 -B platform-v2/portability/verify_issuer_origin_pg_uat.py --confirm-synthetic-only
python3 -B platform-v2/test/test_issuer_fault_source_guard.py
```

Existing tests for signed fake grant/receipt and other source guards should also be run before commit. Preserve Node.js ESM + Express5, existing production services and account protocols unchanged. **Global writer fence and production migration stay NOT_READY.**
