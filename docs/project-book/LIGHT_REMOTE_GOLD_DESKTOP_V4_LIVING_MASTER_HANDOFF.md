# LIGHT REMOTE — GOLDABV2 × DESKTOP V4
# LIVING MASTER HANDOFF — CANONICAL CONTINUITY

**Document status:** ACTIVE / MUST UPDATE AFTER EVERY TASK, including partial work and blocked work.
**Created:** 2026-11-04, Asia/Ho_Chi_Minh (ICT, UTC+07).
**Project:** Light Remote GoldABV2, Desktop V4 Native Owner Authentication, and T04 Desktop → Local Wall single sign-on.
**Next active task:** **T04b8-A2** — isolate/cryptographically attest the real HTTPS edge; verify Traefik overwrite and backend bypass denial before any SSO runtime activation.
**Safety state:** **SSO OFF**; Gold Lab service healthy at last read-only check; Gold main UAT/production untouched.
**Canonical location:** `docs/project-book/LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md` on `feat/goldabv2-desktop-owner-lab-20261103`.
**Desktop mirror:** same exact relative path on `feat/desktop-v4-api-integration-20261103`, kept byte-identical after each task.
**Pre-existing handoffs:** historical and reference-only; this file's TOP CURRENT STATE and latest dated receipt take precedence. Do not silently discard historical evidence.

> **FIRST INSTRUCTION FOR EVERY FUTURE SESSION:** Read sections 0–4, 8–11 and the newest dated receipt in section 14. Verify the actual branch HEAD, CI and live Lab flags; never infer that source CI passing means the code was deployed. After EACH task or blocker, update THIS SAME DOCUMENT in BOTH worktrees, the appropriate CURRENT_CHECKPOINT.json, Worklog and Code Map, verify Project Truth, commit/push over VPS-ARM SSH. This file is NOT a one-off handoff.

---

## 0. CURRENT FIRST — authoritative fast start (2026-11-04)

| Dimension | Status at this checkpoint | Evidence / qualification |
|---|---|---|
| Desktop V4 Login-first, Owner browser PKCE | **WINDOWS PHYSICAL PASS** | Owner tested native Windows login, sign out, standard Welcome return and cold-start gate on 2026-11-03. |
| Desktop OS credential restore | **WINDOWS PHYSICAL PASS** | Windows Credential Manager native vault, cold restore/lock, signout clears stored credential metadata; do not inspect secrets. |
| Owner proactive refresh after uninterrupted >10-minute access expiry | **OPEN — live long-duration proof missing** | Source tests/CI are not actual unattended physical Windows acceptance. |
| Independent server-side Owner family revocation after logout | **OPEN — live Redis/backend proof missing** | Shared-Redis tests simulate family deletion and prove logic; actual running backend session proof remains unverified. |
| T04a–T04b7b App → Wall SSO backend | **SOURCE + CI PASS, RUNTIME OFF** | Six exact flags; no real Windows App→Wall SSO or device signed relay yet. |
| T04b7b selected security suite | **122/122 NODE PASS** | Includes real temporary Unix-socket transport with Node HTTP simulated proxy/parser; not physical HTTPS/Express/Traefik. |
| Gold Source Gate T04b7b | **4/4 PASS** | GitHub Actions run **41671804510**; Gold Docs run **41671804368** PASS. |
| T04b8 ingress route | **SOURCE+CI PASS; REAL PEER VERIFIED; DIRECT HTTP BACKEND STILL REACHABLE; SSO OFF** | Public TLS and direct backend both arrive as 127.0.0.1. Source edge-proof guard Gold CI 4/4 PASS; live Traefik override and protected backend NOT deployed. |
| Lab runtime | **4/4 active, public HTTPS health 200** | Latest read-only check **2026-11-04 01:38:17 UTC / 08:38:17 ICT**. |
| Lab Desktop Owner Auth, Token and SSO Issuer | **OFF (observed in target service configuration)** | Owner Auth ON count 0; Token ON count 0; Issuer ON count 0; authorize URL 404. |
| Gold main UAT/production and custom ChatGPT MCP | **NOT CHANGED BY T04 SOURCE TASKS** | No deploy, no service restart, no migration, no feature cutover. |
| Native Windows Desktop V4 candidate for T04 | **NOT AVAILABLE** | Most recent physically accepted candidate was for Owner Login/Logout, not signed Wall SSO. |
| Agent A/B approval authority | **INDEPENDENT / MUST NOT CHANGE** | Owner web login, native login or SSO must never grant Agent command permission. |
| Living Master governance | **ACTIVE — Gold + Desktop Project Truth CI PASS** | GitHub gate runs **41757247108** (Gold) and **41757254955** (Desktop) PASS; missing/undated Master negative tests PASS; both copies byte-identical. |

**What the next Agent should do FIRST:** read the latest task receipt and current branch HEADs. The real Plugin peer has been measured as `127.0.0.1` via BOTH public TLS and direct host HTTP to `172.30.0.1:15583`; this is a confirmed backend bypass of TLS (not a confirmed token exploit). Do **not** allowlist 127.0.0.1 plus `X-Forwarded-Proto` as sufficient evidence of HTTPS. Source now requires an additional 256-bit edge proof, but actual proof injection/isolation on Traefik/Plugin is NOT installed. Next T04b8-A2: review a protected private edge (mTLS/isolated socket or route-specific TLS-only attestation), verify header overwrite, backend restrictions and negative spoof tests before snapshot+auto-OFF+live SSO.

**Baseline repository HEADs before this handoff was created:**
- Gold: `6fc8ba6124ffa1c9af1bc09154698db7082fb945` (T04b7b CI acceptance + read-only Lab ingress).
- Desktop: `edc9802f6925151f0cb9908b18c2e1f38b329a22` (mirror checkpoint of T04b7b CI and topology).
- New handoff commits advance both HEADs; use `git log -1` and checkpoint rather than treating these baseline SHAs as the perpetual HEAD.

---

## 1. Source-of-truth ownership and branch map

**GitHub repository:** https://github.com/n8n2erpnext/light-remote-mcp

**Canonical Gold living handoff URL:**
https://github.com/n8n2erpnext/light-remote-mcp/blob/feat/goldabv2-desktop-owner-lab-20261103/docs/project-book/LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md

**Desktop V4 mirror URL:**
https://github.com/n8n2erpnext/light-remote-mcp/blob/feat/desktop-v4-api-integration-20261103/docs/project-book/LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md

| Role | Branch | Worktree on VPS-ARM | Scope |
|---|---|---|---|
| GOLD/T04 backend primary | `feat/goldabv2-desktop-owner-lab-20261103` | `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/goldabv2-desktop-owner-lab-20261103` | Plugin, Operator, Redis Owner proof, signed device channel, SSO backend, Gold Lab |
| Desktop V4 native/API primary | `feat/desktop-v4-api-integration-20261103` | `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101` | React/Tauri2, native Owner login, OS vault, Desktop→Wall integration |
| Gold base/Owner transfer | `feat/gold-single-owner-transfer-20261101` | historical sibling worktree / remote branch | Owner transfer, A/B V2, memory integrations; do not deploy instead of isolated GoldABV2 without review |
| Device local activity logging | `feat/goldabv2-device-local-activity-logs-20261102` | historical related branch | Wall local logs/rotation; separate from SSO |
| Desktop login/UI predecessors | `feat/desktop-v4-login-entry-20261103` and related V4 feature branches | historical | Frozen Figma/React login implementation, no new redesign |
| LM Chrome extension | `feature/gold-lm-chrome-extension-20261029` | historical | Opt-in capture → Owner-reviewed Long Memory |

**Remote/authority:** run Git read/write/commits/push only in the authorized canonical VPS-ARM worktree over Light Remote/SSH; do not treat a Windows scratch clone as canonical. Do not build native Windows/macOS/Linux on VPS-ARM: use GitHub Actions, conserving constrained SSD. Separate worktrees/branches are NOT automatically merged. Check `git status -sb` and `git log -3` before choosing source.

**Mirroring protocol:** Gold branch contains the **canonical living copy**. Immediately after every Gold OR Desktop task, update the canonical Gold master, then sync its exact content into the Desktop mirror (or vice versa with final Gold reconciliation). Both copies must end byte-for-byte identical; verify `cmp -s` before completion. Do not let future independent task logs diverge. The old Desktop API Master and old Gold FULL MASTER remain deep historical references and should point readers here.

---

## 2. Evidence vocabulary — no false PASS

| Label | Exact meaning |
|---|---|
| **SOURCE IMPLEMENTED** | Code exists in the named branch and can be inspected. It may not be imported, built, mounted or deployed. |
| **LOCAL TEST PASS** | Named tests executed on a specific worktree, with tested count; mocks and harness limitations declared. |
| **CI PASS** | GitHub Actions run ID + all relevant job statuses validated; docs-only PASS is not native CI PASS. |
| **LAB LIVE PASS** | Authorized running isolated Lab service, exact source/version and actual network or Redis call verified. |
| **WINDOWS PHYSICAL E2E PASS** | Owner ran the exact test binary and confirmed screenshots/behavior; neither CI nor WebView mock qualifies. |
| **PENDING/BLOCKED/OFF** | Preserve exact unknown or denial reason, never promote to PASS by assumption. |

**Rules:** distinguish test-double Redis from running Redis, Node HTTP simulated proxy from real TLS/Traefik/Express, Browser Owner Login from Wall cookie, OS vault metadata from private credential contents, and signout UI from independent backend family revocation. Never invent session, device, booking, approval or CI results. A 404 from disabled auth flags is expected, not a login failure caused by the newest source change.

---

## 3. Project components and separation of authority

### 3.1 System diagram (logical, not a deployment claim)

~~~text
Desktop V4 Windows/macOS/Linux — Tauri2 Rust trusted core
  ├─ System Browser → Account Portal Owner login/consent/PKCE
  │    ↳ native localhost callback (ephemeral loopback port, state/nonce)
  ├─ Native keyring: Windows Credential Manager / macOS Keychain /
  │    Linux Secret Service (only supported backend, no plaintext fallback)
  ├─ Rust-only Owner access + refresh and UI "verified" projection
  └─ [T04 — NOT LIVE] scoped native HTTPS Owner one-use ticket request
          ↓ public HTTPS only / six independent default-OFF flags
Gold Plugin (Account Portal + Desktop token authority)
  ├─ current Owner access/family, AccountRegistry and Redis proof
  └─ fixed private Operator Unix-socket request
          ↓ /v1/internal/desktop-wall-sso/issue; 0660 socket
Gold Operator
  ├─ currently enrolled device + live Owner/Portal session + Redis
  ├─ random 256-bit ticket; Redis digest key; EX=45, NX + GETDEL
  └─ signed device channel redemption, Ed25519 nonce replay guard
          ↓ [NOT LIVE: device-signed relay + secure Wall bootstrap]
Target Local Wall on THAT enrolled device
  ├─ separate, Origin/Host/CSRF-scoped Owner Wall session cookie
  ├─ per-request live Owner-family / enrollment revocation
  └─ Agent command A/B permission is entirely separate
~~~

**Trust boundaries:** Owner Portal browser cookie ≠ native Desktop scoped access/refresh ≠ Local Wall cookie ≠ Agent A/B grant ≠ ChatGPT MCP OAuth token. Native app verified must not directly mark Wall verified. A Wall cookie must never unlock Desktop. Wall SSO must never approve Agent sessions, mint B codes, alter local device policy or silently re-enroll a device.

### 3.2 Gold A/B independent authorization (historically accepted)

- Device discovery and Short ID visibility require no B approval. They NEVER imply execution permission.
- A/B V2 flow: stable 6-character device Short ID + rotating 5-character A portion; pending approval expires about 5 minutes; B code is 4+4 and must be pasted/approved by Owner at that SAME Wall.
- Per-Agent grant commonly up to 24 hours; 60-minute session HOLD is a different clock. Closing a session must revoke its exact Agent grant immediately and stop its countdown, without revoking any newer grant of the same Agent or another Agent.
- Keep exact account/device/attempt/connection/Owner binding and fail-closed policy checks. Device local capability cannot be escalated by cloud or account login. **Never skip B or Owner consent in a new design.**
- Historical source `operator-host/owner-session-close-abv2.mjs`; previous live Lab scoped close proof. A fresh real multi-Agent regression is separate acceptance, not implied by T04 tests.

### 3.3 Other Gold features and boundaries

- **Wall R5 UI:** vertical persistent sidebar, theme mode, Google Sans Flex/Code, Material icons, A→B split, live stream, Owner/session lanes; the old UI handoff contains accepted details. Do not resurrect archived R4 presentation strings.
- **Device-local activity logs:** wall/node local RAM ring + persistent rotated logs, limited disk usage, Owner-only Clean and settings. Gold Activity Log source/CI and Lab-specific Wall were previously tested, but physical installed Windows/macOS/Linux logs need separate acceptance. Different storage/consent from Long Memory.
- **Long Memory:** keep functionality; delete only old imported Gold test data when verified/authorized. Extension v0.3 manually reads ChatGPT web DOM with explicit Owner opt-in/preview; no covert capture, no auto-upload. The historical old-LM cleanup status is ambiguous; do not claim it completed without fresh read-only evidence and Owner-scoped delete confirmation.
- **Codex Bridge:** remains a separately permissioned task/observer workflow. Not automatically authorized by Owner desktop sign-in.

---

## 4. Exact live Lab topology, isolation, and security fence

**Lab LXD:** `light-remote-abv2-lab-20261101`. Do not confuse it with Gold UAT or production.
**Lab services (last check 2026-11-04 01:38 UTC):**
- `light-remote-gold-plugin.service` — active
- `light-remote-gold-operator.service` — active
- `light-remote-gold-wall.service` — active
- `light-remote-gold-process-supervisor.service` — active

**Public Account/Plugin origin:** https://goldabv2.light-remote.thaiduy.digital
**Owner consent entry (feature currently OFF):** `/account/desktop/v4/authorize` → HTTP 404 after prior bounded Lab auto-OFF.
**MCP endpoint (separate authority):** `/mcp`. Do not touch its OAuth authorization when testing Desktop login.
**Local Wall in Lab via NetBird:** `http://100.94.184.141:15591/`; this is NOT automatically a valid public secure cookie origin or a Wall on the user's Windows device.

**Read-only ingress trace verified 2026-11-03:**
1. Docker `netbird-traefik` listens host TCP :443 and routes `Host(goldabv2.light-remote.thaiduy.digital)` on `websecure` TLS.
2. Dynamic router `goldabv2-mcp` → backend `http://172.30.0.1:15583`.
3. LXD proxy host `tcp:172.30.0.1:15583` → inside Lab Plugin `tcp:127.0.0.1:5583`.
4. Inside Lab Redis/PG loopback services observed, but do not infer real business state from TCP LISTEN.
5. Operator actual socket `/run/light-remote-gold-uat/operator.sock`, permission 0660 `gold-uat:gold-uat`. Source defaults to `/run/gpt-vps-operator/operator.sock`; real systemd service overrides the path.
6. Separate NetBird Local Wall proxy host `100.94.184.141:15591` → Lab local `127.0.0.1:5491`.

**T04b8 ingress hazards — exact TCP peer VERIFIED, remaining real-edge controls BLOCKING:**
- **VERIFIED 2026-11-04:** both public HTTPS TLS 1.3 and direct host HTTP `172.30.0.1:15583` reach Plugin as remote peer **`127.0.0.1`** through the LXD proxy. The backend health route returns HTTP 200 on direct HTTP. Peer allowlisting alone cannot prove Traefik TLS provenance.
- Effective ownership/sanitization of `X-Forwarded-Proto` and `X-Forwarded-Host`, and whether an untrusted path can bypass TLS termination to backend HTTP.
- Actual Express 2KiB pre-parser behavior across deployed middleware; source-only test harness used Node HTTP because VPS source worktree does not contain Express installation.
- Real cross-process Redis family/access proof, exact device enrollment and revocation across the running Plugin + Operator.
- Native Rust ticket request/transfer, Agent signed relay and Local Wall session issuance.

**Isolation:** Lab auth/Token/Sso Issuer ON counts all 0 on 2026-11-04; 4/4 services active; public health HTTP 200. Never assume flags remain OFF or ON without checking exact deployed service/config. Create a fresh LXD snapshot, targeted backup and bounded auto-OFF timer before a new Lab window. Verify rollback has actually succeeded before claiming it. Never deploy an unreviewed Gold source branch directly to main UAT/production.

---

## 5. Desktop V4 — accepted user experience and auth contract

**Frozen UI:** React + Tauri 2, nine screens: Overview, AI Access, Sessions, Live Monitor, Devices, Long Memory, Codex Bridge, Account, Settings. Google Sans/Google Sans Flex from repo, Material icon kit, dark/light in Settings. Login-first before sidebar; do not reintroduce Login theme controls. Source designs in Figma key `wfvLVoNvzVzyNHq51U0DPB`, login frames `63:76`, `63:105`, `63:244`, `63:278`, `63:312`, `63:346`. Existing layout was approved; T04 is not permission to redesign Desktop UI.

**Native Owner Login implementation:**
- Tauri Rust `client/desktop-v4/src-tauri/src/owner_login.rs`: system-browser PKCE code + ephemeral localhost callback, HTTPS Owner token refresh, status revalidation and fail-closed generation/race semantics.
- `client/desktop-v4/src-tauri/src/owner_vault.rs`: OS keyring vault, no plaintext fallback.
- `client/desktop-v4/src-tauri/src/main.rs`: feature-gated native command exposure, fixed Local Wall target (UI test vs Lab profile deliberately separate).
- Server `plugin-server/desktop-auth-v4-server.mjs` plus `plugin-server/desktop-owner-token-v4.mjs`: exact Owner Portal session, one-use authorization code, 10-minute native access TTL, revocable rotating refresh family (historical server policy 7-day family), purpose-scoped access only.
- React entry gate and authenticated projection: under `client/desktop-v4/src/` (AuthEntry and App). Never expose raw access/refresh to React, Webview localStorage or the Wall.

**Owner physical Windows acceptance:**
- GitHub unsigned Owner LAB EXE candidate from run **41653557757**; T03c2c10 source fix `002ae870cd11df0e8c4be96f32d78ad53f682400`.
- Owner confirmed physically **"đăng nhập và đăng xuất được welcome ngon lành"** with screenshot showing **Welcome to Light Remote / Continue in browser**, not erroneous **SESSION EXPIRED**.
- On an intentional logout, absent OS vault credentials now restore the ordinary signed-out Welcome rather than an expired-session error; actual revoked/invalid storage/network errors remain fail closed.
- OS Credential Manager target-count metadata after signout was zero in authorized read-only inspection (no secret values fetched).
- **Do not close** independent live tests for *sustained >10-minute proactive refresh*, *server-side family revocation after logout* or *T04 App→Wall SSO* based on the above UI acceptance.

**Native build discipline:** Windows, macOS and Linux native builds via GitHub Actions only. LAB unsigned Owner candidate is deliberately labelled “NO-PRODUCTION”. A Source Gate PASS is not physical installed Windows/macos/Linux acceptance. Keep candidate hashes and run IDs in the specific task receipt rather than claiming the last binary includes future T04 changes.

---

## 6. T04 implementation chronology — verified source/CI receipts

| Milestone | Implementation | Verified / limitation |
|---|---|---|
| T04a | Backend one-use ticket, SHA-256 Redis key, 45s TTL, device/Owner family binding, signed device redemption contract | SOURCE + tests; initial service not mounted. |
| T04b1/b2 | Local Wall revocable Owner session gate, separate from Agent A/B, strict Origin/session check | Source and isolated HTTP loopback tests; not actual native Wall SSO. |
| T04b3 | Real enrolled Ed25519 device-channel signed proof via EnrollmentRegistry; avoid nonce replay | Source CI PASS; no physical signed Agent transport. |
| T04b4 | Operator `POST /v1/device-channel/desktop-wall-sso-redeem`; exact request, default 404 without trusted callback | Gold commit `8a2d49da070e14a79c22001eaa79048c90bc13d4`, 66/66 selected Node PASS; CI 4/4 run 41658255479. |
| T04b5 | Shared Gold Redis hashed native access/family validation + current AccountRegistry/Portal Owner + Ed25519 | Gold commit `931b86ade48a9d19c5dcbf83a9c2174db64e8276`, 79/79 PASS; CI 4/4 run 41662764438. Test Redis was an in-memory double, not real multi-process Lab. |
| T04b6 | Operator startup gate: exact 5 independent flags, fail-closed trust dependencies, default OFF | Gold commit `fa1f75bfbdf35cc8cec10443d891b7301f7a4274`, 89/89 PASS; CI 4/4 run 41665190911. |
| T04b7a | Strict native-only HTTPS Owner ticket-issue handler and Operator Unix-only issue seam; initially unmounted | Gold commit `0f0a002d65cc3958ada84ecbe4510fbc95d2918d`, 103/103 PASS; CI 4/4 run 41668319985. |
| T04b7b | Wire Plugin HTTPS ticket issuer to Operator private Unix handler using sixth independent flag, conditional 2KiB parser, proxy peer pinning and bounded in-process rate | Gold commit `89b607d04c3000bb82fdf2ccf2981822c471148a`, 122/122 PASS; CI 4/4 run **41671804510**. Source only, default OFF. |
| T04b8 | Live read-only proxy peer/bypass test and source-only edge attestation hardening | Gold commit `0ecffcfbaeb29d944288546c53a5817d863ff08d`; public TLS1.3 and host direct HTTP both peer 127.0.0.1, direct HTTP health200; 129/129 local T04 PASS; Gold CI **41760470702 4/4 PASS**; no runtime changes. |

**Important security regression:** verify Ed25519 device channel envelope **exactly ONCE**. Calling `verifiedChannelContext` before the T04 trusted redeem callback consumes the anti-replay nonce and causes a valid request to fail. Signed payload must bind ticket digest, account and device; Redis consumes ticket atomically with GETDEL. Concurrent redemptions have at most one winner. Keep native Owner bearer out of browser cookies/URL query/Wall requests.

**Current six issuer gates, ALL exact string '1':**
1. `LIGHT_REMOTE_GOLD_INDEPENDENT`
2. `LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4`
3. `LR_GOLD_ABV2_DESKTOP_TOKEN_V4`
4. `LR_GOLD_ABV2_DESKTOP_WALL_SSO_V4`
5. `LR_GOLD_ABV2_DESKTOP_WALL_SSO_OPERATOR_V4`
6. `LR_GOLD_ABV2_DESKTOP_WALL_SSO_ISSUER_V4`

**Additional proxy setting:** `LR_GOLD_ABV2_DESKTOP_WALL_SSO_PROXY_PEERS_V4` is comma-separated **exact trusted peer IPs**, intentionally empty by default. Do not turn it into a wildcard or assume Express `req.secure` proves upstream TLS without identifying the peer. Existing Plugin global JSON limit is 12MiB; conditional ticket request parser limit is 2KiB. The current in-process request limiter is **5/60s per hashed access, 100/60s global, at most 512 tracked hash entries** — needs distributed/production capacity review before large public use.

**Source and test file index:**
- Gold Plugin: `plugin-server/desktop-auth-v4-server.mjs`, `desktop-owner-token-v4.mjs`, `desktop-wall-sso-v4.mjs`, `desktop-wall-sso-native-issue-v4.mjs`, `desktop-wall-sso-native-router-v4.mjs`, `operator-client.mjs`, `server.mjs`.
- Gold Operator: `operator-host/desktop-wall-sso-trusted-authority-v4.mjs`, `desktop-wall-sso-device-proof-v4.mjs`, `desktop-wall-sso-signed-route-v4.mjs`, `desktop-wall-sso-internal-issue-v4.mjs`, `desktop-wall-sso-operator-gate-v4.mjs`, `executor-routes-device-channel.mjs`, `executor.mjs`.
- Gold Device/Wall: `device-agent/desktop-wall-sso-session.mjs`, `device-agent/local-wall.mjs`.
- T04 tests: `plugin-server/desktop-wall-sso-native-router-v4.test.mjs`, `desktop-wall-sso-native-transport-v4.test.mjs`, `desktop-wall-sso-native-issue-v4.test.mjs`, `desktop-wall-sso-v4.test.mjs`, `operator-host/desktop-wall-sso-operator-gate-v4.test.mjs`, `desktop-wall-sso-trusted-authority-v4.test.mjs`, `desktop-wall-sso-signed-route-v4.test.mjs`, `desktop-wall-sso-device-proof-v4.test.mjs`, `device-agent/desktop-wall-sso-session.test.mjs` and `deploy/scripts/selftest-desktop-wall-sso-v4-http.mjs`.
- Full Gold T04 source CI workflow: `.github/workflows/gold-connection-lifecycle-gc.yml`, latest accepted **41671804510** 4/4. Docs Integrity **41671804368** PASS. Gold checkpoint and Desktop counterpart both updated after acceptance.

---

## 7. Other Gold/desktop task board (do not infer completion)

| Track | Current state | Explicit next gate |
|---|---|---|
| GoldABV2 Owner A/B V2 Wall/session control | Historical Lab acceptance; current source preserved | Recheck closed-session stale grant / two-Agent physical regression before any production promotion. |
| Gold R5 Wall layout / typography / stream / panels | Historical UI handoff; source and staged Lab changes | Screenshot acceptance per screen if UI is touched again. |
| Device-local log ring/rotation/Clean Log | Activity Log branch CI + Lab Wall source tests; native packaging not fully accepted | Windows/macOS/Linux installed log history/rotation/Clean acceptance; default disk caps and storage path. |
| Chrome Long Memory v0.3 | Source + CI, opt-in manual DOM capture | Owner-reviewed Windows Chrome Extension → actual GoldABV2 LM save/restore test. |
| Gold old test LM data cleanup | Ambiguous; cannot assume deleted | Read current scopes, secure Owner approval and audit delete DATA only, never feature. |
| Desktop V4 T03 Owner Login | Windows physical Login, Sign out, Welcome, cold vault restore PASS | Prolonged >10m native refresh and independent real backend family revocation proof. |
| Desktop V4 T04 | T04b7b source+CI PASS, default OFF; T04b8 route-only | Real proxy trust + Redis/Enrollment + native signed device relay/Wall session and Windows physical E2E. |
| Desktop V4 T05–T11 | Data panels/integration OPEN | Owner-scoped signed real data, no synthetic statuses/actions; live permission tests per screen. |
| Desktop V4 T12 | Native CI pilot builds have passed previously; full release acceptance OPEN | Installed Windows/macOS/Linux functional and security tests, official release gate. |

---

## 8. NEXT EXECUTION RUNBOOK — T04b8 onward (priority order)

**T04b8-A — inspect actual HTTPS trust boundary, read-only / secret-free:**
1. Verify current Git worktree status, Lab service and feature flags. Document source revision behind each running unit; source HEAD is NOT necessarily deployed.
2. Map Traefik TLS router and LXD proxy as in section 4, then determine **effective Node/Express remote peer** and forwarded TLS metadata with a narrowly scoped Lab-only diagnostic that does not log Owner tokens, cookies, IPs of unrelated clients, full requests or private headers. Do not assume the observed host gateway equals the TCP peer.
3. Check forwarded header sanitization/overwrite at Traefik, trust proxy behavior, alternate backend ingress into `172.30.0.1:15583` and whether the conditional 2KiB Express parser is actually reached before global 12MiB when feature flags are on. If bypass or spoof risk exists, STOP and fix before opening SSO.
4. Record ONLY bounded nonsecret result and exact measured allowlist value in a security review; not in generic production settings by guess. Keep all six flags OFF for passive audit.

**T04b8-B — controlled isolated Lab integration (after A proves safe):**
5. Take and identify an LXD snapshot and scoped DB/Redis/config backup; record rollback commands and readiness check. Keep Gold UAT/prod/ChatGPT MCP unchanged.
6. Stage exact compatible Plugin and Operator sources/Unit overrides without overwriting Owner/Gold runtime historical state. Add a **separate auto-OFF timer** for any test flags, short window, no indefinite authorization. Start with flags OFF, confirm 404/health and no regression to existing A/B.
7. If all gates satisfy, explicitly opt-in only the needed Lab endpoints for narrow testing. Exercise true HTTPS from an authorized native caller, real cross-process Redis Owner/family/token, exact enrolled device binding, GETDEL one-use/replay and family revoke on logout. No secret is printed in logs/CI or handoffs.
8. Prove negative tests: fake peer XFP, direct backend bypass, other account/device, revoked/disabled Owner, Portal logout, wrong audience, expired access, wrong signature/digest/nonce, duplicate ticket, Redis offline and partial flags. Check A/B unchanged and memory/log features unaffected.
9. Verify auto-OFF fired, revert flags, service health 4/4, snapshot/rollback state and no leftover Owner session/tokens. Only after real result and CI mark **LAB LIVE PASS**.

**T04b9 — native/Rust + signed enrolled device relay:**
10. Add Rust-only API to issue short-lived ticket using OS-vault Owner access; WebView may see only a nonsecret status and user confirmation, not native bearer/refresh or ticket history/query. Bind a concrete owned device ID, not a free-form URL.
11. Relay the one-use ticket digest through an enrolled authenticated/signed device channel (Ed25519), avoid double nonce verification, avoid JS owner-bearing URL/query. Ensure no accidental A/B grant.
12. Wall must accept on a secure *actual* Local Wall HTTPS or trustworthy localhost origin on the target machine, use its own HttpOnly SameSite host-scoped cookie with strict CSRF/Origin/Host and **per-request live revocation**. NetBird HTTP on a different device is not equivalent to app local loopback.
13. Test user logout, app restart, revoked family, relinked device, lost network, bad hostname, forged Agent, concurrent duplicate ticket, idle access refresh and read-only diagnostics.

**T04c — final native acceptance:**
14. GitHub Actions **unsigned explicitly LAB-only** Windows owner candidate, source SHA and artifact hash, only after full source gate PASS and limited Lab runtime ready. User tests at most one exact candidate with a defined script.
15. Accept physical Windows Login → consent → native verified → selected device Wall verified → logout/restart/revoke → Wall denied; then remaining macOS/Linux native and release tests. Do not silently ship to production.

**Non-T04 priority:** concurrently or subsequently close T03 sustained token refresh >10m and independent real backend revocation proof. Do not conflate the source contract tests with this physical E2E.

**STOP CONDITIONS:** unknown effective proxy peer, untrusted forwarded header, unprotected backend listener, ambiguous Owner/device ID, Redis/offline fail-open, invalid or unavailable snapshot/rollback, missing independent auto-OFF, unverified native credential isolation, or tool/policy denial. Do not bypass a blocked action; record it and stop the dangerous part.

---

## 9. Safe resume commands and proof checklist

Run only after explicit authorized Light Remote/SSH session to **VPS-ARM**, not unattended, and preserve exact device/session identity.

~~~bash
# GOLD source of truth
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/goldabv2-desktop-owner-lab-20261103
git status -sb
git log -5 --format='%h %as %s'
sed -n '1,95p' docs/project-book/LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md
tail -100 docs/project-book/LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md
node deploy/scripts/check-project-truth-sync.mjs --head

# DESKTOP source of truth, separate branch
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101
git status -sb
git log -5 --format='%h %as %s'
node deploy/scripts/check-project-truth-sync.mjs --head

# Mirror must match once both branches have been updated
cmp -s \
 /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/goldabv2-desktop-owner-lab-20261103/docs/project-book/LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md \
 /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101/docs/project-book/LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md
~~~

Safe Lab read-only inspection: `lxc list light-remote-abv2-lab-20261101`, `lxc exec light-remote-abv2-lab-20261101 -- systemctl is-active ...`, `curl -ksS -o /dev/null -w '%{http_code}' https://goldabv2.light-remote.thaiduy.digital/healthz`. Only inspect feature flags by names and **ON/OFF**, not log credentials or dump entire environment files.

Local focused source tests on Gold without installing all desktop dependencies:
~~~bash
node --test plugin-server/desktop-wall-sso-native-issue-v4.test.mjs \
 plugin-server/desktop-wall-sso-native-router-v4.test.mjs \
 plugin-server/desktop-wall-sso-native-transport-v4.test.mjs \
 operator-host/desktop-wall-sso-operator-gate-v4.test.mjs \
 operator-host/desktop-wall-sso-trusted-authority-v4.test.mjs \
 operator-host/desktop-wall-sso-signed-route-v4.test.mjs \
 operator-host/desktop-wall-sso-device-proof-v4.test.mjs \
 plugin-server/desktop-wall-sso-v4.test.mjs \
 device-agent/desktop-wall-sso-session.test.mjs \
 plugin-server/desktop-owner-token-v4.test.mjs
node deploy/scripts/selftest-desktop-wall-sso-v4-http.mjs
node deploy/scripts/check-project-truth-sync.mjs --staged
git diff --cached --check
~~~

GitHub Actions: check exact new run and job conclusions (do not quote previous 4/4 for a new commit). Native builds only in GitHub Actions. VPS-ARM disk was constrained; never run large Cargo/Windows builds or wipe caches by default.

---

## 10. Mandatory living-handoff update contract — EVERY task from now on

**One task = one durable update to this SAME FILE.** Even if an action is blocked or only partial, record the truthful status before switching tasks/sessions. Do not create a series of competing "LATEST MASTER" documents. To update:

1. Confirm task ID, exact branch and clean/bounded working tree. Read the newest section 14 receipt and this section.
2. Do the work; gather source changes, tests, CI run IDs, Lab runtime and physical Owner acceptance independently.
3. Update **section 0** CURRENT FIRST with new status, keep PASS categories precise; update **section 7** task board and **section 8** next task when material.
4. **Append a NEW dated top-level `## YYYY-MM-DD — Txx...` receipt in section 14**. Never rewrite historical receipts to conceal failures or skipped gates.
5. Update `docs/project-book/LIGHT_REMOTE_WORKLOG.md` with its own new dated `## YYYY-MM-DD` milestone; update `docs/project-book/LIGHT_REMOTE_CODE_MAP.md` on code/security/file changes; update `.light-remote/CURRENT_CHECKPOINT.json` with `status`, `nextAction` and pointer to this master.
6. Stage code + docs together; run `node deploy/scripts/check-project-truth-sync.mjs --stamp` if source changed, then `--staged`, `git diff --cached --check` and targeted tests. **Git must reject new work without a dated update in this Master**, see the Project Truth guard.
7. Commit/push Git branch over authorized VPS-ARM SSH only; validate exact GitHub run. If CI resolves later, make a separate dated **CI receipt** and update this Master, Worklog and checkpoint in a new docs-only commit.
8. Mirror EXACT same updated master bytes into the other worktree/branch. Validate byte-for-byte equality; commit the mirror plus its checkpoint and Worklog. Return ONE canonical GitHub link and status.
9. If a policy/tool blocks edits, do not bypass: record blocker in an authorized location if possible, leave code unshipped, disclose incomplete sync in chat. A tool-call attempt or uncommitted change is not accepted work.

**Every new source commit under Gold/Desktop after this handoff must carry the Master + Worklog + checkpoint in that same commit.** The Project Truth guard has backward compatibility for historical commits that predate the Master file. Documentation-only project/task commits should also append to the Master. Owner may hand off to a fresh session at ANY moment; latest section 0 and section 14 tell it exactly where to resume.

**Required receipt fields:**
- Task ID, local date/time, exact intent and scope.
- Source branch, previous/next HEAD and changed paths.
- User-visible result, source-level work and security boundary.
- TESTS: commands, count, PASS/FAIL, mocks vs real services.
- CI: exact workflow run ID and job outcomes, or PENDING.
- LIVE: running Lab SHA/unit/flags, evidence, or NOT DEPLOYED.
- OWNER E2E: screenshot/artifact and exact build SHA, or NOT TESTED.
- Safety/rollback: no-production statement; feature flags and auto-OFF; blocker if any.
- Remaining gates, **one next task ID**, and handoff mirror sync status.

---

## 11. Persistent constraints and risk register

| Risk or nonnegotiable constraint | Required behavior |
|---|---|
| Gold production and isolated Lab confusion | Use exact LXD name, source/Unit SHA and flags; do not blanket deploy or global rollback. |
| Owner/session/Agent authority conflation | Owner login, Wall session and A/B grants are separate. No silent approval, bypass or privilege escalation. |
| Device local policy | Cloud cannot promote local file roots, Admin, mount or execution rights; requires local Owner action. |
| Port 5491/15591 and secure cookies | A fixed Local Wall URL is not an authenticated same-origin session; HTTPS and local loopback need proof. |
| Unsafe proxy allowance | Pin measured real peer and test forwarded header provenance; missing proof → gate OFF. |
| Redis ticket race and Ed25519 anti-replay | Atomic GETDEL, 45s TTL and exactly-once signature verification. |
| Native bearer/refresh exposure | OS vault only, no WebView, URL query, Wall cookie, logs, DOM, extension or browser storage. |
| Owner logout/transfer/relink | Revalidate live family and enrollment on every protected Wall request; no stale Wall access. |
| Production scale | Current hashed-token 5/60s and 100/60s global limiter is a conservative lab cap, not final scalable policy. |
| Windows build acceptance | GitHub native artifact and exact owner physical screenshot, separate from source CI and Web preview. |
| Long Memory deletion | Delete only the intended old copied DATA with Owner scope; never remove LM feature without request. |
| Server SSD constraint | CI builds; no unbounded artifact/cargo/npm cache on VPS-ARM, no unexplained cleanup. |
| Tool and safety denial | Report exact failed operation; no retry loops to bypass governance, no false completion. |
| Historical handoff drift | THIS canonical living Master takes precedence; log old contradictory evidence as historical, not latest. |

---

## 12. Related documents, CI and commits to retain

**Primary technical references:**
- `docs/project-book/LIGHT_REMOTE_DESKTOP_V4_WALL_SSO_T04_CONTRACT_20261103.md` — immutable SSO protocol, T04a–T04b7b detailed chronology and limits.
- `docs/project-book/LIGHT_REMOTE_DESKTOP_V4_API_MASTER_HANDOFF_20261103.md` (Desktop branch) — historical T00–T03c2c receipts and native Windows QA, updated through T04b8 topology. This is a deep reference, not the next-session starting point.
- `docs/project-book/LIGHT_REMOTE_GOLDABV2_FULL_MASTER_LATEST_20261102.md` (Gold branch) — historical R5, A/B, Gold Lab isolation, log/LM scope and T04 chronology.
- `docs/project-book/LIGHT_REMOTE_CODE_MAP.md` — source locations, especially security/Operator/Device code.
- `docs/project-book/LIGHT_REMOTE_WORKLOG.md` — chronological milestones.
- `.light-remote/CURRENT_CHECKPOINT.json` — machine-readable current task, code-tree source digest, next action and living Master pointer.
- `docs/project-book/LIGHT_REMOTE_GOLDABV2_LM_CHROME_INTEGRATION_V03_20261102.md` (Gold owner-transfer related branch) — LM Chrome v0.3 opt-in.
- `docs/project-book/LIGHT_REMOTE_GOLDABV2_DEVICE_LOCAL_ACTIVITY_LOG_20261102.md` (Activity Log branch) — local-first log budget and clean.
- `client/desktop-v4` Tauri/React source and `.github/workflows` — native build truth.

**Milestone receipts with exact GitHub run IDs:**
- T03c2c10 native Windows Login/Logout candidate: GitHub run **41653557757**, code fix **002ae870**, Owner physical Welcome acceptance.
- T04b4: Gold 8a2d49da, Source Gate **41658255479** 4/4.
- T04b5: Gold 931b86ad, Source Gate **41662764438** 4/4.
- T04b6: Gold fa1f75bf, Source Gate **41665190911** 4/4.
- T04b7a: Gold 0f0a002d, Source Gate **41668319985** 4/4.
- T04b7b: Gold 89b607d0, Source Gate **41671804510** 4/4, Gold Docs **41671804368** PASS.
- T04b8 read-only Lab ingress checkpoint: Gold **6fc8ba61**, Desktop mirror **edc9802f** (before this living-handoff baseline).

**Versioning policy:** add new commits here as dated receipts, do not manually change earlier Git commit IDs, don't extrapolate the latest branch head from these historical SHAs.

---

## 13. Immediate handoff checklist (for Owner or new Agent)

- [ ] Read **section 0** and latest receipt.
- [ ] Verify both worktrees clean, current HEAD and target branch.
- [ ] Verify current Lab auth/SSO flags and relevant service health; don't use stale window.
- [ ] Check previous code vs running unit SHA (not assumed equal).
- [ ] Choose ONE next task; T04b8-A is next unless Owner explicitly redirects.
- [ ] Preserve local-first A/B and Gold/production isolation.
- [ ] Run targeted tests, CI, physical Lab/Windows tests with separate evidence labels.
- [ ] Update THIS MASTER in both branches; Worklog, Code Map and checkpoints.
- [ ] Confirm Project Truth staged/head PASS and mirror checksum equal.
- [ ] Commit/push, report exact links, failures and next action.

---

## 14. APPEND-ONLY TASK RECEIPTS (newest receipt at BOTTOM)

### Receipt template (copy for each task, replace placeholders)

~~~text
## YYYY-MM-DD — Txx: <short task title> [SOURCE|CI|LAB|WINDOWS|BLOCKED]
When/Agent: YYYY-MM-DD hh:mm ICT; authorized VPS-ARM session
Intent:
Git: branch, before HEAD -> after commit SHA, changed files
Implementation:
Security boundaries / flags:
Tests: exact commands; passed/failed counts; simulations vs actual services
CI: workflow run IDs; jobs status (or PENDING)
Live Lab: exact service, unit source SHA, URL/flags/auto-OFF, or NOT DEPLOYED
Owner physical acceptance: build/EXE hash and evidence, or NOT TESTED
Rollback / no-prod / local-first A/B:
Blockers and risks:
Next task:
Master mirror: GOLD/DESKTOP identical? yes/no; both checkpoint commits
~~~

## 2026-11-04 — H00: living Master created and continuity guard established [DOCUMENTATION]

- **Intent:** consolidate latest GoldABV2 and Desktop V4 project state into ONE living handoff; explicitly establish mandatory updates after EVERY task and preserve ability to hand over at any time.
- **Baseline evidence:** Gold source HEAD `6fc8ba61`, Desktop source HEAD `edc9802f` before this documentation task; latest Gold Source Gate T04b7b 41671804510 4/4 PASS; current Lab health 4/4 active, HTTPS 200, Owner Auth/Token/Sso Issuer OFF as of 2026-11-04 08:38 ICT.
- **Work:** new canonical file in Gold and exact mirror in Desktop; both existing historical Master documents and checkpoints point here. Project Truth enforcement requires a newly dated master receipt in future source and project documentation task commits. Git commit SHA/CI for this H00 task must be reported in chat; do not invent SHA inside an uncommitted document.
- **No deployment, migration, native executable or policy change.** Gold UAT/prod, ChatGPT MCP and Agent A/B unchanged.
- **Next task:** **T04b8-A** measure actual Plugin-side proxy peer/HTTPS forwarded metadata safely and audit backend bypass; do not activate SSO until security evidence and rollback/auto-OFF are proven.

## 2026-11-04 — H00-CI: Master Git receipts, negative guard proof, expanded CI coverage [DOCS CI PASS / TRUTH CI PENDING]

- **First canonical Master commits:** Gold `c38e2e540fa66ce634ab5e2902ae628af3a905e8` and Desktop `475de7bf415d66817d8c90d0f79c46f6b1e97560`; identical 42 KB living Master, root AGENTS.md and identical Project Truth verifier logic; worktrees clean after push.
- **First GitHub Docs Integrity:** Gold run **41756711537** SUCCESS, Desktop run **41756716978** SUCCESS. Project Truth `--staged` and `--head` PASS on both branches at first commits. Those documentation CI results do not represent a Gold Source Gate or Windows runtime acceptance.
- **Negative guard test in isolated temporary Git repository, no user repo changes:** docs task without the Master → DENIED; Master edited with NO newly dated `## YYYY-MM-DD` receipt → DENIED; Master + Worklog + checkpoint with a new dated entry → PASS `living-master-docs-coherent`. Existing Project Truth selftests also PASS on both branches (code-only denial, missing Worklog, stale source SHA, security Code Map, atomic source/docs acceptance and history range).
- **Critical CI discovery:** existing `.github/workflows/gold-project-truth-sync.yml` originally triggered only for `feat/gold-connection-gc-reconciler-20261029`; the GoldABV2 and Desktop V4 living branches were not covered. **This H00-CI task extends push/pull_request branch triggers to both current feature branches.** Subsequent pushes must run per-commit `--range BASE HEAD`, including documentation-only tasks, with historical pre-Master commits grandfathered. Full new workflow CI result still PENDING until GitHub completes it.
- **No Lab deployment, SSO flag activation, Owner credential access, A/B grant, production change or native EXE build.** Work remains at T04b8-A: verify real effective Plugin proxy peer, forwarded HTTPS-header trust and direct backend bypass before a bounded Lab SSO gate.

## 2026-11-04 — H00-CI FINAL: per-commit continuity enforcement accepted on BOTH branches [CI PASS]

- **Project Truth GitHub CI Gold:** run **41757247108**, job `source-docs-checkpoint-sync` COMPLETED SUCCESS on commit `4666000b22062d842575468f5a731c05df2d7950`.
- **Project Truth GitHub CI Desktop:** run **41757254955**, job `source-docs-checkpoint-sync` COMPLETED SUCCESS on commit `7bf6175a309206d370185f3591ca1a4d102a8605`.
- **Documentation library CI:** Gold run **41757246951** SUCCESS, Desktop run **41757254998** SUCCESS for those same commits. First handoff Docs CI was also independently PASS (Gold 41756711537, Desktop 41756716978).
- The CI workflow tests the existing Project Truth source/docs checkpoint selftest, then verifies **every pushed commit** via `--range BASE HEAD`, with historical pre-Master commits grandfathered. The gate is enabled for **both current feature branches**, not only historical GC.
- **Isolated negative checks PASS:** missing Master rejected; Master without new dated receipt rejected; Master + Worklog + checkpoint with dated updates accepted. Both actual H00 commits and H00-CI source commits passed `--head` before reporting. The two Master copies remain byte-identical.
- **Task H00 outcome:** living documentation, root AGENTS.md and CI guard **COMPLETE**. This does NOT imply the next T04b8 task or Windows Wall SSO is complete. No production/Lab feature/deployment/Agent A/B changes were performed.
- **Next task:** **T04b8-A** — effective Plugin reverse proxy peer and forwarded HTTPS trust measurement, backend bypass audit, then snapshot/independently timed auto-OFF before any bounded real Redis/Owner/Ed25519 SSO test.

## 2026-11-04 — T04b8-A1: live proxy peer and direct HTTP bypass measured; fail-closed edge attestation added [SOURCE TEST PASS / CI PENDING / NOT DEPLOYED]

- **Intent:** continue T04b8 directly from the living Master. Prove real public HTTPS→Traefik→LXD→Plugin TCP peer and assess whether allowing TCP source plus X-Forwarded-Proto truly proves TLS. Only read-only Lab network probing; NEVER open SSO auth/Token/Issuer flags during this task.
- **Actual live observations on 2026-11-04:** public origin `https://goldabv2.light-remote.thaiduy.digital/healthz` HTTP **200** with TLS **1.3**. Calling the LXD-proxied backend directly from the authorized VPS-ARM on `http://172.30.0.1:15583/healthz`, public Host header, also returned **HTTP 200** without TLS. A TCP-only localhost inspection of the Plugin port `5583` with no credentials, cookies or body logging showed **remote peer `127.0.0.1`**. A second bounded public-TLS probe showed **the same remote peer `127.0.0.1`**. Thus a direct host HTTP request can reach the backend through the LXD proxy with the same peer address as trusted Traefik HTTPS traffic.
- **Security issue identified:** pre-task source `plugin-server/server.mjs` sets Express `trust proxy` to loopback/linklocal/uniquelocal, and T04b7b native issuance accepted an allowlisted peer + `req.secure` + `X-Forwarded-Proto: https`. With the observed LXD topology, **an attacker able to reach backend HTTP could spoof the forwarded scheme and Host**. This does not demonstrate a successful token or SSO exploit (SSO is OFF and Owner bearer still mandatory), but makes the former TLS provenance assumption unsafe.
- **Source hardening (Gold branch only; default OFF):** in `plugin-server/desktop-wall-sso-native-issue-v4.mjs`, trusted *HTTP proxy hops* now require an additional **256-bit random private edge proof** as header `X-Light-Remote-Edge-Proof-V4`, checked as a strict 64-character lowercase hex string with `crypto.timingSafeEqual`, alongside exact peer, Host and HTTPS-forwarded checks. If `proxyPeers` is nonempty without a correctly sized secret, the issuer refuses initialization **fail closed**. Direct encrypted Node TLS sockets can still pass their separate existing path. `plugin-server/desktop-wall-sso-native-router-v4.mjs` passes the trusted server-only proof through; `plugin-server/server.mjs` reads `LR_GOLD_ABV2_DESKTOP_WALL_SSO_EDGE_PROOF_V4` only from the server environment. It is not logged, supplied from caller JSON or returned to a browser. No real proof secret has been created or placed into running Lab config.
- **Scope/test:** added negative tests for direct localhost HTTP + forged HTTPS/Host without proof, incorrect or malformed proof, wrong peer with correct proof, incomplete server configuration refusing route registration and actual Node HTTP→Unix-socket denial before Operator contact. Existing legitimate mocked TLS and trusted proxy paths continue PASS. Selected T04 Node security suite **129/129 PASS**, existing isolated Wall revocation HTTP loopback regression PASS, JS syntax check and `git diff --check` PASS. Gold Source Gate CI PENDING at this checkpoint.
- **Crucial remaining production risk:** a STATIC proof header transported over plaintext Traefik→LXD may be observed/replayed by a sufficiently privileged local network/host attacker. This proof is a **minimum source defense**, NOT a substitute for private transport, backend ingress isolation, mTLS or Unix-socket protection. Never treat this as production-ready. The Traefik TLS-only router has **no proof-injection middleware configured yet**; actual header overwrite and source trust over the running chain remain UNVERIFIED. Correct fix before enabling is to isolate/private-protect the backend and use a trusted TLS-only proxy injection or a cryptographically protected backend transport, then validate direct-spoof rejection on Lab.
- **Live state:** No services restarted; no new source deployed; GoldABV2 Lab Owner Auth/Token/SSO issuer six flags remain OFF at baseline. Gold main UAT/production, custom MCP, A/B Agent grants, Desktop native EXE and other device policies unaffected. Do not ask Owner to test Windows yet.
- **Next task — T04b8-A2:** harden Traefik→LXD trust domain (prefer restricted transport/mTLS or private socket), verify actual TLS-only middleware overwrites untrusted proof and forwarded fields, prove direct backend cannot forge SSO provenance, then snapshot+auto-OFF for bounded real Redis/Owner/enrollment Lab E2E. New private random proof must never be pasted in docs/chats.
- **Master mirror:** this exact receipt and CURRENT FIRST update are present byte-for-byte on Gold canonical and Desktop mirror. Gold source and Docs/Worklog/Code Map/checkpoint staged together; Desktop docs/checkpoint staged in mirror. Final GitHub SHA and CI should be recorded by a **separate dated T04b8-A1 CI receipt** after both commits.

## 2026-11-04 — T04b8-A1 CI acceptance and T04b8-A2 ingress preflight [CI PASS / LAB RUNTIME OFF]

- **Gold source security fix accepted:** `0ecffcfbaeb29d944288546c53a5817d863ff08d`, new mandatory 256-bit private proxy edge-proof for native SSO over any HTTP hop, strict constant-time comparison and fail-closed missing secret; six independent issuer enable flags remain OFF by default. **Gold Source Gate run `41760470702` 4/4 SUCCESS**, including source-gate, Windows Agent epoch, PostgreSQL 1,000 and 10,000 device races. Gold Project Truth run **41760470707 PASS**, Gold Documentation Integrity **41760470763 PASS**.
- **Desktop mirror receipt:** `ddb91dd7f1049d1d059d5842a785c9b2801feabb`; Desktop Project Truth run **41760476365 PASS**, Desktop Documentation Integrity run **41760476336 PASS**. Desktop code/binaries were not rebuilt or changed. The Master remains byte-identical between Gold canonical and Desktop mirror.
- **Tests:** selected T04 Node **129/129 PASS**, actual ephemeral Node HTTP + Unix socket negative direct-backend forgery tests PASS, Wall HTTP per-request Owner-family revocation loopback regression PASS. No physical TLS→LXD/Express edge-proof integration has run. A CI success is not a Lab or Windows SSO acceptance.
- **Live topology detail for T04b8-A2:** real public Traefik container `netbird-traefik` is on Docker network `netbird_netbird`, container IPv4 **172.30.0.10**; Docker bridge gateway **172.30.0.1/24** hosts the LXD proxy listener **172.30.0.1:15583**. Direct HTTP to that listener from the authorized VPS host returns health200, while public `https://goldabv2.light-remote.thaiduy.digital` uses TLS1.3; BOTH reach Plugin with TCP peer `127.0.0.1`. This is a **host/Docker trust-domain bypass of the TLS terminator**, NOT evidence it is exposed to the public internet. Under current flags SSO is OFF.
- **Read-only Lab refresh at 2026-11-04 02:26:04 UTC / 09:26:04 ICT:** GoldABV2 Lab four services ACTIVE, HTTPS health200, effective config count for Owner Auth/Token/SSO Issuer ON = **0**. No secret, cookies, native bearer or unrelated user headers observed; no configuration or service restart.
- **Next security gate remains T04b8-A2:** restrict/protect Traefik→LXD backend (mTLS/private socket or an equally strong isolated hop) and confirm **TLS-only** Traefik middleware overwrites any caller `X-Light-Remote-Edge-Proof-V4`, `X-Forwarded-Proto` and host metadata. Traefik documentation for `headers.customRequestHeaders` shows request overwrite behavior: https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/headers/ . No static proof or production secrets are to be pasted in docs. Test direct backend spoof denial using no Owner tokens and make sure the proof is not replayable across a plaintext local network before any flags are enabled. Snapshot, short expiry auto-OFF, explicit Lab-only Owner consent and rollback come before live issuance.
- **No production/Lab deployment of this source, no authorized Windows Desktop App→Wall signed SSO test yet.** Gold UAT, prod, custom MCP, Agent A/B and device-local policy unaffected.
