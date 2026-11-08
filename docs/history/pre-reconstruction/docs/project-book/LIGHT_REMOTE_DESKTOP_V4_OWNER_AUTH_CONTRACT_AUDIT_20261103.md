# Desktop V4 Owner Authentication and Local Wall API Contract Audit
Date: 2026-11-03. T02 = read-only SOURCE AUDIT COMPLETE. No production endpoint or auth code modified.

## Verified account and OAuth routes

| Consumer and route | Method | Authority and real backing | Desktop use |
|---|---|---|---|
| Account Portal /account/api?action=login | POST | email/password through /v1/accounts/login; Portal sets __Host-light_remote_account cookie HttpOnly Secure SameSite=Strict | Existing browser sign-in ONLY. DO NOT send password from Tauri webview |
| Account Portal /account/api?action=me | GET | Owner Portal cookie, /v1/accounts/me | Owner account projection AFTER dedicated Desktop SSO; unverified otherwise |
| Account Portal /account/api?action=devices | GET | Owner Portal cookie, /v1/accounts/devices | Owner-scoped enrolled device inventory after auth |
| Account Portal /account/api?action=usage&months=N | GET | Owner Portal cookie; upstream /v1/accounts/usage; months clamped 1..24 | Device/month usage after Owner auth |
| Account Portal /account/api?action=logout | POST | Portal cookie, upstream /v1/accounts/logout then clear cookie | Browser session logout; NOT automatically Desktop vault revocation |
| Account Portal /account/api?action=notifications | GET | Owner Portal cookie, /v1/accounts/notifications | Owner notifications; no synthetic unread count |
| Account Portal /account/api?action=sessions-list | varies per account-session proxy | dedicated owner-scoped session rename/list proxy gated by env | MUST verify enable flag and exact response before UI bind |
| Operator /v1/accounts/login, /logout, /me, /devices, /usage | server internal routes | Account service verifies session via x-light-account-session | Not public native Desktop REST contract |

### OAuth is currently MCP-only

plugin-server/oauth.mjs defines /oauth/authorize, /oauth/register, /oauth/token and /userinfo, PKCE S256, single-use Redis code exchange, rotating refresh tokens. It rejects resource other than MCP_RESOURCE and token uses have scoped audience; authorization HTML explicitly says Authorize ChatGPT. Scopes include remote:read/write/execute/terminal and offline_access. Reusing this token in Desktop would create incorrect audience and privilege confusion. Do NOT change MCP_RESOURCE validation to let Desktop in.

Observed OAuth constants: authorization code TTL 120s, access TTL 3600s, refresh TTL 30 days, Redis replay checks for code and refresh. These are baseline mechanics, not Desktop token policy.

## Verified Device Local Wall APIs

- device-agent/local-wall.mjs: /api/status GET Owner cookie required with 401 wall_auth_required when not logged in.
- /api/abv2/pending GET requires locally authenticated email-shaped Owner Wall identity and verified signed feed; absence returns unavailable / not-found.
- /api/abv2/approve POST requires Wall Owner identity, CSRF/Origin and exact requestId/expectedAttempt/B4+4/one-time owner consent. Separate from ordinary account login.
- /api/enrollment/begin and /api/enrollment/poll POST require local mutation CSRF and installed Agent callbacks; missing callback 501, NOT permission to fake link.
- /api/session-close POST, /api/jobs/cancel POST, /api/activity GET, /api/processes GET and /api/gold/modules/... are real routes. Exact purpose and callback enable flags need per-task feature verification; reading a route name alone does not authorize Desktop mutation.
- /api/policy-status GET, /api/filesystem-volumes GET, /api/filesystem-roots POST and /api/permissions/owner-approve POST have different Owner/capability gates; do not merge into a single broad native token.
- Local Wall /auth/login and /auth/logout own a distinct local cookie/session. Account Portal cookie on public domain is not shared with localhost:5491.
- Existing desktop Tauri probe_local_wall can only identify Owner-required vs anonymous unverified Wall; network reachability must never unlock workspace.

## Proposed missing Desktop-specific contracts (NOT YET IMPLEMENTED)

1. Dedicated desktop:login OAuth resource/audience, client registration policy and Auth Code + PKCE S256. Prefer using existing Account Portal browser session to issue Desktop authorization consent after verifying state/nonce/device/account, rather than asking password inside native app.
2. Deep-link or loopback ephemeral callback strictly bound to process-local nonce/PKCE verifier and exact callback target. Reject state mismatch, replay, stale code, wrong account, wrong device, cross-client redirect and account logout; one-time code.
3. Token/refresh scope for Desktop read-only Owner view vs mutation rights must be explicit. Native secure OS vault only. Tauri webview gets sanitized Owner profile status projection; never raw token/refresh/Account cookie.
4. Desktop -> Wall one-time signed SSO exchange: exact owner accountId + enrolled deviceId + short expiry + one-time nonce + local listener binding. Wall issues its own session after server verification; App Logout invalidates dependent Wall grant. No email-only Owner identity match without server accountId proof.
5. Contract negative tests: forged callback, wrong account, revoked login, rotated refresh reuse, wrong device, expired code, cross-origin CSRF, localhost port spoof, duplicate nonce, missing Agent, active vs closed Agent lane, no Owner consent. All must fail closed.
6. Pending feature gates: Windows / macOS / Linux vault implementations, callback registration, Account Portal/Operator owner session changes, Wall verified SSO route, migration/revocation metadata. DO NOT claim these are deployed.

## Task completion evidence / next

- Source inspection: plugin-server/account-portal.mjs (actions and cookie), plugin-server/oauth.mjs (resource + replay/audience), device-agent/local-wall.mjs (Owner gates and B mutation), client/desktop-v4/src/lib/status.ts and src-tauri/src/main.rs (untrusted probe).
- Static route census: 97 distinct exact Wall API/auth paths enumerated from current source; Account Portal actions include me/devices/usage/login/logout/notifications and owner-only mutations.
- Tests: read-only source audit; no token issued, no CSRF weakening, no runtime production calls, no CI claims for native auth.
- T02 outcome: API security contract understood; additional purpose-specific Desktop auth and Wall SSO endpoints required. T03 coding must begin behind explicit default-OFF flags and tests, after precise token schema review.

## Candidate T03a pure request validator (not endpoint)
- plugin-server/desktop-auth-v4-contract.mjs: independent desktop audience urn:light-remote:desktop-owner:v4, clientId light-remote-desktop-v4, fixed desktop:read scope, PKCE S256 and fixed loopback callback validation.
- Source rejects forged Owner/Agent authority, guessed localhost/remote redirects, weak state and MCP_RESOURCE purpose confusion. Code TTL intent 90 seconds.
- Node native offline unit tests 5/5 PASS before commit; wired as GitHub CI step. No new OAuth route, no token issuance, no Owner session, no bypass. Exact CI run PENDING.
