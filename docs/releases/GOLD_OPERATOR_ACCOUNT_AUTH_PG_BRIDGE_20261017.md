# Gold Operator Account/Auth PostgreSQL Core bridge (2026-10-17)

## Scope and operational mode

This change extends the **opt-in**, independent Gold Operator-to-Core private socket bridge to account login/session/logout. It does **not** switch or restart production. It depends on the accepted Gold PostgreSQL 17 schema 001–020 and Redis admission code, but real PostgreSQL/Redis services have **not** been provisioned or tested (the earlier device policy denied provisioning).

Enable only on an isolated Gold deployment with BOTH:

- `LIGHT_REMOTE_GOLD_INDEPENDENT=1` and a private `LIGHT_REMOTE_GOLD_ROOT`.
- `LR_GOLD_NOTIFICATIONS_PG=1` and `LR_GOLD_ACCOUNT_AUTH_PG=1`. Account Auth opt-in refuses startup if Notifications PG mode is not enabled.
- Verified Gold PostgreSQL/Redis configuration (existing `LR_GOLD_PG_URL_FILE`, `LR_GOLD_REDIS_URL_FILE`, `LR_GOLD_INSTANCE_ID`), and an already-running private Gold Core Unix socket via `LR_GOLD_CORE_SOCKET`.
- Gold Core runs **first**, then isolated Operator. Neither can silently use production sockets or endpoints; the socket must lie inside the independent root and have private ownership/perms per the existing check.

Legacy Operator mode remains unchanged with the flags off. Existing notifications-only Gold canary behaves as before: `LR_GOLD_ACCOUNT_AUTH_PG` defaults off.

## Canonical Account routes migrated in this opt-in mode

| Canonical Operator API | Gold Core authority | Compatibility adaptation |
|---|---|---|
| POST `/v1/accounts/login` | `GoldPgCoreAuthority.login` → `lr_accounts`/hashed `lr_sessions` | Returns `ok:true`, `account`, `token`, and `session:{sessionId,expiresAt}` for Account Portal cookie |
| GET `/v1/accounts/me` | `GoldPgCoreAuthority.authenticate` → unrevoked live `lr_sessions` joined to live account | Returns `ok:true`, `account`, `session`; `groupId` from relational account |
| POST `/v1/accounts/logout` | `GoldPgCoreAuthority.logout` → revoke `lr_sessions` row | Returns `ok:true,loggedOut`; replayed tokens no longer authenticate |
| Notification routes (five) | Pre-existing Gold Core PostgreSQL + trusted admin verifier | Same Gold auth principal and notification data authority |

The Account Portal sends `x-light-account-session` with its cookie. In this mode, the bridge maps its **opaque token bytes** to an Authorization Bearer *candidate*. This is **not** trusting the JSON credential: Gold Core performs the sole authoritative hash lookup in `lr_sessions` with `lr_accounts.status='active'`. Existing JSON-only tokens cannot pass that lookup. Explicit Authorization Bearer takes priority.

Successful Gold Core response structures are converted to the canonical Operator Account Portal shape for login/me/logout only. Error responses, including HTTP 401 and PostgreSQL/Redis 503, retain their original status/body/content type. Malformed or incomplete Core success envelopes are rejected with `gold_account_core_contract_invalid` 503; never fabricated as a successful login.

## What is deliberately denied, not silently delegated to JSON

Under `LR_GOLD_ACCOUNT_AUTH_PG=1`:

- Other `/v1/accounts/*` routes such as registration, password change/setup/reset and Team membership **return 503 `gold_account_route_not_migrated`**. Registration cannot reuse legacy `ownerProofVerified:true` because Gold requires a distinct trusted verified-email challenge. Gold's secure registration Core API exists but the canonical verification flow is NOT integrated.
- Legacy `/v1/plugin/accounts/*`, `/v1/plugin/auth/*`, `/v1/plugin/team/*`, and admin account, pending registration, group, overview, license, upgrade and dormancy registry endpoints are also blocked before their legacy handlers, so the opt-in Gold Account mode cannot generate divergent JSON Account identity or claims.
- Existing JSON AccountRegistry may still be initialized by the wider Operator for **other unported operations**. This is not yet a full canonical Operator/Plugin state cutover; additional routes and dependencies need removal or fail-closed gating before complete acceptance.
- The optional notifications-only canary (Account flag off) and production defaults preserve their existing behaviors.

No real owner-provisioned `verifyNotificationAdmin` proof issuer was added here; a client-provided admin header remains untrusted and must be cryptographically verified by Gold Core. No static bypass or hardcoded admin was introduced.

## Source tests and remaining acceptance

`platform-v2/test/gold-operator-account-auth-two-sockets.test.mjs` creates actual Gold Core and Operator HTTP servers with a private Gold Core Unix socket, real `GoldPgCoreAuthority` and fake PostgreSQL and Redis. It tests creating a verified account, wrong-password denial, canonical login response, cookie-header PG token verification, raw legacy JSON token denial, `groupId` projection, logout and replay revocation, unported registration/password denial, and PostgreSQL/Redis failures without old registry fallback. A contract test checks explicitly blocked Plugin/Admin JSON authority routes and nonblocked Gold notifications.

`deploy/scripts/selftest-gold-notification-pg-mode.mjs` verifies Gold auth opt-in requires unified notifications and cannot start unconfigured; baseline isolated Operator smoke confirms the default mode remains as before. The source-level two-socket tests use real HTTP transport but **mock database data**, not a live PostgreSQL 17/Redis 8 instance, separate deployed processes or actual browser UI session.

**Known incompatibility requiring further work:** Gold `/me` does not yet project the full canonical `entitlements`/billing profile. Paid plan eligibility must be verified against real Gold PG entitlements, never inferred from `plan` alone. Browser pages requiring those fields, registration, password, OAuth Google/Plugin and the Admin account UI are **NOT ACCEPTED** in this slice. No 23-domain gate credit yet; cutover remains `BLOCKED_SOURCE_CUTOVER 0/23`.

Production `light-remote-direct` is untouched. Previous denied Gold 021 job-worker, TeamUsage and Inventory changes are kept in separate Git stashes and must not be reapplied via alternate tools.

## 2026-10-17 additive live-entitlement read API

The opt-in Gold Account Bridge now also forwards **`GET /v1/accounts/entitlements`** to Gold Core. Core uses the actor verified against `lr_sessions` and a current matching unrevoked `lr_entitlements` row before reporting paid/Pro/VIP/teamEligible. It returns Free when no matching ledger entitlement exists even if `lr_accounts.plan` says Pro. The bridge strips caller `accountId`/`plan` query strings, does not forward legacy identity headers as trusted authority and never falls back to JSON.

This does **not** add entitlements to the existing canonical `/v1/accounts/me` shape or finish Account Portal/TeamUsage UI. Complete contract and regression tests: `docs/releases/GOLD_ACCOUNT_ENTITLEMENTS_PG_20261017.md`. The signed password-reset/rotation, verified email signup and payment/usage cutover are still outstanding. A partial attempted password-rotation edit was safety-denied, quarantined in a stash, and must not be restored by an alternate path.
