# LIGHT REMOTE DESKTOP V4 - API INTEGRATION MASTER HANDOFF

Date: 2026-11-03 (Asia/Ho_Chi_Minh). Status: ACTIVE; update after every task.
Branch: feat/desktop-v4-api-integration-20261103
VPS-ARM worktree: /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101
Base source: 54c69365b592b5da1ffd51783992defe680a2454
Remote on VPS-ARM: git@github.com:n8n2erpnext/light-remote-mcp.git

## 1. Owner decisions and strict workflow
1. GitHub SSH credentials and definitive source worktree are on VPS-ARM. Reach it through authorized SSH (host VPS-ARM, user ubuntu). Git commits and pushes MUST run on VPS-ARM. Windows / Light Remote Gold is only for inspecting the Figma UI, running Desktop binary and, if needed, relaying SSH commands to ARM. The Windows scratch clone is NOT canonical and has no commit/push.
2. Write this handoff BEFORE wiring any API. Update this exact document, .light-remote/CURRENT_CHECKPOINT.json, docs/project-book/LIGHT_REMOTE_WORKLOG.md and docs/project-book/LIGHT_REMOTE_CODE_MAP.md after each completed task, including source SHA, CI and runtime proof; never claim unverified work as finished.
3. Use GitHub Actions for native Windows/macOS/Linux builds and Chromium, NOT VPS-ARM npm/cargo native build (ARM disk observed 121 GiB / 17 GiB free, 87% used). Keep same feature branch and source evidence.
4. Frozen V4: existing nine screens, React+Tauri 2, Light/Dark, Google Sans from repository, Figma Google Sans Flex. No redesign. Owner reported Light/Dark/Auto three-button picker clashes with titlebar in non-maximized Windows; replace ONLY with a single Light/Dark icon toggle. Do not build solely for this cosmetics change.
5. Login-first is mandatory before all internal app routes. Keep account, device linking, session/Agent A/B authorization distinct. The UI-only Explore UI (design preview) MUST NOT count as real Login/Owner proof or be enabled in release builds.
6. Work on isolated branch. Do not modify installed Windows Agent, Gold UAT or production, do not bypass owner auth, do not migrate databases. Fail-closed until real signed authentication / callback / native vault is verified.

## 2. Accepted design/build evidence (frozen)
- Nine V4 screens: Overview, AI Access, Sessions, Live Monitor, Devices, Long Memory, Codex Bridge, Account, Settings; owner approved at code baseline 73d448e9.
- Separate Login-first source in AuthEntry.tsx and auth-entry.css (React): all routes gated before sidebar. UI-only build flag VITE_LR_V4_UI_TEST=1 permits in-memory labelled Explore UI preview.
- Login Figma Light/Dark plus states on new node IDs 63:76, 63:105, 63:244, 63:278, 63:312, 63:346. Google Sans Flex editable text from Moryqa; STOCK logo 34:4. Original frame manifest unchanged.
- Figma file key wfvLVoNvzVzyNHq51U0DPB. Desktop Google Sans Variable font already in repository; do not change font families of old screens.
- Login UI source accepted at 4878db759613d1c0d446e1ec5e5ba415a3301100. Source documentation head 54c69365b592b5da1ffd51783992defe680a2454.
- GitHub Actions run https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41569151264 passed Web/Chromium 30/30 and native Windows/macOS/Linux 4/4. This is UI build acceptance, NOT real Owner Login, App-Wall SSO, signed data, installed E2E.
- User screenshot 2026-11-03: titlebar-edge collision of the multi-button appearance switch in restored/non-maximized Window. Fix via one icon and carry into next integration CI.

## 3. Source boundaries verified before this handoff
- client/desktop-v4/src/App.tsx currently gates workspace until inDesignPreview; no production Owner login implementation. Direct URL hash alone cannot bypass gate.
- client/desktop-v4/src/lib/status.ts reads GET /api/status strictly same-origin; Tauri native webview is not a valid Owner Wall origin. No session list or plan can be assumed.
- client/desktop-v4/src/lib/local-logs.ts reads GET /api/activity/logs/state same-origin; no authority -> unavailable, no fake log totals.
- client/desktop-v4/src-tauri/src/main.rs allows fixed open_local_wall literal localhost:5491 and bounded anonymous probe_local_wall. Neither grants Owner authority. Default browser Launcher does not authenticate by itself.
- device-agent/local-wall.mjs requires Owner auth for /api/status and privileged APIs; unauthenticated request returns 401. Local Wall browser session cookie is separate from Account Portal cookie origin.
- plugin-server/account-portal.mjs provides web login and cookie __Host-light_remote_account (HttpOnly / Secure / SameSite=Strict); this cannot be copied into 127.0.0.1 Local Wall or assumed native credential. Existing OAuth/PKCE is purpose-specific, do not repurpose MCP tokens into Desktop without review.
- A/B V2 request Short ID 6+rotating5, 5-minute pending, B 4+4 and independent Owner consent, individual max-24h Agent grant. Owner login NEVER auto-approves A/B or resurrects closed grants.
- Device Local Wall Activity Logs and rotation/clean backend were tested in isolated GoldABV2 Lab but NOT validated on installed Windows/macOS/Linux. Long Memory and working logs are different storage domains.

## 4. Security architecture to implement
A. Native Login: system browser owner sign-in via purpose-scoped PKCE authorization-code and exact signed one-time callback. Verify state, nonce, audience, owner and device at server. Persist only in secure OS credential vault (Windows Credential Manager/DPAPI, macOS Keychain, supported Linux secret store), never JS storage. Provide revocation, renewal, logout, and fail-closed authenticated UI projection.
B. App-to-Wall one-way SSO: a verified owner/device native session may initiate bound short-lived one-use server-verified exchange; Wall issues ITS OWN HttpOnly cookie on localhost same-origin route. Do not copy Account cookie, use port-open as identity, or allow Wall login to unlock native app. App logout revokes dependent Wall SSO per server contract.
C. Data panels must use typed, owner-scoped, signed authoritative projections. Without valid provenance show unavailable rather than synthetic names/leases/quotas/jobs. Use bounded polling, bounded event memory and error states.
D. Native mutations require purpose-specific Owner verification, CSRF, replay checks and explicit confirmation: A/B approval, session close, link/relink, job kill, memory delete, Codex approve, log Clean. Never wire UI button straight to guessed route.
E. OS App Lock applies only after verified account session; unlock cannot override server revocation.

## 5. Task board (update after each completed task)
| Task | Scope / gate | Status |
|---|---|---|
| T00 | Write master handoff + checkpoint, verify canonical ARM SSH Git and baseline | DONE |
| T01 | Login theme collision: owner superseded single-icon approach; remove Login toggle entirely (Settings retains Appearance) | SOURCE + CI 4/4 PASS, physical acceptance OPEN |
| T02 | Inventory exact Account Portal / Operator OAuth / Local Wall signed API contracts and auth security | SOURCE AUDIT COMPLETE |
| T02b | GoldABV2 Lab Wall target / custom ChatGPT MCP separation | SOURCE + CI 4/4 PASS, installed E2E OPEN |
| T03 | Native Owner login PKCE + callback + secure OS vault + logout/refresh | IN PROGRESS: T03a validator/test only; no live auth |
| T03b | Account Portal Owner browser consent + one-use Redis authorization code; default OFF | SOURCE + CI 4/4 PASS, runtime OFF |
| T03c1 | Revocable Owner access/refresh on server, bound to exact Portal session | SOURCE + CI 4/4 PASS; runtime OFF |
| T03c2a | Native OS credential vault with feature default OFF | SOURCE + CI 4/4 PASS; runtime OFF |
| T03c2b | Native system browser PKCE callback, HTTPS Owner restore/login/logout, React gate | SOURCE + CI 4/4 PASS; E2E still OPEN; default OFF |
| T04 | Signed one-way App -> Local Wall SSO, replay prevention and logout link | BLOCKED ON T03 |
| T05 | Overview/Devices/Link/Relink with actual enrolled ShortID and signed status | OPEN |
| T06 | Sessions / AI Access (per-Agent leases/nicknames, B and consent, Owner close) | OPEN |
| T07 | Live Monitor / bounded job activity / safe Job Controller and kill | OPEN |
| T08 | Long Memory modes/Home/replicas/archive/delete with exact scope/Owner permission | OPEN |
| T09 | Codex Bridge runtime, observer and task create/edit/approve/delete | OPEN |
| T10 | Account, plans, device monthly calls, notifications, settings/OS permissions | OPEN |
| T11 | Local device Activity Log retention, disk cap, Clean Log on Win/Mac/Linux | OPEN |
| T12 | CI native 4/4, installed Windows+macOS+Linux functional security and no-regression | OPEN |

## 6. Mandatory task completion entry format
After each verified Txx append below: Task, Source branch+full SHA, Paths changed, API and authorization evidence, negative tests, GitHub CI run and 4-job outcomes, actual platform E2E (or NOT VERIFIED), known blockers and the next task ID. Update checkpoint/worklog/code map in same source change. Project truth --staged must PASS. Commit and push only from VPS-ARM over SSH. Never rewrite past receipts to imply passing.

## 7. Continuity and next action
Next: complete T00 handoff commit/push on ARM, then T01 cosmetic icon without standalone build and T02 read-only exact API contract audit. T03/T04 require signed secure Owner proof first. No production cutover is authorized.
Resume on ARM: cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101; git status -sb; git log -3 --oneline; cat docs/project-book/LIGHT_REMOTE_DESKTOP_V4_API_MASTER_HANDOFF_20261103.md

## 8. Atomic completion receipts
### T00 ? COMPLETE: first handoff and SSH commit
- Source commit: 8004a074ac427c2bc33b8cbde263a6ecfc1e809c.
- Files: this master handoff, checkpoint JSON, Code Map, Worklog and V4 GitHub CI branch allowlist.
- Environment: verified Windows -> authorized SSH -> VPS-ARM ubuntu; GitHub SSH identity on VPS-ARM succeeded; git remote uses git@github.com:n8n2erpnext/light-remote-mcp.git.
- Tests: project-truth --staged PASS, git diff --cached --check PASS, Git branch pushed and clean.
- Runtime E2E: NOT APPLICABLE; documentation bootstrap only. Gold UAT and installed Windows Agent untouched.
- Next task: T01 single appearance icon, then T02 precise Owner API contract.

### T01 ? SOURCE ADDED; CI / native screenshot PENDING
- Changed AuthEntry.tsx: replaced three-button Light/Dark/Auto switch with ONE accessible target-mode button; System setting remains supported elsewhere.
- Changed auth-entry.css: 44x44 button, top 64px for restored windows, focus/hover, responsive compact top offset; no impact on internal nine workspace screens.
- Changed App.test.tsx: verifies one button, correct light/dark state and local preference, no Owner API or route bypass.
- Exact commit, GitHub CI and native Windows screenshot: PENDING; do not mark accepted before proof.
- Next: stage + push this source change through VPS-ARM SSH; inspect CI. No standalone cosmetic-only build request.

### T02 ? SOURCE AUDIT COMPLETE; dedicated Desktop Login still OPEN
- Contract: docs/project-book/LIGHT_REMOTE_DESKTOP_V4_OWNER_AUTH_CONTRACT_AUDIT_20261103.md.
- Source evidence: Account Portal /account/api me/devices/usage/logout needs separate Portal Owner session cookie. /oauth/authorize and /oauth/token are strictly bound to MCP_RESOURCE and use Redis one-time code/refresh replay protection.
- Local Wall /api/status requires its own Owner session. /api/abv2/approve additionally requires B code, request/attempt and independent Owner consent with CSRF. Native Tauri port reachability is NOT Owner proof.
- Read-only source audit only; no new server route, no production/Wall mutation. Next: T03 purpose-specific Desktop login behind default-OFF controls, then T04 one-way Wall SSO. T01 native CI pending.

### T01 ? CI ACCEPTED, physical Windows acceptance separate
- Source SHA: 9f89a63a6aeb0ad2f4483c9fd4fc30018f59fe1a.
- GitHub Actions: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41571945654 4/4 SUCCESS, Web+Chromium and Windows/macOS/Linux Tauri native build.
- This is only UI build/automated test acceptance. Updated Windows restored-size screenshot from installed UI pilot is NOT YET VERIFIED; do not claim owner visual signoff or production installation.
- Next: T03a contract, then T03b server Owner exchange and T03c native vault/callback. No change to installed Agent.

### T02 ? SOURCE CONTRACT COMMIT RECEIPT
- Contract source commit: b681e6a61b8d2955923323896efca3d851492929.
- Files: docs/project-book/LIGHT_REMOTE_DESKTOP_V4_OWNER_AUTH_CONTRACT_AUDIT_20261103.md, this ledger, Code Map, Worklog, checkpoint.
- Read-only source evidence: Account Portal cookie-based me/devices/usage and OAuth MCP_RESOURCE restrictions; Local Wall 401, B4+4/consent and CSRF.
- No live API or Desktop auth attempted; next T03 deliberately separate audience.

### T03a ? CODED PURE CONTRACT + TESTED; endpoint NOT mounted
- Paths: plugin-server/desktop-auth-v4-contract.mjs and desktop-auth-v4-contract.test.mjs.
- Validates owner authority from the already-verified Account Portal session, exact desktop client/resource/scope, PKCE S256, 43-character state+install nonce, strict ephemeral IPv4/IPv6 loopback callback /desktop/v4/callback, 90s authorization intent.
- Denies remote:MCP audiences/scopes, wrong Owner/account client parameters, forged Agent/grant/B/consent payload, wrong callbacks, weak verifier/challenge.
- On VPS-ARM only lightweight Node 22 syntax + node --test (NO npm build): 5/5 PASS. New dedicated test step added to GitHub V4 CI; exact run PENDING.
- This module is never imported/mounted by Account Portal or Operator; creates NO authorization code, session, bearer/refresh token or grant. T03b still needed before enabling actual Sign in.

### T01b ? OWNER SCREENSHOT CORRECTION (2026-11-03)
- Owner's latest restored-window screenshot shows the one-icon Light/Dark toggle still overlapping top-right of Login card. Owner explicitly selected removal of the Login toggle instead of repositioning again. **The prior T01 one-icon design is SUPERSEDED.**
- Changed client/desktop-v4/src/AuthEntry.tsx: remove standalone theme toggle, derived mode variables, unnecessary theme props and Sun/Moon icon imports.
- Changed client/desktop-v4/src/App.tsx: stop passing theme controls to Login gate; Settings still independently supports Light/Dark/System via existing useTheme and stored preference.
- Changed client/desktop-v4/src/auth-entry.css: delete all Login auth-theme positioning styles, including small-screen overrides; avoids titlebar/card collision regardless of DPI/restored window size.
- Changed client/desktop-v4/src/App.test.tsx: expect NO theme control in Login and no privileged fetch; existing Settings theme test remains.
- Changed client/desktop-v4/e2e/visual-smoke.mjs: Chromium geometry evidence additionally requires zero Login theme controls.
- Native/Login Owner API and permissions unaffected. No standalone UI test build or production deployment requested. GitHub CI on next source commit is automated; actual physical Windows acceptance remains separate.
- Source commit: b22f75fe463552d77e31005419f48bcec928a2df. GitHub CI: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41574241626; pending complete verification. Production app unchanged.
- Continue T03b Desktop Owner authentication after T01b checkpoint, without faking account authority.

### T02b ? GoldABV2 Lab Wall and ChatGPT MCP endpoint split
- Owner endpoint mapping: NetBird Lab Wall UI/API http://100.94.184.141:15591, distinct from custom ChatGPT MCP https://goldabv2.light-remote.thaiduy.digital/mcp.
- Read-only runtime checks: Windows GET Lab /api/status HTTP 401 unauthenticated; ARM Wall root HTTP 303; GoldABV2 Account Portal /account HTTP 200; MCP HEAD HTTP 405. Authenticated device status remains UNVERIFIED.
- Exact Rust native opener and bounded anonymous status probe: compile-time LR_V4_WALL_PROFILE=goldabv2-lab chooses Wall Home or Activity Logs under 100.94.184.141:15591; ordinary builds default to 127.0.0.1:5491. No caller-provided URL, no /mcp in launcher, no credentials/Owner cookie in probe. HTTP Lab transport is NetBird-overlay-only, NOT an authenticated SSO mechanism.
- GitHub V4 native pilot workflow sets the compile-time Lab profile and artifact names include goldabv2-lab. Webview CSP remains self-only; no browser fetch to Lab data from React.
- Source unit/static contract: client/desktop-v4/src/lib/native-shell.test.ts checks both literal profiles and prohibits MCP in opener. Exact CI proof pending; no runtime production deployment or installed Agent change.
- Next after profile CI: T03b dedicated Desktop Owner authorization, distinct from MCP RESOURCE and account cookie sharing.

### T03b ? Source-only Owner browser authorization (feature OFF)
- Source: plugin-server/desktop-auth-v4-server.mjs, desktop-auth-v4-server.test.mjs, and feature registration in plugin-server/server.mjs. Flag LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4 must equal 1; default OFF and NOT deployed to GoldABV2 Lab/production.
- Browser GET /account/desktop/v4/authorize verifies Account Portal Owner cookie via real Operator /v1/accounts/me. If absent redirects to same-origin Account login. Explicit Continue/Cancel form, exact CSP and strict Origin/CSRF on POST.
- Separate audience urn:light-remote:desktop-owner:v4, client light-remote-desktop-v4, desktop:read scope, PKCE S256, state and install nonce 43 chars, exact local loopback callback. No MCP bearer, remote execution or A/B authorization.
- Browser Owner session fingerprint is SHA256 hashed in Redis; consent is one-use GETDEL, limited 12 intents per Owner per ten minutes. A 256-bit authorization code has 90-second TTL, stored as SHA256 key, once-only consumption. Wrong verifier/redirect/nonce/state consumes and rejects. No token endpoint yet.
- Offline Node security tests T03a+T03b 16/16 PASS. CI workflow now runs both; exact native CI pending.
- T03c still OPEN: native callback, access/refresh token issuer and revocation, OS credential vault. T04 App-to-Wall SSO also OPEN. UI Continue in browser remains disabled; this is NOT real Owner Login.
- Owner endpoints: Lab Wall http://100.94.184.141:15591; browser Account Portal https://goldabv2.light-remote.thaiduy.digital/account; ChatGPT custom MCP https://goldabv2.light-remote.thaiduy.digital/mcp remains separate.

### T03b ? CI receipt (exact source)
- Source SHA: 376cb8ffd10ec17a4ee0ef88eef9b3f0fa7310c8.
- GitHub Actions: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41576488187; Web + Chromium, Tauri Windows, macOS, Linux all SUCCESS (4/4).
- Gold documentation library integrity: run41576488180 SUCCESS. Project Truth --staged passed securityBoundaryChanged=true. Local lightweight Node T03a/T03b 16/16 PASS.
- T01b Login theme removal earlier source b22f75fe CI 41574241626 4/4 PASS. T02b GoldABV2 NetBird Wall profile source 294aefba CI 41575414419 4/4 PASS.
- Only SOURCE, binary build and test acceptance. No App login browser callback, no secure OS vault, no token endpoint, no runtime feature flag activation, no App->Wall SSO and no native installed E2E. GoldABV2 Lab Wall and custom ChatGPT MCP unchanged.
- Next: T03c must specify durable revocable Desktop-only session authority (account/device binding), build native localhost callback and OS vault with fail-closed revocation before enabling browser consent. DO NOT share Account Portal cookies with HTTP Wall; use T04 signed one-use SSO later.

### T03c1 ? Server-only revocable Desktop token authority (2026-11-03)
- Source: plugin-server/desktop-owner-token-v4.mjs and .test.mjs; plugin-server/desktop-auth-v4-server.mjs and .test.mjs; plugin-server/server.mjs; operator-host/account-registry.mjs; operator-host/executor-routes-account.mjs.
- WHY account session binding matters: AccountRegistry has a distinct acctsess_UUID login session with expiry and logout/invalidateSessions handling. New read-only desktopOwnerSessionActive(accountId,sessionId) checks actual Operator account session, status and expiry. Internal Operator Unix-socket POST /v1/accounts/desktop-session-check checks this existing identity; ID is NOT a bearer credential. Plugin browser consent/code includes accountSessionId+absolute accountSessionExpiresAt from Operator /v1/accounts/me, not from user input.
- Desktop native token issuance: independent strict feature gate LR_GOLD_ABV2_DESKTOP_TOKEN_V4=1 **AND** LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4=1. Both OFF in current runtime. Four candidate server paths: POST /account/desktop/v4/token, POST /refresh, GET /session, POST /logout. No MCP token reuse, no Agent grant, no Wall cookie.
- Server atomically consumes T03b one-time PKCE code; re-checks exact Portal session active in Operator before issuing opaque random 256-bit Desktop access and refresh credentials. Only SHA256 of those credentials indexes Redis entries. Access lifetime <=10 minutes, rotating refresh and family <=7 days AND no longer than original Portal session. Every access inspect/refresh checks the original active Account Portal session; Portal logout/password reset/admin disable fail closed. Explicit Desktop logout deletes family, invalidating all descendants. Response supplies only desktop:read scope and Owner accountId; no Owner Portal credential, email, B-code or Webview token.
- Native endpoints reject any browser Origin/Cookie and reject cross-site or wrong JSON Content-Type, with no credentials in URLs. Account Portal is HTTPS; native caller must use OS HTTPS and store refresh outside JS. No endpoint is turned on during this source-only task.
- Lightweight Node syntax and security tests: 25/25 PASS across T03a/T03b/T03c1, including invalid/cross-site requests, revoked Portal session, refresh reuse, family revocation, expiry and AccountRegistry disabled account. GitHub CI runs all three suites; exact CI pending.
- T03c2 NOT DONE: Tauri system-browser launcher + temporary 127.0.0.1 loopback callback with exact state/issuer, native HTTPS code exchange and OS secure vault Windows Credential Manager, macOS Keychain and Linux Secret Service. No real Desktop session yet; continue only after standalone native security tests.
- T04 App -> Wall signed SSO still OPEN; NetBird Lab Wall 100.94.184.141:15591 remains HTTP and must not receive bearer/refresh secrets.

### T03c2a ? Native platform credential vault (2026-11-03)
- Paths: client/desktop-v4/src-tauri/src/owner_vault.rs; Cargo.toml; main.rs; src/lib/native-shell.test.ts; V4 GitHub workflow.
- Native Cargo feature desktop-owner-login DEFAULT OFF; pinned keyring 3.6.3 with Windows Credential Manager, Apple Keychain and Linux Secret Service backends. Refresh credential stays private to native Rust. No Tauri invoke/API, Webview/localStorage/plaintext file exposure.
- Credentials fail closed on unavailable or locked OS keystore. Linux libdbus-1-dev installed on CI runner only, not VPS-ARM. GitHub CI runs cargo test --features desktop-owner-login on all three OS runners without modifying existing UI-only native binary defaults.
- Tests in Rust validate opaque token syntax, namespace. Web static test checks private-only keyring boundary. Cross-OS GitHub CI PENDING.
- Next: T03c2b native loopback PKCE callback, OS-only HTTPS exchange, restore/revoke and verified native Owner UI gate. Real login and App-to-Wall SSO NOT implemented. GoldABV2 Lab unchanged.

### T03c1 / T03c2a ? exact GitHub CI receipts and next gate
- T03c1 source SHA e20d699e65aeb4d2a80e1b1b46f3aa660c042a27, GitHub V4 CI run 41579145997 SUCCESS 4/4 Web/Chromium, Windows, macOS, Linux. Documentation integrity run 41579145894 SUCCESS. 25/25 offline security tests PASS. These tests do NOT imply live Owner login or server feature flags enabled.
- T03c2a vault source SHA d30d534b0d79bdfaefba2e23bb0b814bb4445568, GitHub V4 CI run 41579644386 in progress at this receipt. Rust feature desktop-owner-login default OFF. OS vault candidate compilability/credential interaction NOT YET VERIFIED; installed Windows runtime unchanged.
- Next: read GitHub run 41579644386, fix any Windows/macOS/Linux keyring CI build errors, update this same handoff, then implement T03c2b localhost callback and native login. Separate T04 signed App->Wall SSO remains OPEN.

### T03c2b - Native callback, HTTPS exchange, Owner UI gate (candidate)
- Source: client/desktop-v4/src-tauri/src/owner_login.rs, owner_vault.rs, main.rs, build.rs, Cargo.toml, permissions/desktop-owner.toml, tauri.conf.json; client/desktop-v4/src/lib/native-owner.ts and .test.ts; src/AuthEntry.tsx and .test.tsx; src/App.tsx; native-shell.test.ts; V4 GitHub native CI.
- Native Cargo feature desktop-owner-login is DEFAULT OFF. Candidate React VITE_LR_V4_OWNER_LOGIN=1 is ALSO required and is inhibited by UI-test preview. UI pilot with default feature still has only open_local_wall and probe_local_wall Rust commands.
- Exact system-browser Account Portal authorization to https://goldabv2.light-remote.thaiduy.digital/account/desktop/v4/authorize. Native creates fresh 256-bit verifier, state, install nonce and PKCE SHA256 challenge; binds a random 127.0.0.1:0 port, accepts only GET /desktop/v4/callback with exact Host, state, issuer, one code and 120-second timeout. Duplicate/unexpected callback parameters rejected, no token logged or served by callback. Backend code itself expires in 90s.
- Native exchanges code via HTTPS/TLS with fixed Account Portal /token endpoint and no HTTP redirects. Response capped at 8KiB and checked for exact Desktop audience, read-only scope, account id, 256-bit access/refresh tokens and <=600s access expiry. Rotating refresh is saved only to Windows Credential Manager, macOS Keychain or Linux Secret Service, inside Rust. No bearer token, password, cookie, verifier or refresh secret is returned through React/Tauri IPC.
- Native OwnerRuntime generation fencing: Sign out while browser callback is in flight invalidates prior generation; late token family is revoked rather than written to OS vault. Keyring write is protected by native mutex from logout/rotation races. Native restore rotates stored refresh via HTTPS. Owner session revalidated with server-only /session GET every <=15s; outage/revocation locks UI fail-closed.
- Only sanitized native state (signed_out, browser_pending, restoring, verified, expired + accountId) can unlock the React workspace. Ordinary UI preview remains independent and is never treated as Owner authentication. Account verified banner explicitly states LOCAL WALL NOT VERIFIED; no A/B grant or Wall owner cookie is issued by this step.
- Native command registration and exact permissions are gated by compile-time Cargo feature, with no arbitrary-url shell/plugin. Fixed endpoints do not use Custom ChatGPT /mcp. NetBird Lab Wall remains http://100.94.184.141:15591 for Home/Logs, not for secret transport.
- Tests: Rust module unit callback/PKCE/expiry/issuer/duplicate and token scope tests through GitHub Windows/macOS/Linux cargo test --features desktop-owner-login; frontend native Owner projection security tests, AuthEntry gate tests and static Tauri permission checks; separate feature-gated Vite build. Source and CI currently PENDING; no true Owner login E2E, installed Windows App or GoldABV2 runtime changed.
- Launch gate: operator session-check, default-OFF T03b/T03c1 server routes require LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4=1 AND LR_GOLD_ABV2_DESKTOP_TOKEN_V4=1; do not enable until cross-platform compilation, negative tests and full authorized Lab E2E are complete. App-to-Wall signed SSO (T04) still separate and OPEN.

### T03c2b - First CI feedback and correction
- Initial source SHA 548992ddd4f253ebc4659dc7e6cfdb068ffc8d6d; GitHub V4 CI run 41582176494: Web stage FAILED 3 UI/static test assertions (not token security regressions), native matrix skipped by dependency.
- Fixes: restore previous Design Preview visible exact text (UI acceptance snapshot), explicitly wrap browser button onClick to invoke zero-argument native initiation rather than forwarding React SyntheticEvent, and update prior static prohibition of all Rust .manage() to permit only feature-gated native OwnerRuntime state while shell/plugin arbitrary execution remains prohibited. Rust URL serialization made explicit.
- Repeat Web/Chromium and all native Windows/macOS/Linux Rust tests via GitHub; next run pending. No feature flags enabled and no Lab installation. This receipt is NOT a native Owner login E2E PASS.

### T03c2b - CI pass Web / native manifest lifetime failure and fix
- Source patch 7ef872dbf7be1b40d5830e900eb472ca0b85ea2e; GitHub V4 CI 41582409955: Web TypeScript, 51+ unit tests, Chromium and feature-gated React build PASS. Windows/macOS/Linux default Tauri build all FAIL at Rust E0597: Tauri AppManifest requires a static command list, but build.rs used a local Vec.
- Fix: build.rs now defines static UI_ONLY and OWNER_CANDIDATE slices, chooses by Cargo feature and passes a static slice to AppManifest. Default UI-only binary still registers two commands and never links Owner backend. Candidate feature still explicitly registers exact four native Owner phase commands.
- Security hardening in same fix: refuse to start a new login if an Owner session is already verified (must explicit Sign out); native logout prioritizes rotating refresh credential over potentially expired access token when revoking the server family. No change to browser Account Portal /mcp or Wall endpoint.
- All native CI results for corrected commit still PENDING. Runtime flags OFF; physical Windows E2E not completed.

### T03c2b - Final source/CI acceptance receipt
- Source: 9de0b41ddaa1db1bc914fc3bc36f9b42a3d3a4be (after fixes 548992dd, 7ef872db). Branch feat/desktop-v4-api-integration-20261103, canonical Git SSH worktree VPS-ARM.
- GitHub V4 workflow https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41582835723: SUCCESS 4/4 Web/Chromium, Windows-latest, macOS-latest, Ubuntu-24.04. Web frontend unit tests 51/51 PASS and Figma/geometry smoke PASS; Windows/macOS/Linux Rust keyring+Owner callback candidate tests 7/7 PASS on EACH OS. Documentation integrity run41582835735 SUCCESS.
- Rust native default UI-only build still registers ONLY open_local_wall and probe_local_wall; native Owner candidate module is opt-in Cargo desktop-owner-login. Candidate feature compiled/tested but NO feature-enabled production binary, no real OS keyring write/read/login, no external browser/loopback E2E.
- React Owner UI candidate requires VITE_LR_V4_OWNER_LOGIN=1 with UI_TEST disabled, plus real native IPC. UI-only pilot still has no login bypass. Actual Owner verification is separate from signed Wall Owner session and Agent A/B B-code/consent.
- Fixed compile issue: Tauri manifest command lists are static at build-time. Removed UI old assertions, preserved exact Design Preview typography and no-SyntheticEvent native callback. Native Sign out prefers rotating refresh token and rejects an overlapping new Owner login; cancel generation fences late browser callbacks.
- Backend T03b/T03c1 default-OFF flags LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4 and LR_GOLD_ABV2_DESKTOP_TOKEN_V4 have NOT been enabled or deployed. GoldABV2 Lab at http://100.94.184.141:15591 and ChatGPT custom /mcp unchanged. Installed Windows V4 pilot unchanged.
- NEXT: T03c2c authorized Lab end-to-end plan/build: compile separate native Owner test artifact with both Cargo feature and non-preview frontend flag, controlled GoldABV2 Lab-only Account Portal auth rollout with rollback; verify Owner accountId, browser callback state/issuer/PKCE, OS keyring persistence, restart restore/refresh rotation, server logout revocation and wrong account cases. Then T04 App-to-Wall one-time signed SSO and downstream read APIs. No claim of live login until these pass.

## TRANSFER CHECKPOINT — 2026-11-03 — T03c2c LIVE E2E STILL OPEN

This is the newest Owner-requested handoff to a new ChatGPT session. Follow this checkpoint rather than older chronological sections saying CI is still pending.

### Canonical source and device
- GitHub repository: n8n2erpnext/light-remote-mcp, branch feat/desktop-v4-api-integration-20261103.
- Main Git SSH worktree on VPS-ARM: /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101. Verified clean at base SHA a421d0df21d65991d3d78be3d6e9f4464864e9be; this handoff commit comes after it. Use git rev-parse HEAD for current state.
- Official @Light Remote helper successfully recovered an A/B-authorized VPS-ARM Main session this turn. No A/B code, B code, token, or transient session identifier goes into source/handoff. Never silently switch devices.
- VPS-ARM owns Git/SSH, not Windows. Heavy npm/cargo builds belong in GitHub CI, not on the ARM SSD.

### Endpoints and deployed reality
- GoldABV2 Lab device Wall UI/API: http://100.94.184.141:15591 (authorized NetBird overlay).
- GoldABV2 Account Portal HTTPS browser login: https://goldabv2.light-remote.thaiduy.digital/account/login; direct audit returned HTTP 200 and valid TLS.
- Custom ChatGPT MCP: https://goldabv2.light-remote.thaiduy.digital/mcp. This is NOT Desktop Login / Token / SSO.
- Isolated LXD Lab: light-remote-abv2-lab-20261101. Read-only audit found Operator, Plugin and Wall active. Plugin runtime source was /opt/light-remote-abv2-lab/source-f228c2bb, older than new Desktop Owner code. Anonymous GET /account/desktop/v4/authorize and /account/desktop/v4/token returned 404. Therefore new routes are NOT deployed; changing the flags alone cannot make login work. Verify actual runtime/source before any change.
- Do not touch Gold UAT, production, installed Windows client, or ChatGPT custom MCP while preparing E2E; stage in isolated Lab only with backup/rollback.

### What is proven by source + CI
- Owner-approved V4 UI design uses Google Sans Flex in Figma and Google Sans in app. Login must be first gate; no Light/Dark switch on Login (removed after overlap screenshot); Appearance stays in Settings. Open Wall and Activity Log UI exist, but real data/SSO wiring is separate.
- T01b Login theme removal: source b22f75fe, GitHub CI 41574241626 4/4 PASS.
- T02b Lab Wall target profile: source 294aefba, CI 41575414419 4/4 PASS; ordinary installed client default local Wall still 127.0.0.1:5491.
- T03a/T03b separate Desktop-only PKCE and Owner Account Portal consent: T03b source 376cb8ff, CI 41576488187 4/4 PASS; OFF at runtime.
- T03c1 revocable server Owner Desktop session, 10m access, rotating refresh <=7d and bound to exact Portal session: source e20d699e, CI 41579145997 4/4 PASS, 25/25 Node security tests. Server feature gates LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4 and LR_GOLD_ABV2_DESKTOP_TOKEN_V4 both require literal 1; currently OFF.
- T03c2a private Rust OS Keyring vault (Windows Credential Manager, macOS Keychain, Linux Secret Service): source d30d534b, CI 41579644386 4/4 PASS; no plaintext fallback or token in React.
- T03c2b native browser, random localhost callback, state/issuer/PKCE, HTTPS exchange/restore/logout, Owner UI gate: source 9de0b41d, CI 41582835723 4/4 PASS. Web 51/51 tests PASS, native Rust 7/7 tests PASS on EACH Windows/macOS/Linux; docs CI 41582835735 PASS.
- These tests prove source and compile only, NOT actual login, installed feature-enabled candidate binary, OS Keyring real-world persistence, or Lab API availability.

### T03c2c is NOT DONE — immediate blockers
1) Native refresh defect: client/desktop-v4/src-tauri/src/owner_login.rs defines refresh_from_vault() but calls it only from desktop_owner_restore(). While the app remains open, access_deadline reaches <=10 minutes and Owner workspace locks instead of proactively renewing. First fix automatic native token rotation before expiry, including 15s Owner server verification, generation-safe updates, mutex safety, revocation and offline/sleep-resume; keep refresh/access tokens entirely in Rust/Keyring. Test idle >10min, concurrent polls, logout during in-flight refresh, server revocation, reconnect and locked vault. The existing status revalidation is not token renewal.
2) Feature-enabled Owner native candidate artifact: NOT built. The previous attempt to write the candidate GitHub workflow was blocked by an OpenAI safety check; no bypass attempted and worktree remained clean. Need a permitted isolated CI path for a SEPARATELY LABELED unsigned/non-production Windows/macOS/Linux candidate built with BOTH Cargo feature desktop-owner-login and frontend VITE_LR_V4_OWNER_LOGIN=1, VITE_LR_V4_UI_TEST=0. Keep UI-only release artifact unchanged. Record source SHA, build job, SHA256 and explicitly mark not installed/not signed.
3) GoldABV2 Lab server source/deployment: present runtime routes are 404. Inspect active plugin+Operator service source, valid public origin, Redis atomics, local Operator session-check and rollback state. Prepare snapshot/rollback, stage compatible auth source only in isolated Lab with both flags OFF initially, run regressions, then authorize only controlled Lab E2E. Do not change unrelated production/UAT/MCP.
4) Real Windows end-to-end acceptance: Owner browser signin and explicit consent -> bounded 127.0.0.1 callback -> issuer/state/PKCE -> HTTPS native token -> OS vault -> verified Owner workspace; restart/restore, 10m auto-refresh, logout/revocation, wrong account, cancel, replay, locked vault, network failure/recovery. Do not expose token to Webview, command logs or handoff.
5) T04 AFTER T03c2c: signed one-time App -> Wall Owner SSO with expiry/replay/identity/device scope, independent from Agent A/B consent. Do not post Desktop bearer/refresh to the HTTP Lab Wall, and do not reuse Account Portal cookie. Then connect the actual V4 data/screens and Settings/Log/Open Wall workflows.

### New session exact first actions
- Read THIS handoff and .light-remote/CURRENT_CHECKPOINT.json; run git status -sb and inspect HEAD on VPS-ARM with authorized official Light Remote.
- Review client/desktop-v4/src-tauri/src/owner_login.rs, owner_vault.rs, client/desktop-v4/src/App.tsx, plugin-server/desktop-auth-v4-server.mjs, desktop-owner-token-v4.mjs, plugin-server/server.mjs and current Lab service source.
- First commit should fix native proactive refresh and tests while feature flags stay OFF. Use GitHub CI on all platforms, not ARM cargo/npm build; fix failures before calling PASS.
- Next prepare separate Owner candidate via authorized CI, isolate Lab server deployment with backup/rollback, then manual approved Windows login E2E. Only after that begin T04.
- After EACH task update this Master, docs/project-book/LIGHT_REMOTE_WORKLOG.md, docs/project-book/LIGHT_REMOTE_CODE_MAP.md, .light-remote/CURRENT_CHECKPOINT.json. Run Project Truth --staged, git diff --cached --check, commit/push from VPS-ARM.
- Never claim T03c2c or T04 complete based only on existing 4/4 T03c2b CI, a Wall HTTP 401, or a running Plugin service. No current Lab auth enabled or installed Windows candidate.

### T03c2c1 — Native proactive Owner token refresh (SOURCE STAGED; CI PENDING)
- 2026-11-03. Worktree feat/desktop-v4-api-integration-20261103 on VPS-ARM; baseline 9320b16d. Owner requested continuation of T03c2c. This is the first atomic corrective source step, NOT a live Owner login or Lab deployment.
- client/desktop-v4/src-tauri/src/owner_login.rs: Owner status poll now chooses server verification at 15s intervals or OS-only rotating refresh <=90s before access expiry, including sleep/resume after expiration. A native single-flight flag serializes refresh and verification; concurrent polls cannot claim renewed Owner proof before the refresh commits.
- Refresh validates the same accountId, stores the rotating refresh exclusively in native Keyring while protected by OwnerRuntime mutex, and only then updates native access/expiry. Failed HTTPS, revoked Portal session, wrong Owner, locked/writable vault failures expire local authority. Generation-fenced late refresh after signout never persists and attempts to revoke newly issued token family.
- Added Rust tests: 15s verification selection, 90s early refresh and sleep wake, single flight, successful Keyring rotation with injected mock, late logout, wrong account, offline/locked vault, revocation and stale verification. No real credential material in tests, source or UI.
- The default UI-only build feature remains OFF; no new Tauri IPC, endpoint, permissions, browser/cookie sharing or A/B grant. Existing GoldABV2 Lab is unchanged; native Windows/macOS/Linux installation and T03c2c Lab E2E remain OPEN.
- Source commit, GitHub 4/4 CI and exact tests: PENDING until this change is committed and verified; do not label PASS. Next: GitHub Actions CI, then separately labeled feature-enabled Owner candidate and isolated Lab backend with rollback before real Windows E2E.

### T03c2c2 — Isolated unsigned Owner candidate workflow (SOURCE STAGED; BUILD PENDING)
- T03c2c1 refresh source commit be91bf7060edc73e143b910fca3172da370abf13 is CI ACCEPTED: GitHub Actions 41604858829, Web/Chromium + Windows + macOS + Linux 4/4 SUCCESS. Each native OS ran 12/12 Rust tests PASS, including five new refresh regressions. This does not represent real installed Owner login or OS Keyring E2E.
- Added one distinct owner-login-lab-candidate matrix job to .github/workflows/desktop-v4-native-ci.yml, available only on push to feat/desktop-v4-api-integration-20261103. Existing native-shell UI-only build and artifacts remain untouched and run separately.
- Candidate builds frontend VITE_LR_V4_UI_TEST=0 and VITE_LR_V4_OWNER_LOGIN=1, Rust --features desktop-owner-login, with compile-time goldabv2-lab Wall profile. GitHub-hosted Windows, macOS and Linux runners compile an unsigned portable binary (no installer, signing or production release). Artifact names explicitly say LAB-UNSIGNED-NO-PRODUCTION; retention 3 days and SHA256 in job output.
- Python yaml.safe_load and static feature boundary checks PASS on VPS-ARM without any npm/cargo native build. Exact workflow commit/CI and actual feature-enabled artifacts are PENDING. No installed client, Lab service, Owner authentication flag, production Agent, LXD database or MCP session has been changed.
- Blocker for live Owner E2E remains isolated Lab Plugin missing desktop-auth-v4-server.mjs and desktop-owner-token-v4.mjs and Operator missing desktop-session-check; anonymous Owner Desktop routes are 404. Next: CI acceptance, snapshot and backward-compatible isolated backend staging with both flags OFF, then controlled real Owner login and T04 SSO only after evidence.
