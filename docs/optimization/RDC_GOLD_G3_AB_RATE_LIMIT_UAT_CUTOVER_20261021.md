# G3 Gold — A/B lookup isolated from observer 429, UAT cutover acceptance (2026-10-21)

## Owner intent and root cause

Owner paired Gold plugin directly into `light-remote-gold-uat` via new A/B one-time code; official Gold helper returned `ready` before work. The request: test Gold Redis rate limiter because Local Wall B approval is directly affected; production MUST stay untouched.

Gold `ac97414111bb77f0e18c9ef1eb22fc6d7fedd554` had two separate signed Redis device lanes:
- `status` and `activity`: observer (default 240/min/device)
- `pairing-code`, `access-approve`, `access-deny`: control (default 120/min/device)

The actual **Gold Redis** test used an ephemeral synthetic device key and `limits={observer:1,control:2}`: after observer returned **429**, control pairing and approval still consumed their own quota and succeeded; the third control request returned 429; generated keys were deleted. No actual A/B code/authorization was created by the test.

**Previously hidden dependency:** `device-agent/local-wall.mjs::resolveCode` always looked up B through `status({fresh:true})`; when the observer lane returned 429, lookup could incorrectly treat a new B as `approval_code_not_found` (HTTP 404). Separate Redis counter lanes alone did NOT protect this approval lookup.

## Source correction and security properties

Commit `84fb09be3460ed3e46681c3322460a57457e2c83`, pushed branch `feature/light-remote-gold-rebuild-20261018`.

- New signed `/v1/device-channel/access-lookup` inside Operator, calling existing `verifiedChannelContext`, `requireDeviceConnection`, and only `accessGrants.pendingForDevice` for the authenticated device.
- Plugin signed `CHANNEL` allow-list updated. Redis limiter explicitly classifies `access-lookup` as `control`; quotas NOT raised and other lanes NOT disabled.
- Both Gold Agent daemon and wall-only implementations make the new signed `access-lookup` request. Local Wall `resolveCode` uses it instead of observer status. A legacy fallback still calls status but now propagates 429/503, not a fictitious 404.
- Wall authentication, approval CSRF, Ed25519 signature, device binding and approval decisions unchanged. No Cloudflare, WAF or third-party Worker added.
- Gold CI includes `deploy/scripts/selftest-g3-ab-control-lane-lookup.mjs`, which validates observer=429 while B GET+POST succeed, and control=429 yields 429 not 404. All other Gold Redis/Wall and strict/source regressions passed.

## Actual isolated Gold LXD promotion

- Prior installed Gold candidate: `ac974141...`.
- Immutable new candidate: `/opt/light-remote-gold-uat-candidates/84fb09be3460ed3e46681c3322460a57457e2c83`, exact package-lock parity and sources checked by stage script.
- Verified new backup under `/var/backups/light-remote-gold-uat/pre-g3-84fb09be3460ed3e46681c3322460a57457e2c83`: source code, previous systemd overrides, local state and PostgreSQL dump with checksums. Rollback target is prior `ac97414`.
- Closed only **our own** Gold plugin test session; cutover preflight observed **2/2 ExecutorReady, active=0, queued=0, inFlight=0, strict OFF**.
- Ran existing Gold-only transactional `gold-g3-uat-cutover.sh` with explicit opt-in. It reported `G3_GOLD_CUTOVER_NO_ACTIVE_JOBS=PASS`, previous override snapshot PASS, source cutover PASS, **10 stable health samples PASS**; strict remains OFF. Neither production nor Cloudflare, Traefik and Nginx were restarted.
- After cutover, official Gold helper reconnected ready to the LXD, validating an authorized plugin session on the new Operator. Installed candidate ran A/B + Redis Wall regression **3 + 7 markers PASS**, JS syntax PASS.
- **Live protected route negative test:** `POST http://10.192.135.61:5583/device-channel/access-lookup` without enrollment/signature returned **HTTP 403**; no unauthorized pending access list. (First smoke used loopback `127.0.0.1:5583` and got `ECONNREFUSED`, because Plugin actually binds the Gold LXD address `10.192.135.61`; corrected test passed.) Do not call the negative test a successful signed owner lookup.
- Final Gold state: PostgreSQL, Redis, Operator, Plugin, Wall **5/5 active**, 2/2 fresh and ready, queued/inFlight=0, strict OFF. One active Gold session at final snapshot is **our current authenticated test session**; do not restart while it is in use. Gold public HTTPS 200 and production HTTPS 200.

## Acceptance boundaries / next work

**PASS:** Redis true physical quota lane isolation with temporary keys and cleanup; positive B GET+POST under simulated 429 in loopback Wall fixture; control 429→429; Git commit+push; Gold UAT cutover; installed regression, proper unsigned request denial, overall Gold service health.

**PENDING:** New real owner-entered A and B after this cutover to prove the entire signed live `access-lookup` → Local Wall B lookup → explicit approval end-to-end. Don't reuse the earlier consumed codes. No owner needs to create another code merely to satisfy a fixture if they don't want to.

Strict admission remains OFF. G3 stays IN PROGRESS for physical sustained soak/performance and controlled Gold strict activation; G4 not started. Production `wall.dashboard.thaiduy.store` is still on older production core and is out of scope for this change.

Inherited untracked Gold test artifacts must not be staged or overwritten. Gold-only snapshot + previous immutable candidate preserved.
