# Light Remote Gold G3 — Local Wall A/B approval independent of observer 429 (2026-10-21)

## Owner requirement and verified source problem

Scope: isolated `light-remote-gold-uat` and `feature/light-remote-gold-rebuild-20261018` only. Production is explicitly out of scope. Owner performed a real official Gold A/B connection and granted approval; the Gold plugin helper returned **ready** on `light-remote-gold-uat`. Do not disclose actual one-time A/B codes or signing material here.

The earlier Gold Redis limiter `ac97414111bb77f0e18c9ef1eb22fc6d7fedd554` enforced independent lanes after successful signed device proof: `status/activity=observer`, while `pairing-code/access-approve/access-deny=control`. On **actual Gold LXD Redis**, used an ephemeral synthetic device key, forced observer quota 429 while control pair creation/approval calls remained allowed, verified eventual control 429 and removed both test keys. These results prove the independent Redis budgets, **not** a live synthetic enrollment approval.

However, Gold Local Wall `resolveCode()` fetched `status({fresh:true})` for `access.pending` before accepting a B code. When observer 429s, this lookup could return an empty/stale list and misreport **approval_code_not_found** even while signed control quota remained available. A successful existing real pairing does not eliminate this edge case.

## Smallest Gold-only source fix

- Add signed `POST /v1/device-channel/access-lookup` at Operator using existing `verifiedChannelContext(body,'access-lookup')` Ed25519 identity check, `requireDeviceConnection` and `accessGrants.pendingForDevice`, returning only the authenticated device's pending requests. No unauthenticated or cross-device listing.
- Classify `access-lookup` in **control lane**, and allow signed channel routing in Plugin `CHANNEL` set. This does **not** raise or disable control or observer quotas.
- Agent uses existing signed `channelRequest` helper for `access-lookup`. Both daemon and wall-only instances supply `getPendingAccess` to Local Wall.
- Local Wall `resolveCode` uses that separate signed lookup when available; legacy fallback still reads fresh status but **propagates 429/503** rather than silently saying code absent. Existing authentication and CSRF for owner approval are unchanged. The POST decision still uses independently verified `access-approve` or `access-deny` with binding checks.
- Gold CI runs `deploy/scripts/selftest-g3-ab-control-lane-lookup.mjs`. The fixture uses in-memory synthetic Redis quotas and a loopback Local Wall (no production connection), asserts `observer=429` does not block GET B lookup and POST B approval, and asserts control=429 returns 429, **never 404**. No actual pairing code or real approval is created by the fixture.

## Evidence to date

- Official Gold A/B request entered by owner and helper returned ready.
- Real isolated Gold Redis synthetic quota separation **PASS** and cleanup; runtime original Gold candidate `ac97414`.
- Source test: `G3_AB_ACCESS_LOOKUP_CONTROL_LANE_ISOLATED_FROM_STATUS_429`, `G3_AB_B_CODE_LOOKUP_APPROVE_WITH_OBSERVER_429`, `G3_AB_CONTROL_429_NOT_REPORTED_AS_INVALID_CODE` **3/3 PASS**.
- Other Gold Redis/Wall status regression markers, G3 strict admissions fixtures, read-only readiness evidence, JS syntax, YAML and `git diff --check` PASS.
- IMPORTANT: these source/fixture tests are **not** evidence that new `access-lookup` was used end-to-end through a live Gold LXD Operator yet. Only mark live acceptance after immutable Gold-only promotion, healthy services, actual signed access lookup and new local Wall path.

## Deployment / rollback safety

1. Git commit/push exact branch; do not stage four inherited unrelated untracked UAT files.
2. Verify zero Gold active sessions/jobs, complete source parity, backup current Gold code+PostgreSQL+state+systemd, immutable new candidate, 10 stable service health samples and rollback to prior `ac97414` if failure.
3. Gold-only local Wall and Plugin route smoke, end-to-end signed A/B when owner requests a new pairing; **never reuse** the consumed A/B codes.
4. Production `wall.dashboard.thaiduy.store` remains old core and should not be claimed fixed. Cloudflare Proxy/Workers not used. Existing R2 release distribution retained.
5. G3 IN PROGRESS: physical sustained soak + Gold-only strict admission remain separate gates, strict stays OFF.
