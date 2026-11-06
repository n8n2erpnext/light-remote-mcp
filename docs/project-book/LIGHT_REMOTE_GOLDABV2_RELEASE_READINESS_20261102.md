> **CURRENT GOLDABV2 HANDOFF (2026-11-02 evening):** Read [LIGHT_REMOTE_GOLDABV2_FULL_MASTER_LATEST_20261102.md](./LIGHT_REMOTE_GOLDABV2_FULL_MASTER_LATEST_20261102.md) first. This file is historical and its runtime/grant counts may be stale; the latest consolidated handoff supersedes its NEXT steps.

# LIGHT REMOTE GOLD A/B V2 — RELEASE-READINESS FULL MASTER HANDOFF
## 2026-11-02, 12:09 ICT | GoldABV2 Lab | Code-session continuation

**STATUS: LAB ACCEPTED FOR VERIFIED SUBSYSTEMS; NOT PRODUCTION-CERTIFIED.**
**DOCUMENT AUTHORITY:** This handoff is the latest audited checkpoint; supersedes historical NEXT lines in LIGHT_REMOTE_GOLDABV2_FULL_MASTER_HANDOFF_20261102.md. The 2026-10-28 A/B V2 Device Discovery Agent Initiated Session handoff remains the OWNER CONTRACT.

# 0. START HERE — NO REINTERPRETATION

Owner explicitly asked us to finish safe remaining work and provide a complete, evidence-based handoff before proceeding to Desktop V4. We audited live Lab, Git, source and tests. We DID NOT silently issue a new A/B request, approve an Owner B, revoke the protected GPT-6 grant, alter production/UAT, or build anything on VPS-ARM.

IMPORTANT BOUNDARY:
- Scope: only LXD container light-remote-abv2-lab-20261101, never main light-remote-gold-uat or production.
- Operator + Plugin + Wall + Process Supervisor are different systemd units with shared dependencies. An Operator stop may stop Plugin and Wall; always check/restart all four before claiming health.
- Do not use a whole-container snapshot restore as a casual rollback: snapshots may resurrect previously revoked CLAUDE authorization. Prefer a narrowly scoped systemd drop-in rollback first, then compare auth DB.
- Protect the sole remaining GPT-6 A/B grant and account-approved device R01KAP. A test that would close/revoke GPT-6 needs NEW explicit Owner consent; do not use this grant for destructive acceptance.
- All app/native builds use GitHub Actions CI runners. No npm ci, Vite, Playwright, Rust/Tauri, heavy builds or cache generation on VPS-ARM. SSH Git, tiny Node source selftests and read-only diagnostics are allowed.

# 1. REPOSITORY AND FROZEN BRANCH TRUTH

Source worktree:
    /tmp/light-remote-gold-single-owner-20261101
Branch:
    feat/gold-single-owner-transfer-20261101
Last audited source commit:
    856c4684  fix(gold-abv2): align SCP upload size schema with device contract

Latest handoff commit may be one or two commits AFTER 856c4684, docs only; verify git log and git status before coding. Tracked files were clean after commit; only unrelated untracked node_modules and device-agent/__pycache__ exist. DO NOT delete/reset them as part of audit.

Master source files:
- plugin-server/tools.mjs: MCP tool registration (84 tools), Discovery, Helper, optional nickname, exec result handling, SCP input contract.
- plugin-server/operator-adapter.mjs: account grant/session context, A/B V2 Helper ready and nickname.
- operator-host/executor-routes-device-channel.mjs: signed Owner Wall close, B approval and status routes.
- operator-host/owner-session-close-abv2.mjs: exact Owner close -> Agent-specific grant revoke + client binding detach + close.
- operator-host/agent-client-registry.mjs: detachGrant only exact matching grant/binding.
- operator-host/device-access-grant-registry.mjs: 24h grants, close and authorization checks.
- operator-host/session-manager.mjs: Agent lane active/hold/expired/closed, independent of 24h grant, nickname uniqueness.
- lib/gold-ab-v2-lab-v1-lock.mjs: explicit Lab V1 lock, no production V1 behavior change.
- device-agent/local-wall.mjs: owner Wall actions/CSRF/Confirm, status cache and per-Agent countdown.
- device-agent/platform-adapters/linux.mjs: Linux shell whitelist, native command semantics.
- lib/light-scp-file.mjs: SCP staged upload, integrity, totalBytes>=1.
- plugin-server/gold-memory-bridge.mjs: separate Memory Home/device binding authorization.
- .light-remote/CURRENT_CHECKPOINT.json, docs/project-book/LIGHT_REMOTE_WORKLOG.md and LIGHT_REMOTE_CODE_MAP.md: mandatory project-truth files when source changes.

Related handoffs, read on demand:
    /home/ubuntu/handoffs/LIGHT_REMOTE_GOLDABV2_FULL_MASTER_HANDOFF_20261102.md
    /home/ubuntu/handoffs/LIGHT_REMOTE_GOLDABV2_SINGLE_OWNER_HANDOFF_20261101.md
    /home/ubuntu/handoffs/LIGHT_REMOTE_DESKTOP_V4_FULL_MASTER_HANDOFF_2026-11-01.md
    /home/ubuntu/handoffs/GOLD_AB_V2_DEVICE_DISCOVERY_AGENT_INITIATED_SESSION_HANDOFF_20261028.md
The last reference may have been stored in the repository or handoffs folder; locate/read the actual file instead of guessing content.

# 2. CURRENT RUNNING RUNTIME — VERIFIED 2026-11-02 12:09 ICT

LXD instance: light-remote-abv2-lab-20261101, state RUNNING.
Lab URL: https://goldabv2.light-remote.thaiduy.digital
Lab device: R01KAP, Linux arm64; one device online in this Lab account.
PostgreSQL Lab database: light_remote_gold_dev (not main Gold UAT DB).
Services: all four ACTIVE:
- light-remote-gold-operator.service
- light-remote-gold-plugin.service
- light-remote-gold-wall.service
- light-remote-gold-process-supervisor.service
Public HTTPS /healthz: HTTP 200.

Exact effective source overlays as observed from systemd:
- Operator: /opt/light-remote-abv2-lab/source-94933590-op-overlay-ddd012b1/operator-host/executor.mjs
- Plugin: /opt/light-remote-abv2-lab/source-856c4684-plugin-overlay-14f8bfed/plugin-server/server.mjs
- Wall: /opt/light-remote-abv2-lab/source-38fdc76c-wall-overlay-390192ef/device-agent/operator-agent.mjs
- Process Supervisor: unchanged; verify ExecStart before modifications.

Key Operator environment from systemctl:
    LR_GOLD_INSTANCE_ID=abv2lab01
    LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1=1
    LR_GOLD_SESSION_AGENT_NICKNAME=1

A/B grants: EXACTLY ONE nonclosed, nonexpired grant for R01KAP, belonging to the GPT-6 ChatGPT Agent; no active Claude grant. Historical Claude grant was revoked by a narrowly scoped guarded PostgreSQL transaction and both Claude client bindings/records were closed. DO NOT recreate or reopen Claude's grant.
GPT-6 24h grant ID (audit only, DO NOT use to access outside official tools):
    dag_v2_bc15b3da... (redacted; verify exact ID in private Lab PostgreSQL)
GPT-6 Session history: older GPT-6 Golden Lotus session expired (not active); new Agent working session s_mvys898w_7bece3571695c7ce, backend nickname GPT-6 Golden Lotus 2. Session may move ACTIVE->HOLD after inactivity; HOLD is NOT a revoked grant.

# 3. OWNER-APPROVED A/B V2 PRODUCT CONTRACT — MUST PRESERVE

- BEFORE authorization: Agent can enumerate account-owned device MINIMAL metadata through light_remote_discover_devices, filter by name, hostname, OS, architecture, Short ID, and onlineOnly. NEVER require B for read-only online/offline discovery.
- Device discovery is independent of the old light_remote_list_devices grant-only API. items:[] DOES NOT mean 0 online devices.
- When user says "connect", resolve EXACTLY ONE selected online Short ID, then call Helper with startAbV2=true. Never silently connect to another device.
- Owner verifies and approves a one-time B (4+4) through signed/authenticated Local Wall /approve OR signed-in /account. Do not remove Wall approval, auto-approve, or require an additional Owner code not in the Lab contract.
- A V2 uses stable six-character Short ID and rotating five-character suffix; A expires after 5 minutes. Owner can refresh A. The Helper is Agent initiated, never demand that Owner copy old V1 A flow.
- A/B grants last up to 24 hours PER AGENT/DEVICE. Reapproving B for that Agent replaces its previous grant, does NOT reset other Agents. Sessions have independent 60-minute hold/grace, not 24h; do not conflate timers.
- A/B grant controls remote access; a Helper ready state is required before running remote commands. OAuth and online Discovery alone NEVER authorize execution.
- Owner voluntarily presses Close session: close ONLY that Agent lane, revoke its matching 24h grant immediately, detach the corresponding client binding, and remove THAT grant countdown. Next connection for the revoked Agent must request fresh B. Do not simply hide a Wall timer while grant remains usable.
- Owner-close applies exact sessionId + agentId + account + device + connection + client binding workingContext + grantId. An old session cannot revoke a newer approved grant; one Agent close does not revoke other Agents/devices.
- Agent may choose a playful, optional nickname before post-B Helper session ready; do NOT ask Owner, do not assume ChatGPT is calling, do not require a nickname. Report server-confirmed nickname + sessionId after ready. Nickname collision may append number. Session ID is immutable across rename.
- All policy/Origin/CSRF/independent Owner approval boundaries remain in effect. Do not expand Linux exec privileges, Memory Home authorization, or nonzero command reporting based only on superficial UI.

# 4. VERIFIED LIVE PASS MATRIX

A. DEVICE DISCOVERY: PASS LIVE — official connected Light_Remote_AB schema now exposes all 84 tools INCLUDING light_remote_discover_devices. Direct calls:
  account summary = 1 total / 1 online / 0 offline;
  query R01KAP = same Linux arm64 online;
  query Windows onlineOnly = 0 matches;
  each call requestCreated=false, approvalState=not_issued. NO B generated.
B. EXISTING GRANT: PASS LIVE — official AB Helper returns ready for R01KAP, 24h grant present only for GPT-6; list_devices grant-only API and account Discovery are differentiated.
C. HISTORICAL CLAUDE REVOKE: PASS LIVE — PostgreSQL one active GPT6 grant, zero active Claude grants, zero Claude bindings, two Claude clients closed. Operator restarted after DB reconcile; all services recovered and health200. Backup snapshot exists.
D. OWNER-INITIATED CLOSE SECURITY: SOURCE TEST PASS + LAB DEPLOY PASS — Operator 94933590 verified exact-bound grant revoke and client detachment. Live postpatch Owner new Close->grant vanishes acceptance PENDING because sole protected GPT6 must not be closed without user permission.
E. OWNER B APPROVAL: prior USER-MEDIATED LIVE acceptance proved signing, Wall /approve and /account support and real Claude/GPT6 sessions; fresh end-to-end with a disposable Agent after the last Owner-close change is NOT YET RUN. Never fake human Owner B.
F. NICKNAME: backend feature active; GPT6 persisted GPT-6 Golden Lotus 2 with nameSource agent. Source mocked Helper with and without agentNickname PASS. Current client metadata for Helper still OMITs optional agentNickname even though server implements it; a fresh connected client tool-schema refresh + fresh Agent B would be required for an end-to-end pre-session nickname proof.
G. EXEC NONZERO: PASS LIVE — exit7 returned structured ok:false command_exit_nonzero, executionCompleted=true, commandSucceeded=false, exact stdout + stderr and jobId, no MCP INVALID_ARGUMENT. Exit0 normal. Invalid/unavailable shell exit126 is not falsely marked executionCompleted. Reserved values 72,124,126,127,130 stay conservative until signed command spawn-phase attestation.
H. JOB/FILES/PTY: live scoped exec, managed process, output, PTY, structured files already PASS; NEVER claim all 84 tools runtime tested.
I. SCP ZERO SIZE CONTRACT: PASS SOURCE+LAB RUNTIME 2026-11-02 — commit 856c4684 changed two plugin input declarations from min0 to min1, aligned to existing lib/light-scp-file.mjs. 84-tool registry runtime tested as gold-uat: totalBytes=0/-1 rejected, 1 accepted. ALL Lab 4 services active and HTTP200 after Plugin-only cutover; GPT6 grant unchanged. Empty-file SCP UPLOAD remains unsupported, not silently added.

# 5. TEST AUDIT AND CI

2026-11-02 test execution using lightweight Node source selftests (NO local builds):
- Owner close exact grant isolation; Wall close HTTP/cache; Helper V1 lock, target/poll/recovery; Discovery no B; Agent nickname; nonzero exit classification; 84 MCP tool metadata; signed Owner approval/preview, Origin/CSRF; grant per Agent/24h; Device SCP file/owner/routing/chunk compatibility; native Terminal and Terminal plane; Memory modes — PASS.
- Wall close cache initially gave ROOT_REQUIRED due missing command-line root argument. Correct invocation is: node deploy/scripts/selftest-gold-wall-close-session-cache.mjs . ; it then PASSED.
- Two special test scripts selftest-gold-ab-v2-native-pg-grant.mjs and selftest-gold-ab-v2-pending-redis.mjs have mandatory explicit opt-in and a separate no-network rollback clone hostname (gold-p2a-runtime-rollback-20261030); they failed the PRECONDITION before touching DB/Redis on VPS. DO NOT set those flags on the real Lab/VPS and never report as runtime regression or PASS.
- 84/84 REGISTERED DOES NOT MEAN 84/84 TOOL OPERATIONS TESTED.
- New source commit 856c4684 GitHub Actions:
  Gold Connection Lifecycle GC Source Gate — run 41391998357 SUCCESS
  Gold documentation library integrity — run 41391998373 SUCCESS.
- Previously owner-close 94933590 CI 2/2 PASS; nickname commits ddd012b1 and 14f8bfed CI 2/2 PASS; P0 exec commits e519175b and 3b61c558 verified source/live scoped.
- After writing THIS handoff, check final docs-only commit and source status; do not claim CI source runs for a docs-only commit unless checked.

# 6. KNOWN REMAINING ACCEPTANCE GATES, SEPARATED BY PRIORITY

P0 HUMAN AUTHORIZATION (BLOCKS PRODUCTION PROMOTION):
- Owner Close->grant revoke: source tested and running on Lab, but a FRESH real B-approved disposable Agent must be connected, then Owner Close on Wall; check immediate removal of session, active Agent grant, client binding and 24h timer. Verify GPT6 grant untouched. On reconnect Agent must get approval_required/new B. Requires explicit Owner interaction, cannot be replaced with a fake/SQL-approved B. Current sole GPT6 grant MUST NOT be used as sacrificial test.
- Also verify Owner B on BOTH Wall and Account with chosen disposable test Agent only if Owner authorizes new pairing and Grant. Test without copying B into logs/handoff.
- CLI compatibility for fresh Agent nickname: tools metadata refresh so optional agentNickname appears in Helper schema. Agent can already rename with light_remote_context after grant. Existing current-client helper lacks the new schema argument; only actual fresh client binding can prove pre-session nickname.

P1 SECURITY / INTEGRATION REVIEW:
- Long Memory: Lab Plugin has LIGHT_REMOTE_GOLD_MEMORY_DEVICE_ID set to a DIFFERENT Device ID than R01KAP, though LIGHT_REMOTE_GOLD_MEMORY_CLIENT_ROOT exists. gold-memory-bridge.mjs properly enforces device-scoped root and throws gold_memory_device_binding_mismatch. Determine the intended Memory Home / authorized replica / signed scope BEFORE changing ID or enabling local reads. Do not bypass the guard.
- Linux shell: platform adapter accepts shell modes default, bash, zsh, sh; an input of /bin/sh is NOT a supported selector and gives linux_shell_unavailable. Calling shell:'sh' is verified to work. Decide if a carefully whitelisted canonical path alias is needed; do not loosen arbitrary executable path policy.
- Reserved Linux exec exit codes may be legitimate app exits, but cannot be distinguished from Agent pre-spawn denial with the existing receipt. Future protocol enhancement: explicit signed spawned/exec-phase field before classifying reserved numbers as command execution. Preserve conservative fail-closed current behavior.
- Per-Agent grant 24h vs session hold 60m, including restart and duplicate nicknames, should remain two independent UI concepts. Wall active grant count is not session count.

P2 UX AND MAINTENANCE:
- Nickname uniqueness currently reserves old expired GPT-6 Golden Lotus name, resulting in GPT-6 Golden Lotus 2. Cosmetic only; do not delete session history or grant merely to reclaim string. Any future uniqueness change needs new test for active collisions and expired history.
- SCP upload empty file support NOT implemented. Current contract explicitly requires >0 bytes. To support empty file later, implement zero-chunk SHA256(empty) commit semantics throughout device/Plugin/Agent with tests; NEVER just change min1 back to min0.
- Consider Owner Wall success/error toast and request-id after Close to avoid stale cache ambiguity. Current cache invalidate, stale-response fencing and close HTTP tests PASS.
- 84 tools should be validated in an intentionally scoped acceptance matrix, not asserted runtime PASS from metadata alone.

# 7. SAFE ROLLBACK, BACKUPS, AND OPERATIONAL CAUTIONS

LXD snapshots verified present:
- pre-owner-close-grant-revoke-20261102
- pre-keep-gpt6-claude-revoke-20261102
- pre-scp-upload-schema-20261102

Plugin override backup for the latest source-only SCP contract update:
    /var/backups/light-remote-abv2-lab/plugin-before-scp-856c4684-20261102.conf
Older Operator override backup for Owner Close:
    /var/backups/light-remote-abv2-lab/operator-before-owner-close-94933590-20261102.conf
Historical exact Claude cleanup SQL and rehearsal:
    /home/ubuntu/handoffs/abv2_keep_only_gpt6_20261102.sql
    /home/ubuntu/handoffs/abv2_keep_only_gpt6_dryrun_20261102.sql

Do NOT rerun historical Claude cleanup SQL: its strict preconditions expect 2 active grants and MUST fail after cleanup. Never make it idempotent by loosening identifiers. Full-container restore to an older snapshot could REOPEN Claude; never perform one without auditing grant rows and Owner approval. For rollback of SCP schema, use ONLY the saved Plugin systemd override (and daemon-reload/restart) if needed; then verify all four services + HTTPS200 + only GPT6 grant. Operator service restart may stop dependent Plugin/Wall: manually restart those if inactive, then recheck health. No uncontrolled restart/promotion on main UAT or production.

Read-only operational commands, execute via official Light Remote authorized VPS-ARM session:
    git -C /tmp/light-remote-gold-single-owner-20261101 status --short --branch
    git -C /tmp/light-remote-gold-single-owner-20261101 log -8 --oneline
    lxc list -c ns
    lxc exec light-remote-abv2-lab-20261101 -- systemctl is-active light-remote-gold-operator.service
    lxc exec light-remote-abv2-lab-20261101 -- systemctl is-active light-remote-gold-plugin.service
    lxc exec light-remote-abv2-lab-20261101 -- systemctl is-active light-remote-gold-wall.service
    lxc exec light-remote-abv2-lab-20261101 -- systemctl is-active light-remote-gold-process-supervisor.service
    curl -sS -o /dev/null -w '%{http_code}\n' https://goldabv2.light-remote.thaiduy.digital/healthz
    lxc exec light-remote-abv2-lab-20261101 -- runuser -u postgres -- psql -X -At -d light_remote_gold_dev -c "SELECT count(*) FROM lr_ab_grants WHERE closed_at IS NULL AND expires_at>now() AND device_id='dev_2e6ca4ded175829131a280e9';"

Do NOT print B codes, encrypted request payloads, secrets, OAuth tokens or complete private session cap tokens in worklog.

# 8. DESKTOP V4 — DISTINCT HANDOFF AND NEXT PIPELINE

The Desktop UI V4 code worktree is separate:
    /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101
    branch feat/desktop-v4-shared-ui-20261101
    HEAD 3a408718 (clean tracked as read-only verified 2026-11-02)
    /home/ubuntu/handoffs/LIGHT_REMOTE_DESKTOP_V4_FULL_MASTER_HANDOFF_2026-11-01.md

Desktop V4 is React + Tauri2 pilot, 9 screens, Google Sans, light/dark, GitHub CI hosted builds (prior 4/4 PASS); Owner downloaded build, native Windows acceptance still outstanding. It is UI-only Pilot with read-only fail-closed status, not a fully authorized signed Owner API Bridge. Do not confuse Moryqa/Figma DESIGN session with code session; design freeze pending. Don't edit current WinForms/Agent, live Gold UAT, production, migration schemas or handoff branches to "finish" the UI prematurely.

After GoldABV2 Owner-close REAL acceptance and Helper schema refresh, the code session may plan the signed, least-privilege V4 API Bridge for Device Discovery, nickname/session lanes, B approval and grant countdown without any unauthenticated control or invented Open/Approve successes.

# 9. NEXT-SESSION HANDOFF RUNBOOK — FOLLOW THIS ORDER

1. Read THIS file fully. Then read the original 2026-10-28 Device Discovery Agent Initiated Session contract, the historic 2026-11-02 master, Git log/diff, checkpoint and source. Do not start coding from a stale handoff section.
2. Call official Light Remote helper on VPS-ARM; recover authorized session. Read-only verify Lab 4/4, HTTPS200, 84th direct Discovery and exactly ONE GPT6 grant; no Claude client access.
3. Verify the final docs commit and 856c4684 SCP input contract are present; do not rebuild on VPS. Check CI/branch divergence before edits.
4. Decide with Owner when to run the remaining disposable-Agent postpatch close/B flow. NEVER revoke GPT6 grant; require real Owner B and a disposable Agent. On Close check exact grant removed, DB client binding gone, Wall timer removed, and fresh reconnect creates new B. Record live evidence with no secrets.
5. Refresh ChatGPT/Claude plugin metadata in a new session; verify optional agentNickname is advertised by Helper, and run fresh Agent nickname choice only with Owner-approved disposable B. Do not force Owner to supply a nickname.
6. Independently review Memory Home mismatch; keep fail-closed until target identity and signed scope are proven. Shell alias and empty SCP upload are separate P1/P2 design decisions.
7. When true authorization acceptance is done, return to Desktop V4 CODE worktree and its own handoff; test downloaded Win pilot with Owner, implement authenticated bridge in a separate reviewable branch.
8. For every source change: update CURRENT_CHECKPOINT.json + WORKLOG.md + CODE_MAP.md, run node deploy/scripts/check-project-truth-sync.mjs --stamp and --staged, git diff --cached --check, commit and push over GitHub SSH, verify hosted CI. Keep rollback for all Lab-only deployments. Do not promote to Gold UAT or production without explicit authorization.

# 10. FINAL RELEASE GATE

ACCEPTED LIVE on Lab: Discovery without B, existing authorized Helper ready, one protected GPT6 grant and no Claude, Owner historical cleanup, scoped exec exit0/exit7 & invalid shell safety, source 84 tools and runtime schema positive/negative, basic terminal/process/files, Lab health.
SOURCE TESTED and DEPLOYED but NOT fresh Owner live E2E: Owner Close session simultaneously revoking its Agent's 24h grant (94933590).
SOURCE TESTED and DEPLOYED but client schema partially stale: optional nickname at pre-session Helper.
NOT MODIFIED intentionally: Memory Home device authority mismatch, arbitrary /bin/sh shell aliases, true zero-byte upload capability, reserved exit spawn attestation, current Gold UAT/production, native Desktop V4.

**DO NOT CLAIM PROD READY OR ALL 84 TOOLS RUNTIME PASS.**
**SUCCESS CRITERION FOR NEXT SESSION: finish specifically enumerated acceptance gates without disturbing the surviving GPT-6 grant.**
