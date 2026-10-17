# Gold Core-only API — startup contract (not full Light Remote)

The **Core-only** Unix socket server is an independently launchable source component. It is **NOT** a replacement for the full Operator, Device Channel, Fleet, Plugin, Wall, clients, billing or website.

## Mandatory prerequisites

- Owner-provisioned isolated **PostgreSQL 17** (Gold-only database `light_remote_gold_dev`, application user `lr_gold_app`) and isolated authenticated **Redis 8**; 20 SHA-locked migrations, including the owner-only versus Team member Agent binding separation and durable remote session/context table, with least privilege verified. **Do not use shared production data or the old RC.50 UAT state.**
- `LIGHT_REMOTE_GOLD_INDEPENDENT=1`, dedicated Gold root, `LR_GOLD_INSTANCE_ID` and owner-owned **0600** `LR_GOLD_PG_URL_FILE` and `LR_GOLD_REDIS_URL_FILE` strictly inside that root. Normal `goldCredentials` and `verifyGoldSchema` policy gates are mandatory.
- `LR_GOLD_CORE_SOCKET` absolute pathname under a Gold-owned `0700` private directory, not an existing socket path.
- `LR_GOLD_VERIFIERS_MODULE` absolute path to an owner-owned **0600** `.mjs` file inside a private directory under Gold root. It must export `goldCoreVerifiers`, providing vetted **real** callbacks: `verifyIdentityProof`, `verifyDeviceProof`, `verifyAgentPrincipal`, `verifyWallApproval`, `verifyPaddleSignature`, `verifyOwnerProof`, `verifyUsageEvidence`, `approveWallRequest`, `verifyAgentIngress`, `verifyOAuthClient`, `verifyBillingIngress`, and `verifyUsageIngress`; plus a private 32-byte `pairingEncryptionKey`. Do not accept self-declared booleans or install the mock callbacks from tests. No actual verifier module/key is distributed with source.

## Run only when those prerequisites are met

```bash
npm run gold:core:test
npm run gold:core:boot
```

The launcher fails **before binding** when the verifier module, credentials, database schema, Redis or private socket requirements are missing. `GET /healthz` and `GET /readyz` recheck PostgreSQL (`SELECT 1`) and Redis (`PING`) on each request; they return **503** if unhealthy, never fall back to a JSON business database.

The health response always includes `"cutoverComplete":false`. Even a healthy Core-only API **does not certify full Gold**.

## Hard deployment block at the latest checkpoint

The environment has **not** had a real isolated PG17/Redis8 Gold instance started; the prior Docker ingress policy denied the operation as `target_node_capability_missing`. Do **not** circumvent the denial by changing remote targets, tools, permissions, or sudo; the device owner must enable the required capability via its authorized management path. The source also lacks an authorized production `goldCoreVerifiers` implementation; no fake or insecure verifier may be substituted. The old Operator/Plugin JSON registries still exist, and `npm run gold:cutover:check` **must remain blocked**.

No actual Gold Core process, migration, device pairing, Paddle webhook, cross-process test or ERPNext write has been started using these instructions.

## 2026-10-17 Gold PG-only signed Device Channel — source integration

- **No new migration**: the already-locked Gold schema 001–020 has the required `lr_devices`, `lr_accounts`, `lr_device_connections`, `lr_ab_requests`, `lr_ab_grants`, `lr_remote_sessions` and `lr_jobs` columns. Historical SQL and checksum manifests remain byte-identical.
- New `platform-v2/src/storage/gold-device-channel-authority.mjs` implements **connect / renew / setGrace / disconnect** using PostgreSQL transactions and a private, owner-provisioned `verifyChannelEnvelope({purpose,signedEnvelope})` callback. Verifier output must cryptographically bind the purpose, identity (device ID, node ID and owner Account) and the signed payload (lease/grace/connection/reason); no user-provided owner, device or connection field is trusted. The `verifyDeviceChannelIngress({req,body,purpose})` callback is independently mandatory at the Unix-socket API boundary; absence of either callback fails closed before service startup.
- Connect and reconnect validate the active PG device owner/state, obtain the SAME account-wide `gold:connect:<owner>` advisory lock already used by `GoldPgCoreAuthority.connectDevice` (prevent Free/Pro seat-cap races across devices), and then a device-specific lock. Reuse only a nonexpired existing connection; never extend the original 24-hour maximum. An expired connection is closed with its A/B pending requests, grants and remote sessions revoked. Two concurrently active imported connection rows are refused instead of arbitrarily selected.
- Renew and grace management require a connection ID within the independently verified **signed** envelope; they cannot revive an expired/closed lease or extend the hard maximum. Disconnect closes A/B pending codes and grants, remote session lanes, and queued device/owner jobs inside one SQL transaction, then marks the device offline. Already-running command/device processes require the future Gold Job/Device Channel fencing and are NOT claimed forcibly stopped.
- The V20 `lr_jobs` table lacks a per-job `connection_id`. The authority only cancels unclaimed jobs for the exact device + owner when that device has no other still-live connection; cleanup of a stale/expired duplicate row must not cancel queues belonging to the current live connection. The future migration 021 worker/job work is still **blocked/unaccepted** in Git stash and is not silently restored.
- `platform-v2/src/http/gold-core-http.mjs` and `gold-core-server.mjs` expose the actual private Gold Unix-socket API routes `POST /v1/device-channel/{connect,renew,grace,disconnect}`. They take only the two-stage signed-channel verifier product, not request-body identity. The old bearer-only `POST /v1/devices/connect` now **returns 403** after authenticating, so a logged-in Account cannot assert a physical device is online and mint an A/B-capable connection without real device proof. Device registration and Team routes remain unchanged.
- Tests cover signed-only ingress, body identity spoof rejection, cross-owner/revoked device, connection cap locking, reconnect lease reuse, A/B and remote session rollback/cleanup, no cross-connection queued-job cancellation, duplicate active connection detection, native HTTP and native private Unix socket fail-closed 503 on PostgreSQL/Redis outage.
- **Verification on this source:** `npm run gold:core:test` 82/82 PASS; `node --test platform-v2/test/*.test.mjs` 124/124 PASS; `npm run gold:cutover:test` 4/4 PASS; 20/20 SHA immutable SQL and independent Compose static policy PASS; isolated Operator and Plugin HTTP smoke PASS. `gold:cutover:check` is still **BLOCKED_SOURCE_CUTOVER 0/23**: the new Core is not the canonical Operator/Plugin/Fleet. No live PostgreSQL17/Redis8 nor actual Device Channel signing bundle, live client or E2E. Production untouched.
