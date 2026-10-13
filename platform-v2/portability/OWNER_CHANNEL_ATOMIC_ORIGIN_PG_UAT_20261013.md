# rc50 P0 — Synthetic signed Wall + device-channel origin → atomic PostgreSQL grant

**2026-10-13 · VPS-ARM · ephemeral PostgreSQL Compose, synthetic Ed25519 keys. TEST ONLY.**

## What was actually implemented

This checkpoint joins the previously tested source-only Ed25519 Wall owner + device-channel attestation model to a **single PostgreSQL transaction** that issues a grant and appends a signing-pending outbox. It does not wire either signer into production and does not authenticate an actual owner who enters B-code.

- `synthetic-owner-channel-db-proof.mjs`: **explicitly synthetic-only Node CLI** (`LR_RC50_UAT_ONLY=1` plus `--synthetic-only`). Generates throwaway Ed25519 Wall/channel keypairs in memory (one pair each per 1–3 mock requests), signs a device-channel ACK and Wall owner approval binding the whole signed channel packet's digest, request/grant/owner session/device public-key fingerprint, one-time nonce, creation and expiry of the **exact** request from the scratch DB, and expected time ordering. Calls `verifySyntheticChannelAndWallOrigin` to verify both fake signatures before returning a digest-only proof plus test public-key fingerprints. No signing private keys or raw B-code/cookie/token are returned; `productionIssuerAuthorized:false` and `physicalExecutionAuthorized:false`.
- `owner_channel_origin_transaction_uat.sql`: UAT-only schema creates a trusted-pins table and one-to-one immutable ledger (request PK, grant unique deferred FK, owner, session, device/connection, enrolled fingerprint, fake Wall/channel verifier pins, **globally unique one-time decision nonce**, unique Wall signature proof SHA and channel signed-packet SHA, request creation/expiry and approval time). The SQL `lr_uat_commit_owner_channel_origin` locks request, owner session, enrolled device, connection, verifier pins, checks pending request, owner/account/device/Agent/key pin/connection trust, session revocation, exact stored creation/expiry and approval order, and unique nonce. In **one PostgreSQL transaction**, it inserts the proof ledger and older owner evidence, marks request approved and calls the prior `lr_uat_issue_direct_owner_grant` which creates grant, monotonic generation+revision and pending signing-outbox, then consumes request. SQL failure atomically rolls back all these writes.
- `verify_owner_channel_origin_transaction_pg_uat.py --confirm-synthetic-only`: allocates one randomly named private, no-ports PostgreSQL Compose project, checks PG healthy/network isolation, applies 13 immutable SQL source migrations and the prior issuer UAT SQL before the new schema. Generates only synthetic rows and uses Node CLI to create 3 independently signed mock Wall+channel proof pairs sharing the same UAT trust pin. Mutations stay isolated in the new scratch database. Always destroys its own project/volumes in `finally`.
- `test_synthetic_owner_channel_db_proof.mjs`: 10 tests for fake signer/verification, no private key output, per-request nonce distinctness, stable fake issuer pins within a batch, invalid device/session fingerprint, no UAT flag, timing.
- `test/test_owner_channel_atomic_origin_source.py`: 10 static source guard checks (including exact DB request creation/expiry and no production integration).
- `portability/README.md` new index checkpoint.

## Actual acceptance on VPS-ARM

```bash
python3 -B platform-v2/portability/verify_owner_channel_origin_transaction_pg_uat.py --confirm-synthetic-only
node --test platform-v2/portability/test_synthetic_owner_channel_db_proof.mjs platform-v2/portability/test_real_wall_owner_approval_http_uat.mjs platform-v2/portability/test_synthetic_channel_approval_attestation.mjs
python3 -B platform-v2/test/test_owner_channel_atomic_origin_source.py
```

- **15/15 private PG transaction scenarios PASS**: source DB owner/session fixtures, no unsupported issuance from pending request, two UAT signatures and pinned keys, wrong owner/device/channel key, revoked owner session/enrolled key/pin, reversed event ordering, signed request-time mismatch, one atomic request→grant+ledger+nonce+epoch+outbox transition, replay refusal, same nonce re-used across a different request, rollback of reused grant ID, a second valid generation, and a two-issuer simultaneous race on the same request with exactly one winner. Final state is exactly 3 unique ledgers, 3 pending outboxes, device floor generation/revision 3:3 and **zero signed rows**.
- **38/38 focused Node tests PASS** (10 new mock bridge, 15 fake channel attestation, real Local Wall localhost HTTP test group); source guards **10/10 PASS**.
- On errors, project cleanup prints `RC50_OWNER_CHANNEL_ATOMIC_ORIGIN_PRIVATE_COMPOSE_CLEANED`; after success the same marker is printed. No production PG roles, table changes, service restarts or existing UAT instance mutations.

## Critical honesty about trust

1. **Not real owner approval.** The synthetic bridge generates both signing keys in its own test process. It does NOT receive a cryptographically attested real POST from Local Wall, verify live owner identity or accept a real device-channel ACK. The previous commit `217d3d5` separately tested actual Local Wall HTTP session+CSRF+B logic on localhost with mock callback; this checkpoint has not yet combined that real HTTP callback with a live PG issuer service. Do not report real end-to-end production A/B issuance.
2. **PostgreSQL does NOT verify Ed25519.** SQL stores pinned verifier fingerprints and a digest tuple **supplied by the UAT Node process**; if an attacker has direct access to the function or DB owner rights, they can spoof all data. The immutable ledger and nonce transaction are evidence-processing mechanics, not authentication of the service itself. Real deployment must require an independently authenticated, protected verifier service with immutable pinned keys, separate database role, and revoke all direct access to the legacy issuer and unchecked table mutations.
3. **No protected key custody.** Source uses transient fake keys; no owner/session issuer key attestation, device transport signing identity or rotation/revocation is established.
4. **One database only.** Same-DB row lock proves local serialization, not cross-host writer exclusivity, power-loss data durability, clock rollback resistance or global partition recovery.
5. **Auth-disabled Local Wall** can authorize a device under device-local control but cannot be assumed to represent authenticated owner identity. Future issuer needs a separately specified policy for this mode.
6. Native PTY/process/Real Remote/SCP/fs/updater routes remain unchanged; all fake proofs explicitly deny real physical execution. No Windows/macOS native lock or actual Agent receipt-authority canary yet. Production and global writer cutover are **NOT_READY**.

## Next P0

1. Build an *isolated, nonproduction* owner-attestation producer that consumes the actual Local Wall authenticated approval context, proves CSRF/B-code once-only and binds an authenticated device-channel response with durable request→grant; do NOT log B codes/cookies or mint key material from client-supplied claims.
2. Add a protected non-superuser verifier-to-DB identity and explicit `EXECUTE` role policy (the last `85eb5bf` experiment applied only to ACK). Ensure no unchecked SQL issuer pathway can be called by a verifier client or untrusted API.
3. Add signed issuer publisher/ACK state to this exact origin chain, then native Windows/macOS lock acceptance and full duplex/poll opt-in Agent canary gates. Real global writer fence/cold-move remains NOT_READY.

Keep Node.js ESM `.mjs`, Express5; no protocol rewrite or live production side effects.
