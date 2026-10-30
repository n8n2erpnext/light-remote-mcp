# Gold P2-I0 — first implementation source-contract audit (2026-10-30)
Companion to `GOLD_P2_INTEGRATED_ABV2_NICKNAME_PRO_SHARE_PLAN_20261030.md`.
Authority: Gold branch `feat/gold-connection-gc-reconciler-20261029`, starting SHA `d6892d7`.
Audit is READ-ONLY, not a deployed feature or final implementation sign-off.

## Confirmed seams and changes required
**A/B V2:** Current MCP `light_remote_connection_helper` (`plugin-server/tools.mjs:170+`) accepts legacy 4+4 A and `remote:read`; `operator-adapter.mjs:58+` calls pairBegin/recover and still tells the user to copy A from Wall. `device-pairing-registry.mjs` uses `rotate/currentOrRotate/redeem` and in-memory `currentByDevice`; `device-access-grant-registry.mjs` has exact pairingId and 24h `AB_GRANT_MAX_LIFETIME_MS` but request timeout max 10m. Need new account-scoped resolver, immutable PG short ID and on-demand request binding; old 4+4 flow must remain a compatibility branch, not overwritten in-place. Research how exact client identity survives separate helper invocations before opening a pending request.

**Nicknames:** `operator-host/session-manager.mjs` `SessionRegistry.open` already records `label` and `_view` exposes it; helper path `executor-routes-device-channel.mjs:377` and `plugin-server/operator-adapter.mjs:160` pass hardcoded `ChatGPT Light Remote`. `lib/gold-session-redis.mjs` mutator whitelist includes `open/ensure/resume/hold/setWorkspace/close/...` but **no setDisplayName**. A valid implementation must add server-authorized displayName setter with owner precedence, Redis snapshot persistence, idempotent first Agent label, collision handling and owner UI; passing `label` blindly on repeated helper calls would overwrite identities.

**Pro Share:** `executor.mjs` has `teamSessions=null`; `executor-routes-account.mjs` returns `crossAccountExecutionEnabled:false`. `pro-team-registry.mjs` globally has five seats and default 5000 member calls: retain those internals and make cap2 a separate entitlement policy, not a global MAX_SEATS change. Guest must independently authorize via the A/B V2 path and must not receive owner account/Agent permissions; trusted guest-to-owner billing/action delegation remains unimplemented. Owner's proposed $5 add-on is not live Paddle provisioning.

**Schema:** Current migration lock has sequential 040,041,042; allocate new immutable numbers only **after 042**. PostgreSQL17 durable state, Redis8 TTL/CAS; no shadow JSON/SQLite authority. Gold UAT still 039. A/B V2 and guest auth feature flags default OFF. Production rc47 unchanged.

## I0 implementation-ready contracts to freeze next
1. `DeviceShortId`: device UUID ↔ globally/owner-unique six-character ID, never recycled, explicit guest visibility policy.
2. `TargetResolution`: OAuth-owner/guest principal, query -> bounded safe metadata 0/1/N without grant or A issuance.
3. `PendingApproval`: exact account/Agent/client/device/connection/request binding, A6+5+B4+4, one TTL and atomic pending/recovery, no B in Wall HTML.
4. `SessionDisplayName`: authenticated same-session Agent first-write and owner override, unchanged sessionId, allowlisted display-only model.
5. `ProShareAuthority`: invited guest identity + selected device + own A/B + active owner entitlement + per-operation owner-paid quota, validated at dispatch.
6. `ReleaseManifest`: frozen Git SHA, migration-lock hash, four-service UAT hash, client artifact signature, evidence ledger M1–M7, rollback receipt.

**Next source implementation order:** DeviceShortId PG migration/backfill fixtures → account-scoped resolver → new pending request/owner approval/legacy compatibility → session display mutation + Wall → one-guest permission + ledger. Unit CI on every change; one physical UAT after final candidate freeze. No live migrations or paid billing now.
