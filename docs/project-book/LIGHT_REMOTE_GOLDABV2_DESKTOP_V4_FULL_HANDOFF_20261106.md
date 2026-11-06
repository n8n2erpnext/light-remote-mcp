# LIGHT REMOTE — GOLDABV2 + DESKTOP V4
## FULL TECHNICAL HANDOFF / CONTINUATION MASTER
**As of:** 2026-11-06 (ICT, Asia/Ho_Chi_Minh)
**Scope:** Unified Windows Desktop V4 / official GoldABV2 Operator, Plugin, Agent, Local Wall R5, A/B V2, Real Remote V2, installer and backend owner APIs.
**Classification:** Working project handoff; not a release certificate.
**READ THIS FILE FIRST. DO NOT GUESS BASELINES OR START A NEW UI PILOT.**

### 0. NON-NEGOTIABLE OWNER REQUIREMENTS / WHAT WENT WRONG

1. Light Remote Desktop is **ONE APPLICATION**, **ONE Windows Setup.exe**, containing **React Desktop V4 UI + Tauri/Rust Owner Login + Windows Tray + Node Device Agent + Local Wall R5 + RM V2 + updater/watchdog + installed runtime**. The former UI-only and Owner-LAB binary variants were intermediate developer builds; UI V4 design-to-code/visual test was already accepted long ago. **Never ask the owner to install UI-only and functional builds separately**, never release a Tauri shell as the "complete app".
2. **The GoldABV2 LXD Wall R5 is the accepted visual/behavioral reference.** Do not redesign the Wall, "fix" the screenshot with cosmetic CSS, or replace its running source. Local Wall is a per-device instance; Windows Wall at `http://127.0.0.1:5491` must use the same R5 implementation and **server-authoritative A/B V2**, not old V1 presentation or local force flag. Screenshot comparison by owner on 2026-11-06:
   - LXD R5: `http://100.94.184.141:15591`, short ID `R01KAP`, session lanes, A/B V2 standby and modern header.
   - Existing Windows Wall: `http://127.0.0.1:5491`, device shown as `DESKTOP-VA16D27`, legacy A code with eye/countdown. It was on an older registered Gold server profile; the two browser tabs **were not the same server authority**. Window version and live enrollment cannot be inferred from source commits.
3. **A/B V1 disablement MUST be enforced in the GoldABV2 SERVER Operator/Plugin**, not client-only. Legacy request issuance, poll, recovery, approval and direct device-channel routes must reject at the server when GoldABV2 policy says V2 only. Client's Local Wall must **fail closed** if signed server pairing status is unknown; never silently downgrade to V1 on an API timeout/404.
4. **Do not silently migrate an enrolled Windows device from Gold to GoldABV2**. Fresh V4 QA installs default to the GoldABV2 host. A previously saved connection must preserve its authority until explicit Owner-initiated relink/approval. No copying grant/session/account secrets, no silently transferring Short IDs. The independent Light Remote connector/environment is separate from Gold/GoldABV2: when pairing via the plugin, always target exactly the connector named in the request.
5. **Do not disable SSO/login flags after shipping a Desktop installer that opens that login URL.** Earlier Desktop Browser `Cannot GET /account/desktop/v4/authorize` was traced to server flags OFF; both authentication flags have since been restored on the isolated LAB. Do not conflate Owner OAuth login with A/B device authorization; both are required.
6. Run developer source tests as often as necessary, but ask the owner to test **one actual integrated installed app**, not dozens of isolated UI shells. Do not claim complete backend functionality merely because package install, a window launch and Wall HTTP 200 passed.
7. Production, Gold UAT, old Gold Windows enrollment, independent Light Remote plugin, and owner machines are **not automatically approved deployment targets**. Work in isolated LAB and new QA installer; keep rollback. No work on unrelated ARM VPS/phone projects.

### 1. AUTHORITATIVE SOURCE / WHICH GIT TREE TO USE

Repository: `https://github.com/n8n2erpnext/light-remote-mcp`.

**AUTHORITATIVE UNIFIED BRANCH** (this handoff): `feat/desktop-v4-api-integration-20261103`.
- Windows/full Desktop source worktree: `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101`.
- Last code-fix HEAD before handoff: `3a1d2e83` (full SHA `3a1d2e839391bc0a4034582844c43a279175a3f6`).
- Older integration milestones: `56608ebf` (actual merge of Desktop V4 and GoldABV2 backend/Agent; full installer), `0ce120cb` (Operator V1 lock and server pairingMode / Wall fail-closed), `9a97003d` (CI dependency-order correction), `3a1d2e83` (Windows Tray origin-sensitive selftest correction). These are sequential in the unified Desktop branch.
- The **old Gold-specific development branch** `feat/goldabv2-desktop-owner-lab-20261103` lives in `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/goldabv2-desktop-owner-lab-20261103` and its last checked HEAD was `997f9bf3`. **It is NOT the latest unified Windows installer source.** Don't build the new Desktop from that older Gold branch or overwrite the unified branch with it. Its relevant backend code was merged into the unified branch at `56608ebf`.
- The standalone handoff YOU ARE READING is canonical for the new session. Other long-lived project docs: `docs/project-book/LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md`, `docs/project-book/LIGHT_REMOTE_WORKLOG.md`, `docs/project-book/LIGHT_REMOTE_CODE_MAP.md` and `.light-remote/CURRENT_CHECKPOINT.json`. Historical entries in those files are chronology, not a statement that old candidate branches are current.

**Recommended first inspection commands (read-only):**
```bash
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101
git status --short --branch
git log -8 --oneline
git rev-parse HEAD
cat docs/project-book/LIGHT_REMOTE_GOLDABV2_DESKTOP_V4_FULL_HANDOFF_20261106.md
python3 -c 'import json; c=json.load(open(".light-remote/CURRENT_CHECKPOINT.json")); print(c["status"]); print(c.get("nextAction",""))'
```

### 2. EXACT ACCEPTED WINDOWS INSTALLER EVIDENCE — NOT UI-ONLY

**Latest successful full integrated Windows build**, GitHub Actions workflow `Windows Tray Client`:
- Run `42198200310` — `https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42198200310`.
- Commit tested: `3a1d2e839391bc0a4034582844c43a279175a3f6`.
- `build-install-smoke` job: **completed, success**, zero failed steps.
- Full artifact name: `light-remote-desktop-v4-COMPLETE-windows-x64-3a1d2e839391bc0a4034582844c43a279175a3f6`, artifact ID **13492509192**, ZIP artifact size **180,311,251 bytes**, ZIP digest `sha256:ac39af4050f163159b9ea404c1f0fe2a51cfb4f5f2d8e0ba9cd5f29ff7114f4c`.
- In artifact: **ONE full Windows Setup.exe** named `Light-Remote-MCP-Setup-x64.exe` (plus `SHA256SUMS.txt`). **Setup.exe SHA-256** from actual Windows CI: `9b70d625ada54bd88f1af5b9eabd2b8c50cf3a7a278dcb9ee44d42df8c09fc97`. Do not mix ZIP digest with EXE digest.
- Separate artifact `13492707944`, `light-remote-windows-ui-preview-...`, consists of automated **visual test evidence**, NOT a second application or alternate installer.
- `Build and stage Desktop V4 in the SAME full Agent/Wall/RM installation` PASS; staged Tauri V4 EXE **8,104,448 bytes**, native Owner bridge compiled.
- `Native client bundled runtime smoke` PASS; JSON `ok=true, trayLogic=pass, agentHostRecovery=pass, trayIcons=pass`; versions Tray/Agent `0.9.0-rc.49`. This smoke previously failed in run `42195803932` (see section 7).
- `Golden Local Wall UI and pairing regression`, RM V2 duplex/broker/push, real device Agent module staging: PASS.
- `Build per-user installer` PASS; `Install tray, background agent and updater tasks` PASS.
- **Actual installed-runner proof:** `windows-unified-complete-install-and-launch=PASS v4=8104448 agent=PASS wall=HTTP200 rm=PASS owner-native=COMPILED`; `windows-full-installed-wall-assets=PASS`; `windows-rmv2-installed-idle-zero=PASS`; updater healthy and rollback PASS; `windows-native-installer-roundtrip=PASS` after uninstall.
- The older full Windows run `42185548184` (commit `56608ebf`, EXE SHA `0096333787c9840fb56cd4de6552a836edd6463da101934998fbf3d3bd66e206`) is **superseded**. Likewise the UI-only NSIS run `42181390342` is **superseded; do not distribute**.
- Last source Gold GC/lock gate at `0ce120cb`: GitHub run `42194760659` PASS **4/4**. `3a1d2e83` docs and Project Truth CI runs `42198200298` and `42198200311` both PASS. Earlier Owner/backend 37/37 and Agent A/B + Wall transport 23/23 source unit tests were PASS at the merge stage, but don't pretend those equal physical end-to-end acceptance.

**What CI PROVES:** one installer really contains/stages and installs Tauri Desktop V4, Windows Tray, Node Agent, Local Wall implementation, RM V2 companion, updater/watchdog; the installed process launches and a local Wall responds HTTP 200. Build, rollback and uninstall are working on a fresh hosted Windows test runner.

**What CI DOES NOT PROVE:** owner account authenticates all the way back into the installed Desktop, native B field is truly approved by a physical Owner, the physical Windows client is enrolled in **GoldABV2** (rather than persisted Gold), current Lab Owner snapshot API has been enabled or deployed, all V4 feature screens have working APIs, or live R5 visuals exactly match both systems. Do not label those PASS without separate evidence.

### 3. ONE INSTALLER — EXACT PACKAGING DESIGN

Authoritative workflow: `.github/workflows/windows-native-client.yml` on the unified Desktop branch, not the old `desktop-v4-native-ci.yml` output. The latter only runs source/visual QA and macOS/Linux native compile; does **not** distribute a second Windows UI-only installer.

In Windows CI:
1. Compile Windows native Tray from `client/windows-native/GptOperator.Client` (.NET WinForms).
2. Stage the real Windows Agent, Node runtime, Local Wall assets, A/B V2 native IPC, updater/watchdog and `realremote-v2/LightRemote.RM.exe` into `dist/windows/stage/`. Underlying file inclusion: `client/core-files.json` and `deploy/scripts/stage-client-core.mjs`.
3. Compile Tauri Owner-enabled React Desktop with `client/desktop-v4`, Rust feature `desktop-owner-login`, production frontend `dist/index.html`, no dev-server dependency. Stage single executable at `dist/windows/stage/desktop-v4/LightRemote.Desktop.exe`.
4. Use **Inno Setup** `client/windows-native/installer/GptOperator.iss` with define `/DUnifiedDesktopV4=1`, shipping `Light-Remote-MCP-Setup-x64.exe`. The R5 Wall and A/B agent are supplied by the **same** Agent source; there is not a separately shipped Wall server. Start menu/Desktop shortcut launches V4; Agent+Tray still start in background. Retain updater, bootstrap, Windows Scheduled Task and uninstall/rollback semantics.
5. This V4 branch skips the old Compact installer, and publishes just the COMPLETE artifact listed in section 2. Node runtime and other resources remain bundled.
6. Relevant tests in the workflow: `Server authoritative GoldABV2 V1 lock regression`; `Native client bundled runtime smoke`; `Golden Local Wall UI and pairing regression`; `Build and stage Desktop V4 ...`; `Build per-user installer`; `Install tray, background agent and updater tasks`; `Installed tray client self-test`; `Broken update rollback smoke`; `Uninstall native Windows client`; `Upload ONE complete Windows Desktop V4 + Agent + Wall + RM installer`.
7. The binary is a **QA unsigned** Windows installer. Avoid silently replacing existing owner Gold installation. Do not infer that an already installed binary changed after a source or server update.

Relevant source entry points:
- `client/desktop-v4/src/App.tsx` — V4 login-first navigation and screens.
- `client/desktop-v4/src/FeatureScreens.tsx` / `src/lib/native-snapshot.ts` — Owner-read views, empty/unverified states, not fake records.
- `client/desktop-v4/src-tauri/src/owner_login.rs` — native OAuth/OS keyring Owner bridge and scope.
- `client/windows-native/GptOperator.Client/ConnectionConfig.cs` — endpoint defaults and explicit save/legacy preservation.
- `client/windows-native/GptOperator.Client/TrayApplicationContext.cs` — relink, native Tray, allowlisted browser URLs, trayLogic tests.
- `device-agent/operator-agent.mjs` — single background Agent, Wall mount and native A/B IPC.
- `device-agent/local-wall.mjs` + `device-agent/wall-ui-refinement.mjs` — Wall R5 HTML/behavior.
- `device-agent/desktop-abv2-native-ipc-v4.mjs` — same-host A/B native transport; local B approval must be real and bound.


### 4. ISOLATED GOLDABV2 LAB — ACTUAL LIVE SYSTEM AS VERIFIED 2026-11-06

**LXD container:** `light-remote-abv2-lab-20261101`. This is an isolated **GoldABV2 Lab**, not production Gold UAT and not the existing Windows Agent. The LXD reference Wall shown by Owner: NetBird `100.94.184.141:15591`, device/Short ID `R01KAP`. Its R5 visual redesign was already accepted. DO NOT rework R5 typography/panel/layout from screenshots.

Read-only systemd state checked again just before this handoff:

| Service | Active | Actual running WorkingDirectory |
|---|---|---|
| `light-remote-gold-operator.service` | yes | `/opt/light-remote-abv2-lab/source-9d996956-desktop-owner-operator-v1lock-0ce120cb-STAGED` |
| `light-remote-gold-plugin.service` | yes | `/opt/light-remote-abv2-lab/source-9d996956-desktop-owner-plugin-STAGED` |
| `light-remote-gold-wall.service` | yes | `/opt/light-remote-abv2-lab/source-3453ff09-wall-activity-STAGED` |

**WARNING: source divergence.** The services above run independently pinned staged source trees, NOT the latest unified desktop Git SHA. The Operator overlay has only the narrow V1 lock patch, NOT a wholesale rollout of all newer Owner APIs or T04 SSO changes. No silent full-source replacement, no binary copy-over, no entire-Lab/LXD production cutover.

**Owner login/SSO server status (confirmed on live Lab):**
- `LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4=1`: enabled.
- `LR_GOLD_ABV2_DESKTOP_TOKEN_V4=1`: enabled.
- `LR_GOLD_ABV2_DESKTOP_READ_V4`: **OFF/UNSET** at latest read; cannot claim Owner snapshot live.
- Backend `/account/desktop/v4/authorize` exists and now resolves to login/consent path rather than Express `Cannot GET` (previously anonymous HTTP 404). `/account/login` and `/account/` were HTTP 200. Invalid token request returned 401 as expected. A later no-cookie redirect-follow probe reached HTTP 200; distinguish URL hops from final response. Do not report a successful physical Owner OAuth callback until exercised.
- Earlier OFF flags in final systemd override caused the Owner's blank Browser error. The two flags were deliberately restored in the Lab and should not be turned OFF by routine source deployment. Backup: `/opt/light-remote-abv2-lab/rollback/desktop-v4-flags-pre-20261106.conf`; log: `/opt/light-remote-abv2-lab/rollback/desktop-v4-auth-restore-20261106.txt`. Backup is for emergency rollback, **not** the desired current login setting.
- **T04 two-way Desktop App ↔ Local Wall SSO remains separate and NOT accepted.** OAuth account tokens and A/B Agent approval are different authorities. Desktop currently has only `desktop:read` OAuth scope; a read token MUST NOT authorize session mutation.

**Server-authoritative A/B V1 deny (LIVE, not only source):**
- GoldABV2 Operator Lab policy: `LR_GOLD_INSTANCE_ID=abv2lab01` and `LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1=1`.
- `operator-host/executor-routes-device-channel.mjs` was patched through an isolated source overlay, with **eight** explicit legacy V1 denial guards (create/pair/access-request, poll, recover, recover-consume, device-channel A, approve and request approval), plus signed `pairingMode` projection on authenticated device status.
- Operator's Unix socket: `/run/light-remote-gold-uat/operator.sock`. **Five direct V1 negative probes** performed against the actual running socket returned **HTTP 423** with `abv2_server_legacy_v1_disabled` (5/5 PASS): `/v1/device-pair/begin`, `/v1/device-channel/pairing-code`, `/v1/device-access/request`, `/v1/device-access/poll`, `/v1/device-channel/access-approve`. Source test checks remaining locked routes. Later spot probes still returned HTTP 423.
- **Do not confuse HTTP 423 deny on V1 with evidence that a real B approval succeeded.** It is a deny/authority boundary test.
- Rollback backup for Operator systemd override: `/opt/light-remote-abv2-lab/rollback/operator-before-v1lock-0ce120cb-20261106.conf`. Previous Operator source pinned at `/opt/light-remote-abv2-lab/source-9d996956-desktop-owner-operator-STAGED` (preserved). Overlay source: `/opt/light-remote-abv2-lab/source-9d996956-desktop-owner-operator-v1lock-0ce120cb-STAGED`.
- One deployment attempt initially failed because an already long original systemd override filename was made even longer with a temporary suffix. Rollback restored old Operator; second attempt used short temporary `.v1lock-0ce120cb.tmp` and atomic replace, then restarted **Operator only**. Plugin and R5 Wall source were not replaced. All three services active after.
- Avoid revealing OAuth secrets, refresh tokens, B code, HMAC keys or device grants in logs or handoffs.

**Safe read-only server probes (no credentials):**
```bash
lxc exec light-remote-abv2-lab-20261101 -- systemctl show \
 light-remote-gold-operator.service light-remote-gold-plugin.service \
 light-remote-gold-wall.service -p Id -p ActiveState -p WorkingDirectory --no-pager
lxc exec light-remote-abv2-lab-20261101 -- sh -lc '
  s=/run/light-remote-gold-uat/operator.sock
  for p in /v1/device-pair/begin /v1/device-channel/pairing-code /v1/device-access/request; do
    code=$(curl --unix-socket "$s" -sS -o /tmp/lr-v1-deny -w "%{http_code}" -X POST \
      -H "Content-Type: application/json" --data "{}" "http://localhost$p")
    echo "$p HTTP=$code"
  done'
```
The denial probes do not authorize any pairing; expect 423 only on the GoldABV2 Lab policy. Never run these against the independent standard Light Remote environment as if that policy were universal.

### 5. WHY OWNER'S TWO WALL SCREENSHOTS DIFFERED

The 2026-11-06 screenshots were **two different running enrolled devices/authorities**, not proof the new Desktop was fully connected to GoldABV2:
- Lab screenshot: LXD R5 with Short ID `R01KAP`, A status `standby` and Agent A/B V2. Server-side GoldABV2 V1 policy enabled.
- Windows screenshot: `127.0.0.1:5491`, `DESKTOP-VA16D27` and old legacy A code with eye/refresh/countdown, 1 active Agent, historical SHL25-Linux-Lab output. This is an installed device Wall/session on Windows, and screenshots do not prove it was installed from the last successful Setup commit.
- Direct comparison of `device-agent/wall-ui-refinement.mjs` source against the LXD R5 staged tree matched; the `local-wall.mjs` differences mainly involved un-deployed T04 Desktop-Wall SSO/browser logic, not a missing redesign. Different **server pairing policy** was the main explanation. DO NOT overwrite the already accepted LXD R5 stylesheet with arbitrary Windows CSS.
- The Windows native Tray `ConnectionConfig.StablePublicEndpoint` historically defaulted to `https://gold.light-remote.thaiduy.digital`. The **new unified V4 QA build** uses conditional compile symbol `LIGHT_REMOTE_GOLDABV2_V4` to default **fresh installs** to `https://goldabv2.light-remote.thaiduy.digital`. Existing saved `ConnectionConfig` for a Gold-enrolled Windows client is deliberately retained; auto-migration is forbidden. Windows needs explicit Owner-controlled relink to test the GoldABV2 policy end-to-end.
- The Wall now initializes the legacy `.paircontrol` region hidden, and renders V1 only if a real authenticated Agent→Operator status carries `pairingMode==='legacy_allowed'`. When `abv2_only` is received it latches V2, never falling back to V1 because of preview errors, missing policy or disconnected state. The **source and tests** prove this behavior; the owner-side physical Windows before/after has **NOT** yet been accepted. The signed status is forwarded through `operator-agent.mjs` and exposed to the local Wall; client doesn't dictate policy.
- Lab Operator already serves V2 signed status. New Windows Agent must actually be registered with GoldABV2 to see it. Installing a newer `.exe` does not transfer existing device enrollment or previously issued A/B grants.

### 6. DESKTOP V4 + OWNER API FUNCTIONALITY MATRIX — FACTUAL STATUS

| Component / API | Source status | LIVE/physical status | Work left |
|---|---|---|---|
| V4 visual design from Figma/Moryqa, nine screens, theme/fonts | Prior visual pilot accepted; React/Tauri source integrated | Installed V4 process launched in CI | No more separate UI pilot |
| One Windows installer: Tray + Agent + Wall + RM + updater + V4 | Done, Inno Setup, integrated branch | Run 42198200310 full install/rollback/uninstall PASS | Physical Owner machine acceptance, no silent upgrade |
| Account login-first and Owner PKCE via browser | Native Owner OS-vault OAuth implemented | Lab authorize/token routes ON, no error-404; installed V4 UI compiles | Physical end-to-end login, restart/logout/cold-start, tokens/consent and callback |
| A/B V2, native IPC on same host | Agent module and UI/native integration built | Operator Lab V1 denies HTTP 423; IPC source tests; no verified physical B in new V4 | Local Wall B consent and signed Agent binding; exact 4+4, one-use A, 24h Agent grant |
| Wall R5 layout/session lanes/streams | Accepted R5 refinement source, same source family | LXD R5 working; Windows hosted test Wall HTTP200 | Verify Windows Wall renders R5 with GoldABV2 pairingMode and 2+ Agent lanes; don't redesign |
| Owner devices/sessions/grants read-only | `desktop-v4-owner-snapshot.mjs` + token route + native typed React snapshot present | Running Lab `READ_V4` OFF/UNSET, source older than merged; not live accepted | Staged backend source provenance/allowlist, controlled flag-on QA and per-device read proof |
| Usage by Device, bounded Jobs and Live Monitor recent events | Source added T06b2/T06b3; bounded Owner-projected current state/events | CI/source tested, not a durable history API | Deploy same source to isolated Lab, verify actual owner data, timestamps and cross-Owner exclusion |
| Per-Agent Close Session / Revoke Grant | Source-only exact Owner-session/Agent/Device proof module `operator-host/desktop-v4-owner-close.mjs` with tests | **NO callable API** on Lab/Desktop; intentionally not mounted | Separate Owner `desktop:manage` or equally scoped signed local approval; preserve A/B checks; never use `desktop:read` for mutations |
| Devices New Link / Relink from V4 screen | Tray has existing Owner-confirmed relink command, V4 screen disabled | No unified V4 action accepted | Connect approved explicit relink experience to correct registered endpoint; do not silently alter existing enrollment |
| Long Memory account/replica/sync/delete controls | Windows Agent/Wall existing modules and integration sources | Basic Agent/CI tests, not complete V4 actions | Native V4 read/mutation API, Owner access and state, delete-data vs delete-function semantics; avoid copying UAT test data |
| Codex Bridge | Agent/Wall module source exists | Full signed Desktop V4 API not accepted | Proper capability and signed job authority, state and UI bindings |
| T04 App ↔ Wall SSO | Multiple candidate browser bootstrap, native private IPC, ticket sources | **Not deployed/approved**; default-off gates | Complete two-way login, private same-host proof, owner/cookie/PKCE negative tests; do not impersonate Wall login |
| T05E native B GUI provenance | Source test contracts drafted | Owner physical consent not accepted | Exact B local popup/signed proof and cross-session negative tests |
| Multi-Agent UI / 24-hour leases / close held sessions | Gold R5 source behavior and server logic | Lab uses R5 and prior tests; Windows old screenshot differs | Actual physical 2-Agent V2 approval/session clock and close/revoke read/write authority tests |

**Non-negotiable trust boundaries:** Owner OAuth `desktop:read` does not imply permission to revoke grants, close sessions, run commands, modify devices or read all stdout/stderr; any unverified source must render `unavailable` or disabled action rather than synthetic values. Signed Operator status is the authority for V1/V2. Each Agent has a separate approved 24h grant; closing a session does not authorize a new pairing without B. V1 lock applies only on specifically configured GoldABV2 instance, not all products by UI assumption.

### 7. BUILD FAILURE HISTORY — SO THE NEXT SESSION DOES NOT REPEAT IT

1. **Wrong installer architecture:** UI-only NSIS candidate and Owner LAB binaries were being uploaded separately from real Windows Agent/Wall. Corrected by merging latest GoldABV2 source into Desktop V4 (`56608ebf`), integrating with existing Inno `GptOperator.iss`, removing separate Windows UI-only installer upload. Full CI `42185548184` already proved this architecture on an older commit.
2. **Wrong Wall apparent mode:** Windows still showed legacy A controls because previous native Tray defaulted to old Gold endpoint and client did not require signed server pairing policy. Corrected source via `0ce120cb`, and deployed narrowly to Lab Operator. R5 was already accepted; CSS was not the root cause. Windows relink physically pending.
3. **Windows CI `42194760685` early failure:** Gold source regression imported `zod` before root dependencies were installed by the workflow. Fixed by root `npm ci --ignore-scripts --no-audit --no-fund` before the early test (`9a97003d`). Don't remove this dependency ordering.
4. **Windows CI `42195803932` failure:** Job `build-install-smoke` failed at `Native client bundled runtime smoke`. Selftest JSON: `{"ok":false,"trayLogic":"fail","agentHostRecovery":"pass","trayIcons":"pass"}`. Cause was **test fixture**, not broken runtime: `TrayApplicationContext.RelinkRuntimeSelfTest()` hard-coded a Gold `https://gold.light-remote.thaiduy.digital/enroll` URL; new V4 default bridge was GoldABV2. Correct origin validator rejected cross-host, making trayLogic fail. `3a1d2e83` changed fixture to build public activation URL from actual `ConnectionConfig.DefaultBridgeUrl`, retained explicit cross-Gold/GoldABV2 origin rejection. **Do not weaken `TrustedEnrollmentActivationUrl`** or change saved device endpoint to make a selftest pass.
5. **Windows CI `42198200310` latest:** Same full Windows pipeline **SUCCESS**, `trayLogic=pass` and native bundle, Wall, RM, updater, installed launch, rollback and uninstall all PASS; Setup SHA above. This is the accepted current package QA baseline, **not a product-wide API acceptance**.
6. **Previous SSO 404:** Server Plugin Auth/Token V4 env gates were OFF. Restored ON in isolated Lab, tested no 404, token rejection 401; do not reset to OFF during rebuild.
7. **First Operator patch attempt:** systemd temporary override name exceeded filesystem filename limit, rollback occurred; second atomic replace with short temp succeeded. Do not repeat a full source cutover for this narrow fix.


### 8. THE NEXT SESSION'S CONCRETE EXECUTION PLAN (IN PRIORITY ORDER)

**Do not start from Figma/UI-only builds. Do not ask the owner to repeat already established requirements.**

**P0 — Establish truth before acting (non-mutating):**
- Open this FULL HANDOFF, current branch `git status` and `.light-remote/CURRENT_CHECKPOINT.json`. Assert unified branch is current, clean and based on `3a1d2e83` plus this handoff commit. Gold worktree is historical backend research, not the current Desktop installer branch.
- Recheck latest full Windows CI `42198200310`, artifact ID `13492509192`, ZIP vs EXE SHA-256, and LXD Operator/Plugin/Wall source pin above. Verify `Owner Auth/Token V4 ON` and `READ_V4 OFF` before designing read API acceptance. Read `server` code, not historic statement alone.
- If connecting to authorized devices through plugin, call **the explicitly named connector's** `light_remote_connection_helper` first; if approval required show only B, and resume helper with empty args after Owner approves. Standard `Light Remote` is not the `Light Remote Gold` namespace. Never reuse A code or use stale session capabilities.

**P1 — One installed Windows V4 / current endpoint + real A/B V2 (NO silent migration):**
- Identify physical Windows installed version, Tray/Agent running, wall `http://127.0.0.1:5491`, local source version, user-facing V4 process and **effective saved Bridge/Hub URL**. The owner screenshot with old A is evidence of wrong/old authority, not evidence of Wall R5 UI failure. **Never modify the installed connection config file behind Owner's back.**
- With Owner's explicit approval, use V4/Tray relink to register the Windows device to `goldabv2.light-remote.thaiduy.digital` (only if that is the desired authority). Preserve device local settings and existing unrelated Gold profile; don't copy token/agent client grants/Short ID. If link flow is missing in V4, implement the UI/action on the **same unified installer** with proper confirmation and negative tests.
- Verify *actual* GoldABV2 Operator device-channel signed status yields `pairingMode=abv2_only` for that enrolled device. Verify Windows Wall **R5** (not V1 A eye/clock), Short ID/standby, B 4+4 approval on that Windows Local Wall, multi-Agent lease clocks, 24h and close semantics, active jobs, PTY and physical login. Check 0 V1 fallback if preview/offline.
- Treat each function's evidence separately: runner-installed component PASS ≠ actual Owner B consent PASS. Only claim physical B is PASS when Owner physically approves and exact signed Agent/connection/grant proof is returned; don't infer from UI rendering.

**P2 — Make Owner API source and LAB runtime match before marking screens as real:**
- The deployed LAB Plugin/Operator currently run older staged `9d996956` trees. Audit precise differences vs unified Desktop HEAD, signed schema/protocol, prepared source closure, database migrations and rollback. Avoid wholesale cutover without gate. First run read-only preflight and an isolated rollback-safe test stage. Preserve live R5 Wall and Operator V1 lock. Do NOT flip a read flag on a backend that lacks matching routes/projections.
- Bring matching Owner snapshot backend to isolated Lab, verify auth, same-host Owner token, device/account scope, redacted jobs/events and timestamp parsing, then intentionally enable `LR_GOLD_ABV2_DESKTOP_READ_V4` for the isolated QA only. Validate cross-account exclusion and no scripts/stdout/stderr, no false "durable job history" label. Retain prod OFF.
- Run installed V4 login-first OAuth in the app with real browser/PKCE callback, token refresh in OS keyring, restart/cold launch/logout, then read Owner Sessions/Devices/Grants/Usage/Live Monitor. A 200/303 authorize page alone is not acceptance.

**P3 — Finish the missing unified Desktop APIs (not a new app):**
- New Link/Relink UI action with real Owner-managed device authorization, explicit endpoint and exact target.
- Per-Agent Close Session and Grant Revoke requires new Owner manage-scope authority/consent, not `desktop:read`. Reuse exact existing `owner-session-close-abv2.mjs` and source-only `desktop-v4-owner-close.mjs` validation: Owner account session, enrolled device, Agent/session/grant binding, busy jobs, no cross-Agent revoke, close resets local session display without granting new B, no privilege escalation.
- Long Memory UI/API: read mode, replica/sync/archive, delete local/account data distinct from disabling/deleting the feature, signed Owner scope; avoid copying old UAT test data. Codex Bridge and process/terminal APIs: use supported signed Device channel authority, no arbitrary backend execution authority.
- Complete **T04 Desktop App ↔ Local Wall SSO** behind separately accepted feature gates; verify private IPC, Origin/CSRF/cookie/PKCE/anti-replay and Wall Owner proof. Do not confuse Owner OAuth with B approval, or bypass Wall auth by copying browser cookies.
- T05E Native B GUI: physical Owner consent UX and signed origin/session/device provenance, cross-client negative proof.
- Keep feature screens disabled/unavailable until each API has real source, typed parsing, Owner scope and E2E proof. Add tests for each before enabling.

**P4 — One production-quality Windows installer iteration / one Owner acceptance:**
- All changes go through `.github/workflows/windows-native-client.yml`, same Inno installer and exact merged source. No UI-only NSIS, no alternate "Owner LAB" app and no compact variant offered as complete V4. Run hosted Windows **install + live Wall HTTP + process launch + security + rollback + uninstall**, then optionally install the same artifact on physical QA Windows with Owner permission.
- Verify packaged Agent/Wall source commit, endpoint, ABV2-only policy, Login, B, RM V2, Tray, updater, Long Memory and Codex Bridge in **one installed app**. Record a per-screen PASS/FAIL matrix, actual build SHA and operator backend source. Fix errors on **that same line**; don't regress accepted R5.
- Release only after physical Owner acceptance. Current artifact `13492509192` is a valid integrated **QA baseline**, not a declaration of full API readiness.

### 9. REPRODUCIBLE COMMANDS / CI OPERATIONS (SAFE BY DEFAULT)

From unified Desktop source worktree:

```bash
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101
git status --short --branch
git log -5 --oneline

# Regenerate test dependencies when absent; do not skip tests.
npm ci --ignore-scripts --no-audit --no-fund

# Operator denies V1 and signed pairing mode, Wall cannot downgrade.
node --test operator-host/gold-ab-v2-server-v1-lock.test.mjs
node deploy/scripts/selftest-gold-ab-v2-lab-v1-lock.mjs
node deploy/scripts/selftest-gold-wall-r5-interactions.mjs

# Owner read/login and Agent IPC regression suites (expand as APIs change).
node --test operator-host/desktop-v4-owner-snapshot.test.mjs \
  operator-host/desktop-v4-owner-close.test.mjs \
  plugin-server/desktop-owner-token-v4.test.mjs \
  plugin-server/desktop-auth-v4-contract.test.mjs \
  plugin-server/desktop-auth-v4-server.test.mjs
node --test device-agent/desktop-abv2-native-ipc-v4.test.mjs \
  device-agent/desktop-wall-sso-native-ipc-v4.test.mjs

# Source/docs/checkpoint gate before pushing new committed code.
git add <explicit-changed-source-and-doc-files>
node deploy/scripts/check-project-truth-sync.mjs --stamp
node deploy/scripts/check-project-truth-sync.mjs --staged
git diff --cached --check

# Windows full installer must be rebuilt by this workflow, NOT UI-only:
# https://github.com/n8n2erpnext/light-remote-mcp/actions/workflows/windows-native-client.yml
# Last accepted evidence:
# https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42198200310
```

**Windows installer acceptance checklist:** download artifact from GitHub run; verify `SHA256SUMS.txt` against the actual Setup.exe (not ZIP digest); clean runner install; `GptOperator.Client.exe` Tray and `LightRemoteDeviceAgent` scheduled task; Node runtime/Agent; `127.0.0.1:5491` HTTP 200; exact R5 UI and signed V2 mode for a properly enrolled ABV2 device; `desktop-v4/LightRemote.Desktop.exe` starts; RM V2 companion installed and idle until used; updater rollback; uninstall. Physical login/B approval and read APIs are **separate live gates**.

**Failure policy:** If Windows CI fails, first inspect the exact failed GitHub step and log. Do NOT assume it is a kernel/Wall UI regression, disable strict host validation, bypass A/B server gate, fake Owner data, or weaken tests merely to make CI green. Fix the responsible source or actual stale fixture and run the same full installer workflow.

### 10. DO-NOT-TOUCH / SAFETY / AUTHORITY AND ROLLBACK

- **Do not** alter Gold production, independent Light Remote, unrelated VPS ARM/phone/device work, actual owner Windows enrollment or Gold UAT without explicit scope and evidence. If a remote connector denies an action, do not attempt a different namespace or reuse expired A code; follow approval.
- **Do not** flip the Lab Auth/Token V4 flags OFF (breaks `/authorize`), turn on prod/Gold API flags without review, or enable T04 SSO by pretending its candidate source is deployed. Keep read-vs-manage privilege boundary.
- **Do not** replace Lab Wall R5 with an older Windows version or force local flag `LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1=1` on the Windows client as the authoritative solution. Server Operator/Plugin is the final V1 authority. Local Wall should fail closed until signed policy arrives.
- **Do not** ask Owner to test old `42181390342` UI-only or separate unsigned UI shell. Last integrated Windows Setup artifact is from `42198200310` until superseded by a full CI PASS.
- **Do not** use Gold stage `gold.light-remote.thaiduy.digital` as if it were GoldABV2 stage `goldabv2.light-remote.thaiduy.digital`; don't overwrite saved account/device enrollment simply to make screenshot match.
- On an incident involving LAB Operator, backup is `/opt/light-remote-abv2-lab/rollback/operator-before-v1lock-0ce120cb-20261106.conf`. Restore only the precise systemd override, daemon-reload/restart **Operator only** after checking current pin and external effects. The old staged Operator source is preserved. On login incident, read `desktop-v4-auth-restore-20261106.txt` and service env before reverting any flag.
- No public tool should expose private A/B continuation, Agent capabilities, OAuth refresh, B approvals, command bodies/terminal contents, local paths of Owner data or device IDs unnecessarily. Tests should use synthetic fixtures.

### 11. REQUIRED HANDOFF FORMAT FOR EVERY FUTURE SESSION

Before ending each future work session, update **this handoff** with:
1. Exact branch / HEAD SHA / worktree and any new merge.
2. Exact GitHub Actions run IDs, results, full installer artifact ID + **separate ZIP and EXE SHA-256**.
3. Which staged Lab source is actually running for Operator, Plugin and Wall, effective flags names/status and rollback path; distinguish source-ready, CI PASS, Lab LIVE PASS and physical Windows PASS.
4. Signed A/B mode, target server for Owner and Agent, and whether old Windows was explicitly relinked with Owner approval.
5. A per-screen API acceptance matrix with disabled actions clearly marked.
6. One concrete next step for the next session, with validation and rollback. **Do not return to UI V4 design/pilot** unless Owner specifically requests a design change.

Related historical files may be useful but MUST NOT supersede this verified 2026-11-06 source/CI/runtime snapshot:
- `docs/project-book/LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md` (long cumulative Living Master).
- `docs/project-book/LIGHT_REMOTE_CODE_MAP.md` (module routes and feature gates).
- `docs/project-book/LIGHT_REMOTE_WORKLOG.md` (chronology).
- `.light-remote/CURRENT_CHECKPOINT.json` (machine-readable project truth).
- `docs/project-book/LIGHT_REMOTE_GOLDABV2_WALL_R5_LIVE_DEPLOY_20261102.md` (Wall R5 accepted baseline).

**END STATE AT THIS HANDOFF:** unified Windows full installer **CI PASS** at `3a1d2e83`, Operator Lab V1 server deny **LIVE PASS**, Lab R5 unchanged/active, Owner Auth/Token enabled, Owner read backend still OFF, real Windows GoldABV2 relink/Owner B GUI/fully connected V4 APIs **OPEN**. Next session must continue **one actual Desktop app**, not recreate a UI-only pilot.

## 2026-11-06 — T07d Critical production-endpoint/profile audit and GoldABV2 QA isolation

OWNER CORRECTION: Previous claim "the GoldABV2 build has GoldABV2 defaults, so just Relink" was misleading. The shipped source used **the exact same persisted Windows production Gold state and connection paths**, so an installed QA EXE could still inherit production `connection.json`, environment endpoints and old enrollment. The desktop V4 `Devices` view also had `New Link` / `Relink` as `DisabledControl`: THERE WAS NO FUNCTIONAL RELINK BUTTON INSIDE V4. Existing native Windows Tray link action is `Light Remote system tray icon → More actions → Link / Relink device` (only while disconnected; on connected device first Disconnect). Implemented in `client/windows-native/GptOperator.Client/TrayPopoverForm.cs` and `TrayApplicationContext.RelinkWindowsAsync`, with explicit local Yes/No and browser Owner approval. It was never a connected V4 API action.

**Source fix on the canonical `feat/desktop-v4-api-integration-20261103` branch (awaiting new Windows CI at this checkpoint):**
1. Native `AppPaths.cs` compiled with `LIGHT_REMOTE_GOLDABV2_V4` now uses separate persistent profile `%LOCALAPPDATA%/LightRemoteGoldABV2` and `%USERPROFILE%/.config/gpt-operator-agent-goldabv2/device.json`, instead of shared production `GPTOperatorAgent/connection.json` + `.config/gpt-operator-agent/device.json`. Old Gold credential/device files are untouched and **not imported**. No silent migration; GoldABV2 QA requires a fresh **Link this Windows PC** with account approval.
2. `ConnectionConfig.cs` GOLDABV2 compiled branch explicitly returns **only** `https://goldabv2.light-remote.thaiduy.digital` for Bridge and Hub, ignoring inherited `OPERATOR_AGENT_BASE_URL`/Hub production environment and production saved config. Save rejects foreign URLs; non-Gold builds still use previous behavior. Native `PackageTargetSelfTest` integrated into actual Windows EXE self-test, producing `targetProfile=pass`.
3. The *bundled* Node Agent `device-agent/operator-agent.mjs` now detects install-only `goldabv2-package-profile.json`. On marked bundles it refuses mismatching environment and CLI --base/--hub with `goldabv2_build_wrong_server_endpoint`; unmarked standard builds retain existing behavior. Windows V4 CI stages marker ONLY for the unified GoldABV2 V4 branch and checks **both packaged and installed marker**, plus a live negative invocation with production Gold URL. This avoids a direct-invoked Agent reverting to the generic public-endpoint module's production default.
4. V4 `Devices` screen no longer displays misleading dead `New Link`/ `Relink` buttons. It shows the **actual currently usable Tray path**. A first-class V4 native Link/Relink action still needs design/permission-wired implementation; do not falsely label it done.
5. GoldABV2 QA installer still uses the **same Inno AppId, Windows install directory, task and local 5491 port** as the existing Light Remote app. Different persistent device profile does NOT make it safe to install alongside production: replacing the application binary/task on an already running Gold PC will disrupt that instance. Do NOT install on owner's production-enrolled machine without explicit permission / planned rollback. Isolated Windows runner CI is the first QA target.
6. Source QA observed: `GOLDABV2_DESKTOP_SINGLE_TARGET_AND_ISOLATED_PROFILE_PASS`, `GOLD_WINDOWS_RELINK_RM_STABILITY_CONTRACT_PASS`, `GOLD_ABV2_LAB_V1_LOCK_UI_WALL_API_HELPER=PASS`, **Desktop V4 Vitest 69/69 PASS**, React build PASS. These are not yet evidence a newly produced full Setup passed Windows CI or physical account Link.
7. New native installer must be accepted ONLY after full `.github/workflows/windows-native-client.yml` build/install/launch/rollback/uninstall CI and SHA, with `targetProfile=pass` and `WINDOWS_INSTALLED_GOLDABV2_PROFILE_AND_ENDPOINT_PASS`; previous `42198200310` installer has the old shared profile and is **NOT** the fix.
**Next session:** observe actual Windows CI, fix any failed step on the same one-full-Inno installer, then test clean isolated Windows GoldABV2 **Link** with Owner approval. The old live Gold client remains untouched by source changes. Never auto-transfer production enrollment, signed grants or configuration.

**T07d follow-up guard:** A direct invocation of the marker-equipped Agent could previously skip the native Tray's state isolation by using the generic `~/.config/gpt-operator-agent/device.json` fallback or an injected `OPERATOR_AGENT_STATE`. The bundled Agent now pins its default state path to `~/.config/gpt-operator-agent-goldabv2/device.json` and rejects any different environment-specified state path (`goldabv2_build_state_profile_mismatch`). The source test proves production endpoint injection AND production state-path injection are rejected, without copying old Gold enrollment.

## 2026-11-06 — T07d3 Windows CI temporary-state fixture correction, production guard preserved
Full Windows QA CI run 42214051002 at a2b5dc15 failed in `Native client bundled runtime smoke` AFTER `windows-goldabv2-bundled-agent-production-origin-rejected=PASS`: the old test line injected `OPERATOR_AGENT_STATE=$RUNNER_TEMP/native-empty-device.json` and then expected direct bundled Agent `status` success. The new correct security guard refused foreign state path (`goldabv2_build_state_profile_mismatch`), as designed. Fix on unified V4 branch: for marked GoldABV2 build the direct-status fixture uses canonical `%USERPROFILE%\.config\gpt-operator-agent-goldabv2\device.json`. Added **negative native Windows process test** injecting the old temp state path and requiring `goldabv2_build_state_profile_mismatch`; no security exception/allowlist was added. Non-V4 builds retain temp-path test. This CI failure is **not** proof of a broken R5 Wall, Relink, or GoldABV2 origin; new full Inno Windows CI is still required after commit. Prior 1f24763e and a2b5dc15 QA installer artifacts are NOT accepted as final.

## 2026-11-06 — T07d4 FINAL Full Windows isolated GoldABV2 installer CI acceptance

**Verified latest code SHA:** `3cef5e38b05a194ee800d99d6f5ea5419558d05f` (`feat/desktop-v4-api-integration-20261103`). The same ONE full Windows Inno installer workflow `Windows Tray Client` run **42214902399** completed **SUCCESS**, job `build-install-smoke` SUCCESS, no failed steps. Exact GitHub artifact `light-remote-desktop-v4-COMPLETE-windows-x64-3cef5e38b05a194ee800d99d6f5ea5419558d05f`, ID `13501606019`, ZIP artifact size **180,304,547 bytes** and ZIP digest `sha256:d437e6c86cf829fdb700baf4f2f42efdce2af3e4b41f0608edec13ea219fbb1d`. Actual full **`Light-Remote-MCP-Setup-x64.exe` SHA256** printed by the Windows CI after install/uninstall: **`8c2b0e4757db2bb0bf03f60118fa567541acbd42fe0232ee8ad47df30ba2514e`** (do NOT confuse ZIP digest with EXE hash). Artifact also contains SHA256SUMS. GitHub run: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42214902399.

**Exact Windows log acceptance:**
- `windows-goldabv2-bundled-agent-production-origin-rejected=PASS`.
- `windows-goldabv2-bundled-agent-production-state-rejected=PASS`.
- `windows-tray-selftest=PASS agent=0.9.0-rc.49 adapter=win32` with `targetProfile=pass` asserted by CI.
- `windows-unified-complete-install-and-launch=PASS v4=8104448 agent=PASS wall=HTTP200 rm=PASS owner-native=COMPILED`.
- `WINDOWS_INSTALLED_GOLDABV2_PROFILE_AND_ENDPOINT_PASS` asserts installed marker and strict target.
- `windows-native-installer-roundtrip=PASS`; independent updater and broken-update rollback PASS.
- Legacy compact installer skipped; only full Desktop V4+Agent+Wall+RM Setup delivered, not UI shell.

**Security/product scope reminder:** Gold production's prior persisted enrollment and config remain untouched on disk, but QA V4's new profile does NOT import them, so the QA app shows an unlinked Windows device and requires **Link via Windows Tray → More actions → Link / Relink device** plus real Owner approval on GoldABV2. `client/desktop-v4/src/FeatureScreens.tsx` Devices has correct instructions but no first-class native V4 Link command yet. Same Inno AppId, installation location, Scheduled Task names and Local Wall 5491 mean this QA setup **cannot run side by side with production Gold on the same PC**; installing over a running Gold PC will replace the executable/task, although previous production state remains saved. Do NOT install on the owner's currently connected production machine without explicit informed approval. No physical Owner B/PKCE, V4 Owner snapshot API deployment or all-screens E2E acceptance has been performed from this build. Lab GoldABV2 Operator V1 deny HTTP423 and R5 Wall/SSO flags state remain as documented above, untouched by these Windows source changes.

**Current next action:** On an explicitly authorized QA Windows device, install the CI-verified ONE setup, verify effective server/hub are GoldABV2 and the new profile is not enrolled, then choose Tray Link + Owner browser approval, verify actual signed `pairingMode=abv2_only`, R5 Wall, local B 4+4 approval and Agent grant. Only afterward enable/deploy matching Owner snapshot APIs on isolated Lab with proper authorization; do not treat source-only API tests as LIVE acceptance.

## 2026-11-06 — T07e Windows native tray replacement + per-device Short ID/Main metadata (SOURCE QA)

Owner supplied screenshots after linking Windows: Wall at `127.0.0.1:5491` showed `Short ID (Device ID) —`, online device name `DESKTOP-VA16D27`. GoldABV2 account screenshot showed that hostname Main/online and another QA row; WinForms Tray still displayed the previously built 500x740 white popover. Owner explicitly requires **OS-native Windows tray menu**, in this exact order: `Hostname - Short ID : XXXXXX`; status `Connected` / disconnected/etc.; Open Light Remote (open the unified Desktop V4 app); Open Wall; Open Fleet (**only when THIS device is Main in account**); Manage Account; Restart; Stop; Check Update (1) if a verified update is pending; Exit. Owner subsequently added **Link / Relink** as an explicit item, placed between Manage Account and Restart. No separate custom popover should be invoked.

**What was verified LIVE, before this code change:** LXD `light-remote-abv2-lab-20261101`, PostgreSQL `light_remote_gold_dev`: schema version **43**, `lr_gold_device_short_ids` table exists with six assigned rows. The online `DESKTOP-VA16D27` records and `Windows GoldABV2 Desktop V4 QA` had existing Short ID records, with **multiple same-name device rows**, so do NOT generate another ID from the hostname, do NOT overwrite immutable mapping and do NOT manually pick a different device's code. The Wall's `—` is a *read/delivery issue*: old signed Operator `/v1/device-channel/status` lacked `shortId`, while `/v1/device-channel/abv2-pending-preview` returns a Short ID only when its separate explicit allowlist and Owner proof succeed. A Preview 404 or null code previously left the UI as dash. Exact preview failure on this particular physical Windows session was not independently measured; don't claim the allowlist is definitely the cause.

**Source patch on `feat/desktop-v4-api-integration-20261103`:**
- `operator-host/executor.mjs`: read-only, schema43-gated `goldShortIdByDevice({deviceId,accountId})` queries the immutable PG Short ID joined to `lr_devices`, scoped by the **signed** device's owner and exact device ID, excludes revoked. Missing DB/row returns null; no auto-generated/guessed fallback.
- `operator-host/executor-routes-device-channel.mjs`: existing Ed25519 verified `POST /v1/device-channel/status` now returns `shortId` and `isMain`. `isMain` is derived from `accounts.account(binding.accountId).mainDeviceId===ctx.device.deviceId`, NEVER from local Fleet health or a device-supplied flag. Existing A/B V1 423 server lock preserved.
- `device-agent/local-wall.mjs`: R5 frontend accepts Short ID from the signed remote Operator status; a missing/null pending preview no longer overwrites a previously validated code with `—`. Approval preview remains separately protected and does not grant B consent by displaying a code.
- `device-agent/operator-agent.mjs`: CLI `status` now reads signed remote status only if enrolled and connected, projects validated `shortId` and Boolean `isMain`; if remote call fails, safely emits null and false (never a stale/fabricated Main flag). This is needed by native Tray for correct identity/Main visibility. The extra remote status call is bounded by the existing channel timeout; monitor Windows UI responsiveness.
- `client/windows-native/GptOperator.Client/TrayApplicationContext.cs`: **removes all instantiation/activation of `TrayPopoverForm`**; `NotifyIcon.ContextMenuStrip` is now a standard Windows native menu, right-click automatic and left-click same menu; double-click opens installed `desktop-v4/LightRemote.Desktop.exe`. Menu exact labels: top disabled `Environment.MachineName - Short ID : <six-code-or-dashes>`, disabled connection state, separator, Open Light Remote, Open Wall, Open Fleet (only if signed `isMain`; enabled when Fleet healthy), Manage Account (uses correctly configured GoldABV2 `BridgeUrl/account`), **Link / Relink** always visible, Restart, Stop/Start, Check Update (1 only if installed independent updater reports `state=ready` with a different targetVersion), Exit. Link/Relink retains actual Owner-approved native Tray flow; if connected it explains that the Owner must disconnect first, rather than silently stealing a session.
- Old `TrayPopoverForm.cs` may remain as dead source/visual-pilot evidence for historical CI; it is NOT constructed and NOT shown in runtime. Existing updater/task/Agent/Wall remain in the **one** integrated Inno Setup; no second UI installer.
- Tests: `deploy/scripts/selftest-goldabv2-native-tray-menu.mjs` source contract checks native menu, server-signed Short ID/Main, No Popover activation; `operator-host/gold-ab-v2-server-v1-lock.test.mjs` exercises signed metadata + V1 denial; prior `selftest-gold-abv2-wall-short-id-display.mjs` and Gold Lab V1 lock PASS. Windows full installer CI is the proof of actual native .NET compile and installed app, **not yet PASS for this source patch** as of writing.

**Next:** Run exact Windows full Inno CI; fix any C# compile/test failure in same source. Then, after rollback plan, stage only the audited Operator status fields in isolated GoldABV2 Lab and verify signed device status for the ACTUAL enrolled Windows device and local Wall shows same six-character ID. Owner account Main is controlled by server; test main toggle visibility (not just Fleet service status), update available/no-update and real Link/Relink. No client installed by source changes, no production data or short ID mapping touched. **Do not claim the screenshot already fixed until physical Windows confirmation.**

## 2026-11-06 — T07e1 Windows CI legacy V3 popover-contract failure and correction
Windows full installer CI run `42221173463` at source `05b99f97` failed early in step `Verify Moryqa Windows Tray theme and installer contract`, **before native .NET compile and installer build**. Root cause: `deploy/scripts/selftest-windows-moryqa-tray-v3.mjs` still asserts `UiTheme.StyleMenu(menu)`, `new TrayPopoverForm(...)` and `_popover.Toggle(Cursor.Position)`. Those assertions contradict the Owner's explicit requirement for a **standard native Windows ContextMenuStrip**. The historical legacy V3 test remains enforced for non-unified/non-V4 Gold builds. Unified V4 workflow now runs `selftest-goldabv2-native-tray-menu.mjs` instead, retaining its stronger checks for native menu labels, no popover activation, exact signed Short ID and server Main flag. No UI feature was reverted, no production deployment or Windows install performed. NEXT: rerun full Windows Inno build/install/rollback/uninstall CI on new commit; only accept once actual .NET EXE compiles and installed menu operates.

## 2026-11-06 — T07e2 Windows CI relink-label fixture update
Windows full CI `42221499099` failed in early `Gold Windows tray Relink regression` (before .NET build): legacy source test expected literal `new("Relink this Windows PC…"` while Owner required native Windows menu label `Link / Relink`. Fixed the existing Relink regression so **both old and new product variants** satisfy its core safety invariants; when new label present, it additionally requires `NotifyIcon.ContextMenuStrip`, action always visible, and no custom TrayPopoverForm activation. The native V4 script separately requires exact new menu and server-signed Short ID/Main. The Desktop V4 Devices screen instruction was revised from `Tray → More actions → Link / Relink device` to the actual new native `Tray → Link / Relink`. React 69/69 tests PASS. Continue to full Windows CI; do not revert new native menu to satisfy historical popup screenshot contracts.

## 2026-11-06 — T07e3 V09/V10 desktop package contract updated for native Windows menu
Full Windows CI run `42222343084` at `5766fc7f` compiled the native .NET Tray and passed Agent runtime smoke, but failed at step `RM V2 push live lane contract` because `selftest-v10-desktop-productization.mjs` still required old literal labels `Open Local Wall`, `Stop Light Remote`, `Exit Tray UI`. The old `selftest-v09-windows-package.mjs` contained the same stale requirement. Both test contracts now accept either existing legacy Gold menu or the user-requested native GoldABV2 V4 menu, but still enforce tray/task/updater/RM V2 guard and no custom TrayPopoverForm construction on native variant. Local V09, V10, Tray Relink and native menu tests all PASS. No application behavior was weakened or rollback test skipped. NEXT: rerun **full** Windows Inno CI and inspect actual install/Wall/ShortID/Native menu selftest, not just source. Prior failures were test fixtures inconsistent with the accepted UI change.

## 2026-11-06 — T07e4 Windows Actions path trigger corrected
After 2026-11-06 V09/V10 menu contract fix commit a3bb8136, docs+Project Truth CI ran but Windows full-install CI did not auto-trigger: `.github/workflows/windows-native-client.yml` `on.push.paths` omitted the updated V09/V10 source tests. Updated the path filter to include `deploy/scripts/selftest-v09-windows-package.mjs`, `selftest-v10-desktop-productization.mjs`, `selftest-gold-windows-tray-relink.mjs` and `selftest-goldabv2-native-tray-menu.mjs`; workflow itself is an included path, so the new commit must trigger one full Windows installer job. Do not claim previous a3bb8136 has Windows full CI PASS; check new run. Operator signed Short ID overlay remains staged only, not live; LXD Wall R5 remains untouched.
