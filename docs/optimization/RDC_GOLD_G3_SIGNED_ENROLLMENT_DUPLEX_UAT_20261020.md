# G3 Gold — Signed ephemeral enrollment → Duplex → Executor readiness → Reconnect

**Date:** 2026-10-20
**Gold branch:** `feature/light-remote-gold-rebuild-20261018`
**Baseline HEAD:** `09d5ed6` — G3 probe deadline and staleness accepted source.
**Status:** G3 additional real cryptographic protocol acceptance PASS; full live enrolled-Agent gate remains OPEN.

## Why this fixture exists
Earlier G3 duplex fixtures used `authorizeHello` shortcuts in local test servers and validated reconnect/callback behavior but did **not** exercise an Ed25519 identity, real enrollment approval, signed hello verification or replay rejection. Existing Gold LXD live Fleet leaves report `executorReady=null` because live Operator and connected Agents predate the source changes. The owner-account approval path of the running Gold service must not be bypassed or modified to force an E2E test.

## Exactly what ran
New `deploy/scripts/selftest-g3-signed-enrollment-executor-duplex.mjs` performs all of the following using the actual source implementations:
1. Create a disposable Ed25519 key pair **in fixture process memory**, begin enrollment with `EnrollmentRegistry.begin()`, assert pending; reject a wrong approval code, approve using the synthetic fixture's genuine one-time device code, claim with genuine poll token, and reject reuse of code. This is self-contained test owner authority in a process-local Registry; **not a registered user account or an owner approval on the live Gold service**.
2. Create ephemeral loopback Node HTTP server using the real `handleDeviceDuplexSession`, `FleetRouter`, `DeviceDuplexClient`, `deviceChannelMessage()`. Each device hello is signed with the ephemeral private key using canonical device proof; server calls real `EnrollmentRegistry.verifyChannel(frame,'stream',frame.payload)` before accepting it.
3. Send a safe synthetic command and observe real duplex result ACK and Fleet completion; no user shell, FS or desktop operation is invoked.
4. Assert a valid proof fails if its signed `executorReady` field is changed, and a valid used nonce cannot be replayed. Both use the **real EnrollmentRegistry proof validator**.
5. Inject failure of independent `ExecutorReadinessProbe` while signed stream remains fresh, send heartbeat status, assert `executorReady=false` and admission rejected with `target_node_executor_unavailable` (409).
6. Restore successful probe, verify dispatch recovers and prior command is not repeated.
7. Drop the real HTTP duplex TCP stream, let Client reconnect with a **fresh signed nonce**, verify new command completes with no repeated side effects.

**Expected markers:**
- `G3_EPHEMERAL_ENROLLMENT_APPROVAL_CLAIM=PASS`
- `G3_SIGNED_DUPLEX_DISPATCH_RESULT=PASS`
- `G3_SIGNED_CHANNEL_TAMPER_AND_NONCE_REPLAY_DENIED=PASS`
- `G3_SIGNED_AGENT_HEALTHY_CHANNEL_DEGRADED_EXECUTOR_BLOCK=PASS`
- `G3_SIGNED_EXECUTOR_RECOVERY_NO_DUPLICATE=PASS`
- `G3_SIGNED_AGENT_RECONNECT_NEW_PROOF_NO_DUPLICATE=PASS`

## Linux Gold UAT evidence
- VPS-ARM source fixture **6/6 PASS**.
- Real Ubuntu ARM64 LXD `light-remote-gold-uat`: staged to `/tmp/g3-signed-enrollment-20261020/` including `operator-host/enrollment-registry.mjs`, small relative import shim `operator-host/device-proof.mjs`, `lib/device-proof.mjs`, duplex client/transport/session/Fleet modules and the fixture. Executed `node /tmp/g3-signed-enrollment-20261020/deploy/scripts/selftest-g3-signed-enrollment-executor-duplex.mjs` **inside LXD**: 6/6 PASS.
- Host/staged fixture SHA-256 both `73bdb993e8c22e57539c4edb0758708c5399ae704eb1ee8cde2520086c2455a1`.
- No installed Gold Operator, Plugin, Wall or Agent modules replaced; no restarted units or persisted synthetic account/keys. Existing live Gold 5 units and IPC should be rechecked after tests.

## Cross-platform CI
Added fixture to Gold Operator source contract and the Windows, macOS (Intel+Apple Silicon), Linux Desktop (x64+ARM64) native packaging workflow smoke. It uses only Node built-in crypto/HTTP and existing project modules; no external service or credentials. CI results pending until exact source SHA logs verified.

## Still open
This exercise **does not claim** a real user-approved Agent enrolled in the running `light-remote-gold-uat` Operator, an authenticated Gold account session, service-runtime replacement, or physical network interruption. It does not validate process-side effects under actual Agent/OS native permissions. Owner-signed A/B or user account approval cannot be substituted by the synthetic fixture. Next: use authorized test-account enrollment via official Gold public origin and valid account session; run isolated disposable real Agent with matching current Gold Operator and follow up with bounded long-lived service soak; do not advance to G4 solely on this fixture.

Keep all pre-existing untracked UAT assets unchanged.
