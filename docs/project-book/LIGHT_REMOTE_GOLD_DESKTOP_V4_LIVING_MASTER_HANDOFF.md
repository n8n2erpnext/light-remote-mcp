# LIGHT REMOTE — GOLDABV2 × DESKTOP V4
# LIVING MASTER HANDOFF — CANONICAL CONTINUITY

**Document status:** ACTIVE / MUST UPDATE AFTER EVERY TASK, including partial work and blocked work.
**Created:** 2026-11-04, Asia/Ho_Chi_Minh (ICT, UTC+07).
**Project:** Light Remote GoldABV2, Desktop V4 Native Owner Authentication, and T04 Desktop → Local Wall single sign-on.
**Next active task:** **T04b8-A2 — REAL isolated Traefik:v3.6 file-provider client certificate hot reload PASS; offline mTLS certificate release gate source/test PASS (2026-11-04 ~21:00 ICT).** Live loopback sidecar same PID: OLD client to overlap backend HTTP200, OLD client to NEXT-only backend HTTP403, update dynamic serversTransport to NEXT cert without Traefik restart HTTP200, restore OLD/overlap HTTP200. Independent host cleanup timer armed then stopped; sidecar, both LXD proxies, firewall, private test CA/client/server keys all cleaned; original public Traefik HTTP :15583 and 4/4 Lab services/public HTTPS200 unchanged. New source certificate gate 11/11 PASS for validity, CA/EKU/SAN, matching keys, permissions and exact two SHA256 pins; integrated into Gold CI, but not a live issuer or scheduled renewer. NEXT: offline CA custody, CSR/issuance and renewal/revocation lifecycle, guarded permanent Lab mTLS route, then real signed Owner Desktop→Wall E2E. Owner/Token/SSO OFF, UAT/prod and SQL unchanged.
**Safety state:** **SSO OFF / LIVE CUTOVER ROLLED BACK**; isolated Gold Lab Plugin and Operator restored to source 9d996956, 4/4 units active and public HTTPS200 after rollback. Gold main UAT/production untouched.
**Latest source-only safety audit:** 2026-11-04 prepared Lab043 scanner verified 222 JS files, 18 external literal references and 309 relative literal references, all resolvable; exactly one computed updater lifeboat import is explicitly inventoried but NOT runtime-resolved. Negative fixtures PASS. GitHub Gold Source Gate 41821402194 SUCCESS 4/4 at source commit 852091a1; canonical Git42 preflight and isolated Lab runtime release remain HOLD.
**Latest LAB043 pre-cutover review (2026-11-04 ~18:36 ICT):** Prepared isolated Lab stage Node syntax 222/222 PASS; Linux/macOS updater lifeboat targets exist and pass syntax (NOT runtime imported). Literal external 18/18 and relative 309/309 imports resolved. Canonical Git042 versus Lab PG043 preflight BLOCKED exit3; rollback readiness BLOCKED exit3 (snapshot age and autooff timer); root ~30GiB free, pool ~8.2GiB free, existing backup SHA256 and rollback --check PASS. No release approval or live source switch; SSO OFF.
**Latest conditional trial receipt:** 2026-11-04 19:00 ICT snapshot pre-t04b8-a2-owner-approved-20261104-1900 created (six historical snapshots total); independent auto-off timer unit INSTALL DENIED by read-only host / mount. Rollback readiness BLOCKED exit3 solely on missing timer load/active/schedule/target, while fresh snapshot, backup SHA256, scripted rollback --check and storage PASS. Original Lab Plugin/Operator unchanged; NOT CUTOVER. Timer drafts were removed. Host is systemd degraded due two unrelated landscape-outbox snap units; no proven cause for mount read-only.
**Verified LXD-only live trial (2026-11-04 19:25 ICT):** Lab staging source b8ec5d6f successfully started BOTH Plugin/Operator via scoped systemd drop-ins; real PostgreSQL43 startup gate passed with correct staged lock043, 4/4 active, public HTTPS200, account login200, Desktop authorize404 (OFF), /mcp GET405, Lab Wall /login200 /approve303. Scoped 18m systemd auto-off was armed INSIDE LXD, verified, then triggered manually and SUCCESS; old 9d996956 source restored, short post-restart HTTPS502 resolved to HTTP200, timer disarmed. No SQL, SSO, Gold UAT or production change. Prior host / read-only diagnosis does not block LXD operations.
**Latest ACTUAL T04b8-A2 mTLS acceptance (19:50 ICT):** New real Plugin source b8ec5d6f on 127.0.0.1:5584 accepted pinned TLS1.3 client200, rejected valid unpinned403 and absent client at handshake. Host LXD proxy 15584 returned pinned200/TLS0. Isolated Traefik:v3.6 on host loopback19444 -> LXD proxy -> REAL Express Plugin returned200/TLS0 after correcting a test-only Host/SNI router mistake. Separate scoped Lab timer and live manual rollback SUCCESS, no temp cert/proxy/sidecar/firewall residue, old source/HTTPS200 healthy. Owner Auth/Token/SSO OFF; no public router cutover or real signed SSO E2E.
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
| T04b8 ingress route | **ISOLATED REAL TRAEFIK/LXD/PLUGIN MTLS PASS; PUBLIC TRAEFIK ROUTER NOT CHANGED; SSO OFF** | 2026-11-04 19:50 ICT: pinned client TLS1.3, actual Host LXD proxy and isolated Traefik sidecar HTTP200 verified; missing/unpinned cert DENY, rollback PASS and old source restored. Plaintext backend 15583 remains available; real Owner/Redis/Ed25519/Windows E2E and public route switch are OPEN. |
| Lab runtime | **4/4 active, public HTTPS health 200 AFTER SOURCE ROLLBACK** | Reverified on **2026-11-04 ~11:27 ICT**; old source 9d996956 for Plugin and Operator, TLS verification0, no mTLS listener. Source cutover temporarily produced 502 and was explicitly rolled back. |
| Lab Desktop Owner Auth, Token and SSO Issuer | **OFF (observed in target service configuration)** | Owner Auth ON count 0; Token ON count 0; Issuer ON count 0; authorize URL 404. |
| T04b8 actual Plugin/Operator rollout | **ISOLATED LAB LIVE CUTOVER + ROLLBACK PASS / OWNER SSO OFF** | 2026-11-04 direct LXD b8ec5d6f Plugin+Operator actual PIDs, PG43 staged source native startup gate PASS, four units/HTTPS200. Guard timer INSIDE LXD, scoped rollback service SUCCESS, baseline 9d996956 restored, HTTPS200 (initial transient502), timer disarmed. Earlier failed initial attempt from source42 and canonical production lock42 remain historical / UAT release HOLD. |
| Verified Lab 043 ledger and source drift | **DB READ-ONLY PASS / CANONICAL LOCK RELEASE HOLD** | Actual Postgres COUNT43, versions 001–043; Short ID table and immutable trigger present; running old source has locally pinned 043 with matching SQL SHA; new Git archive has only 001–042. No 043 release approval found; no DB or runtime changes made. |
| Lab pre-restart cutover preflight | **SOURCE PASS / ACTUAL LAB NEGATIVE PASS / GITHUB SOURCE GATE 4/4 PASS** | READ-ONLY script compares PG ledger, Git+staged lock and SQL SHA256, resolves Node express/pg. Both old and new source BLOCK as expected, exit3, without restart. No apply, no cutover approval. |
| Lab043/045 original historical provenance | **EXPERIMENTAL LAB ONLY / CANONICAL RELEASE HOLD** | Original 2026-11-01 handoffs explicitly record manual Lab-only 043+local lock and Owner045 sidecar, while main Gold UAT stayed 042. Actual applied_at for 043 is 2026-11-01 15:25:05.798104 UTC; relational 043 contract matches SQL. |
| Gold main UAT/production and custom ChatGPT MCP | **NOT CHANGED BY THIS LAB CUTOVER ATTEMPT** | Isolated GoldABV2 Lab Plugin/Operator WERE briefly restarted and restored; no changes to main UAT/prod, public Traefik, Agent A/B, database migrations or desktop native binaries. |
| Native Windows Desktop V4 candidate for T04 | **NOT AVAILABLE** | Most recent physically accepted candidate was for Owner Login/Logout, not signed Wall SSO. |
| Agent A/B approval authority | **INDEPENDENT / MUST NOT CHANGE** | Owner web login, native login or SSO must never grant Agent command permission. |
| Living Master governance | **ACTIVE — latest Gold source CI 4/4 PASS, both branches pushed, Docs/Truth CI PASS** | Gold source 41821402194, Docs 41821402207, Truth 41821401904; Desktop Docs 41821409755 and Truth 41821409778 all SUCCESS on published heads 852091a1 / 153330b3. These are source/docs checks ONLY; Lab source cutover stays BLOCKED. |

**What the next Agent should do FIRST:** The actual isolated real Plugin TLS1.3 pinned-client mTLS and loopback Traefik->LXD proxy->Plugin transport test NOW PASSED. The prior temporary probe 403/404 came from incorrect generated Host/SNI rule; test harness fixed and final actual HTTP200 verified. Old 9d996956 source restored, all temporary resources and timer removed. The next separately guarded Lab-only gate is to switch public Traefik BACKEND to mTLS and retire/deny its old plaintext LXD proxy :15583, without breaking /mcp or Owner web login. Keep Owner/Token/SSO flags OFF, maintain independent A/B authority, do not conflate this transport with signed Desktop->Wall E2E or canonical Git42 schema release.

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


**T04b8-A2 SOURCE implementation status (2026-11-04):** an opt-in Plugin HTTPS server is now available behind `LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_EDGE_V4=1` with fixed `127.0.0.1` bind, TLS1.3-only mutual authentication, independently private client CA and **exact SHA-256 client leaf certificate pinning**. The SSO route MUST use the mTLS-only listener with `LR_GOLD_ABV2_DESKTOP_WALL_SSO_PROXY_PEERS_V4` EMPTY so unencrypted backend cannot issue tickets. This code is only SOURCE+local tests; live LXD 15583 plaintext bypass remains. Do NOT turn ON even the mTLS listener until snapshot and rollback are ready. Traefik configuration, certificates, LXD proxy, systemd, Owner/Token/SSO flags and native desktop remain untouched.

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

## 2026-11-04 — T04b8-A2-SOURCE: dedicated loopback TLS 1.3 mTLS Plugin listener with pinned client [SOURCE TEST PASS / CI PENDING / NOT DEPLOYED]

- **Starting evidence:** Gold HEAD `6dde884a` included A1 Gold Source Gate 41760470702 (4/4 PASS), Gold Project Truth 41760470707 PASS and Docs 41760470763 PASS; Desktop mirror HEAD `80eadbc8` included Desktop Project Truth 41760476365 and Docs 41760476336 PASS. Both worktrees were clean before A2 edits.
- **Files/source:** `plugin-server/desktop-wall-sso-mtls-edge-v4.mjs` creates an exact feature-gated HTTPS listener at loopback only, TLS v1.3 mutual certificate authentication with private CA and exact pinned Traefik client certificate SHA-256 (timing-safe digest comparison), refuse missing/malformed cert paths, unsafe port, mixed plaintext `PROXY_PEERS`. `plugin-server/server.mjs` registers it without changing primary HTTP listener, and closes it on normal shutdown. No certificate material, Bearer token or key is committed/logged.
- **Security:** this is an alternative to the A1 static edge-proof header over HTTP. A successful Lab cutover must use mTLS-only with empty HTTP proxy peer allowlist, move Traefik backend to TLS, and **remove/disable legacy host LXD plaintext :15583**. The current Lab still has this plaintext bypass and must not enable SSO. Operator/Owner/Agent A/B code unchanged.
- **TESTS:** `plugin-server/desktop-wall-sso-mtls-edge-v4.test.mjs` uses ephemeral OpenSSL test CA and distinct client certificates, actual Node TLS1.3 connection: valid pinned client PASS, missing client handshake DENY, valid-but-unpinned client HTTP403, serverAuth-only certificate DENY, no listener by default and configuration fail-closed. 3/3 new tests PASS; combined selected T04 security suite **132/132 PASS**, JS syntax and git diff check PASS. Source-gate workflow changed to invoke the new tests. This is NOT a true Traefik/LXD/Express/Redis integration test.
- **CI:** new Gold source/Project Truth/Docs and Desktop mirror CI PENDING at this task receipt. Record exact new run IDs in a subsequent CI receipt; do not reuse A1 runs as A2 PASS.
- **LIVE/Windows:** NOT DEPLOYED. No Lab service restart, no LXD device changes, no Traefik modifications, no certificate provisioning, no SSO runtime, no Agent A/B grant, no Windows EXE. Gold UAT/production and the ChatGPT MCP are unchanged.
- **Next task T04b8-A2-LAB:** create and record Lab snapshot, scoped backup and independent timed auto-OFF *before* any flag/route modification; provision private CA/server/client identities outside Git; validate Traefik 3.6.13 mTLS upstream configuration and exact client leaf pin; add new isolated LXD loopback TLS proxy; verify TLS paths and direct HTTP denied, then remove old plaintext bridge. Verify public HTTPS health and A/B stability, rollback on mismatch. Only afterward T04b8-B bounded Redis/Owner live SSO testing; no physical Windows request yet.
- **Living Master:** Gold canonical + Desktop byte-identical mirror; Worklog, Code Map and both checkpoints updated in the same task. Git commit SHA and CI to be recorded after push.

## 2026-11-04 — T04b8-A2-SOURCE CI acceptance: mTLS source gates accepted, Lab still OFF [CI PASS / RUNTIME NOT DEPLOYED]

- **Gold source HEAD** `a74cba5d8939108d6ab81ae1e0a51f0c50126349`: Source Gate GitHub Actions run **41761822548 COMPLETED SUCCESS, 4/4 jobs PASS**, including source-gate, Windows Agent epoch contract, PostgreSQL 1,000-device and 10,000-device tests. Gold Project Truth **41761822698 PASS**, Gold Documentation Integrity **41761822657 PASS**.
- **Desktop mirror HEAD** `70d233719b87d68d92fc4b7b6d0eea7e5147694d`: Project Truth **41761828404 PASS**, Documentation Integrity **41761828526 PASS**; Desktop code and Windows native EXE unchanged.
- **Local evidence:** 3/3 actual temporary TLS1.3 CA/client-cert/pinning tests PASS and selected T04 **132/132** tests PASS. SSO is default OFF and no Lab TLS listener or signed App→Wall flow deployed. Source/CI is not Lab or physical Windows E2E acceptance.
- **Live check at task source commit:** GoldABV2 Lab four services active, public HTTPS health200 with certificate verification0, mTLS listener port5584 absent. The original LXD plaintext backend port15583 was still present. No credentials accessed, no Agent permissions changed, no Gold UAT/production change.
- **Next T04b8-A2-LAB:** obtain isolated Lab snapshot and backup, out-of-band independent auto-OFF, provision private CA/certs and Traefik client leaf pin outside Git, stage mTLS-only route via new LXD proxy, shut/deny old direct HTTP bridge and validate negative spoof tests before any Owner/Token/Issuer flags. Rollback on uncertain trust boundary. Do not ask Owner to test Windows until actual signed device-to-Wall E2E is available.

## 2026-11-04 — T04b8-A2-LAB0 safety preparation: snapshot, scoped backup, independent auto-OFF; LXD staging blocked [LAB PREP PASS / STAGING BLOCKED / SSO OFF]

- **Scope:** the next task after T04b8-A2-SOURCE CI 4/4 PASS was isolated Traefik3.6.13 → LXD → mTLS Plugin transport proof. Kept existing public router and four Lab services unchanged. This was an isolated probe preparation, not activation of Owner/Redis/SSO.
- **Read-only preflight (2026-11-04 09:42 ICT):** Gold source HEAD e3bf8273; Desktop mirror 75954762; both clean, byte-identical Living Master; Lab 4/4 services active and HTTPS health200 (TLS verification0); old LXD proxy tcp:172.30.0.1:15583→127.0.0.1:5583 present, new mTLS port5584 absent.
- **Snapshot:** live LXD filesystem snapshot `light-remote-abv2-lab-20261101/pre-t04b8-a2-20261104` successfully created and listed at 09:45 ICT. Snapshot is stateless and has no automatic expiry; storage was ~33.12/40GiB Btrfs used before snapshot, VPS / ~16GiB available. Do NOT blindly restore over concurrent state; take scoped diff and preserve current service data before any rollback.
- **Scoped host backup:** `/home/ubuntu/handoffs/T04B8_A2_LAB_20261104/backup` mode700 parent, includes original Traefik dynamic YAML, LXD device map, Plugin systemd unit/drop-ins TAR and SHA256SUMS. No PG/Redis application data backup was made; none was changed. A full auth-backed Lab activation would still require an independently scoped PG/Redis/config recovery plan.
- **Independent auto-OFF:** root systemd transient timer `lr-t04b8-a2-lab-autooff-20261104.timer` observed active with trigger 2026-11-04 **10:06:11 ICT**. Script `/home/ubuntu/handoffs/T04B8_A2_LAB_20261104/autooff-rollback.sh` removes only specifically named isolated Docker probe, LXD probe proxy, transient Lab probe and test certificate directory; does not touch production/public Traefik, original :15583 HTTP or A/B. Auto-OFF trigger was not yet observed at receipt time, so do NOT report cleanup as PASS.
- **Certificate handling:** temporary 1-day test CA, server/client and second unpinned client certificates were generated into private host `probe-private` for planned isolated transport testing, with private keys not printed to stdout/chat nor committed. They were **not staged into LXD or Docker**. Timer is scheduled to delete the temporary directory if not cleaned earlier. No production certificates touched.
- **BLOCKER:** one attempt to stage the module and test certs into the isolated LXD via `lxc file push` and start a transient probe service was rejected by OpenAI remote-tool safety before execution. Do NOT retry with alternative commands, tools, identities or privilege paths to evade the denial. No LXD mTLS module, unit, listener or Docker sidecar was installed.
- **Post-block read-only proof (09:48:20 ICT):** auto-OFF timer still active, Lab port5584 has **no listener**, LXD `abv2-sso-mtls-probe` device **absent**, Gold worktree still clean. No new public Traefik router, no SSO flags enabled, no Agent grants changed. This is **LAB PREP**, not LAB LIVE PASS or SSO E2E.
- **Next T04b8-A2-LAB-STAGE:** verify the independent auto-OFF actually ran or revoke/clean private test certs through authorized safe means; then use a permitted owner-authorized runtime staging mechanism to test a **separate** mTLS LXD/Docker route, keep main public router untouched, prove spoof and client-cert denial. Before later actual rollout, require new snapshot+backup+auto-OFF, middleware/source trust audit and old HTTP SSO bypass denial. Gold UAT/prod and Windows native acceptance remain untouched.
- **CI:** docs-only receipt CI PENDING; prior T04b8-A2 source Gold 41761822548 4/4, Project Truth 41761822698 and Docs 41761822657, Desktop Project Truth 41761828404 + Docs 41761828526 all PASS. Local source 132/132 PASS unchanged.

## 2026-11-04 — T04b8-A2-LAB1 isolated Traefik→pinned mTLS→LXD PASS and verified cleanup [LAB TRANSPORT PROBE PASS / REAL SSO OFF]

- **Resume/permission:** after earlier remote-tool safety denial, owner explicitly requested a new attempt via the connected official Light Remote plugin on VPS-ARM. On 2026-11-04 the same exact isolated LXD file-stage/systemd-run probe request was accepted and completed; no alternative identity, unauthorized device, or policy bypass used.
- **Lab-only setup:** starting snapshot `light-remote-abv2-lab-20261101/pre-t04b8-a2-20261104`, scoped copies of Traefik YAML/LXD device and Plugin systemd unit, and independent root auto-OFF timer existed before probe. Installed ONLY standalone `/run/light-remote-t04b8-a2-mtls-probe` files and transient `light-remote-t04b8-a2-mtls-probe.service`; new Plugin mTLS module was not installed into the real Gold Plugin process. New loopback listener `127.0.0.1:5584`; new isolated LXD bridge `172.30.0.1:15584 → 127.0.0.1:5584`. No actual Owner/Operator token or Agent A/B route invoked.
- **Direct mTLS real network evidence:** host curl through LXD proxy with ephemeral CA and correct exact-pinned leaf returned HTTP **200**, TLS verification **0**; other CA-valid but UNPINNED client returned HTTP **403**; NO client certificate caused TLS connection failure (curl exit56, HTTP000). These test certificates are ephemeral and were never committed or copied into production.
- **Independent Traefik test:** launched a separate Traefik 3.6.13 sidecar `light-remote-t04b8-a2-traefik-probe` on `netbird_netbird`, with inbound HTTPS bound on host **127.0.0.1:19444** only; file-provider watch disabled to work with read-only bind mounts, and process ran unprivileged UID1001 with dropped capabilities and no-new-privileges. The public Traefik container/router/config was NOT changed.
- **Firewall observation:** the host firewall correctly only permitted production Traefik source IP **172.30.0.10** to old **15583**; isolated sidecar IP **172.30.0.13** to **15584** initially yielded 502 with `no route to host`. After backing up host iptables rules, a single short-lived exact `INPUT` allow rule `172.30.0.13 → 172.30.0.1:15584` on Docker bridge `br-2b4f73f607d5`, comment `lr-t04b8-a2-mtls-probe`, was inserted and its deletion added to the independent auto-OFF script. No general accept rule or other production firewall change was made.
- **End-to-end probe evidence:** HTTPS curl to the isolated Traefik hostname with CA verification returned **HTTP200**, verify0; Traefik connected upstream with client mTLS cert to LXD service. A targeted malicious request supplied `X-Forwarded-Proto:http`, foreign `X-Forwarded-Host`, and forged `X-Light-Remote-Edge-Proof-V4`. The isolated backend returned `protoIsHttps:true`, `forwardedHostIsExpected:true`, `edgeProofStripped:true`. This is valid evidence for the **isolated probe**, not proof that the real Gold Plugin’s SSO route or native Windows Wall flow has passed.
- **Verified cleanup (2026-11-04 10:02:59 ICT):** ran the exact scoped auto-OFF rollback script once: temporary IP-specific firewall allow-rule REMOVED, Docker probe REMOVED, LXD proxy REMOVED, transient Lab service STOPPED, /run probe directory removed, ephemeral private CA/server/client material REMOVED. Checked each cleanup result; independent auto-OFF timer then explicitly STOPPED (inactive) to avoid later execution of a user-owned script. Snapshot and scoped config backup remain available.
- **Post-cleanup live regression:** four Lab units Plugin/Operator/Wall/Supervisor **active**, public `https://goldabv2.light-remote.thaiduy.digital/healthz` HTTP **200** with valid TLS, only legacy plaintext `172.30.0.1:15583` remains listening; public SSO ticket route POST {} with no bearer HTTP **404**. No real mTLS listener is deployed, no credential material retained, no SSO flags enabled, no Gold UAT/production or native Desktop EXE touched.
- **Next T04b8-A2-REAL-LAB-CUTOVER:** only after fresh snapshot and scoped recovery plan, independent bounded auto-OFF and private certificates, stage the actual vetted Gold source into Lab (Plugin and Operator with six flags OFF), configure a TLS-only Traefik backend and exact client certificate pin, keep local Wall/Agent A/B service working, and replace/deny legacy plaintext HTTP access for SSO. Run actual Express/Owner/Redis/Operator/Ed25519 signed test and verify rollback before any real Owner SSO activation; full native Windows Desktop→Wall E2E remains open.
- **Repository/CI:** no source-code changed in this LAB1 receipt; append to canonical Gold Master and byte-identical Desktop mirror, both Worklogs/checkpoints, Gold Code Map; Project Truth and docs CI pending for this documentation-only commit.

## 2026-11-04 — T04b8-A2-REAL-LAB source cutover attempted, startup blockers found, scoped rollback PASS [LAB BLOCKED / SSO OFF]

- Time/target: 2026-11-04 ~11:21-11:28 ICT; officially A/B-authorized Light Remote on VPS-ARM, exact isolated LXD light-remote-abv2-lab-20261101. Git Gold b8ec5d6f and Desktop d59ea74f were both clean/origin-synced before this work.
- Source staged safely: git archive of Gold b8ec5d6f, 19,322,880 bytes, installed only into /opt/light-remote-abv2-lab/source-b8ec5d6f-t04b8-a2-MTLS-STAGED. Parser checks for Plugin server.mjs, mTLS module and Operator gate PASS; SHA-256 of staged mTLS module matches source f4b6e76bb9c774d7331620724dd8708a043c7e016d770e8285de8fa24ed45815. No live service was changed by this file-stage operation.
- Rollback prerequisites: existing LXD pre-t04b8-a2real-20261104 snapshot (taken 10:11 ICT), scoped backup directory T04B8_A2_REAL_LAB_20261104/backup with three SHA256-verified items, and separate root rollback script source-cutover-rollback.sh. Script syntax and --check PASS. Independent systemd auto-OFF was ARMED with due time 11:33:22 ICT BEFORE source switch. Source override dropins scoped exclusively to two GoldABV2 Lab units, not public router/Traefik/DB/Agent A/B.
- ATTEMPT/FAIL: temporary high-precedence systemd dropins changed ExecStart and WorkingDirectory of only Lab Plugin/Operator to staged b8ec5d6f. Immediate public HTTPS health was 502, even though systemd initially indicated active. New Plugin logs showed ERR_MODULE_NOT_FOUND for express; new Operator repeatedly exited with exact guard error gold_pg_candidate_43_not_locked. A momentary active systemd status is not a readiness gate; no live SSO was enabled.
- ROLLBACK: called the pre-created scoped source-cutover-rollback.sh, deleting only those two dropins and restarting Lab Operator/Plugin on old immutable source 9d996956. First immediate post-restart HTTPS remained 502 during startup; subsequent checks confirmed public HTTPS health200 with valid TLS verification0, direct host LXD HTTP backend200 and all four Lab services active. Explicitly verified both dropins ABSENT, effective ExecStart for both units back to source-9d996956, port5583 listening, NO mTLS port5584. Unused independent rollback timer STOPPED and observed inactive. Existing :15583 plaintext host proxy remains and SSO remains OFF. Gold main UAT/production, public Traefik, account tokens/Agent A/B, PG/Redis data and Windows EXE unchanged.
- ROOT CAUSE #1 / fixed STAGING ONLY: existing running Plugin finds express in per-service plugin-server/node_modules linked to /opt/light-remote-gold-uat/plugin-server/node_modules; the initial staged archive contained only a root node_modules link pointing to /opt/light-remote-gold-uat/node_modules (no express). Added per-service node_modules symlink INSIDE THE STAGED PLUGIN TREE; confirmed Node module resolution now finds express. Operator pg resolves from shared root node_modules. No package installations or repo source changes.
- ROOT CAUSE #2 / DO NOT BYPASS: newer Gold source lib/gold-schema-startup-gate.mjs requires an independently approved, pinned checksum for migration 043. Actual operator startup emitted gold_pg_candidate_43_not_locked. Source platform-v2/sql/migrations.lock.json latest locked version is 042, version 043 absent; source comment explicitly says migrations 043/044 HOLD. Exact current live Lab migration version remains to be read back through authorized read-only database evidence; failure establishes at least the 043 gate was reached. Never bypass intentional release gate by editing lock or setting release approval solely for rollout.
- Post-fix isolated STAGING tests: native/Operator negative issuer tests 29/29 PASS; additional schema gate + mTLS + Operator tests 16/16 PASS. These tests are not successful live Plugin/Operator or Windows App→Wall E2E. Source repository worktrees unchanged during diagnosis; docs/checkpoint are the only planned Git edits in this task.
- NEXT SINGLE TASK T04b8-A2-REAL-LAB-SCHEMA-GATE: verify live schema ledger in a scoped read-only query, perform independent 043 release/security review and checksum-locked migration gate only if explicitly approved, preflight actual staged package imports before touching systemd, then obtain a NEW rollback timer and verify readiness over a bounded period. Do not enable mTLS/SSO or retire plaintext :15583 until Plugin AND Operator new source are stable with Owner/Redis/device authority tested. Physical Desktop V4 SSO acceptance NOT TESTED; no native build.
- CI: docs/checkpoint Project Truth and GitHub Documentation Integrity pending new commit; prior Gold Source Gate 41761822548 4/4 PASS does NOT imply this failed runtime cutover was accepted.

## 2026-11-04 — T04b8-A2-REAL-LAB failed-cutover checkpoint accepted by GitHub Docs + Project Truth CI [DOCS CI PASS / LAB ROLLED BACK]

- Original Gold checkpoint commit 898ea60758dc2b1ca7c5657a79ab5f5eee51f689: GitHub Gold documentation library integrity run 41774007357 SUCCESS; Gold Project Truth source/docs checkpoint run 41774007472 SUCCESS.
- Original Desktop mirror checkpoint commit 134e8a705fed74f2f1ce7fb2dbef2b2f9f1de921: GitHub documentation library integrity run 41774013294 SUCCESS; Project Truth run 41774013319 SUCCESS.
- Both branch worktrees clean/origin-synced and Living Master byte-identical after the first checkpoint push. No source changes and no native EXE build in this CI receipt. Success here is DOCUMENTATION / CONTINUITY acceptance only; real Lab b8ec5d6f Plugin+Operator runtime cutover FAILED and was ROLLED BACK to 9d996956.
- Last live Lab check on 2026-11-04 ~11:35 ICT: four units active, public HTTPS health200 with TLS verification0, old host LXD HTTP :15583 present, no :15584 proxy, source auto-OFF timer inactive, SSO OFF.
- Next single task remains T04b8-A2-REAL-LAB-SCHEMA-GATE. Need independent read-only active Lab PG ledger evidence, explicit authorized 043 release with cryptographic checksum lock (and relevant runtime/code review), staging module import closure, new independent rollback prior to any rollout. Do not bypass HOLD or enable SSO/mTLS based on docs CI.

## 2026-11-04 — T04b8-A2-SCHEMA043-FORENSIC: real DB and deployed lock mismatch verified [LAB READ-ONLY PASS / SOURCE RELEASE HOLD]

- **Actual PG evidence:** Light Remote same authorized VPS-ARM and isolated GoldABV2 LXD Lab, PostgreSQL database light_remote_gold_dev, explicit read-only transaction followed by ROLLBACK. public.lr_schema_migrations COUNT 43, contiguous 001–043, last 040,041,042,043; public.lr_gold_device_short_ids table and lr_gold_short_id_immutable_trg both exist. NO migration executed.
- **Root cause established:** old effective Plugin and Operator 9d996956 source trees each have a LOCAL migrations.lock.json with 43 entries (file SHA256 9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609). New b8ec5d6f Git-archived staging has 42 entries (file SHA256 05b287052de42df16324263130d6ef85fb67acc496a108b2f0a49c280da5a122), 043 NOT locked. The old local 043 entry specifies 043_gold_device_short_ids.sql SHA256 935b268899c7b59761781db33d8ad2c573773566844fbfab0b861046f3a680d4; measured SQL digest MATCHES old Plugin, old Operator and new staging. All lock entries 001–042 match. Both gold-schema-startup-gate.mjs and gold-db.mjs are byte-identical across these three trees. Thus the prior gold_pg_candidate_43_not_locked failure is caused by the locally extended OLD lock missing from NEW Git source, not by different schema logic.
- **Runtime proof:** Operator effective ExecStart old 9d996956 source, PID339325 since 2026-11-04 04:25:16 UTC, NRestarts=4 cumulative from previous attempts; Plugin PID339483 old source since 04:25:17 UTC, NRestarts=0. All four Lab units active, public HTTPS health200 TLS verify0, old source rollback timer inactive. Running Operator/Plugin Owner Auth V4 and Token V4 flags inspected as OFF/OTHER. This confirms current startup longevity, not Windows/SSO acceptance.
- **Governance:** source project-book explicitly says SQL043 is candidate not in canonical Git migration lock; owner-approved review and rollback lane required. A matching checksum in the locally modified deployed tree is NOT formal release authorization. SQL044 native Guest runtime remains HOLD. No Git lock, SQL, PostgreSQL, service, credentials, firewall, Traefik, production, Agent A/B, Owner SSO or native desktop artifact was changed by this investigation.
- **Diagnostic audit:** /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/SCHEMA_043_CONSISTENCY_AUDIT_20261104.md contains the corrected read-only evidence and hashes.
- **Next task T04b8-A2-SCHEMA043-RELEASE-REVIEW:** formally trace and approve migration 043 release provenance and canonical checksum lock. Require a fail-closed PRE-RESTART compatibility check against actual DB ledger, packaged source lock+SQL digest and Node dependency resolution before any new source cutover; new independent timed rollback, snapshot and sustained readiness are still required. Keep SSO OFF, protect/retire plaintext 15583 only with tested mTLS backend, no Windows App-to-Wall signed E2E acceptance yet.
- **CI:** documentation and Project Truth receipts pending Git push; no new Gold Source Gate or real Plugin/Operator cutover.

## 2026-11-04 — T04b8-A2-SCHEMA043 forensic docs/Project Truth CI acceptance [CI PASS / RUNTIME UNCHANGED]

- Gold forensic doc commit fcf54e9ea27fc412a2b79e92acce6953986bb68e: GitHub Documentation Integrity 41778591691 SUCCESS; Project Truth 41778591645 SUCCESS.
- Desktop mirror doc commit d778fe2365967826f9321882ed5d7b764719346e: Documentation Integrity 41778598854 SUCCESS; Project Truth 41778598856 SUCCESS.
- Both Git worktrees clean/origin-synced before this receipt; Master byte-identical. Results prove DOCUMENTATION/CONTINUITY gates only, not 043 release authorization or new Plugin/Operator/Windows SSO runtime acceptance.
- Actual Lab state remains old running 9d996956 Plugin/Operator, PostgreSQL ledger 43, canonical Git migration lock 42, effective local old source lock 43 with matching SQL digest. No migration, systemd, Traefik, mTLS, SSO or production changes.
- Single next task: T04b8-A2-SCHEMA043-RELEASE-REVIEW, independent owner authorization of version-controlled SQL043 checksum release and pre-restart schema/dependency compatibility gate; SQL044 HOLD remains.

## 2026-11-04 — T04b8-A2-LAB-CUTOVER-PREFLIGHT fail-closed guard [SOURCE TEST PASS / REAL LAB NEGATIVE PASS / CI PENDING]

- Baseline Gold c94537a4, Desktop de114497, worktrees clean. Official Light Remote resumed exact VPS-ARM A/B session, isolated GoldABV2 Lab 4/4 units active, HTTPS200 TLS verify0. NO database writes, migration, restart, routing, SSO or Agent A/B grant changes.
- New deploy/scripts/gold-abv2-lab-cutover-preflight.mjs: READ-ONLY explicit CLI --preflight --source /opt/light-remote-abv2-lab/source-ID for only isolated LXD light-remote-abv2-lab-20261101 / DB light_remote_gold_dev. Uses PostgreSQL BEGIN TRANSACTION READ ONLY and ROLLBACK, compares contiguous ledger with git HEAD canonical committed lock and staged source lock, calculates SHA256 of EVERY staged locked SQL file, checks 043 immutable Short ID table/trigger and Node Plugin express / Operator pg module resolution; strictly HOLDS SQL044. No modules imported with side effects, no secrets printed or service changes.
- Compatibility is NOT release approval: output canCutover=false even when technical check is compatible. BLOCKED returns exit3, invalid/--apply args exit2, inspection failure exit4. Never turns on 043 acceptance, never imports local Lab-only pin into Git, never enables SSO.
- Fixtures deploy/scripts/selftest-gold-abv2-lab-cutover-preflight.mjs PASS: schema mismatch, noncontiguous ledger, Git/staging lock drift, missing 043 contracts, mismatched SQL SHA, unresolved express/pg, uncommitted lock, SQL044 guest HOLD and forbidden CLI. Both JS syntax checks PASS.
- ACTUAL LAB NEGATIVE: 9d996956 old Operator source returns BLOCKED exit3 (deployed local043 lock vs Git042); b8ec5d6f newly staged source returns BLOCKED exit3 (actual DB043 vs Git/staged042). This PROVES fail-closed preflight detects prior 502 cause BEFORE restart, NOT that new Plugin/Operator runtime is accepted.
- Source CI wiring: Gold .github/workflows/gold-connection-lifecycle-gc.yml now watches these two files and runs new test. CI result PENDING push. Gold UAT/prod and Windows native binary unchanged; Desktop V4 SSO NOT E2E tested.
- NEXT T04b8-A2-SCHEMA043-RELEASE-REVIEW: independently verify historical release provenance and obtain approved canonical 043 migration checksum release before repo lock change, rerun preflight, create snapshot+bounded auto-OFF, then only try limited real service switch with sustained health. SQL044 Guest HOLD, SSO OFF; private mTLS backend and plaintext bypass closure plus signed Owner/Redis/Ed25519/Windows App-Wall E2E remain undone.

## 2026-11-04 — T04b8-A2-LAB-CUTOVER-PREFLIGHT GitHub CI acceptance [SOURCE 4/4 PASS / LAB CUTOVER STILL BLOCKED]

- Gold source/preflight commit 4ffcce8b33d56a96053bd0c51a80c3c717e61620: GitHub Gold Source Gate run 41780066163 COMPLETED SUCCESS **4/4 jobs** (source-gate, Windows Agent epoch, PG simulated 1000 and 10000 device races); Gold Documentation Integrity run 41780066087 SUCCESS; Gold Project Truth run 41780066173 SUCCESS.
- Desktop V4 exact mirrored Living Master commit 19868e7e5f74ac51a2e50cb71801010f21c92355: Docs Integrity run 41780072332 SUCCESS, Project Truth run 41780072282 SUCCESS. Both branch HEADs pushed and worktrees clean before this CI-only receipt. Source code changed ONLY in Gold; Desktop native code/EXE not rebuilt.
- Live post-CI safety check: isolated GoldABV2 Lab all four services active, public HTTPS health200 TLS verify0, active Plugin/Operator still original 9d996956 source. New preflight tested against real Lab remains fail-closed exit3 on both staged old local043 vs Git042 and new staged042 vs actual DB043. The CI PASS validates source preflight tests, not real cutover or authenticated Desktop→Wall SSO.
- NEXT T04b8-A2-SCHEMA043-RELEASE-REVIEW: obtain independently reviewed owner authorization and canonical Git 043 checksum release before any next service restart; preserve 044 Guest HOLD, SSO OFF, no mTLS ingress switch, no plaintext bypass exposure.

## 2026-11-04 — T04b8-A2 LAB043/045 provenance and guarded compatibility review [FORENSIC PASS / RELEASE HOLD]

- **Original provenance found:** /home/ubuntu/handoffs/LIGHT_REMOTE_GOLD_ABV2_LXD_CUSTOM_MCP_HANDOFF_20261101.md documents SQL043 applied manually only to isolated LXD Lab, with 043 checksum in deployed local lock only; explicit NO production release approval and Gold UAT schema042. Read-only PG applied_at for 043 is 2026-11-01 15:25:05.798104 UTC, two seconds after 042.
- **SQL043 structural proof:** catalog shows six-char CHECK, PK/unique, device FK on delete SET NULL, partial index, and immutable update trigger; matches intended SQL043. PostgreSQL ledger stores version/time but not applied SQL digest. Old local lock/SQL SHA match is not cryptographic proof of all historic SQL execution.
- **Owner 045 sidecar:** /home/ubuntu/handoffs/LIGHT_REMOTE_GOLDABV2_SINGLE_OWNER_HANDOFF_20261101.md explicitly documents manual LAB-ONLY SQL045 without registering 045 into schema ledger (still 043). Actual Lab Owner Authority and Handoffs tables both present, Guest044 jobs absent. No canonical SQL045 release is approved.
- **New preflight hardening:** Gold deploy/scripts/gold-abv2-lab-cutover-preflight.mjs also validates canonical Git source SQL SHA (previously stage only), requires actual isolated Lab Owner045 tables and Guest044 absence; selftest-gold-abv2-lab-cutover-preflight.mjs now includes matching negative cases. New selftests PASS. Real original and new source still expected BLOCKED exit3 on Git lock042 vs Lab043; no cutover.
- **Decision file:** https://github.com/n8n2erpnext/light-remote-mcp/blob/feat/goldabv2-desktop-owner-lab-20261103/docs/project-book/LIGHT_REMOTE_T04B8_A2_SCHEMA043_RELEASE_REVIEW_20261104.md identifies separate, reviewable Lab-only compatibility path versus formally promoted canonical Git release. Neither is approved here. No migrations, service restart, Traefik, auth grants or SSO changes.
- **Next:** T04b8-A2-LAB-043-COMPATIBILITY-APPROVAL: secure explicit owner release scope decision, then prepare a reproducible Lab-only source artifact under independent approval and rollback; never copy runtime lock directly to canonical Git merely to pass gate. Guest044 HOLD, SSO OFF, mTLS-only trusted ingress/Windows signed E2E still open. Git/CI receipts pending this task.

## 2026-11-04 — T04b8-A2 LAB043/045 forensic + preflight hardening GitHub CI accepted [SOURCE 4/4 PASS / RELEASE HOLD]

- Gold implementation/review commit f9e8ae2ca06a52cb248ee1a6a07035ce06f72107: Source Gate run 41781994866 COMPLETED SUCCESS 4/4 jobs (source-gate including hardened read-only preflight tests, Windows Agent epoch contract, PostgreSQL 1000/10000 device simulated races). Gold Documentation Integrity run 41781994869 SUCCESS and Project Truth run 41781994935 SUCCESS.
- Desktop V4 mirror commit f43d4e4d02b5415a94ac1450571047d7dd462528: Documentation Integrity run 41782000058 SUCCESS and Project Truth run 41782000170 SUCCESS. Both branches pushed, worktrees clean, Living Master copies byte-identical before this CI-only receipt.
- The ORIGINAL Nov 1 Lab handoff is explicit that SQL043 was applied manually only inside isolated LXD; local-only lock was intentional and main Gold UAT remained schema042. SQL045 Owner tables also manually applied only in Lab; canonical Git 043 and 045 approval is NOT given by this evidence. Preflight continues to block old and new source cutover due canonical Git042 vs DB043 as designed.
- After previous changes, latest read-only runtime verification was all four Lab units active, public HTTPS200 TLS verify0, auto-OFF inactive, SSO OFF. CI Source PASS proves code/tests, not a real Plugin/Operator or Windows App-to-Wall SSO cutover.
- NEXT T04b8-A2-LAB-043-COMPATIBILITY-APPROVAL: obtain separate explicit owner authorization for scoped lab-only reproducible compatibility artifact versus broader canonical migration release. Both paths require fail-closed guard, independent rollback and sustained acceptance; Guest044 remains HOLD.

## 2026-11-04 — T04b8-A2 deterministic in-memory Lab043 review [ACTUAL LAB READ-ONLY PASS / RELEASE HOLD]

- New Gold tool deploy/scripts/gold-abv2-lab-043-compatibility-review.mjs runs only --review on isolated LXD Lab light-remote-abv2-lab-20261101. It reconstructs the hypothetical lock43 from canonical Git42 plus exact SQL043 exclusively in memory. Proposed lock SHA256 9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609 MATCHES both old Plugin and Operator deployed local lock files. SQL043 SHA256 935b268899c7b59761781db33d8ad2c573773566844fbfab0b861046f3a680d4.
- Actual read-only Lab review verified PostgreSQL ledger 001–043, historical 043 applied timestamp 2026-11-01 15:25:05.798104 UTC, 043 immutable Short ID trigger, owner045 lab-only tables, Guest044 absent, canonical 42 SQL hashes, new staged source 042 and both old source 043 fingerprints. Output LAB_ONLY_COMPATIBILITY_PROPOSAL_REPRODUCIBLE, empty blockers.
- SAFETY: canCutover=false, releaseApproved=false, canApplyMigration=false, canEnableSso=false. No write/approve/apply/stage/restart mode. No migration file, database, environment, Traefik, service, SSO or AB V2 grant changed. Lab proposal is NOT an approved canonical Git/UAT/production 043 release.
- New fixture selftest-gold-abv2-lab-043-compatibility-review.mjs rejects tampered SQL SHA, wrong manifest target, wrong old pin, missing owner045/Short ID/Guest044 absence, changed applied timestamp, and --apply/--approve/--write/--stage flags. Source fixture PASS; Gold Source Gate workflow updated for both new file triggers/tests; CI pending.
- NEXT T04b8-A2-LAB-043-COMPATIBILITY-APPROVAL: obtain explicit approval scoped ONLY to reproducible isolated Lab source artifact and independent rollback before preparing any new stage, then bounded source cutover and sustained health; Gold UAT/production remain 042, Guest044 HOLD, SSO/mTLS OFF pending real signed Windows E2E.

## 2026-11-04 — T04b8-A2 Lab043 review-only source GitHub acceptance [SOURCE GATE 4/4 SUCCESS / RELEASE HOLD]

- Gold code+doc commit 8a53f2d8dc1b2cd6e38b51190dcb51b2af6beda4: Gold Connection Lifecycle GC Source Gate run 41787944824 COMPLETED SUCCESS, four successful jobs (source-gate with deterministic Lab043 review negative tests, Windows Agent epoch contract, PG 1000/10000 simulated devices). Documentation Integrity 41787944597 SUCCESS, Project Truth 41787944780 SUCCESS.
- Desktop V4 mirrored handoff commit d590b99672ed84c50ab0050a94d3f60e4fed8e62: Documentation Integrity 41787950463 SUCCESS and Project Truth 41787950437 SUCCESS. Worktrees clean after original pushes; Master byte-identical before this receipt.
- Post-push isolated Lab runtime: 4/4 units active, public HTTPS200 and TLS certificate verify0, prior independent auto-OFF inactive, SSO still OFF. This source CI proves reviewer/test code only and DOES NOT approve writing a Lab-only lock, executing SQL, changing a live Operator, releasing to main UAT/production, or enabling Owner SSO.
- Next remains T04b8-A2-LAB-043-COMPATIBILITY-APPROVAL. Need clear separate owner consent and bounded rollback for an immutable Lab-only artifact; canonical Git lock through 042 and Guest044 HOLD remain unchanged.

## 2026-11-04 — T04b8-A2-ROLLBACK-READINESS-CI (source test PASS / real Lab BLOCKED)

- New Gold read-only audit: `deploy/scripts/gold-abv2-lab-rollback-readiness.mjs --audit`, with `selftest-gold-abv2-lab-rollback-readiness.mjs`. Gold Source Gate workflow watches both paths and executes the selftest. No apply, delete, arm, snapshot, restart, SQL migration, Owner SSO or release approval.
- The guard verifies scoped three-file backup SHA256, strict rollback `--check` output for BOTH Plugin and Operator (not a single `NOT_APPLIED` line), available LXD snapshots and a **fresh** snapshot, active independent auto-OFF timer with future deadline, original running Plugin+Operator source, 4/4 services, HTTPS200/TLS0, and root free-space headroom (>=10GiB AND <=85% used).
- Actual VPS-ARM audited read-only: **31 old snapshots, none fresh; three backup SHA256 PASS; rollback script --check PASS; timer LoadState=not-found / inactive, no scheduled deadline; root 14.8GiB available and 87.6% used; all 4/4 Lab units active and HTTPS200 with valid TLS**. Expected BLOCKED (exit3), not a failure of the unit tests. Existing rollback script is NOT triggered. Storage `/home/ubuntu` ~29GB; high-level read-only inventory only, nothing removed.
- Negative source fixture tests PASS including missing backups/snapshot/timer, unhealthy service, TLS failure, low disk, and newly covered malformed/mixed `NOT_APPLIED` versus `PRESENT` rollback reports. `canCutover=false` and `releaseApproved=false` even on synthetic compatible input.
- NEXT: run Gold Source Gate + Project Truth + Docs CI for this new source change. Before any actual Lab-only cutover still require explicit owner scope approval, safe storage remediation (no speculative deletion), a fresh pre-cutover snapshot and an independent auto-OFF timer; preserve Git canonical schema042, Guest044 HOLD, Gold UAT/production, and SSO OFF.

## 2026-11-04 — T04b8-A2-ROLLBACK-READINESS-CI accepted [SOURCE GATE 4/4 SUCCESS]

- Gold commit `0ae75f6f302cf67a56b1cffb3b62d3b3819a3bde`: Gold Source Gate [41790279601](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41790279601) COMPLETED SUCCESS 4/4 (source-gate, Windows Agent epoch, PostgreSQL 1,000 and 10,000 simulated device races); Docs Integrity 41790279578 SUCCESS and Project Truth 41790279581 SUCCESS.
- Desktop mirror commit `20e907e3fb5b984af707dd7ee9ad6a799e79acc9`: Docs Integrity 41790285739 SUCCESS, Project Truth 41790285898 SUCCESS. The 2 branch Living Master copies remain byte-identical.
- New rollback readiness audit is intentionally **BLOCKED** against the true Lab, and CI PASS does not authorize releasing canonical SQL043, running any migration, a live source restart, snapshot deletion, disk cleanup, or enabling SSO. Disk inventory found older backup/build directories, but no files were deleted or designated safe to delete.
- NEXT: obtain separate owner approval for Lab-only source artifact, then remediate space with a reviewed preservation plan, establish a fresh scoped snapshot and independent active scheduled rollback before any cutover. Guest044 HOLD, Gold UAT/production schema042, SSO OFF.

## 2026-11-04 — T04b8-A2-STORAGE-AND-TIMER-GUARD: actual Lab negative PASS; source CI pending

- **Storage inspection (read only):** VPS-ARM root ext4 87.7% used, ~14.8GiB free; policy <=85% used means approximately 3.2GiB of actual root bytes still needed. LXD `default` is a 40GiB Btrfs loop-backed pool, **33.33GiB used / 6.67GiB free (83.3%)**, shared with Gold UAT and other instances. It is NOT a 75GiB pool. There are 31 older Lab snapshots and no fresh pre-cutover snapshot. No data removed and no snapshot created.
- **Safety improvement:** Gold `deploy/scripts/gold-abv2-lab-rollback-readiness.mjs` now also validates LXD pool >=5GiB free and <=90% used, and requires any future independent timer `Unit` to point to the expected loaded `.service` whose `ExecStart` contains the exact scoped rollback script, **not --check**. Systemd property parsing preserves embedded `=` in `ExecStart` (fixed in this task). Negative selftests PASS for wrong timer target, pool insufficient and systemd embedded equals.
- **Real audit:** BLOCKED exit3 as intended (fresh snapshot absent, auto-off timer/service not installed or scheduled, wrong/unverified rollback target, root above 85%). Three scoped backup SHA256 PASS, rollback `--check` PASS, 4/4 Lab services active, public HTTPS200 TLS0, LXD pool headroom PASS. All changes are source-only; cutover and SSO remain OFF.
- **Retention review:** Gold-only `docs/project-book/LIGHT_REMOTE_T04B8_A2_STORAGE_REMEDIATION_REVIEW_20261104.md` records actual storage figures and candidate directories such as old build backups and caches, but explicitly **does not label them safe to delete**. Disk cleanup requires separate scoped review/approval and proof of preservation; do not automatically remove LXD snapshots or current Git/Service source.
- NEXT: Gold Source Gate/Docs/Project Truth CI for guard changes; separate explicit owner scope approval for a Lab-only compatibility artifact; safe real disk headroom, fresh snapshot, and correctly bound independent active timer immediately before any source cutover. Canonical Git migration lock remains 042, Guest044 HOLD, Gold UAT/production untouched, SSO OFF.

## 2026-11-04 — T04b8-A2 storage/timer binding source CI accepted [GOLD SOURCE 4/4 PASS / RELEASE HOLD]

- Gold code and storage review commit `06fef1a1ae50ccd16f3980041f7b26723b4e9dfa`: Gold Source Gate run [41792145176](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41792145176) COMPLETED SUCCESS 4/4 (source test, Windows Agent epoch and PostgreSQL 1000/10000 simulated devices). Gold Docs Integrity 41792145221 and Project Truth 41792145174 SUCCESS.
- Desktop V4 exact mirrored Living Master commit `859c0ce6c718556b4573d877cbbf125fa2ce1396`: Docs Integrity 41792152657 and Project Truth 41792152623 SUCCESS. Both worktrees clean and master documents identical before this receipt.
- Runtime post-push still 4/4 active, public HTTPS200 and TLS verify0. Live rollback --audit deliberately BLOCKED by missing fresh pre-cutover snapshot, timer unit and host root >85% used. Pool remains above 5GiB free but shared; do not delete old backups/snapshots without separate preservation approval.
- **Next:** separate owner approval for a Lab-only 043 compatibility artifact, preservation-reviewed root storage plan, fresh scoped snapshot and independently armed/bound rollback timer before any source switch. Canonical Gold UAT/production Git lock042, Guest044 HOLD and Desktop Owner SSO OFF.

## 2026-11-04 — T04b8-A2-REAL-LAB-ROLLBACK-READINESS [REAL TECHNICAL PASS / RELEASE HOLD]

- **Scope:** owner-approved VPS-ARM storage cleanup preceded this task; only isolated LXD GoldABV2 Lab rollback readiness was prepared here. Gold UAT/production, public Traefik, SQL, SSO flags, Agent A/B, Windows native runtime and source service overrides unchanged. Original clean Git branch heads: Gold ea0c4ba2403e6813d95241ab43c5a03dde596143, Desktop a7af6e2b7a149f8b82914bdf8377a7ed131aa790.
- **Storage now PASS:** actual Lab audit VPS root used 74.9% with 30.1GiB free; LXD default Btrfs pool used 79.6% with 8.2GiB free (40GiB total). Supersedes historical root 87.7% used. Both independent headroom policies PASS.
- **Snapshot:** created/verified isolated Lab pre-t04b8-a2-readiness-20261104-155117; preserved five most recent snapshots as owner requested by deleting only prior oldest pre-goldabv2-wall-r5-20261102 AFTER the new snapshot existed. Evidence: /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/LAB_READINESS_SNAPSHOT_20261104.json.
- **Independent temporary auto-OFF:** root transient lr-t04b8-a2-source-autooff-20261104.timer is loaded/active, future realtime deadline 2026-11-04 16:37:30 +07 and exact Unit bound to loaded service whose ExecStart calls scoped source-cutover-rollback.sh (no --check). The current original Plugin/Operator source has no matching cutover overrides; if no cutover occurs, trigger performs no source changes. This is a bounded window, NOT permanent authorization; after expiry fresh timer and re-audit are required.
- **Observed rollback readiness PASS:** source read-only audit returned exit0 TECHNICAL_ROLLBACK_READY_APPROVAL_STILL_REQUIRED, blockers empty, 5 snapshots with fresh one, 3/3 backup SHA-256 verified, rollback --check PASS, timer checks all true, original running source restored, 4/4 Lab services active, public HTTPS200 TLS0; source negative selftests PASS. The tool always returns canCutover=false, releaseApproved=false and canEnableSso=false.
- **Real schema release still BLOCKED:** isolated Lab ledger 043 vs committed Git/staged source migration lock 042; deterministic proposed Lab-only lock43 SHA-256 9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609 reproducible in memory, with no approval. Actual staged-source pre-restart preflight still exits3 BLOCKED on database/staged/canonical mismatch. Owner045 historical Lab-only, Guest044 HOLD and SSO not activated. No actual new cutover or live Owner/Windows E2E.
- **Audit evidence:** /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/ROLLBACK_READINESS_LIVE_PASS_20261104.json. CI for this docs-only receipt must be verified after commit; do not present it as source implementation or Lab E2E acceptance.
- **NEXT:** T04b8-A2-LAB-043-COMPATIBILITY-APPROVAL requires separate explicit Owner authorization for immutable Lab-only compatible source artifact; keep canonical Git lock042 and Gold UAT/production untouched. Re-arm fresh independent rollback and revalidate a fresh snapshot immediately before ANY later authorized Lab source/mTLS switch. Never infer cutover permission from an empty readiness blocker list.

## 2026-11-04 — T04b8-A2-REAL-LAB-ROLLBACK-READINESS documentation CI accepted [DOCS/TRUTH PASS, RUNTIME RELEASE HOLD]

- Gold first real technical-readiness evidence commit 7cd647df0d7b7ad6a92bed08b516fccb6c9644c5: GitHub Documentation Integrity run 41803644894 COMPLETED SUCCESS; Project Truth run 41803644904 COMPLETED SUCCESS.
- Desktop V4 mirrored evidence commit bf10f723ad7ec415ad51c0ca4f5d265735d6f6e8: GitHub Documentation Integrity run 41803653894 COMPLETED SUCCESS; Project Truth run 41803653663 COMPLETED SUCCESS. The Living Master stayed byte-identical across both worktrees.
- These jobs verify documentation and project-truth consistency ONLY. Real Lab snapshot was created, bounded independent rollback timer proved active at 16:37:30 ICT due time, root/LXD space passed and read-only rollback audit exited0 with blockers=[] at observation time. The timer expires, and technical readiness must be reacquired for any later Lab window. Live new-source preflight remains BLOCKED exit3 on DB043 vs Git/staged042.
- No approval of SQL043 source release, no new staged compatibility artifact, no migration, Operator/Plugin restart, Owner SSO or mTLS route activation; Gold UAT/production and Guest044 remain untouched. NEXT explicit Lab-only owner compatibility artifact decision; do not promote a transient rollback-readiness PASS into cutover authorization.

## 2026-11-04 — T04b8-A2-LAB043 artifact preparation and independent fail-closed review [LAB PREP PASS / SOURCE CI PENDING / RELEASE HOLD]

- **Scope:** owner requested continue with preparation of SQL043 compatible source artifact exclusively in isolated LXD light-remote-abv2-lab-20261101. Neither the Git canonical lock (42) nor the original b8ec5d6f staging directory was altered; existing Gold UAT/production remains canonical 042. The artifact is a separate unactivated file-only copy, not an approved runtime release.
- **Prepared artifact path:** /opt/light-remote-abv2-lab/source-b8ec5d6f-t04b8-a2-LAB043-COMPAT-PREPARED copied from existing source-b8ec5d6f-t04b8-a2-MTLS-STAGED, with only the prepared copy's migrations.lock.json changed. Lock sha256 exactly 9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609, derived from Git42 plus pinned SQL043 sha256 935b268899c7b59761781db33d8ad2c573773566844fbfab0b861046f3a680d4. All 43/43 source SQL digests match. Source files remain byte-identical outside lock; staged express/pg resolution tested; original 9d996956 Plugin/Operator still running 4/4 active HTTPS200/TLS0. No source override or service restart.
- **New Gold source audit:** deploy/scripts/gold-abv2-lab-043-prepared-artifact-audit.mjs --audit is strictly read-only, fixed Lab/path/pins, validates committed canonical42 and every SQL digest, old/new source tree diff excluding lock, Lab PG043/Short ID/Owner045/Guest044 provenance via existing read-only review, dependency availability, and original runtime source state. Actual LAB_ONLY_043_PREPARED_ARTIFACT_COMPATIBLE_NOT_RELEASED exit0 blockers=[]; always canCutover=false, releaseApproved=false, canApplyMigration=false, canEnableSso=false. Negative selftest rejects changed source folder, lock, checksum, DB provenance, dependencies, wrong runtime and --apply/--stage/--approve/--write modes. Gold CI workflow includes both scripts.
- **Original guard deliberately still BLOCKED:** real existing canonical gold-abv2-lab-cutover-preflight.mjs against the prepared stage returns exit3 with exactly staged_lock_differs_from_canonical and database_version_vs_canonical_lock_mismatch: DB/stage043 vs canonical Git042. Do not weaken or bypass canonical preflight based on artifact validity. The separate Lab-only compatibility decision and source runtime release approval remain explicitly unapproved; no mTLS/SSO activation or Windows signed E2E.
- **Evidence:** /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/LAB043_COMPAT_PREP_20261104/receipt.json plus prepared 043 manifest and source audit. Existing root auto-OFF due at 16:37:30 ICT is temporary and must not be reused after expiry; renewed pre-cutover snapshot/independent rollback/whole readiness required on any future approved live switch.
- **NEXT:** CI Source Gate/Docs/Project Truth acceptance for source-only audit, and separate explicitly scoped owner authorization/technical review before any Lab source runtime release. Guest044 HOLD, Owner045 Lab-only, Gold UAT/production and canonical Git042 unchanged. Never call artifact-prep PASS a live SSO or source cutover PASS.

## 2026-11-04 — T04b8-A2-LAB043-PREPARED-ARTIFACT source CI accepted [SOURCE GATE 4/4 PASS / RUNTIME NOT RELEASED]

- Gold source/audit commit dd1d4e2854fe1c8c5db62b065e36fb85fe1f4b57: Gold Connection Lifecycle GC Source Gate run 41805819252 COMPLETED SUCCESS with 4/4 jobs (source gate including fail-closed prepared-artifact fixtures; Windows Agent epoch contract; PostgreSQL 1,000 and 10,000 simulated device tests). Gold Documentation Integrity 41805819223 SUCCESS; Project Truth 41805819205 SUCCESS.
- Desktop V4 exact mirrored Living Master commit 2f2eaf7694a1b1f603b0a647cf20c64824d637af: Documentation Integrity 41805827735 SUCCESS and Project Truth 41805827571 SUCCESS. Both original branch worktrees were clean/origin synced before this CI receipt.
- Live evidence: fixed isolated Lab-only prepared stage source-b8ec5d6f-t04b8-a2-LAB043-COMPAT-PREPARED has pinned 043 lock, all 43 SQL digests verified, exact source tree equal to original stage outside lock, dependencies resolve, Lab original source still running 4/4 active HTTPS200/TLS0. Dedicated read-only prepared-artifact audit returns LAB_ONLY_043_PREPARED_ARTIFACT_COMPATIBLE_NOT_RELEASED, exit0 with blockers=[]; canonical preflight still deliberately BLOCKED exit3 because Git lock42 vs staged/DB43. No actual cutover or migration or SSO, mTLS, Agent/Windows access changes.
- Source CI PASS certifies the audit implementation and fixtures, not human release authority. Separate explicit Lab-only runtime source cutover authorization, reviewed canonical-lock exception for isolated Lab, renewed independent rollback and sustained E2E remains OPEN; Gold UAT/production canonical Git42, Guest044 HOLD and Owner045 Lab-only unchanged. Existing rollback auto-OFF timer is temporary, scheduled for 2026-11-04 16:37:30 ICT and must be freshly evaluated before any later window.

## 2026-11-04 — T04b8-A2-LAB043 source static module closure guard [ACTUAL LAB READ-ONLY PASS / SOURCE CI PENDING / RELEASE HOLD]

- Previous actual source cutover failed with missing Plugin express and unapproved SQL043 lock. The prepared Lab-only 043 artifact audit now statically scans plugin-server, operator-host, lib and platform-v2 JavaScript for literal import/export-from/import()/require() dependencies; uses createRequire().resolve() only, does not execute staged code, and fails closed if a dependency is unresolved or the scan is empty.
- Exact live audit: 222 JavaScript files inspected, 18 literal external dependency references checked and ZERO missing. Prior broader 581 references included relative/builtin imports; this figure is external-only. Negative tests for unresolved dependencies and zero-file scan PASS. Dynamic computed imports and actual runtime/module startup are NOT covered by this static evidence.
- Source audit remains LAB_ONLY_043_PREPARED_ARTIFACT_COMPATIBLE_NOT_RELEASED with blockers=[], canCutover=false, releaseApproved=false, canApplyMigration=false, canEnableSso=false. Canonical preflight remains BLOCKED exit3 on committed Git042 vs prepared/DB043, and will not be weakened. Existing Lab 4/4 active HTTPS200/TLS0, no service restart, SQL, mTLS/SSO or Gold UAT/production changes.
- Previously armed independent Lab source auto-OFF timer has a deadline of 2026-11-04 16:37:30 ICT; must refresh timer/snapshot and rerun rollback-readiness before ANY separately approved later real cutover. Timer expiry does not imply new release approval.
- NEXT: verify exact Gold source+Docs+Project Truth CI and mirror docs/checkpoint to Desktop; then separately authorize real isolated Lab source release. Guest044 HOLD and Lab-only Owner045 unchanged.

## 2026-11-04 — T04b8-A2-LAB043 static dependency closure source CI accepted [SOURCE 4/4 PASS / RUNTIME RELEASE HOLD]

- Gold source/audit commit f89c4f7acb47df898e61efdaf681423e8d08bf46: Gold Source Gate run 41808697185 COMPLETED SUCCESS **4/4** (source gate with static closure negative fixtures, Windows Agent epoch, PostgreSQL 1,000/10,000 simulated-device concurrency). Gold Docs Integrity 41808697178 SUCCESS and Project Truth 41808697192 SUCCESS.
- Desktop V4 mirror commit 7d7273749fd6a3d460e0badcf8d86667290c42a8: Docs Integrity 41808704974 SUCCESS; Project Truth 41808704849 SUCCESS. Both source/document mirrors were clean, Project Truth HEAD tests PASS and Living Master byte-identical before acceptance.
- Actual isolated Lab static import closure 222 JS files / 18 external literal specifiers / zero unresolved modules and negative fixtures PASS, no entrypoint execution. Existing prepared Lab-only lock043 artifact remains NOT RELEASED. Canonical Git schema042 vs isolated Lab/staged043 preflight remains BLOCKED exit3; explicitly no cutover, migration or SSO activation. Runtime old source still 4/4 active, HTTPS200/TLS0 at 16:36 ICT.
- Earlier independent Lab-only auto-OFF scheduled 16:37:30 ICT; it is not authorization and will expire. Before any separately approved future cutover, verify that timer fired/no-op and renew snapshot/backup/independent auto-rollback/readiness for a new window. No Agent grant or Gold UAT/prod changed.
- **NEXT:** explicit Owner approval of actual Lab-only Plugin/Operator source cutover together with independent canonical-lock exception review, bounded rollback and sustained negative/positive runtime test. Do not widen to mTLS/Owner SSO, Guest044 or production.

## 2026-11-04 — T04b8-A2 resumed read-only Lab and Git SSH write check [ARTIFACT PASS / PREFLIGHT & ROLLBACK BLOCKED / PUSH HOLD]

- Authorized current Light Remote VPS-ARM main-device session, no source/config/service/SQL or Agent grant mutation. Isolated Lab Plugin, Operator, Wall, Supervisor 4/4 active, public HTTPS health 200 TLS verification 0; Plugin and Operator remain on original 9d996956 STAGED source. Snapshot count five.
- Direct prepared-artifact audit exit0: LAB_ONLY_043_PREPARED_ARTIFACT_COMPATIBLE_NOT_RELEASED, checksum pin lock43 SHA256 9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609, 222 JS files/18 external literal imports/0 missing, blockers=[]. Its reported canCutover/releaseApproved/canApplyMigration/canEnableSso are ALL false.
- Direct canonical cutover preflight exit3 BLOCKED: real PG migration ledger43, canonical Git lock42, prepared staged lock43; blockers staged_lock_differs_from_canonical and database_version_vs_canonical_lock_mismatch. Not a runtime release. Guest044 and SSO HOLD.
- Direct rollback-readiness audit exit3 BLOCKED: existing scoped backup SHA256 and rollback-script check PASS; root 30.1 GiB free/74.9% used, LXD Btrfs pool 8.2 GiB free/79.6% used, HTTPS200; blockers fresh_pre_cutover_snapshot_required and inactive/unloaded/unscheduled independent rollback timer (including wrong-target verification because no timer present). Do NOT infer former 16:37:30 timer still protects a future cutover.
- Git SSH diagnosis: outbound 22 connected but key auth timed out, GitHub official ssh.github.com:443 with pinned original github.com host key returned a valid owner greeting in one trial. A Gold branch push dry-run succeeded once; Desktop dry-run was denied as deploy key; subsequent actual Gold push failed Permission denied (publickey). Therefore SSH write is NOT established, and NO push happened. Preserve original local docs commits Gold f7a761c6 and Desktop 3147b735 (both one ahead of origin before this receipt), do not report Docs/Truth CI for these unpublished commits.
- Next: restore stable authorized GitHub SSH write identity for repository n8n2erpnext/light-remote-mcp and push the two branch tips with no force; independently verify Docs/Truth CI. Real Lab cutover requires separate owner approval and fresh guarded rollback window. Gold UAT/production unaffected.

## 2026-11-04 — T04b8-A2-LAB043 static dependency guard extended [SOURCE + ACTUAL LAB READ-ONLY PASS / CI & RELEASE HOLD]

- Gold source-only deploy/scripts/gold-abv2-lab-043-prepared-artifact-audit.mjs now checks literal relative imports via createRequire(file).resolve() in addition to external packages. Actual pinned isolated Lab stage: **222 JS files, 18 external, 309 relative references, zero unresolved**; status LAB_ONLY_043_PREPARED_ARTIFACT_COMPATIBLE_NOT_RELEASED, blockers=[], exit0.
- The scanner inventories one computed nonliteral import at lib/update-helper-reconcile.mjs (dynamic update-lifeboat selected from the core root). Unknown additional computed import candidates or failure to match this known pinned inventory block review; the known path is NOT executed or proven runtime-resolvable. Do not misstate this as full dynamic import or Node startup acceptance.
- Source negative fixtures PASS for missing relative dependencies, empty relative reference set, missing/unexpected computed import inventory, unresolved external modules and all previous checksum/provenance/runtime release guards. Separate T04 Owner SSO selected source tests **129/129 PASS**; Lab043 canonical preflight and rollback negative suites also PASS. Local syntax PASS.
- Canonical PostgreSQL Lab043 vs committed Git migration lock042 remains intentionally BLOCKED exit3, and independent fresh snapshot/auto-rollback are absent. The scan never mounts modules, writes SQL, restarts services, enables SSO, changes Agent grants, or authorizes cutover. Guest044 HOLD; Lab-only 045 remains unchanged.
- CI for this new source change NOT AVAILABLE until authorized GitHub push; last verified remote Gold f89c4f7a, Desktop 7d727374, both earlier docs commits still unpushed. Next: commit coherent Master/Worklog/Code Map/checkpoint in Gold, mirror Master/Worklog/checkpoint Desktop and retain local commits safely; restore authorized GitHub SSH write and verify source/Docs/Truth CI before any release discussion.

## 2026-11-04 — T04b8-A2 SSH identity read-only forensic + source gate local verification [PUSH HOLD / NO RUNTIME CHANGE]

- Gold local HEAD f54b5374, Desktop local HEAD 2d454291 (both 3 ahead on entry, clean). Public Lab health: Plugin/Operator/Wall/Supervisor 4/4 active and HTTPS200/TLS0. No SQL, rollback timer, service, Agent/session grant, SSO or production change.
- Git remote points to git@github.com:n8n2erpnext/light-remote-mcp.git. Existing ~/.ssh/config selects id_ed25519_github for host github.com, but id_ed25519_n8n2erpnext for alias github-n8n2erpnext. The latter public key fingerprint SHA256:/DVNZRdCoBRonj02EVPGAsks/kE4ipLB1gbQHMlBl+c is present in GitHub user's thdangduy publicly published SSH keys, while the other key is not; n8n2erpnext username has zero published profile SSH keys. These are read-only public-key comparisons, NOT proof of GitHub authentication status or repository write permission.
- Read-only Git ls-remote using the configured github-n8n2erpnext owner alias over GitHub's SSH443 endpoint still returned Permission denied (publickey). Therefore selecting the correct host/key alone DID NOT restore authentication. Never claim push succeeded; do not force, copy private keys, change account privileges, or disguise permission denials. GitHub connector collaborator permission call also returned 403 Resource not accessible by integration. The owner must check the registered key's authentication status and authorized repository writing identity in their GitHub account.
- Locally ran six relevant Gold source gate scripts with exit0: selftest-gold-ab-v2-043-release-readiness, selftest-gold-abv2-lab-cutover-preflight, selftest-gold-abv2-lab-043-compatibility-review, selftest-gold-abv2-lab-043-prepared-artifact-audit, selftest-gold-abv2-lab-rollback-readiness, and selftest-gold-043-migrator-release-gate. Project Truth --head PASS. Pinned staged Lab artifact still exit0 with 222 JS, 18 external, 309 relative, 0 unresolved, exactly one inventoried computed import not runtime resolved, and canCutover/releaseApproved/canEnableSso ALL false.
- NEXT: owner-side GitHub Authentication key status for fingerprint SHA256:/DVNZRdCoBRonj02EVPGAsks/kE4ipLB1gbQHMlBl+c, then verify legitimate auth and non-forced push of both existing branch tips and exact-SHA CI. SQL043 canonical preflight is still BLOCKED (Git042 vs DB043), fresh rollback snapshot/timer and separately approved Lab-only release still required. No Guest044, mTLS SSO or main UAT/prod activation.

## 2026-11-04 — T04b8-A2 Git push repaired without touching SSH keys [TWO BRANCHES PUBLISHED / SOURCE 4-OF-4 CI PASS / RUNTIME RELEASE HOLD]

- Key insight: the existing repo-level core.sshCommand already pins /home/ubuntu/.ssh/id_ed25519_n8n2erpnext with IdentitiesOnly=yes + StrictHostKeyChecking=yes. A separate ~/.ssh/config IdentityFile for github.com did NOT prove repository Git was choosing the wrong key. Previous SSH -F, port443 and identity overrides were misleading diagnostics; DO NOT reconfigure or replace the long-established private key. Existing Git history has 1,660 reachable commits and remote branch push reflog today at 16:34:52 ICT, demonstrating frequent prior success.
- Executed git ls-remote origin on the original Gold worktree with NO SSH overrides: exit0 and remote head f89c4f7a. Then pushed both already-prepared branches using existing repository Git configuration, no force and no history rewrite: Gold f89c4f7a -> 852091a1 (4 commits); Desktop 7d727374 -> 153330b3 (4 commits). Both push commands exit0, local origin tracking clean and synchronized.
- GitHub Actions exact published Gold head 852091a1: Gold Connection Lifecycle GC Source Gate run 41821402194 COMPLETED SUCCESS **4/4**, including windows-agent-epoch-contract and 1,000 / 10,000 simulated PostgreSQL GC/epoch workloads; Docs Integrity 41821402207 SUCCESS; Project Truth 41821401904 SUCCESS. Desktop published head 153330b3: Docs Integrity 41821409755 SUCCESS and Project Truth 41821409778 SUCCESS.
- The published prepared Lab043 source audit still checks 222 JS files, 18 external and 309 relative literal refs with zero missing; one known updater dynamic import inventoried, NOT runtime executed. This completes the source CI gate, NOT the canonical schema Git042 vs Lab PG043 migration preflight or separate runtime/source release authorization.
- Production/Gold UAT unchanged. Isolated Lab old Plugin/Operator source remains running and 4/4 active/HTTPS 200, SSO OFF; prior rollback timer expired, future independent snapshot/rollback review still required. No SQL044, real Lab cutover, SSO or production authorization inferred.
- NEXT active task: isolated Lab-only **SQL043 runtime release decision with independent review**, fresh cutover snapshot and independently armed rollback window if and only if explicitly approved; re-check canonical Git042 preflight, do not weaken it or enable SSO.

## 2026-11-04 — T04b8-A2 LAB043 independent GO/NO-GO review [STATIC/SYNTAX PASS / RUNTIME NO-GO]

- Original VPS-ARM branch baseline: Gold c5f7a033, Desktop 5b9edff7, remote synchronized with complete CI green. Isolated Lab 4/4 active and public HTTPS200 TLS verify 0, original Plugin/Operator source still serving. No service, SQL, SSO, Agent grant or Gold UAT/production change.
- Exact pinned Lab-only prepared artifact audit exit0: SQL043 stage lock SHA256 9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609, 222 staged JS files, 18 external and 309 relative literal refs resolved with 0 missing. Additional syntax-only Node --check physically on all 222 staged files: 222/222 PASS. Client Linux and macOS update-lifeboat dynamic import targets exist and syntax PASS; they have NOT been dynamically imported/executed.
- Canonical schema preflight BLOCKED exit3 for committed Git lock042 versus actual Lab PostgreSQL ledger043 and prepared Lab-only stage lock043. Exact blockers: staged_lock_differs_from_canonical and database_version_vs_canonical_lock_mismatch. This remains a required protection, not permission to bypass it. Owner045 only in isolated Lab, Guest044 HOLD.
- Real rollback-readiness BLOCKED exit3: 5 historical snapshots (newest 15:51 ICT, outside 2h window), no loaded/active/scheduled independent rollback timer or verified target. Existing backup hash and rollback script --check PASS; VPS root ~30.0GiB free, 75% used; LXD Btrfs pool ~8.2GiB free, 79.6% used; all 4 services active, HTTPS200. No snapshot or timer was created.
- GO/NO-GO: NO-GO until explicit isolated-Lab-only source release approval, independently reviewed Lab-scoped release policy satisfying the source startup gate without changing canonical Git42, a fresh verified snapshot plus independent properly bound auto-off rollback timer and rechecked baseline health. Approval for Lab source switch does NOT approve Guest044, Owner SSO/mTLS, Gold UAT or production. Follow the appended topic-specific schema and storage review for detailed decision record.

## 2026-11-04 ~19:00 ICT — Owner-authorized guarded Lab-only cutover attempt HALTED at host root READ-ONLY

- User explicitly authorized conditional Plugin/Operator source trial ONLY on isolated LXD container light-remote-abv2-lab-20261101, with no SQL apply, Guest044, Owner SSO/mTLS or Gold UAT/production changes. This authorization does not approve weakening canonical Git042 migration gate or running without safe rollback.
- Before any service change, verified pinned LAB043-COMPAT-PREPARED lock SHA256 9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609, schema compatibility review has no blockers, and rollback shell script --check reports NOT_APPLIED for both units. Running baseline Plugin/Operator source remains 9d996956.
- Created actual isolated LXD snapshot pre-t04b8-a2-owner-approved-20261104-1900 at ~19:00 ICT; now six total historical snapshots. Btrfs pool remained 31.84/40.0GiB used (~8.2GiB free). No snapshot deletion or restore was done.
- Attempted to install independently scheduled, time-bounded rollback .service and .timer targeting /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/source-cutover-rollback.sh. Host system denied even sudo install: Read-only file system at /etc/systemd/system. Read-only findmnt confirms host root /dev/sda1 ext4 ro; separate /home mount rw. DO NOT remount, write to special system paths through another route, weaken safety gate or substitute unsupervised timer.
- After failure, actual rollback-readiness audit BLOCKED exit3 solely with independent_autooff_timer_not_loaded/not_active/no_future_deadline/wrong_rollback_target. Fresh snapshot PASSES, verified backup SHA256 PASSES, rollback shell --check PASSES, root ~30.0GiB free/75% used and pool ~8.2GiB free/79.6% used PASS, all 4 Lab units active and public HTTPS200/TLS verify0. The prepared timer files were only written to handoffs, were never installed and have been removed so no stale deadlines survive.
- No source drop-in was written to Lab, no service restart, no SQL migration, no SSO/mTLS enable and no Gold UAT/production change. Host systemd is degraded with two failed snap.landscape-outbox units, but this does not establish why / is read-only. Do not diagnose it as ext4 damage or bypass policy without host operator inspection.
- Authoritative evidence JSON: /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/LAB043_OWNER_TRIAL_STOP_ROOT_READONLY_20261104.json. Next: owner-authorized host maintenance to restore supported writable system unit path, refresh snapshot/window if necessary, install properly bound independent auto-off, rerun rollback readiness AND reviewed isolated Lab-only schema/startup approval gate (canonical Git042 vs PG/packed043 remains intentionally blocked), and only then attempt actual Plugin/Operator cutover.

## 2026-11-04 19:25 ICT — T04b8-A2-LAB043 Direct LXD Plugin/Operator cutover and rollback LIVE PASS [SSO OFF]

- Owner corrected architecture: Light Remote Agent host / and /etc are read-only by policy; that is NOT a failure of VPS root filesystem or requirement to install host units. Read-only inspection proved LXD /etc/systemd/system is writable Btrfs and isolated from host /. All subsequent trial writes were INSIDE light-remote-abv2-lab-20261101, none on host systemd.
- Real native startup gate in the pinned stage b8ec5d6f against actual PostgreSQL ledger43: PASS; verified staged lock SHA256 9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609, SQL043 table and immutable trigger, Guest044 absent. This does not mark canonical Git migrations.lock42 preflight as PASS or authorize UAT/prod SQL releases.
- Set up a scoped rollback script in isolated Lab and independently activated a transient monotonic 18-minute autooff systemd timer INSIDE container. Verified scheduled time, active timer and expected ExecStart target before touching any service.
- Applied lexically final guarded drop-ins only for Plugin and Operator; actual systemd restarts succeeded and PIDs pointed to b8ec5d6f prepared stage. All FOUR Lab units active, HTTPS health 200 TLS verify0. Real GET /account/login 200, Desktop authorize404 (feature OFF), GET /mcp 405 (method not allowed), Wall /login200 and unauthenticated /approve303. No matched fatal startup pattern in current logs.
- Triggered the same Lab-local rollback.service immediately for independent live acceptance. It removed both temporary drop-ins, restarted Operator+Plugin, and verified old 9d996956 processes running again. One immediate public health probe returned transient HTTP502 during restart; next bounded retry gave HTTPS200, local Plugin health200, four units active. Stopped timer; final timer not-found/inactive. Trial script remains in Lab for audit, but no override or scheduled rollback is active.
- Existing Lab snapshot pre-t04b8-a2-owner-approved-20261104-1900 and backup checks preserved. No SQL migration, Agent/B grant change, Owner SSO/mTLS activation or Gold UAT/production work. This closes the actual Plugin/Operator Lab source cutover + rollback prerequisite, NOT real Desktop App→Wall SSO E2E.
- Detailed machine-readable receipt: /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/LAB043_DIRECT_LXD_CUTOVER_AND_ROLLBACK_PASS_20261104.json. Next: T04b8 isolated mTLS listener+Traefik/strict private transport and real security E2E under a NEW scoped LXD autooff window, with SSO flags remaining OFF until separately proven.

## 2026-11-04 19:50 ICT — T04b8-A2 real Plugin TLS1.3 pinned-client mTLS and separate Traefik→LXD→Plugin LIVE PASS, scoped rollback PASS [PUBLIC CUTOVER OPEN / SSO OFF]

- Created only temporary one-day test CA, real Plugin server leaf, trusted client leaf, unpinned client leaf and separate frontend leaf in private isolated-LXD directory (no keys printed, retained or committed). Independently ARMED 10/12 minute scoped auto-OFF inside Lab BEFORE restarting the Plugin. Target only isolated light-remote-abv2-lab-20261101. No host systemd writes.
- Real b8ec5d6f Plugin process loaded from pinned Lab-only SQL043 artifact, loopback listener 127.0.0.1:5584 actually started. TLS1.3 correct pinned client HTTP200/TLS verify0; valid CA-unpinned client HTTP403; absent client handshake denied curl56/HTTP000; forged forwarded headers with unpinned cert HTTP403; Desktop Owner Auth route remains404 (OFF).
- A separate LXD host proxy 172.30.0.1:15584 to Plugin 5584 accepted a verified pinned client TLS connection HTTP200. Host localhost-only Traefik:v3.6 sidecar port19444, ephemeral frontend server certificate and CA-verified pinned upstream client certificate, reached real Plugin through real LXD proxy: final HTTPS200/TLS verify0. Attempted spoofed forwarded header request to Owner authorize returned404 because feature OFF, not evidence of a signed Owner issuance route.
- Early failed probe attempts: 403 from nonallowlisted Host goldabv2.lab, later Traefik404 due an incorrectly generated test-sidecar Host rule and SNI mismatch. Fixed ONLY the test runner, verified generated Go Host rule and frontend certificate, and repeated actual network path until the final one-pass valid result. Existing product security checks and public Traefik were never weakened.
- Actual scoped LAB rollback.service manually triggered and returned success, ExecMainStatus0. Old 9d996956 Plugin and unchanged Operator process sources verified, 4/4 units active, public HTTPS200/TLS verify0, mTLS port5584 closed, timer disarmed. Private CA and every ephemeral test key, Docker sidecar, LXD proxy and exact-IP firewall rule cleaned. Backup/snapshot preserved; no DB migration or Agent grant changes.
- Machine receipt: /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/REAL_PLUGIN_TRAEFIK_LXD_MTLS_PASS_AND_SCOPED_ROLLBACK_20261104.json. Reproducible scoped probe script (no key values): /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/traefik-real-plugin-mtls-probe-20261104.sh.
- NEXT T04b8-A2-LAB-PUBLIC-EDGE-CUTOVER: under a NEW isolated safeguarded window, repoint only the public Lab Traefik backend to pinned mTLS, isolate/retire old plaintext :15583, test direct-spoof and existing MCP/Account/Wall regressions, then verify rollback. Real Owner Redis/Operator/Ed25519, native Desktop→Wall SSO and UAT/prod remain OFF/HOLD.

## 2026-11-04 — T04b8-A2 mTLS exact client-certificate dual-pin rotation [SOURCE / NODE TLS TEST PASS, RUNTIME OFF]

- Precondition retained: real isolated public GoldABV2 Lab Traefik service cut over to pinned-client HTTPS backend 172.30.0.1:15584 during bounded 20:03–20:13 ICT trial. The original LXD HTTP proxy :15583 was actually removed; public HTTPS /healthz200, /account/login200, GET /mcp405, Desktop Owner Auth404 OFF stayed healthy. Old plaintext direct curl exit7; TLS without client cert curl exit56. After the trial original Traefik YAML bytes, HTTP proxy, baseline source 9d996956 and four Lab services were restored with public HTTPS200; both temporary guards and all test keys/proxy/rules removed. First host rollback automation had incorrect lxc path and premature health check (exit19); manual recovery verified PASS, script corrected. This was NOT a permanent public mTLS release.
- New source change on Gold branch only: plugin-server/desktop-wall-sso-mtls-edge-v4.mjs accepts optional LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_CLIENT_SHA256_NEXT_V4 alongside required primary SHA-256 pin, both lowercase 64-hex DER client-certificate digest. Next pin missing means original one-pin behavior; invalid/uppercase/empty/duplicate next pin fails closed. Both exact pins are checked with constant-time digest comparisons. TLS1.3, trusted CA client-auth, loopback binding, no forwarding-proxy allowlist and Owner/Token/SSO OFF are retained.
- Security acceptance: real TLS Node/OpenSSL tests confirmed old+new simultaneously accepted during overlap, missing client certificate denied, and old client denied HTTP403 after promoting the next pin as sole primary. Plugin native issuance/router/transport/mTLS suite 42/42 PASS, Operator device proof/signed route/trusted authority/gate 48/48 PASS; node --check and git diff --check PASS. Tests do not establish a running LXD/Traefik certificate reload or operational rotation.
- Source remains NOT DEPLOYED. No mTLS or SSO flag enabled, no SQL migration, no canonical Git lock042 release, no Gold UAT/production change. No private keys, CA or live credentials committed. Git source gate and native runtime validation are separately required.
- NEXT: commit source/test + this Living Master, Worklog and CURRENT_CHECKPOINT together; mirror Living Master and Worklog/checkpoint to Desktop branch. Verify GitHub Source Gate and Docs/Truth. Later add persisted certificate issuance/renewal/revocation and Traefik reload integration under bounded Lab-only rollback, then real Owner Redis/signed device/Windows Desktop to Wall SSO E2E.

## 2026-11-04 ~20:46 ICT — T04b8-A2 real LXD Plugin dual-client-certificate rotation and independent rollback PASS

- Isolated LXD `light-remote-abv2-lab-20261101` only. Separate 21 MB Btrfs shadow stage `source-72b87fb9-t04b8-a2-DUALPIN-LAB043-TRIAL-20261104` was copied from pinned immutable b8ec5d6f Lab043 stage, then *only* `plugin-server/desktop-wall-sso-mtls-edge-v4.mjs` and its test file were replaced using exact committed Gold `72b87fb9` bytes (module SHA256 `f7988206c87fdcf8fe27ea1eb6b29e9bce1c233a15175711b4792f7ceebdaf71`). Stage lock043 checksum preserved `9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609`. This is a *hybrid Lab trial artifact*, NOT a full rebuild of all source at Gold HEAD. The original prepared stage was untouched.
- Real Node/OpenSSL TLS tests **4/4 PASS inside LXD** using the new shadow module. Separately generated CA/server/old/new client 1-day TLS certificates only inside an isolated private LXD directory; never copied certificates to host, printed keys or committed secrets. An independently scheduled Lab-only 12-minute `systemd-run` rollback timer was armed and checked BEFORE the first scoped Plugin-only systemd drop-in/restart.
- Real running Plugin source process on 127.0.0.1:5584 accepted **OLD client HTTP200/TLS0 and NEXT client HTTP200/TLS0 simultaneously** using primary + NEXT exact DER SHA256 pins. The first attempt's negative missing-client-cert probe correctly failed TLS with curl exit56; shell ERR trap incorrectly treated the *expected* error as unexpected and invoked its scoped rollback, which succeeded. Fixed the test-control flow to use `if/else` for expected negative curl exit (no security/policy bypass).
- Second guarded real Plugin restart used NEXT pin as *sole* primary: **OLD cert HTTP403/TLS0**, **NEXT cert HTTP200/TLS0**, **no client certificate TLS rejection curl exit56/HTTP000**, all four Lab units active, public HTTPS200/TLS0. This verifies actual process promotion/revocation of pin, not merely a mocked HTTP fixture; public Traefik was not switched.
- Invoked the independently pre-armed Lab rollback.service manually after PASS: `Result=success`, `ExecMainStatus=0`. Both Plugin and Operator process command lines point to original `source-9d996956-desktop-owner-*`; 4/4 units active and public HTTPS200/TLS0. Disabled timer, closed loopback mTLS :5584, deleted all temporary CA/server/client keys and certificate directory, and removed scoped systemd override. Public Traefik still has original plaintext LXD HTTP proxy :15583 (no public transport cutover in this trial). Gold main UAT/production, migrations, canonical Git lock042, Owner/Token/SSO flags and Agent grants unchanged.
- Verified receipt: `/home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/DUALPIN_REAL_LXD_ROTATION_ACCEPTANCE_20261104.json`. **NEXT:** persistent certificate issuance, validity/renewal/revocation/rotation and Traefik client-certificate reload tests under a separate guarded Lab-only window, then real signed Owner Redis/Ed25519/Desktop→Wall E2E. These remain OPEN; SSO OFF.

## 2026-11-04 ~21:00 ICT — T04b8-A2 real Traefik client-certificate hot reload and fail-closed pre-release certificate audit

- Live isolated loopback Traefik:v3.6 sidecar (host 127.0.0.1:19445) was wired through two temporary LXD proxy devices (15585->5585 OLD+NEXT, 15586->5586 NEXT-only) to the actual new pinned-client TLS1.3 edge module from Gold 72b87fb9. The running public GoldABV2 Plugin/Operator and public Traefik router were NEVER changed in this trial.
- Same actual Traefik container PID across four dynamic file-provider transitions (watch enabled, config rewritten in-place): OLD client -> overlap listener = HTTPS200/TLS verify0; OLD client -> NEXT-only listener = HTTP403/TLS0; update Traefik serversTransport to NEXT cert against unchanged NEXT-only listener = HTTPS200/TLS0 WITHOUT restart; restore OLD identity + overlap listener = HTTPS200/TLS0. This confirms actual certificate hot reload and a negative revoked-client identity.
- An independent host transient cleanup timer was installed via systemd-run (not host /etc), active before creating the sidecar. After test exit0, its scoped cleanup removed the Docker sidecar, exact-IP INPUT rule, both LXD proxies, temporary private host cert directory and private signer CA/client/server keys inside LXD; both temporary services stopped and timer disabled. No PEM/key values emitted or committed. Final 4/4 Lab units active, public HTTPS200/TLS0 and original public HTTP :15583 proxy present. Owner/Token/SSO OFF, SQL, main UAT and production unchanged.
- Implemented read-only pre-release validator deploy/scripts/gold-abv2-mtls-certificate-gate.mjs and real OpenSSL fixture test deploy/scripts/gold-abv2-mtls-certificate-gate.test.mjs. Source/test 11/11 PASS. Checks bundle directory/key permissions and symlinks, rejects signing CA private key in runtime bundle, verifies CA/self-signature, SAN/hostname, clientAuth/serverAuth purpose, private key match, validity and 30-day renewal threshold, distinct OLD+NEXT exact DER SHA256 certificate pins. Reports no secrets. Integrated into Gold Connection Lifecycle Source Gate's trigger paths and test runner. This is an audit only, not live issuance, renewal automation, CA custody or permanent mTLS deployment.
- Design/acceptance: docs/project-book/LIGHT_REMOTE_T04B8_A2_MTLS_CERT_LIFECYCLE_REVIEW_20261104.md. Trial scripts: /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/CERTRELOAD_20261104/run.sh and cleanup.sh. Next: owner-controlled offline CA/CSR issuance, certificate lifecycle and revocation policy, guarded permanent Lab public mTLS cutover; then signed Owner Redis/device/Windows Desktop-to-Wall SSO E2E. Preserve canonical Git lock042 release HOLD and local-first A/B boundaries.
