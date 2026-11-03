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
| T00 | Write master handoff + checkpoint, verify canonical ARM SSH Git and baseline | IN PROGRESS |
| T01 | One-icon Light/Dark appearance switch, fix restored-window edge collision; targeted UI test | OPEN |
| T02 | Inventory exact Account Portal / Operator OAuth / Local Wall signed API contracts and auth security | OPEN |
| T03 | Native Owner login PKCE + callback + secure OS vault + logout/refresh | BLOCKED ON T02 |
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
Pending T00 first commit, then append one receipt per task.
