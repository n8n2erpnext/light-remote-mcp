# rc50 P0 — Real Wall path audit and isolated signed approval origin contract

**2026-10-13 · VPS-ARM · SOURCE ONLY / synthetic Ed25519 fixtures. NOT deployed.**

## Actual source path verified

Existing Local Wall code (unchanged):

1. `device-agent/local-wall.mjs`: `GET /approve` renders B-code lookup. `GET /api/approve` calls `resolveCode`, which matches an entered B code against pending requests returned by the connected device's remote status. `POST /api/approve` requires a valid session when Wall auth is enabled and invokes `mutationAllowed(req)` CSRF guard, re-resolves the B-code and calls `accessApprove(found.requestId)`. We did NOT inspect or export any live B code.
2. `device-agent/operator-agent.mjs`: `approveDeviceAccess(requestId)` checks enrolled local device state, requires the `pa_...` request identifier format, and calls `channelRequest(...,'access-approve',{requestId})`.
3. `operator-host/executor-routes-device-channel.mjs`: the `/v1/device-channel/access-approve` route builds a `verifiedChannelContext`, confirms connected device and calls `accessGrants.approve`. This verifies the device-channel transport but **does not persist a separate cryptographic Wall-owner approval receipt**.
4. `operator-host/device-access-grant-registry.mjs`: `approve()` checks pending/unconsumed request, same connected device and connection, request expiry; mints the grant, saves registry state and emits `device_access_approved` with `accountId`, `deviceId`, `connectionId`, `requestId` and `grantId`. That event is **an internal audit/status event, not an issuer-signed durable identity proof**. The current runtime does not yet use the rc50 PostgreSQL issuer tables from this branch.

This audit is not an assertion of a vulnerability or a change to current Local Wall access control. It identifies **missing artifact provenance** required to promote rc50 signed-grant lease issuance.

## New synthetic-only source model

`synthetic-wall-approval-origin.mjs` creates/verifies a test-only canonical, domain-separated Ed25519 approval receipt. It includes a fabricated request/grant pair, direct owner/actor identity, device public key SHA256, exact device/Agent/connection, opaque owner-session SHA256, single-use Wall-decision nonce SHA256, connected device-channel ACK SHA256, approval/create/request/expiry times, device-only purpose and a strict `approve` action. It never handles raw B codes, cookies, passwords, OAuth bearer tokens or secret signing keys in returned values. Real code MUST derive those references from a protected service context and a database, not from user-controlled JSON.

`verifySyntheticWallApprovalOrigin` requires pinned verifier, valid Ed25519 packet, exact target equality against *trusted supplied fixture expectations*, approved request, active owner session, active enrollment, connected device and still-unused nonce; it checks request duration <=10m, grant <=24h and expiry. It returns only a test provenance SHA256 and fingerprints, with **`physicalExecutionAuthorized:false` and `productionIssuerAuthorized:false`**.

Do not import this model into `device-agent/local-wall.mjs` or `operator-agent.mjs` as is. It contains a TEST signer and caller-provided expected flags; a caller with control of both would trivially simulate an approved event. It is a **contract of required claims**, not a trusted approval source. Real implementation needs authenticated owner session bound to enrolled device and verified transport, CSRF acceptance, one-time B-code and operation ordering, securely issued signer attestation, replay-safe nonce storage, trusted issuer key custody and transactionally checked PostgreSQL grant provenance.

## PostgreSQL concurrent issuer transaction UAT

The prior isolated `verify_issuer_origin_pg_uat.py` fixture was extended with **two independent concurrent PostgreSQL client transactions** trying to issue two different already-approved fake A/B requests for the same device. Both must pass with noncolliding `generation=3,4` and `grantRevision=3,4` after the earlier tests used 1 and 2, and the scratch signing-outbox must have exactly four **pending** rows with zero signed rows. The existing per-device authority-floor row UPDATE serializes the two issuers; neither client chooses its own generation.

Actual observed: **12/12 PASS** in a randomly named PostgreSQL-only Compose project, 13 checksummed source migrations, zero host-published ports. Project and volumes removed after completion. The earlier 10 negative/positive/replay checks remain PASS. No production roles created, no production database or schema migration touched. A durable signed publisher and final Agent ACK are still absent.

## Tests and current non-claims

```bash
node --test platform-v2/portability/test_synthetic_wall_approval_origin.mjs
python3 -B platform-v2/portability/verify_issuer_origin_pg_uat.py --confirm-synthetic-only
python3 -B platform-v2/test/test_synthetic_wall_origin_source.py
```

Observed **25/25** Ed25519-origin fixture tests, **12/12** isolated PG issuer tests and **8/8** read-only source guards. The 25 negative/positive cases include forged wall signer, payload tamper, wrong owner session, grant/request/connection swap, missing device-channel ACK, member-purpose rejection, expired approval, consumed nonce, revoked owner session/enrollment/connection, missing trusted expectations and no real OS-action allowance.

**Still NOT READY:** official owner-authenticated signed Wall producer, unforgeable owner event storage, matching physical device enrollment public key, publisher trust distribution, real signer keys / ACK, Agent compulsory real side-effect gating, cross-platform native locks and global PostgreSQL writer authority. Do not deploy this fake signer, do not claim real user B-code verified, do not claim instant offline revocation or safe cross-host cutover.

## Regression execution caveat

A broad command combining all historical Node regressions, source guards and the independent flock suite was **blocked by OpenAI safety checks before execution** in this session. No combined-regression PASS is claimed for this checkpoint; it was not retried by splitting the denied job across wrappers or tools. The **new standalone 25/25 Node tests**, **8/8 source guards**, and **12/12 isolated PostgreSQL issuer tests** did run and pass through the normal official Light Remote interface. Existing prior-commit regression numbers remain historical evidence only, not a fresh acceptance for these changes.
