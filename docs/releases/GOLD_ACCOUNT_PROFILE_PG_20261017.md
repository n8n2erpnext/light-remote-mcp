# Gold Account Portal profile from PostgreSQL entitlements

2026-10-17 — Gold independent branch, source-level acceptance only.

## Problem and authoritative boundary

In the earlier `LR_GOLD_ACCOUNT_AUTH_PG=1` Gold Operator canary, canonical `GET /v1/accounts/me` returned the authenticated account's raw `lr_accounts.plan`. A separate `GET /v1/accounts/entitlements` checked the actual `lr_entitlements` ledger, but the Account Portal consumed `/me`, so it could display a stale Pro/VIP label after a ledger revocation or expiry.

The accepted correction does not write JSON or trust a client-provided `plan` / `accountId`. With `LR_GOLD_ACCOUNT_AUTH_PG=1` (which already requires `LR_GOLD_NOTIFICATIONS_PG=1` and isolated Core/PG/Redis), the canonical Operator's private socket bridge translates **only** `GET /v1/accounts/me` to private Gold Core `GET /v1/accounts/profile`. Gold Core projects the verified session and current entitlement together, adapting the result back to the canonical Portal's `{ok:true,account,session}` response.

The original public/default Operator routes, and existing notifications-only Gold canary with Account mode off, are unchanged. Direct Core `/v1/accounts/me` is retained for compatibility and has no new hidden paid entitlement claims; the new `/v1/accounts/profile` explicitly supplies the verified profile.

## Verified profile structure

`account` includes `accountId`, `email`, `groupId`, `status:'active'`,  `emailVerified`, `authProviders`, `createdAt`, `lastLoginAt`, effective `plan`, `entitlement`, `paid`, `teamEligible` and `policyAccepted:false`.

`session` includes `sessionId` and `expiresAt` from the **same verified Gold PostgreSQL bearer**. Account ID/email/group are derived from `GoldPgCoreAuthority.authenticate`; entitlement and status are checked with an independent parameterized `lr_accounts` + `lr_entitlements` PostgreSQL query scoped to the exact actor. Paid display plan is downgraded to `free` and an explicit non-authorizing `{plan:'free',kind:null,source:'none',...}` entitlement when no eligible ledger row is found. Pro Team eligibility requires a currently effective personal_pro or pro_team entitlement, never a mere plan string. No body/query overrides are forwarded by the Operator bridge.

The account profile does **not** claim policy-accepted paid feature caps, ability to dispatch worker jobs, paid invoices, future entitlement validity, Team seating limits, licenses, or billing sync. These remain separate incomplete Gold cutover domains. `groupName` is not fabricated from a legacy JSON group registry; it remains unspecified until its own PostgreSQL group metadata authority is available.

## Source-level regression and limitations

- `platform-v2/test/gold-account-entitlement-http.test.mjs` tests verified profile through the real Core HTTP router, one Gold account authentication call, effective Pro and expired/revoked ledger downgrade, and session/group preservation.
- `platform-v2/test/gold-account-profile-sockets.test.mjs` starts an actual isolated Gold Core private Unix-socket server plus Operator HTTP bridge. It proves canonical `/me` carries the effective Pro entitlement (not merely raw `a.plan`), drops to Free when the ledger becomes invalid, denies a fake legacy Account session, ignores identity/plan query spoofing, refuses PostgreSQL/Redis failure and never executes a JSON fallback. The PostgreSQL/Redis providers in the test are **fakes**, and the two HTTP servers share a single test process.
- `deploy/scripts/selftest-gold-notification-pg-mode.mjs` statically asserts the Gold-only Executor enables `accountProfileRoutes` exclusively with `goldAccountAuthMode`; the earlier Account Auth/Notification tests remain the backward-compatibility guard.

**Not an independent live PG17/Redis8 or browser E2E acceptance.** Registration email proof issuance, password rotation (unaccepted safety-denied stash), Google/magic/password reset, Team/Usage, Device/Job/Fleet, Admin signed proof, and canonical Plugin/Operator full business writer migration are not complete. Global mandatory 23-domain cutover remains `BLOCKED_SOURCE_CUTOVER 0/23`. The old production LXD service has not been modified.

Earlier policy-denied target provisioning and source edits remain off-limits; do not route around those denials.

## Acceptance caveats

The `paid` field is inherited from the earlier Gold entitlement read authority and currently means **an effective ledger entitlement exists**, including a possible trial. It is **not evidence of a captured Paddle payment**, and must not be used for invoice status or paid feature authorization. The `authProviders` profile list is preliminary, projected from Gold account login-provider flags; checking actual password hash presence and full Google sign-in lifecycle needs separate UI acceptance. Both are controlled by `policyAccepted:false`.

The optional trial/payment-label and Google-only provider refinements were temporarily drafted but reverted to the earlier 114/114 Core and 156/156 platform-v2 test-green implementation after a later comprehensive test execution was rejected by tool safety checks. No unverified refinements are included in this accepted source slice.
