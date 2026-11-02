# LIGHT REMOTE GOLDABV2 — FULL MASTER HANDOFF (LATEST)

### Chrome LM v0.3 — HOSTED CI VERIFIED (2026-11-02)

Source commit ea622a33, GitHub Source Gate 41454866776 4/4 PASS and Docs Integrity 41454866605 PASS. Lab remains 4/4 active with R5 Wall unchanged; Extension ZIP/source ready to install on Owner Windows Chrome, no real Chrome or signed Memory E2E yet. Current old Memory scopes still present (3) and modules ON. This latest CI verification supplements the v0.3 integration note below and detailed handoff.


### LATEST — Chrome Extension LM v0.3 integration for GoldABV2 (2026-11-02)

Found independent LM v0.2 extension branch feature/gold-lm-chrome-extension-20261029 (6cafb33b) and ported its approved user-click capture, SHA-256 chunked DOM snapshot and manual Wall handoff as GoldABV2-only v0.3 preview at extensions/light-remote-lm-abv2. Exact permitted Wall target is http://100.94.184.141:15591/long-memory rather than Windows localhost; Owner still must explicitly choose Work/opt in/Save. Pending plaintext session data TTL is ten minutes with Chrome alarm cleanup. Preview ZIP at extensions/releases/Light-Remote-LM-GoldABV2-v0.3.0.zip. This is SOURCE/package integration; NOT installed or real Chrome/Owner signed Memory E2E yet. GoldABV2 Wall/DB untouched. Current Owner has no authorized Memory scopes because 3 historic Gold scopes belong to old Account/Home. Previous request to DELETE only old Long Memory data remains OPEN because current Device Sync is ON with this device selected; official deletion must not bypass safety fence. Read docs/project-book/LIGHT_REMOTE_GOLDABV2_LM_CHROME_INTEGRATION_V03_20261102.md before further changes.


### CURRENT LONG MEMORY AUDIT — 2026-11-02 (read before attempting Memory Home changes)

Long Memory and Codex Bridge flags ON; 17/17 isolated memory selftests PASS; live SQLite quick_check OK with 3 historical scopes, 12 scoped checkpoints, 24 historical ACKs (last October 29) and zero quarantine. **All three scopes and Device Sync selection bind to a coherent previous Account ID / Home Device ID, NOT the current GoldABV2 enrollment**. Current account has zero scopes and device is not a member, so My Work may appear empty. This is an authorization/migration gate, NOT permission to rewrite IDs. Do NOT mutate DB/keys/scope Owner or force sync; Owner must identify authorized Memory Home and approve signed clone-tested migration. Full evidence and test suite: docs/project-book/LIGHT_REMOTE_GOLDABV2_LONG_MEMORY_AUDIT_20261102.md. No live Memory data was changed.


### LATEST R5 UPDATE — 2026-11-02 20:01 ICT (supersedes R4 runtime pointers below)

The Owner corrected the font request: LIVE OPERATOR STREAM heading remains 12px; only COMMAND/output body increased 1–2px. New R5 source 61b18b8b is LIVE in isolated Lab Wall at /opt/light-remote-abv2-lab/source-61b18b8b-wall-r5-STAGED. Hover border/no underline, Live green connected / yellow cloud dormant / red disconnected. Source Gate 41449324814 4/4 PASS, Docs Integrity 41449324833 PASS, 4/4 services, HTTP/HTTPS 200. LXD snapshot pre-goldabv2-wall-r5-20261102; rollback /var/backups/light-remote-goldabv2-wall-before-r5-20261102.conf. Active unexpired grants 0 before and 0 after R5 Wall-only restart; earlier 1/2 grant counts below are historical. Owner Chrome acceptance OPEN. Latest detail docs/project-book/LIGHT_REMOTE_GOLDABV2_WALL_R5_LIVE_DEPLOY_20261102.md. The older R4 notes below remain chronological evidence and are not the current runtime pointer.

## 2026-11-02 · Session continuity after Wall Approve B R4 · VPS-ARM / isolated GoldABV2 Lab

**STATUS: GoldABV2 LAB HEALTHY; UI R4 DEPLOYED; OWNER BROWSER ACCEPTANCE OPEN; NOT PRODUCTION-READY.**
**AUTHORITATIVE CONTINUATION POINTER:** This is the consolidated latest handoff for the next code session, superseding historical NEXT steps in older 2026-11-01 and 2026-11-02 handoffs. Older documents remain as evidence, not current runtime truth.
**THE MOST IMPORTANT RULE:** Do not modify Gold main UAT or production, do not grant/revoke/close an active Agent solely for UI testing, do not build heavy distributions on VPS-ARM, and do not substitute a browser/simulated test for signed Owner approval.

---

## 0. NEXT SESSION — FIRST 5 MINUTES

1. Read this complete file BEFORE coding. Then read .light-remote/CURRENT_CHECKPOINT.json, docs/project-book/LIGHT_REMOTE_CODE_MAP.md, recent WORKLOG and the R4 source/detail files.
2. Via official connected Light Remote, target **VPS-ARM** exactly. Recover/open the authorized remote session; do not accidentally target HOMESV or the main Gold UAT.
3. Verify, read-only: Git branch, HEAD vs origin, current LXD Wall WorkingDirectory, all four service states, HTTPS health, Owner grant counts. Runtime counts must be rechecked; they change as 24-hour leases expire.
4. Ask the Owner for new screenshots/acceptance of the **R4 two-card Approve B UI** before doing unrelated UX work. Any new B grant or Close acceptance requires explicit Owner action and a disposable test Agent.
5. For the next code change, maintain project-truth files and GitHub CI gates. Stage into a NEW immutable source directory, snapshot isolated LXD, preserve exact Wall-only rollback and verify grants before/after.

**Current single most useful next step:** Owner opens http://100.94.184.141:15591/approve, hard refreshes with Ctrl+Shift+R, and visually verifies A-card/B-card separation, animated arrow, 8-key code input, paste/backspace/focus, responsive width and real pending flow.

---

## 1. VERIFIED CURRENT CHECKPOINT — THIS HANDOFF AUDIT

Repository:
- GitHub: n8n2erpnext/light-remote-mcp
- Branch: feat/gold-single-owner-transfer-20261101
- Working tree: /tmp/light-remote-gold-single-owner-20261101 (under /tmp: may disappear after host reboot)
- Git HEAD and matching origin: cae2d8728d1a77f81a3678136c8600a5286015ef (docs-only R4 live handoff).
- Last R4 code commit: 1a99c489fb2515934e3c7b3ad741fcb62394fc9c.
- Tracked files clean at audit. Two unrelated untracked items remain: device-agent/__pycache__/ and node_modules. Do not commit or delete them as part of handoff.
- Most recent GitHub CI for R4 source 1a99c489: Gold Connection Lifecycle GC Source Gate run 41442446526 = SUCCESS, four jobs including source, Windows epoch, PostgreSQL 1k and 10k.
- Documentation Integrity run 41442446648 = SUCCESS; documentation-only HEAD cae2d872 integrity run 41442864428 = SUCCESS.

Isolated Lab:
- LXD container: light-remote-abv2-lab-20261101 on VPS-ARM (Linux ARM64).
- Device: R01KAP, account-approved GoldABV2 Lab device; do not substitute old Short ID X3AQQ6.
- Local Wall: http://100.94.184.141:15591/ (NetBird/private).
- Approve page: http://100.94.184.141:15591/approve
- Cloud Lab endpoint: https://goldabv2.light-remote.thaiduy.digital
- Health endpoint: https://goldabv2.light-remote.thaiduy.digital/healthz
- All FOUR services active at handoff audit: Operator, Plugin, Wall, Process Supervisor.
- Public Wall /login HTTP 200, HTTPS health HTTP 200 at handoff audit.
- **Current device grant count read-only audit: 7 historical rows; 6 closed; 1 live unclosed unexpired; 0 expired-but-unclosed.** During R4 deployment a previous before/after count was 2/2. These are DIFFERENT moments; DO NOT continue claiming 2 currently active or assume which Agent currently owns the one active grant without rechecking. Do not interpret an expiry or close as UI regression without evidence.
- No claim of a new R4 Owner-approved B in this code session; R4 tests used synthetic B and did not grant real access.

Actual runtime WorkingDirectory paths (MIXED overlays; do not assume Git HEAD runs across every unit):
- Operator: /opt/light-remote-abv2-lab/source-94933590-op-overlay-ddd012b1
- Plugin: /opt/light-remote-abv2-lab/source-856c4684-plugin-overlay-14f8bfed
- Wall: /opt/light-remote-abv2-lab/source-1a99c489-approve-b-r4-STAGED  **CURRENT**
- Process Supervisor: /opt/light-remote-abv2-lab/source-fa0699ee

**Do not run a blanket deploy, service installer, or entire-container rollback.** The effective service unit override is defined by lexically final systemd drop-ins. Review systemctl show/cat first; only change the target unit.

---

## 2. ISOLATION AND SECURITY CONTRACT — DO NOT BREAK

- GoldABV2 Lab is separate from main LXD light-remote-gold-uat and actual production. Gold UAT/production were NOT deployed as part of the R1-R4 UI sequence.
- Lab uses its own PostgreSQL database light_remote_gold_dev and Redis. Do not apply Lab SQL migrations or old Claude cleanup scripts to main Gold UAT.
- One verified Owner controls enrollment and signed approvals. Historical old Owner transfer was completed; do NOT repeat Owner transfer or use the old disabled account.
- A/B V1 is locked ONLY in this Lab; the server-side V1 denial remains enforced. The visible text "V1 locked" was intentionally removed from normal Wall UI. Production V1 fallback must NOT be disabled by these UX changes.
- Official Agent/Operator A/B grants are authorization boundaries. Browsing account Device Discovery, being online, or seeing a Short ID does NOT grant command execution.
- B code is 4+4, user/Agent-mediated. Never silently generate/approve new B on the Owner's behalf, print live B/consent codes in docs/logs, or create an Owner confirmation success without a signed Operator response.
- A is stable 6-character Device Short ID + rotating 5 characters; pending expires in 5 minutes. Owner may refresh A. The client may render signed A but must never invent or reuse A.
- A/B grants are scoped per Agent and Device and normally up to 24h; Agent session ACTIVE/HOLD/EXPIRED state is independent of grant lease. 60m HOLD is NOT the 24h grant clock.
- Successful fresh authorization replaces only that Agent's previous grant; it must not reset other Agent grants.
- Owner Close must close exactly that session and revoke the matching Agent grant/client binding; stale session Close must not revoke newer or other-Agent grants.
- Signed Origin, CSRF, Owner login, one-time Owner consent when required, device identity, attempt number and requestId validations remain mandatory. UI can clean pasted characters, but server still validates exact B and grant.
- Preserve fail-closed Memory Home/device binding; never edit device ID simply to remove a mismatch.

---

## 3. SOURCE MAP — WHAT CONTROLS WHICH FEATURE

CORE AUTH / SESSION:
- plugin-server/tools.mjs — MCP registration, 84 registered tool schemas, Device Discovery, Helper, optional nickname, exec/SCP validation.
- plugin-server/operator-adapter.mjs — authorized Agent grant and Helper session context.
- operator-host/executor-routes-device-channel.mjs — signed Wall/Owner endpoint routing, B approval and status.
- operator-host/owner-session-close-abv2.mjs — exact Owner Close => revoke scoped grant and detach binding.
- operator-host/device-access-grant-registry.mjs — server grant expiry and close authority.
- operator-host/agent-client-registry.mjs — exact matching grant/client binding detachment.
- operator-host/session-manager.mjs — ACTIVE/HOLD/closed Agent lane and nickname.
- lib/gold-ab-v2-lab-v1-lock.mjs — Lab-only V1 lock.
- lib/light-scp-file.mjs — nonempty upload contract, staged integrity and length enforcement.
- plugin-server/gold-memory-bridge.mjs — authorized Memory Home scope, device binding fail closed.
- device-agent/platform-adapters/linux.mjs — safe shell selector and platform execution classification.

WALL AND UI:
- device-agent/local-wall.mjs — Wall routes, banner, Short ID, pending countdown, per-Agent grant strips, sidebar, PTY Viewer, auth/CSP, process status and SSE/operator stream.
- device-agent/wall-ui-refinement.mjs — fixed/collapsible persistent navigation, local web confirmation dialog, compact typography, subpage width and color thresholds.
- device-agent/wall-ab-v2-preview.mjs — **R4 A/B Owner approval page**, two cards, signed pending A, eight B inputs, keyboard/paste logic, submit only after web Owner confirmation.
- assets/vendor/xterm — local licensed xterm.js 6.0 and FitAddon 0.11.0, CSS and license files; never require Google CDN.
- assets/fonts/web — local Google Sans / Google Sans Code font assets and license.
- deploy/scripts/selftest-gold-abv2-b-segmented-input.mjs — R4 B-code input behavioral test.
- deploy/scripts/selftest-gold-wall-pty-terminal-r3.mjs — R3 PTY/auth/asset/CSP route regression.
- deploy/scripts/selftest-gold-wall-shared-navigation-dialog-v2.mjs — six-route persistent sidebar + Owner web dialog regression.
- deploy/scripts/selftest-gold-abv2-owner-close-revokes-grant.mjs — grant exact close isolation.
- deploy/scripts/selftest-gold-ab-v2-wall-preview.mjs and selftest-gold-abv2-owner-approval-navigation.mjs — signed pending Owner approval route/logic.
- .github/workflows/gold-connection-lifecycle-gc.yml — hosted source gate with new R4 test.
- .light-remote/CURRENT_CHECKPOINT.json, docs/project-book/LIGHT_REMOTE_WORKLOG.md, LIGHT_REMOTE_CODE_MAP.md — project-truth triangle; update for each source change.

Do NOT conflate 84 tool registrations with runtime proof of all 84 operations. Device Discovery is available before grant; old list_devices can return zero because it lists already authorized devices.

---

## 4. BASE AUTH / CONNECTION ACCEPTANCE (PRE-R1) — WHAT WAS ALREADY DONE

At the release-readiness checkpoint earlier on 2026-11-02:
- A/B V2 account Device Discovery directly verified on the official connected plugin; read-only online/matching search no B issued.
- Owner historical single-owner transfer and signed enrollment verified.
- An old Claude grant was explicitly revoked under guarded SQL with zero Claude bindings at THAT time. Later a separate Owner-approved Claude Agent test resulted in a SECOND active grant; R2/R3/R4 observed 2/2. Current count is now 1 (see Section 1); do not claim "no Claude" or "all GPT-6 only" from stale historical data.
- Owner Close exact-grant code/source tests PASS and Operator deployed, but fresh E2E Close->grant revoke->reconnect B with a disposable Agent remains open.
- Optional nickname is implemented server-side; fresh current Helper schema with agentNickname and pre-session E2E still needs separate confirmation.
- Linux shell exit0 and exit7 behavior verified; shell not found/missing cwd is correctly reported without false success.
- Plugin SCP schema updated to reject upload totalBytes=0; source + Lab positive/negative schema PASS. Zero-byte SCP upload is explicitly unsupported.
- Auth/PTY/Jobs/Files basic scoped runtime tests existed; do not claim 84 tool runtime PASS.
- Long Memory Linux Device binding mismatch remained intentionally fail closed until Memory Home identity is verified.
- Reserved exec exit codes need signed spawn-phase evidence before treating them as ordinary application exits.
- Release state still NOT production-ready.

Original full audited baseline:
  docs/project-book/LIGHT_REMOTE_GOLDABV2_RELEASE_READINESS_20261102.md
  /home/ubuntu/handoffs/LIGHT_REMOTE_GOLDABV2_RELEASE_READINESS_FULL_HANDOFF_20261102.md

---

## 5. WALL UI EVOLUTION R0 → R4 (ALL IN ISOLATED LAB)

R0 fonts / typography:
- Source e6a95c86; primary Google Sans, command/stream Google Sans Code; browser font files locally hosted. Standardized 22/18/16 headings, 14 body, 13 secondary, 12 metadata, roughly 13 code. Existing detailed handoff available.
- R0 Wall had oversized COMMAND and navigation buttons and tiny meta; established typography baseline.

R1 layout / sidebar:
- Source 21154b91, test fix 3576a863, docs bdd561b5.
- Collapsible left sidebar, header Short ID R01KAP, Live green ping, Notification bell in header, compact code stream and A/B pending 5min timer. Removed redundant V1 locked visible wording but server V1 remains denied.
- Changed only Wall service; snapshot pre-goldabv2-wall-sidebar-20261102.

R2 approvals / navigation:
- Source 2856faf9, test-only fixture 64798a81, docs f25eaade.
- Signed A code visible when pending (never client invented), English text, Web HTML dialog instead of window.confirm; header status moved under subtitle; 2 Agent grant boxes horizontal / fit content.
- Persistent left sidebar on Home, Long Memory, Codex, Permissions, Settings and Approve B; Wall entry from bundled Material icon; percentage color thresholds: >30% green, 20–30% yellow/amber, <=20% red.
- Profile link remains clickable without underline; 4/4 service and 2/2 grants after cutover.
- Snapshot pre-goldabv2-wall-r2-20261102.

R3 real PTY terminal / full width:
- Feature 21c47388, CSP/layout corrective fb005567, docs 053595ad.
- PTY Viewer is read-only xterm.js 6.0 / FitAddon 0.11 local (licensed), not a plain pre stdout view. Terminal supports ANSI/VT colors, carriage returns, shell echo, scrollback 3000 lines, automatic selection of running PTY, offset/revision-fenced incremental GET poll every ~500ms and list refresh ~3500ms. This is polling, not a true push WebSocket/SSE terminal stream; measure perceived latency in Chrome, not just source interval.
- Bounded output API and auth unchanged. Device Agent can input and resize PTY; Wall remains observation-only.
- Local JS/CSS routes allowlisted under /assets/vendor/xterm, permission 0755 directories/0644 files, HTTP 200; CSP same-origin script/style with anti-framing intact.
- Remove duplicate "Back to Wall" body links. Feature pages Settings/Permissions/Approve/Processes use available width right of sidebar (like Codex).
- Snapshots pre-goldabv2-wall-pty-r3-20261102 and pre-goldabv2-wall-pty-csp-20261102.
- Actual owner Chrome animation/resize/terminal visual acceptance remains separate from source tests.

R4 Approve B two-card segmented input — CURRENT:
- R4 code source 1a99c489, docs-only handoff cae2d872.
- Block A: one-time A code, bold yellow Google Sans Code ~26px/800, clear English instruction to take B from AI chat.
- Center A -> B inline SVG arrow, subtle animation and prefers-reduced-motion support, local asset/no CDN.
- Block B: eight large individual B code character inputs with visual 4+4 separator. Auto-uppercase, auto-next focus, Backspace/ArrowLeft/ArrowRight, paste whole code (including optional B: prefix, whitespace or hyphen) into eight cells and validate accepted alphabet A-HJ-NP-Z2-9.
- The 12s pending feed refresh does not wipe active input while Owner has focused B/consent cell.
- Complete valid B is submitted to UNCHANGED /api/abv2/approve with existing requestId, expectedAttempt, CSRF and conditional Owner consent; human Web confirmation is still required. No auto-approval.
- Tests used synthetic B with a mocked DOM; no real approval/grant executed.
- Snapshot pre-goldabv2-approve-b-r4-20261102 (19:10 ICT); Wall-only deploy from source-fb005567-wall-r3-final-STAGED to source-1a99c489-approve-b-r4-STAGED.
- Immediately post-R4: 4/4 services active, local/public login and HTTPS health 200, 2/2 active grant count, no Wall journal errors.
- At handoff audit later: 1 live grant now (Section 1). Retest identity/time before any permission-affecting actions.
- **STILL OPEN:** actual Owner Chrome screenshot of two blocks/arrow/input, real clipboard behavior, mobile width, and any newly approved B request if Owner elects to create one. Never create an approval to test layout without Owner.

Detailed R4 docs:
  docs/project-book/LIGHT_REMOTE_GOLDABV2_APPROVE_B_SEGMENTED_R4_20261102.md
  docs/project-book/LIGHT_REMOTE_GOLDABV2_APPROVE_B_R4_LIVE_DEPLOY_20261102.md
  /home/ubuntu/handoffs/LIGHT_REMOTE_GOLDABV2_APPROVE_B_R4_LIVE_DEPLOY_20261102.md

---

## 6. MOST IMPORTANT NEXT GATES (ORDERED)

P0 UX / OWNER ACCEPTANCE:
1. Owner opens /approve with a real pending request and reviews R4 card sizes, A code, arrow, responsive layout, focus and paste.
2. Verify any real B submitted is only handled after Owner B, optional Owner consent, web confirmation and signed Operator decision. Do not store/copy a real B/Owner code into logs or this handoff.
3. Check new xterm Viewer on Chrome while Agent PTY is ACTIVE: auto-select, immediate bounded history, progressing output, ANSI echo/prompt, drag, minimize/restore and Resize/FitAddon. The tool/source tests are not visual acceptance.
4. Check full-width Settings/Permissions/Approve versus CodeX/Long Memory and collapsed/expanded persistent sidebar. CSS position and notification popover should not clip at viewport edges.

P0 SECURITY / PRODUCTION BLOCKER:
5. Run human-approved disposable-Agent E2E: fresh A/B, Helper ready, Owner voluntarily Close, exact session and corresponding grant disappear immediately, other Agent untouched; reconnect must require a fresh B. DO NOT close a surviving protected Agent grant for this.
6. Refresh Helper client schema and confirm optional agentNickname before B (backend already supports); test with disposable Agent only.
7. Explicit review of Origin/CSRF/signed approvals, backend grant vs live session semantics and LXD isolation before any promotion. Not production-ready until completed.

P1:
8. Memory Home Linux binding mismatch: verify intended authorized Home/Replica Device ID and signing scope. Do not just change env var to R01KAP.
9. Linux shell selector safe aliases and reserved exit code spawn attestation; current conservative fail-closed behavior stays.
10. Complete scoped 84-tool operational coverage matrix if desired; keep "metadata registered" separate from "live operation tested".

P2:
11. Optional nickname uniqueness semantics for expired historical names.
12. Zero-byte SCP file protocol requires true empty SHA/chunk semantics, not reverting plugin min1.
13. Desktop V4 native Windows pilot and signed read-only/approval API bridge in its OWN branch after ABV2 owner E2E.

---

## 7. REGRESSION AND CI COMMANDS (SAFE, LIGHTWEIGHT)

Execute via official Light Remote authorized VPS-ARM session (read-only and tiny Node selftests allowed; NOT heavy builds):

    cd /tmp/light-remote-gold-single-owner-20261101
    git status --short --branch
    git log -12 --oneline
    git rev-parse HEAD
    git rev-parse origin/feat/gold-single-owner-transfer-20261101

    node deploy/scripts/selftest-gold-abv2-b-segmented-input.mjs
    node deploy/scripts/selftest-gold-ab-v2-wall-preview.mjs
    node deploy/scripts/selftest-gold-abv2-owner-approval-navigation.mjs
    node deploy/scripts/selftest-gold-wall-shared-navigation-dialog-v2.mjs
    node deploy/scripts/selftest-gold-wall-navigation.mjs
    node deploy/scripts/selftest-gold-wall-ui-refinement.mjs
    node deploy/scripts/selftest-gold-wall-google-typography.mjs
    node deploy/scripts/selftest-gold-wall-pty-terminal-r3.mjs
    node deploy/scripts/selftest-g2-wall-pty-viewer.mjs
    node deploy/scripts/selftest-gold-abv2-owner-close-revokes-grant.mjs
    node deploy/scripts/selftest-gold-plugin-tool-contract.mjs
    node deploy/scripts/selftest-gold-wall-close-session-cache.mjs .

Do NOT run selftest-gold-ab-v2-native-pg-grant.mjs or selftest-gold-ab-v2-pending-redis.mjs with opt-in/test clone flags on the real Lab: those require an isolated rollback clone and explicit preconditions.

When CODE changes:
1. Edit only reviewed branch/worktree; update docs/project-book/LIGHT_REMOTE_CODE_MAP.md, WORKLOG.md and .light-remote/CURRENT_CHECKPOINT.json with real evidence.
2. Stage code and docs; run node deploy/scripts/check-project-truth-sync.mjs --stamp (when appropriate), then --staged.
3. Run git diff --cached --check and focused source regressions.
4. Commit, push to origin feat/gold-single-owner-transfer-20261101, confirm GitHub hosted Source Gate and Documentation Integrity results.
5. NO full native distribution builds on VPS-ARM; GitHub Actions runners perform builds.
6. For Lab Wall-only deployment: new immutable stage based on current live Wall source, copy only changed approved files, verify SHA, run tests under gold-uat, take LXD snapshot, atomically edit the FINAL Wall systemd override, daemon-reload/restart only Wall, then inspect all services/health/grants.

---

## 8. LIVE LAB INSPECTION RUNBOOK (READ-ONLY)

    C=light-remote-abv2-lab-20261101
    R=/tmp/light-remote-gold-single-owner-20261101

    git -C "$R" status --short --branch
    git -C "$R" log -10 --oneline
    lxc exec "$C" -- systemctl show light-remote-gold-wall.service -p ActiveState -p WorkingDirectory -p MainPID --no-pager
    lxc exec "$C" -- systemctl is-active light-remote-gold-operator.service
    lxc exec "$C" -- systemctl is-active light-remote-gold-plugin.service
    lxc exec "$C" -- systemctl is-active light-remote-gold-wall.service
    lxc exec "$C" -- systemctl is-active light-remote-gold-process-supervisor.service
    curl -fsS -o /dev/null -w '%{http_code}\n' https://goldabv2.light-remote.thaiduy.digital/healthz

    lxc exec "$C" -- runuser -u postgres -- psql -XAt -d light_remote_gold_dev -c "SELECT COUNT(*) FROM lr_ab_grants WHERE closed_at IS NULL AND expires_at>now() AND device_id='dev_2e6ca4ded175829131a280e9';"

Only inspect aggregate counts in ordinary logs/handoff. For a specific grant identity, work in private authorized diagnostics without copying access tokens, B codes, signed receipts, or raw connection secrets.

---

## 9. SNAPSHOT / ROLLBACK INVENTORY — RECHECK BEFORE USING

Relevant isolated Lab LXD snapshots (observed present):
- pre-owner-close-grant-revoke-20261102
- pre-scp-upload-schema-20261102
- pre-goldabv2-wall-sidebar-20261102
- pre-goldabv2-wall-r2-20261102
- pre-goldabv2-wall-pty-r3-20261102
- pre-goldabv2-wall-pty-csp-20261102
- pre-goldabv2-approve-b-r4-20261102

LATEST Wall R4 rollback:
- Backup inside LXD: /var/backups/light-remote-goldabv2-wall-before-approve-b-r4-20261102.conf
- Prior Wall R3 source: /opt/light-remote-abv2-lab/source-fb005567-wall-r3-final-STAGED
- R4 active Wall source: /opt/light-remote-abv2-lab/source-1a99c489-approve-b-r4-STAGED

Further historical Wall R3 rollback:
- /var/backups/light-remote-goldabv2-wall-before-pty-csp-20261102.conf
- /var/backups/light-remote-goldabv2-wall-before-pty-r3-20261102.conf

IMPORTANT ROLLBACK RULE:
- For a Wall UI regression, restore the exact backed-up FINAL Wall override file atomically (short temporary filename in its drop-in directory), systemctl daemon-reload, and restart ONLY light-remote-gold-wall.service. Verify source WorkingDirectory and four services.
- DO NOT casually restore entire LXD snapshot; it can rewind PostgreSQL and Redis, including resurrecting old revoked grants/Owner state.
- Do not redeploy Operator, Plugin, Process Supervisor for Wall-only changes. Do not use an old server binary just because it matches source HEAD.
- Never rerun historic Claude cleanup SQL or relax its guarded preconditions.

---

## 10. DESKTOP V4 IS A SEPARATE WORKTREE

- Worktree: /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101
- Branch: feat/desktop-v4-shared-ui-20261101
- Last verified HEAD: 3a408718 (independent work).
- Handoff: /home/ubuntu/handoffs/LIGHT_REMOTE_DESKTOP_V4_FULL_MASTER_HANDOFF_2026-11-01.md
- React/Tauri2 pilot, Windows preview, Google Sans/Figma-derived screens; the full signed Owner API bridge has NOT been authorized for production use. Do not confuse Figma design acceptance with native code and auth acceptance.
- Do not edit or merge this worktree during GoldABV2 Wall R4 polish without an explicit Owner request.

---

## 11. CANONICAL REFERENCES AND HISTORICAL EVIDENCE

THIS CURRENT FILE (GitHub):
    docs/project-book/LIGHT_REMOTE_GOLDABV2_FULL_MASTER_LATEST_20261102.md

THIS CURRENT FILE (VPS-ARM):
    /home/ubuntu/handoffs/LIGHT_REMOTE_GOLDABV2_FULL_MASTER_LATEST_20261102.md

Earlier audited release readiness:
    docs/project-book/LIGHT_REMOTE_GOLDABV2_RELEASE_READINESS_20261102.md
    /home/ubuntu/handoffs/LIGHT_REMOTE_GOLDABV2_RELEASE_READINESS_FULL_HANDOFF_20261102.md

R4 feature and live deployment:
    docs/project-book/LIGHT_REMOTE_GOLDABV2_APPROVE_B_SEGMENTED_R4_20261102.md
    docs/project-book/LIGHT_REMOTE_GOLDABV2_APPROVE_B_R4_LIVE_DEPLOY_20261102.md

R3 terminal/flexible pages:
    docs/project-book/LIGHT_REMOTE_GOLDABV2_WALL_PTY_TERMINAL_LAYOUT_R3_20261102.md
    docs/project-book/LIGHT_REMOTE_GOLDABV2_WALL_PTY_R3_LIVE_DEPLOY_20261102.md

R2 layout/approval:
    docs/project-book/LIGHT_REMOTE_GOLDABV2_WALL_REFINEMENT_R2_20261102.md
    docs/project-book/LIGHT_REMOTE_GOLDABV2_WALL_REFINEMENT_R2_LIVE_DEPLOY_20261102.md

R1 sidebar and font baseline:
    docs/project-book/LIGHT_REMOTE_GOLDABV2_WALL_LAYOUT_LIVE_DEPLOY_20261102.md
    docs/project-book/LIGHT_REMOTE_GOLDABV2_WALL_TYPOGRAPHY_20261102.md

Owner contract from October 28:
    GOLD_AB_V2_DEVICE_DISCOVERY_AGENT_INITIATED_SESSION_HANDOFF_20261028.md
Locate the actual file before citing details; historical filename/location may differ.

Project checkpoint/truth:
    .light-remote/CURRENT_CHECKPOINT.json
    docs/project-book/LIGHT_REMOTE_WORKLOG.md
    docs/project-book/LIGHT_REMOTE_CODE_MAP.md

---

## 12. FINAL ACCEPTANCE DEFINITION — DO NOT DECLARE SUCCESS EARLY

Source build/tests, CI, staged Wall rollout and 4/4 Lab health are proved. Current UI R4 is LIVE, but **Owner's actual browser acceptance for segmented B and xterm/terminal UX is still OPEN**. A/B V2 Owner Close grant revocation with fresh disposable Agent is also OPEN. Optional new Helper nickname parameter and Linux Memory Home device binding still require independent review.

Final production certification requires explicit Owner sign-off and security/functional E2E evidence. Continue the isolated Lab only until that point. Protect each active grant, maintain exact authorization per Agent, and preserve rollback and project-truth chronology.

END OF FULL GOLDABV2 MASTER HANDOFF.
