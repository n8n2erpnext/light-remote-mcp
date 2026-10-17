# Gold Account Entitlements — read-only PostgreSQL Core projection (2026-10-17)

## Scope

New Gold-only `GoldPgAccountEntitlementAuthority` in `platform-v2/src/storage/gold-account-entitlement-authority.mjs`, mounted on the **private Gold Core Unix socket** as `GET /v1/accounts/entitlements`. The canonical Operator routes to it only when the existing independent `LR_GOLD_ACCOUNT_AUTH_PG=1` flag is on, via the same private Core bridge as login/me/logout. Existing production/default behavior and notifications-only canary are unchanged.

The identity comes from `GoldPgCoreAuthority.authenticate(Bearer)` (hash-verified active `lr_sessions` and `lr_accounts`) and never from query/body `accountId`. The entitlement query rechecks the account is **active and email-verified**, and selects a current, unrevoked `lr_entitlements` row for that exact actor. The SQL enforces `effective_at<=now()` and `valid_until IS NULL OR valid_until>now()`, with kind matching the owner account's claimed plan. Stale `lr_accounts.plan='pro'` or `'vip'` alone **never confers paid entitlement**.

## Core return contract

`{accountId,plan,paid,teamEligible,entitlement,policyAccepted:false}`

- `plan` is `free` when no valid matching ledger row, even if account's stored plan is Pro/VIP. Otherwise it matches the account's Pro/VIP plan.
- `teamEligible` is true only for currently active, verified Pro owner with `personal_pro` or `pro_team` entitlement. It is **false for trial and VIP**, conservatively pending complete Team/billing policy acceptance.
- `entitlement` describes the selected unrevoked ledger row `{entitlementId,kind,source,sourceRef,validFrom,validUntil}`; no Paddle secrets, billing customer IDs, or other account session information are exposed. A null `validUntil` means no ledger expiry, not permission to skip revocation checks.
- `policyAccepted:false` explicitly refuses to assert final paid Fleet limits, usage caps or Team seats before the *separate* owner-authorized TeamUsage/Plan/Job cutover. **Do not use this field to authorize job dispatch**.

## Tests and status

- `platform-v2/test/gold-account-entitlement-http.test.mjs`: verified principal and SQL actor scoping; Pro/team, trial/non-team, VIP, revoked/expired/mismatched ledger, disabled/unverified account, unavailable PostgreSQL; native HTTP routes reject absent Bearer, POST and forged account/plan query.
- `platform-v2/test/gold-account-entitlement-sockets.test.mjs`: two real HTTP servers, Gold Core via a private Unix socket plus canonical Operator bridge, with PostgreSQL/Redis **mocks**. Tests scope, Pro→Free downgrade, VIP, Redis/PG 503 without JSON fallback.
- No schema update; Gold locked `001..020` migrations. The live Gold PostgreSQL17/Redis8 setup, real billing ledger ingestion, canonical `/me` profile display, existing Account Portal UI and auth/signup, owner-signed Admin evidence, and TeamUsage integration remain unfinished and **not accepted**. A prior device policy blocked Gold provisioning: do not bypass. The full source gate is still `BLOCKED_SOURCE_CUTOVER 0/23`. Production `light-remote-direct` is untouched.
- An earlier **password-rotation** WIP on the same branch was quarantined in `GOLD-ACCOUNT-PASSWORD-ROTATION-WIP-20261017-test-edit-safety-blocked` when a test update was explicitly denied by safety checks. Do NOT restore it or rewrite around the denial.
