# rc50 P0 — Fake A/B approval → short signed lease → device grant floor

**13 October 2026 · Source-only, in-memory synthetic UAT. Do not deploy or import into production.**

## What was implemented

`synthetic-ab-grant-lease.mjs` composes a **two-issuer Ed25519 proof-chain model**, with deliberately fake account/device and ephemeral keys. The first signature is a fabricated **Wall approval certificate** scoped to a request ID, grant ID, owner account, actor account, specific device public identity fingerprint, Agent ID, connection ID, device-only purpose, approval time and grant expiry. A separate **service lease signature** references the SHA-256 digest of that exact approval and repeats its target, grant revision and connection; also binds writer generation, revocation revision and a short `notBefore/expiresAt` window. The third signed envelope is a **revocation event** by the fake service issuer.

Every signature uses strict field schema and domain separation. A changed payload, rogue issuer, different target, changed connection, fabricated grant or modified actor fails closed. Source SQL `003_auth_device_communications.sql` already defines `lr_ab_requests`, `lr_ab_grants`, `lr_agent_clients`, `lr_agent_bindings`; migration 004 enforces tenant/grant binding. These source tables were **only read** to ground the fake schema.

### Strict synthetic policy

- A request may be pending for no longer than 10 minutes. Its fake approval timestamp must fall within that original request window. A device grant may remain valid for up to 24 hours **from approval**, with a shorter optional expiry.
- A signed lease is bounded to **at most 30 seconds** and to the associated grant's expiration and absolute expiration. It cannot grant a different account/device/Agent/connection, or an unapproved member grant.
- State stores separate pinned fingerprints for the fabricated Wall and lease issuer keys, a device public-key digest, active grant ID + approval digest, generation and grant revision high-watermarks, a signed revocation floor, a last-seen clock watermark and a bounded set of revoked grant tombstones.
- Fake `accept`, `check`, and `revoke` return **proposed state mutations** marked `requiresFsync:true` and `physicalExecutionAuthorized:false`. They do not persist any bytes, send network packets or execute anything.
- `revoke` requires an authentic signed revocation, strictly increasing revision and an effective time not in the future; it tombstones the revoked grant ID. Replaying the old signed lease fails even before its expiry. A **new** A/B approval + generation/grant revision can rebind; a different grant cannot reuse the same active generation.
- Caller-supplied `request.nowMs` is not an accepted time source. The verifier takes a **trusted harness-provided clock** and rejects readings lower than `lastSeenMs`. This is merely a test contract: crash-safe watermark persistence, reboot monotonicity and protection against OS time rollback are **not implemented**.

## Verified UAT on VPS-ARM

`node --test platform-v2/portability/test_synthetic_ab_grant_lease.mjs`: **35/35 PASS**, source-only isolated per-test Ed25519 keypairs, including:
- Rogue/tampered approval, lease and revocation signatures; wrong device key, wrong connection, wrong account or direct-device/member purpose.
- Pairing request after 10 minutes, fake grant after 24 hours, lease over 30 seconds, expired short lease and malicious `request.nowMs` override.
- Correct approval digest linkage and fake device grant adoption; reject `check` without accepted grant.
- Signed revocation floor and tombstone; reject replay and forged/future revocation; regrant requires an independently signed new approval and higher generation.
- Fake clock rollback, corrupted state and physically nonexecuting results.

`python3 -B platform-v2/test/test_synthetic_ab_grant_lease_source.py`: **8/8 PASS** source guards for repo provenance, absence of real Agent imports, source-only mutations, domain separated signatures and bounded approval/lease periods.

## Important production trust boundaries and source gaps

1. **No real user authenticated.** A test runner can sign anything with its throwaway keys. The fake Wall approval signature does not establish that the human owner entered B in Local Wall, that a DB transaction marked the A/B request approved, or that a request and grant have a valid database FK. This is an executable **contract proposal**, not a verified issuer deployment.
2. **Grant ownership must be resolved correctly for teams.** `lr_ab_grants.account_id` may represent a member actor, not the device owner. Migration 004's `lr_devices.owner_account_id` is the canonical owner relation. This UAT intentionally covers only `purpose='device'` with actor equal to owner; team member grants need a separate signed delegation proof.
3. **Approval-to-grant DB origin must be closed transactionally.** SQL 003 has `lr_ab_requests` and `lr_ab_grants`, while `lr_agent_bindings.pairing_request_id` is not a complete immutable signed chain for all delivery paths. A real issuer must join and verify approved request state, owner account, device enrollment public key, exact connection and active grant within one fenced DB transaction. Do not accept a client-provided `approved=true`, grant ID or signing key.
4. **Offline revocation is bounded by lease expiry, not immediate.** A disconnected device cannot see a newly revoked grant; at most, an already-issued short lease remains usable until expiry in a healthy monotonic-clock model. The lease issuance policy and outage timeouts must fail closed. No claims about revocation latency or clock integrity under hostile device OS conditions are made.
5. **No disk lock/fencing integration in this module.** The real Linux `flock` + fsync fake AgentReceiptAuthority proved in `c707fee`/`bb62a83` is a separate UAT. The returned `next` state must be atomically persisted under that authority before any future simulated command check is considered effective.
6. **No production Ed25519 PKI, trust anchor, key rotation or device revocation feed.** PINs live only in fake state, owner authentication and consent proof are absent, and this module's supplied `timeSource` is a test dependency. Windows/macOS OS custody and process session policy remain not run.
7. No code changes to actual `device-agent/operator-agent.mjs`, native PTY/RM/SCP, Operator, Plugin, MCP protocol, OAuth, billing or PostgreSQL migrations. All operations return `physicalExecutionAuthorized:false`.

## Next P0 step

Integrate the fake A/B proof-chain **into the existing Linux kernel-locked synthetic receipt worker**, bind the accepted high-watermark to durable receipt state and test multiple processes, restart and signed-revoke before fake STARTED. Then implement a real owner-authenticated issuer and device-side native adapters for Windows/macOS behind nonproduction flags. Production remains **GLOBAL_WRITER_FENCE_NOT_READY**.
