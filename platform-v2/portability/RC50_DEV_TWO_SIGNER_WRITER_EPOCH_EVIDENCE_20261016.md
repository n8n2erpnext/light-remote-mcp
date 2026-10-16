# rc.50 P0-A — two-signer WriterEpoch promotion evidence contract (DEV, NON-AUTHORITATIVE)

Date: 2026-10-16 Asia/Ho_Chi_Minh
Earlier HEAD: `7c418341b2eb870030a957a9a5680588ae33a5d0`
Branch: `feature/rc50-mjs-scale-20261011`
Scope: DEV-only pure verifier and unit tests, no Operator/Plugin/Fleet/Agent write gate integration, no customer/device state, no production keys, no service restart.

## Trust boundaries

A signed promotion request must not conflate an issuer's change of desired epoch with evidence the **old** writer has actually been fenced and has drained external effects. An independent pinned issuer signer and independently pinned enrolled source identity signer have different jobs:

- `grant` claim (signed by a trusted **independent issuer** Ed25519 key): transaction ID, source/target nodes, source epoch `N`, proposed epoch `N+1`, frozen snapshot SHA-256, cryptographically fresh random challenge, issued and expiry time.
- `fence` claim (signed by independently pinned **source-device** Ed25519 key): the exact same bindings PLUS the source's declared `driverFenced:true`, `unresolvedEffects:0`.

`platform-v2/portability/dev-signed-writer-promotion-evidence.mjs` validates *strict allowlisted canonical envelope schemas*, domain-separated Ed25519 signatures, independent pinned public keys, time-to-live at most 30 seconds, source != target, strictly sequential generation, cross-signer binding and exact externally supplied expected values, and in-memory replay challenge refusal.

**CRITICAL:** source `driverFenced:true` and `unresolvedEffects:0` are *claims signed by the device*, not independent observation of live processes, orphaned grandchildren, remote SCP, billing webhooks, or all current Operator/Plugin/Agent activity. A signature does not force an old process that ignores fencing to stop. The issuer public key is supplied by the caller; no actual globally durable consensus/issuer, physical write deny, multi-writer admission, bounded lease renewal, or anti-replay persistence exists. The verifier returns `TWO_SIGNERS_CHECKED_UNFENCED`, `targetActivationAuthorized:false`, `globalWriterFenceProven:false` on every successful case. It does NOT implement an activate/promotion/clear-WAL method.

P0-A still **NOT_READY**. Failing closed on false/missing evidence prevents unsafe optimistic promotion, but does not establish global writer authority. A real design must require a *separate monotonic authoritative store* and a hard enforced fence on **every write path across all hosts**, plus crash-consistent outbox/checkpoint evidence and deadline/renewal semantics that survive clock skew/network partitions.

## Tests

`platform-v2/test/dev-signed-writer-promotion-evidence.test.mjs` validates:
1. Two independent Ed25519 signatures on coherent source+issuer claims succeed as **evidence only** and never authorize target activation.
2. Wrong public/private signer and post-signature tampering deny.
3. Different random challenge, next generation or source snapshot digest deny despite individually valid signatures.
4. Replay of an already accepted challenge denies; the Set is explicitly only in-memory DEV, not crash durable.
5. Non-monotonic generation, source not fenced or any unresolved effects deny.
6. Expired signed receipts, missing trust/expected context, extra schema fields deny.

This is additive source-only to previous `platform-v2/portability/freeze-epoch-guard.mjs` (synthetic lane acknowledgements) and `PG_WRITER_EPOCH_UAT.md` (existing isolated DB concurrency work). It does not replace or imply those tests are real production fencing.

## Release blockers

P0-A: independent issuer and globally enforced fencing still absent.
P0-B: independent real owner Local Wall B issuance/Agent verification unaccepted.
P0-C: Agent-side durable native effect inventory not integrated; no complete quiescence attestation / 16 of 18 fsync only.
P0-D: physically independent ARM64→HOMELAB x64 restore of invented PG/RDB and synthetic JSON passes subset; not complete runtime snapshot under old writer fence.
P0-E: prod-grade OAuth/A-B/RM/PTY/SCP/billing signed end-to-end release missing. New installed SCP adapter has source-level regression; actual deployed canary not yet verified.
All five P0 gates remain NOT_READY. No production deploy or main merge.
