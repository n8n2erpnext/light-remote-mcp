# rc.50 DEV — Agent lifetime signed-observation contract (non-settling)

Date: 2026-10-16 Asia/Ho_Chi_Minh
Parent: `b250b707b87ccde16fc3e1a48785b46d3a735770`
Scope: isolated DEV/UAT-only proof primitives and tests; no production wiring.

## Motivation

Actual Agent binary UAT proved a signed command `ok` and a `finished` command spool record are possible while a process started by that command is still alive. An individual native process or PTY exit needs **independent inspection of the exact handle**, bound cryptographically to the enrolled device identity and particular command. It STILL cannot prove the globally safe moment for a writer cutover.

## New contract and capabilities

`platform-v2/portability/dev-agent-lifetime-observation.mjs` adds two pure functions:

- `signDevAgentLifetimeObservation`: derives one handle's `active` or `exited` state from the actual `NativeProcessRegistry.list(owner)` or `NativeTerminalRegistry.list(owner)`; requires the exact owner/account/device/session/agent and previously known handle. A vanished/pruned/unknown handle FAILS CLOSED, **never** becomes exited. Signs the schema-v1 canonical document under a domain-separated message using an Ed25519 private key.
- `verifyDevAgentLifetimeObservation`: verifies Ed25519 signature under the trusted/pinned device identity key, strict schema and field allowlist, expected account/device/node/command/handle and claimed writer generation, fresh random challenge, boot ID, 15-second receipt expiration and a replay set. A mismatch/expired/replayed/malformed receipt is rejected.
- Return values are only `BLOCK_ACTIVE` or `EXIT_OBSERVED_UNFENCED` with `settlementAuthorized:false`. There is **no** writer-lease check, journal settlement API, successful cutover flag or production integration.

A claimed `writerGeneration` is part of the signed binding, **not a grant**. Until an independent authority proves it and confirms the old writer has been fenced on ALL hosts, it is untrusted metadata. The `bootId` likewise needs independent durable trust anchoring; merely trusting Agent's self-declared random boot ID cannot detect a lost inventory. A replay `Set` is in-memory UAT-only, not a crash-safe distributed anti-replay store, deliberately unable to authorize settlement.

## Tests

`platform-v2/test/agent-lifetime-observation.test.mjs` includes:
1. Actual short-lived Linux Node OS child via `NativeProcessRegistry`: signed ACTIVE denies; signed EXIT after real termination is a candidate only; the DEV WAL remains with its pending command; brand-new empty registry after a simulated Agent reboot cannot claim a vanished handle exited.
2. Synthetic PTY provider via the same `NativeTerminalRegistry` used by Agent: active and ended states; owner and missing handle mismatch deny.
3. Tampered signed result, unrelated signer, wrong command/device/boot ID/writer generation/challenge, short TTL, replay, missing trust set and malformed schema all deny.

This is NOT yet a real Agent-signed side-effect receipt on the product channel. The producer is a stand-alone DEV contract and its output is never accepted by a live Operator. The next milestone is an authorized Agent side durable event inventory bound to an authenticated global writer fence/epoch; only after restart-proof inventory plus independent owner-approved reconciliation can a journal row be resolved.

## Release gates

P0-A/B/C/D/E all remain **NOT_READY**. No production deploy/restart, customer commands, main merge or denied-path write. A successful signature proves the holder of the signing key created the observation; it does not alone prove the integrity/completeness of the host process inventory, nor termination of all other remote effects (exec, fs, SCP, desktop, orphaned grandchildren etc.). Signed evidence is an input to a future cutover policy, never the policy itself.
