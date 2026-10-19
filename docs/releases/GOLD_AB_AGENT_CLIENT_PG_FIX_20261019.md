# Gold A/B pairing PostgreSQL persistence hotfix — 2026-10-19

**Source:** official Light Remote (production connector) bound to VPS-ARM; **target changed:** isolated Gold LXD `light-remote-gold-uat` ONLY. Production LXD `light-remote-direct` and production plugin unchanged.

## Observed failure

- New Gold-only ChatGPT plugin `light-remote-gold` successfully began the A/B pairing: owner received a B code, approved at Gold Local Wall.
- Subsequent `light_remote_connection_helper({})` failed with `gold_postgres_persistence_unavailable`.
- PostgreSQL 17 and Redis 8 services were active, and Gold SQL `lr_ab_requests` contained one `approved` request and `lr_ab_grants` contained one valid approved grant.
- Operator journal at 06:00 UTC revealed recurring `[gold-registry-commit] gold_native_postgres_write_failed:agent_clients`. Gold `lr_agent_clients` and `lr_agent_bindings` were both empty before the fix.
- Live `lr_agent_bindings.account_id` is `NOT NULL` and participates in the two composite FKs `lr_binding_same_actor_as_client`, `lr_binding_same_actor_and_device_as_grant`.
- The Gold native writer `lib/gold-native-agent-clients.mjs` inserted a binding **without `account_id`**, so PostgreSQL rejected the insert and GoldRegistryPersistence latched the failure. This broke the grant-to-client attach path after approval despite healthy DB connectivity.

## Code change

- Include `account_id` in `INSERT INTO lr_agent_bindings`, passing **`row.accountId`** as the eighth parameter and shifting per-binding `working_context` JSONB to the ninth parameter.
- No schema migration, no generic JSONB business snapshot, no JSON-file fallback, no relaxation of composite tenant FKs or grants.
- Regression test: `deploy/scripts/selftest-gold-agent-client-tenant-binding.mjs`, verifies both required tenant owner parameter and JSONB slot.
- Existing `deploy/scripts/selftest-gold-ab-native.mjs` and `deploy/scripts/selftest-gold-registry-persistence.mjs` also PASS (fake DB tests only; real connector test below).

## Real Gold evidence

- Hotfix copied to `/opt/light-remote-gold-uat/lib/gold-native-agent-clients.mjs` in isolated LXD and Gold Operator+Plugin restarted. Backup: `.pre-binding-fix-20261019`.
- **Actual Gold connector test**: `Light_Remote_Gold.light_remote_connection_helper({})` (no A or continuation) returned **`ready`**; no new pairing code required.
- Gold PostgreSQL after that call: exactly **1 `lr_agent_clients` row and 1 `lr_agent_bindings` row**. A read-only join with `lr_ab_grants` and `lr_agent_clients` verified all four matching keys (account, device, grant, connection): 1 valid row.
- Operator journal had **no new** `gold-registry-commit` / `gold-registry-flush` failures during recovery.
- Restarted both **Gold** Operator and Plugin again; after health returned 200, PostgreSQL still had 1 Client and 1 Binding.
- Repeated actual Gold connector recovery call **after restart**: returned `ready`, `deviceState=online`. Session state reported `hold`; this is normal durable session hold, not a failed pairing.
- Gold HTTPS `/account` remained 200. PostgreSQL, Redis, Gold Operator, Gold Plugin all active.
- Production HTTPS remained 200 and was not modified.

## Follow-up

Owner can continue Gold MCP testing without generating another A/B request. Optional call `light_remote_session_control` to resume a Gold session if needed after deliberate restart. Test actual Gold tool execution separately. Keep any new Gold bugs in this isolated branch and never silently route Gold plugin calls through production.
