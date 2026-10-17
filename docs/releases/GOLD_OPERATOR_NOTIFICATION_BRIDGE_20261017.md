# Gold Operator notifications → Gold Core PostgreSQL authority bridge

Date: 2026-10-17
Scope: **independent Gold branch**, notifications ONLY. Production remains unchanged.

## Why this exists

The initial `LR_GOLD_NOTIFICATIONS_PG=1` Operator canary wrote notifications into PostgreSQL, yet its `requireAccount()` still accepted a session from the legacy JSON `AccountRegistry`. Thus a single inbox operation mixed two incompatible principal authorities: JSON for caller, PostgreSQL for stored notification/audience. The separately built private Gold Core correctly authenticates `lr_sessions` and reads `lr_accounts.group_id`.

The Gold canary now connects the **canonical Operator HTTP notification routes** to Gold Core rather than authorizing the user via JSON and writing the result directly. The transport is `operator-host/gold-notification-core-bridge.mjs`.

## Gold opt-in startup and bounded trust

- Must explicitly set `LR_GOLD_NOTIFICATIONS_PG=1`, `LIGHT_REMOTE_GOLD_INDEPENDENT=1`, `LIGHT_REMOTE_GOLD_ROOT=/absolute/private/gold-root`, `LR_GOLD_CORE_SOCKET=/absolute/private/gold-root/run/core.sock`, plus the already-required verified Gold PostgreSQL and Redis URL file/instance configuration for `openGoldDataPlane()`.
- Gold Core MUST already be listening on its private socket. The bridge requires the socket be inside the Gold-independent root, its actual parent directory private (no group/world bits), its inode a Unix socket rather than a symlink, and the socket not group/world accessible. An absent/bad Core socket denies Operator startup in this opt-in mode. It never redirects to the production socket.
- In Gold canary mode, `accountNotifications=null` for the legacy Account route dependencies: **no second file-backed notification writer is constructed**. The bridge intercepts exactly the 5 canonical routes below **before** `handleAccountRoutes`. If the Core socket is lost after startup, those paths return 503, never fall back to JSON. Other Operator endpoints remain on the original implementation and must be migrated separately.
- In default production/legacy mode, the opt-in flag is absent, `goldNotificationBridge=null`, and the original `AccountNotificationRegistry({stateFile:NOTIFICATIONS_STATE_FILE})` is left unchanged. Gold opt-in does NOT start or stop production services.

| Method | Canonical Operator path forwarded to Core | Authentication source |
|---|---|---|
| GET | /v1/accounts/notifications | Gold Core PostgreSQL `lr_sessions`, `lr_accounts` |
| POST | /v1/accounts/notifications/read | Same verified Gold session, account ID not taken from body |
| GET | /v1/admin/notifications | Gold Core owner-provisioned `verifyNotificationAdmin` |
| POST | /v1/admin/notifications/publish | Gold Core verified admin account, not `publishedBy` body |
| POST | /v1/admin/notifications/:id/cancel | Same trusted admin verifier |

The bridge strips query strings, drops legacy `x-light-account-session` and all other headers by default, and forwards only `Authorization: Bearer` and the optional raw `x-light-operator-admin-proof` to the private Core. The latter is only **transport bytes**: `verifyNotificationAdmin` MUST independently authenticate signature, issuer, freshness, audience, operation and verified account, or reject. A string from a client header does not itself grant admin privileges; no production-grade admin proof issuer/verifier was implemented in this batch.

The bridge caps inbound bodies at 32 KiB, outgoing Core responses at 1 MiB, uses 4-second upstream timeout and fails closed on transport errors. It forwards JSON replies as JSON and plain-text 503 dependency errors as plain text, so clients are not instructed to parse an invalid JSON body. It never exposes database credentials or private socket paths in user-facing errors.

## Verification (source/testing boundaries)

1. `platform-v2/test/gold-operator-notification-bridge.test.mjs`: real Unix socket stand-in for Gold Core; authenticated bearer scope, no legacy session forwarding, denied fake admin body, signed-proof transport, exact path/no query, oversized request 413, unsafe socket rejection, Core-down 503/no JSON fallback.
2. `platform-v2/test/gold-operator-notifications-two-sockets.test.mjs`: real Gold Core HTTP server over private Unix socket AND separate Operator-side HTTP server with the bridge; actual `GoldPgCoreAuthority.authenticate()` and actual `GoldPgNotificationRepository.inbox()`; fake PostgreSQL pool and fake Redis. Forged JSON account-session/query values cannot change PostgreSQL-projected account group, and PG/Redis/Core outages all deny requests without any fallback. This is **two live HTTP servers, not two independent worker processes**, and the database results remain mocks.
3. `deploy/scripts/selftest-gold-notification-pg-mode.mjs` updated to assert that canary startup fails closed outside Gold-independent mode and legacy notification routes remain awaited for non-Gold. Isolated Operator legacy smoke still validates default behavior.
4. The new tests are included in `npm run gold:core:test`; run full `node --test platform-v2/test/*.test.mjs`, source cutoff safety, hashes/isolation and isolated Operator/Plugin smoke before committing.

## Not accepted / next

This **closes one canonical notification authority split only in the explicit opt-in Gold canary**, not the entire Operator Account/Auth/Device or Plugin business state. The Account login/UI in the canonical Operator still uses legacy sessions; users need true Gold PostgreSQL account Bearer tokens for the new notification path. Full Account/Auth route and browser sign-in migration, issuance/verification of real owner-admin proofs, actual PostgreSQL17/Redis8 provisioning, SQL cross-process cold-restart persistence, actual Plugin integration and the 23-domain full cutover remain incomplete. Do NOT increment mandatory Gold cutover counts merely for source-mode mocks. Unaccepted TeamUsage, Inventory and Job021 stashes remain preserved. Production LXD is never altered here.

## 2026-10-17 additional Account Auth opt-in (newer contract)

A subsequent independent Gold-only flag, `LR_GOLD_ACCOUNT_AUTH_PG=1`, extends this bridge to `POST /v1/accounts/login`, `GET /v1/accounts/me` and `POST /v1/accounts/logout`. The account flag requires `LR_GOLD_NOTIFICATIONS_PG=1`; notifications-only mode remains backward-compatible when the account flag is absent. In **account mode only**, the existing Account Portal's `x-light-account-session` header is translated to a candidate Bearer value and verified solely against PostgreSQL by Gold Core; the legacy header is never forwarded under its original name and never trusted by JSON AccountRegistry. Legacy Account/Plugin/Admin account writers not migrated are refused HTTP 503 to avoid mixed-authority data. Successful Core Account JSON is adapted to canonical `ok/account/session/token` shape. All failure responses preserve denial and never use a JSON fallback.

See `docs/releases/GOLD_OPERATOR_ACCOUNT_AUTH_PG_BRIDGE_20261017.md` for complete scope, API shape, rejected paths and remaining UI/entitlement/verification limitations. This does NOT claim a full production-ready Gold login or real PostgreSQL/Redis E2E.
