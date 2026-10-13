# rc50 P0 — Signed synthetic verifier→issuer decision receipt

**Date:** 2026-10-13, Asia/Ho_Chi_Minh. **Only isolated Node.js source + unit UAT.**
Parent checkpoint: `970cda2` with independent private PostgreSQL global nonce ledger PASS. **No production migration, no real receipt private key or owner proof, no issuer grant wiring and no persistent HTTP Docker integration.**

## Correct trust model

A caller-controlled `verified:true` or SHA256 digest is **not** authority to mint a grant. A restricted verifier must check fake signed owner Wall and device-channel packets against independently authenticated, current PostgreSQL state. Only then can a separate verifier signing identity issue a short-lived, request-bound decision receipt. The issuer must validate the signature with an **independently pinned, active public verifier key** and must recheck request/device/session, intent, current writer epoch/generation and key revocation. **Cryptographic signature verification is not single-use consumption:** receipt IDs and evidence must be inserted and consumed atomically with nonce, grant generation, grant provenance and signing outbox in one protected PostgreSQL transaction.

## New source module (NOT WIRED)

`synthetic-verifier-issuer-receipt.mjs` (Node.js ESM):
- Domain-separated, fixed-field canonical UTF-8 bytes: `LIGHT_REMOTE_RC50_FAKE_VERIFIER_ISSUER_RECEIPT_V1`.
- Fake Ed25519 signing helper `signSyntheticVerifiedOriginReceipt`: calls `verifySyntheticOwnerChannelEnvelope(envelope,trusted,nowMs)` **before any signing**, and refuses tampered Wall/channel signatures. The test's freshly generated fake private key stays inside the fixture; no key is stored in Git.
- Strict signed fields include a random 128-bit receiptId, verifier ID+key epoch, request ID, grant ID, account/device/agent/connection, owner session SHA256, enrolled device key SHA256, Wall decision nonce SHA256, Wall evidence SHA256, channel ACK digest, expected writer epoch, expected next grant generation, issuedAtMs and expiresAtMs capped to 10 seconds or prior A/B expiry. No `physicalExecutionAuthorized:true` or `grantCommitted:true` outputs.
- `verifySyntheticVerifierIssuerReceipt(packet,issuerTrustedContext,nowMs)`: validates exact fields, version, canonical signature, independent SPKI fingerprint pin and key epoch, verifier active, time window, request pending, session/device active, writer not fenced, and exact IDs/digests/epoch/generation from **issuer-supplied trusted context**. It returns `VERIFIED_FAKE_RECEIPT_PRECOMMIT` with all real execution/commit authority flags false.
- This is a **test-only abstraction**; caller-supplied `trusted` and `issuerTrustedContext` in offline unit tests are fake snapshots. A future real verifier/issuer MUST obtain these from separately authenticated PostgreSQL context. The signer helper can otherwise be misused by a caller who controls both signing key and its fixture state. The issuer still needs real client-authenticated transport, key custody and restricted SQL roles.

## Executed on VPS-ARM (all tests fully runnable from source)

```sh
node --test platform-v2/test/test_synthetic_verifier_issuer_receipt.mjs
# 12/12 PASS, exit 0, stderr empty
python3 -B platform-v2/test/test_synthetic_verifier_issuer_receipt_source.py
# 9/9 PASS
node --check platform-v2/portability/synthetic-verifier-issuer-receipt.mjs
git diff --check
# PASS
```

Negative tests cover: fake `verified:true` flag cannot induce signing; fake wall/channel signature tampering; forged signed receipt/modified grant; unknown, unpinned, rotated or revoked verifier key; changed grant/tenant/device/session/connection/nonce/Wall proof/channel proof; stale epoch or next grant generation; fenced writer; revoked session, nonpending request or disabled device; future or expired receipt; extra keys or wrong private key; no private key or OS permissions leaked.

**Important deliberately passing limitation test:** a valid signed receipt can be cryptographically verified a second time. That is expected, NOT a security PASS for one-time use. PostgreSQL single-use receipt record is **not implemented or wired** yet. The separate global nonce table in `970cda2` currently tracks producer nonce and fake writer generation only, NOT this receipt ID and NOT a real grant transaction.

## Where integration must stop

1. **DO NOT** place verifier private keys in issuer, browser, Local Wall, HTTP ingress caller, or a shared writable volume. Use a dedicated constrained signer identity with authenticated source context and independently pinned public verifier keys.
2. **DO NOT** authorize OS effects, real A/B B-code, direct owner grant, Agent PTY/RM/SCP, or production scope from this local Node module.
3. The previously blocked *persistent HTTP verifier Docker runner* step remains blocked; this checkpoint did not run/build/deploy it or bypass the denial through PTY or other apps.
4. No actual PostgreSQL signed-receipt single-use ledger/transactional grant integration, TLS/mTLS, tenant-scoped principal ACL, cross-host global writer fencing, replay-resistant failover, native ARM64+AMD64 qualification or verified customer JSON/PG/Redis restore. **GLOBAL_WRITER_FENCE_NOT_READY**, production cutover NOT_READY.

## Next precise P0

Use separate private PostgreSQL scratch UAT to add an authenticated-receipt issuer ledger with `UNIQUE(receipt_id)`, pin+revision/revocation table, receipt TTL and a **single protected transaction** that consumes verified fake receipt, global nonce and updates synthetic grant/outbox/provenance and writer epoch. SQL is incapable of directly verifying Ed25519 in this current design: a trusted issuer must verify signed bytes and enforce trusted principal boundaries *before* the protected function can be called. A compromised writer that can submit arbitrary digest-shaped strings must NOT be able to grant. Test concurrent issuers, stale epoch, receipt replay, crash/rollback before COMMIT and pin revocation. No real production integration until all gates PASS.
