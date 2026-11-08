# rc50 P0 — Real Local Wall HTTP owner-gate UAT + two-signer channel origin chain

**2026-10-13 · VPS-ARM · test-only localhost server and disposable synthetic credentials.**

## Goal and important result

This checkpoint is the FIRST UAT in this line to exercise the **actual source Local Wall HTTP `POST /api/approve` handler**, rather than relying solely on source inspection or manually asserted fake `approved=true` data. The service is started via imported `device-agent/local-wall.mjs` with port 0 on **127.0.0.1 only**, a freshly generated private synthetic local auth config (0600) and mock remote device status/approve callbacks. No actual B code, owner account, production device, cloud bridge or authorization endpoint is contacted. The private test directory and localhost server are destroyed at test teardown.

The actual handler checks owner authentication when auth is enabled, session-bound CSRF, looks up matching B code from currently pending requests, then calls `accessApprove(requestId)`. Test negative cases prove session absent, CSRF absent, a CSRF issued to a different session, forged cookie, unknown B code or invalid decision cannot call mock approve. Successful synthetic approval invokes the mock callback exactly once. After the pending code is consumed, replay fails. Deny path never emits an approval proof.

**Critical scope distinction:** A separate test instantiates the *same* real Local Wall handler with `auth:{enabled:false}`. This localhost-only mode still permits a synthetic B-code approval because existing runtime intentionally relies on local device trust. That is not the same as an authenticated owner session. The experimental attestation path deliberately emits **no signed owner proof** in this mode. Production issuer MUST demand an authenticated owner identity, or explicitly define a distinct strong local-device trust model; it cannot infer owner authentication solely from `accessApprove` success.

## Synthetic two-issuer chain

1. `synthetic-channel-approval-attestation.mjs` is a **pure, unwired fake Ed25519 model** for signed device-channel grant acknowledgments (request/grant/actor/device/Agent/connection/approval time and `state=approved`). It uses a strict signed packet domain, strict field schema and independently pinned fake channel verifier.
2. The earlier `synthetic-wall-approval-origin.mjs` test-only domain-separated Ed25519 owner proof includes `channelAckSha256` computed from the **whole signed device-channel ACK packet**, plus an opaque owner-session SHA, one-time decision nonce and enrolled device public-key digest. It has an independent fake Wall signing key.
3. `verifySyntheticChannelAndWallOrigin` checks the fake channel signature and target against independently supplied trusted request/grant/device/connection and channel key fingerprint; then verifies the fake Wall signature, including the channel ACK digest, current owner/session/enrollment/nonce state, expiry and ordering within 30 seconds. A newly signed but different device-channel packet cannot be swapped under a previously signed Wall proof.
4. The real Local Wall HTTP test **does not import this model into the real handler**. Only a mock `accessApprove` callback constructs fake independently signed channel and Wall records after a successful HTTP operation. This is deliberately not a production owner attestation producer; test callbacks can forge their own fixtures. No producer key custody or real device-channel signature verification exists in production.
5. Every returned success from the chain includes `productionIssuerAuthorized:false` and `physicalExecutionAuthorized:false`, never permission to run actual PTY, desktop, SCP, files, process or updater actions.

## New code and acceptance

- `platform-v2/portability/test_real_wall_owner_approval_http_uat.mjs`: **12/12 Node cases** (11 nested real authenticated-handler subtests + 1 parent plus separate auth-disabled HTTP test = Node count **13 total for this file**). The report from the *combined* run with channel tests is **28/28 Node PASS**.
- `platform-v2/portability/synthetic-channel-approval-attestation.mjs`: new synthetic strict channel ACK Ed25519 chain verifier.
- `platform-v2/portability/test_synthetic_channel_approval_attestation.mjs`: 15/15 signed-chain cases PASS; bogus signer, tampered channel status, pin mismatch, request/grant swap, consumed nonce, expired grant, ordering and old owner session all denied.
- `platform-v2/test/test_real_wall_owner_channel_source.py`: 9/9 PASS, guards confirming unchanged real Wall path, code not imported in production, loopback-only synthetic HTTP and no native execution.
- `platform-v2/portability/README.md`: checkpoint index updated.

Observed on VPS-ARM:
```bash
node --test platform-v2/portability/test_real_wall_owner_approval_http_uat.mjs platform-v2/portability/test_synthetic_channel_approval_attestation.mjs
python3 -B platform-v2/test/test_real_wall_owner_channel_source.py
```
**28/28 Node tests, 9/9 source guards PASS**, Node/JS syntax and `git diff --check` PASS. This is a limited new-test checkpoint, not a claim of a fresh full historical regression (a broad historical combined task was safety-denied earlier). No production processes, real Local Wall config, A/B code, owner session, production PG schema, Docker stack or customer key were touched.

## Missing P0 gates and next concrete implementation

1. **Real owner-proof producer**: owner/account credentials, MFA/local auth policy, CSRF, B-code lookup, exact device/channel context and nonce need a protected identity source and an immutable decision record. The current `device-agent/local-wall.mjs` auth can be disabled on localhost, so an issuer must NOT assume every successful approval has verified owner session identity. A real signed Wall record needs key custody, connection binding and exact grant response.
2. **Signed device-channel ACK source**: the current Operator `DeviceAccessGrantRegistry.approve` emits only an internal `device_access_approved` audit event, not the Ed25519-signed packet in this UAT. Do NOT trust status events or callbacks as cryptographic proof.
3. **PostgreSQL transaction boundary**: previous `issuer_origin_uat.sql` and `device_ack_verifier_acl_uat.sql` validate mock provenance and role privileges, but do not yet link real authenticated Wall and signed device-channel evidence to one grant-issuance transaction. Future UAT must atomically consume nonce and prohibit unauthenticated local-only approvals from minting owner grants.
4. **Signer/verifier and production deployment**: protected issuer/Wall/device signing identities, immutable pinned keys, verified PostgreSQL writer identity, offline revocation/clock rollback, Windows/macOS native locks and per-physical-effect Agent authority remain unaccepted. Global writer fence and production cutover remain **NOT_READY**.

Keep Node.js ESM `.mjs`, Express5 and existing production A/B protocol unchanged. No real side-effect authorization derives from a synthetic test PASS.
