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
