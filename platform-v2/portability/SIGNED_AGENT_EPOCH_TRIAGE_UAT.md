# Light Remote rc50 P0 — Ed25519 synthetic Agent gate and mutation triage

2026-10-12 Asia/Ho_Chi_Minh. Branch `feature/rc50-mjs-scale-20261011`, isolated rc50 VPS-ARM source-only. **No real Agent, Operator, billing, user data, network, production signer key or Docker operation was touched.**

## New signed Agent UAT

`synthetic-signed-agent-gate.mjs` wraps the prior `SyntheticAgentGeneration` fake receipt fixture without changing live Agent/Plugin code. Test ephemeral Ed25519 keypairs are created in RAM by `crypto.generateKeyPairSync('ed25519')`. The public verifier is supplied and can be compared using a SHA256 SPKI fingerprint; the private key is never saved to disk, never exported to user and not read from Light Remote production.

Two explicit canonical serialized envelope domains are **separate**: signed `fake_epoch` and signed `fake_command`. Strict known-field schemas reject unknown fields or non-no-op payloads. Epoch binds accountId, deviceId, agentId, increasing generation, grantRevision and bounded time validity. Command binds the same identity, generation, grantRevision, exact epoch SHA-256 digest, commandId, short time validity and `{kind:'fake_noop',message:'...'}`. Ed25519 signature verified before trust or receipt operations. Fake command expiry is checked on acceptance and **again immediately before fake start**; the gate never accepts a real shell/PTY/desktop executor.

Receipt persistence and restart poison/UNCERTAIN behavior comes from previous `SyntheticAgentGeneration` fixture. A new gate process must be presented a freshly verified signed epoch; replayed signed command for an existing receipt returns duplicate without execution, while old generation and changed payload fail. The test-only `controlProof=uat_ctrl_<epoch_digest_prefix>` remains a bridge to the earlier fixture; it is NOT itself an authenticated lease or independent owner approval.

`../test/test-synthetic-signed-agent-gate.mjs` — **20/20 PASS**: rogue key, signature tampering, identity binding, epoch time, command ttl at receive/start, grantRevision and epoch digest, domain separation, duplicate and restart UNCERTAIN, higher-generation fence, invalid public/private key types and fake-only restrictions.

**Limitations:** local clock can drift; test unsigned/expired proof of owner identity is not real A/B authorization; no network fetch of updated revocations, no cross-process device-local mutex, no production key rotation, no hardware custody, no real Agent integration or actual OS command; no reliable at-most-once guarantee for already executed PTY/desktop action. Existing inner fixture can be called directly by a test harness; real Agent requires enforced single dispatch boundary. No cross-plane authority or migration approval.

## Triage of source-derived mutation candidates

`route-fence-triage.json` groups the existing `mutating-route-census.json` candidates by the **11 actual route source files**, each with a priority and required gate. It deliberately leaves **every route group** `MANUAL_PER_ENDPOINT_REVIEW_PENDING` and `guardInstalled=false`, even for familiar routes. 163 candidate mutation source occurrences are NOT 163 unique HTTP endpoints; 28 timer/dispatch occurrences are not a complete background writer inventory.

Prioritize: account/A-B grant/Team/admin revoke (requires durable identity/entitlements), device channel and Fleet/PTY dispatch (device-side signed generation and command receipts), OAuth consumed-JTI (transactionally persisted), Paddle/support webhook/outbox (provider-verified idempotency), plugin MCP method multiplexing (per actual tool action, not a single POST guard), and actual terminal/filesystem side effects (check immediately before execution).

`../test/test_route_fence_triage.py` **6/6 PASS** verifies source-group coverage with no duplicates, priority/expected gate presence, manual-review status and no claims of global fence. Not a runtime E2E test.

## Next P0 integration gate

1. Classify dynamic subactions and all side-effect sources individually. Source scanner is only a heuristic and must not be used as a production admission list.
2. Add a **nonproduction** signed Fake Agent ↔ generation-scoped PG outbox adapter with receipt reconciliation and disabled OS side effects. Ensure no existing Agent/PTY command can execute in the tests.
3. Implement real authenticated owner epoch authority and least-privilege role separation only after valid permission review. Prior DB role provisioning was blocked, as were the 7 AES-GCM sealed runtime tests, two-stack Docker cold move, prior combined writer-source regression and update to `HANDOFF_CURRENT.md`. Do not retry any through PTY, wrapper or alternate interface.
4. Bind revocation, billing/usage idempotency and all writable HTTP/timer paths before claiming cross-host/k3s readiness.

Current runtime/global writer fence and independent restore remain **NOT_READY**. Keep MJS/Express 5 and stable wire protocols.
