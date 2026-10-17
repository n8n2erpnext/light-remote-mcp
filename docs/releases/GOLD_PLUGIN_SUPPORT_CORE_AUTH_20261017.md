# Gold Plugin Support: PostgreSQL-verifiable Account identity

Date: 2026-10-17. Branch: `feature/production-gold-pg-redis-20261017`.

## Closed authority gap

The isolated Plugin already offered a PostgreSQL-backed `GoldPgSupportOutbox` via `LR_GOLD_SUPPORT_OUTBOX_PG=1`. However, the canonical `/support/api` still obtained its caller identity from `GET /v1/accounts/me` on the **legacy Operator**, so its `plan` could originate from a stale JSON AccountRegistry. PostgreSQL outbox storage alone does not establish PostgreSQL authorization.

In explicit **Gold Support PG mode only**, `plugin-server/server.mjs` now injects `createGoldSupportAccountResolver` into `registerSupportBackoffice`. It requires the same independently scoped `LR_GOLD_CORE_SOCKET` used by the Gold Account bridge, checked by `notificationCoreSocket`: the real Unix socket must be under the Gold root and must have private parent and socket permissions. Startup fails closed when this Gold identity resolver or private Gold Core socket is not configured. The Plugin never retrieves caller account identity from JSON Operator in that opt-in mode.

The signed-in browser's existing `__Host-light_remote_account` cookie supplies only an **opaque token candidate**. The Plugin sends it to the Gold Core private Unix socket as `Authorization: Bearer` for `GET /v1/accounts/profile`. Gold Core is the single authority for live `lr_sessions`, active/verified `lr_accounts`, and current unrevoked `lr_entitlements`. The Plugin does not trust the cookie's content as an Account ID or raw plan. If Core rejects the bearer, the Plugin treats the visitor as signed out; if Core becomes unavailable or returns an invalid response, it returns HTTP 503 without falling back to AccountRegistry JSON.

### Effective Pro/VIP support eligibility

A current, email-verified active account with a live matching entitlement qualifies for the **displayed Gold Support eligibility** only when:
- `plan=pro` with `entitlement.kind=personal_pro` or `pro_team`; or
- `plan=vip` with `entitlement.kind=vip`.

An expired/revoked Pro entitlement projecting Free, a Trial entitlement, forged JSON cookie, missing session or mismatched kind never establishes paid support eligibility. An existing support event status lookup is scoped to `Gold Core-verified accountId`, so one account cannot read another account's outbox row.

**Crucial non-delivery boundary:** Gold UAT `GoldPgSupportOutbox({deliveryEnabled:false})` is still enforced, and `/support/api` POST still returns `503 support_delivery_not_ready` after successful authentication/eligibility. No ERPNext ticket was submitted, no delivery queue made active, and the existing `gold_support_real_erp_delivery_not_authorized` startup refusal remains. Actual Support Queue / ERPNext delivery and verified billing authority remain **unaccepted**, not silently enabled by an eligibility result. The rest of production/default SupportOutbox and its legacy Account identity path is unchanged when Gold Support flag is off.

## Tested source contracts

- `platform-v2/test/gold-plugin-support-identity.test.mjs`: real Plugin Express HTTP routes with a native private Unix Gold Core socket test fixture. Verifies Pro, Team Pro, VIP versus Trial/revoked/FREE; account-scoped status, forged legacy account-cookie denial, missing/failed Core 503, no enqueue with delivery off, private socket boundary and mandatory resolver setup. Includes four tests. This uses a Core **stub**, not a real PostgreSQL service or deployed two-process system.
- Existing Gold Core `/profile` authority/test suites already validate the PostgreSQL account and entitlement predicate, including expiry and revocation under fake PG responses. Together, the two layers enforce one principal boundary at source level; however, a true cross-process transaction/cold-restart integration test against PostgreSQL 17/Redis 8 is NOT performed.
- `deploy/scripts/selftest-gold-plugin-support-pg-mode.mjs` enforces the explicit injection and continued disabled ERPNext delivery; existing Gold safety/test and production-default smokes must pass before acceptance.

## Deployment prerequisites and remaining work

The independent Gold Plugin must have `LIGHT_REMOTE_GOLD_INDEPENDENT=1`, a private `LIGHT_REMOTE_GOLD_ROOT`, a configured pre-running Gold Core socket `LR_GOLD_CORE_SOCKET`, and owner-provisioned PostgreSQL/Redis Gold credentials. The Core must run before Plugin. Gold Account/Auth cookies must themselves be generated from the same PostgreSQL Core; legacy Account users receive no privileged Support eligibility in Gold mode. Do not substitute production sockets, static allowlists or caller-plan flags.

**Source cutover is still `BLOCKED_SOURCE_CUTOVER 0/23`**. The previous owner-target PG17/Redis8 provisioning request was denied by capability policy; do not bypass it. Production LXD is untouched. Existing four WIP stashes (password, TeamUsage, Inventory, Job021) remain separate and unaccepted.

## Fail-closed initialization (additional tested guard)

`registerSupportBackoffice` refuses Gold mode when either the trusted Core resolver **or the injected PostgreSQL outbox** is missing, before constructing a default `SupportOutbox` that could read a legacy JSON snapshot. It also rejects `deliveryEnabled:true` even if supplied through programmatic injection. The Gold Plugin entrypoint explicitly constructs the PostgreSQL outbox with delivery disabled, passes the Core resolver and refuses actual ERPNext sending. Tests cover all three denial conditions; they do not enable an alternate dispatch path.
