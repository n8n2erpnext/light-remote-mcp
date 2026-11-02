> **CURRENT GOLDABV2 HANDOFF (2026-11-02 evening):** Read [LIGHT_REMOTE_GOLDABV2_FULL_MASTER_LATEST_20261102.md](./LIGHT_REMOTE_GOLDABV2_FULL_MASTER_LATEST_20261102.md) first. This file is historical and its runtime/grant counts may be stale; the latest consolidated handoff supersedes its NEXT steps.

# LIGHT REMOTE — GOLDABV2 FULL MASTER HANDOFF
Date: 2026-11-02, Asia/Ho_Chi_Minh
Owner project: Light Remote Gold, isolated A/B V2 Custom MCP / exactly-one Owner / Linux Link-Relink.
Intended reader: next ChatGPT session with the OFFICIAL connected Light Remote tool, access to VPS-ARM.
Priority: READ THIS ENTIRE FILE BEFORE WRITING CODE OR RUNNING DESTRUCTIVE COMMANDS.
This document SUPERSEDES historical NEXT BLOCKER lines in 20261101 handoffs. They describe earlier states.
Last checked approximately 2026-11-02 02:15 VN. Reconfirm any dynamic runtime state first.

## 0. EXECUTIVE CHECKPOINT — START HERE

MOST IMPORTANT NEW FINDING: The GoldABV2 Linux Lab Agent appears ALREADY RE-LINKED and connected to the NEW, VERIFIED Owner, contrary to the historical handoff which said "relink still pending":
- Verified sole Owner: th.dangduy@gmail.com, account_id acct_b8c9d023-9b62-4052-99dd-904f21a6e79c, active and email_verified=true.
- Old fake Owner: gold-native-uat-20261019@example.invalid, account_id acct_9e7e305b-c27c-494c-ae82-1b350a832164, admin_disabled.
- SQL045 owner singleton revision=1, one owner handoff audit row; DO NOT repeat Owner transfer.
- Lab device signed enrollment and owner binding: dev_2e6ca4ded175829131a280e9 -> new Owner. Lab operator registry row present, nonrevoked. Local Agent status --unit light-remote-gold-wall.service shows enrolled=true, account_id=new Owner, no pending enrollment, cloudState=connected; lab PG device connection from 2026-11-01 19:13:18 UTC (02:13:18 VN) is not closed. This is evidence of completed signed onboarding, not an instruction to relink again.
- Previous lab device ID dev_e68276c691ba5413f42d5dde belongs to DISABLED OLD Owner. Previous Short ID X3AQQ6 maps to that OLD device ID; NEVER target X3AQQ6 for the new Owner.
- BLOCKER NOW: PG043 lr_gold_device_short_ids has NO row for NEW device dev_2e6ca4ded175829131a280e9. There are exactly 3 historical rows (DQBH12, Q79WC4, X3AQQ6), none belongs to the new Owner device. A/B V2 helper requires a Short ID; new device may be undiscoverable until this is fixed. Existing lib/gold-device-short-id.mjs exports ensureGoldDeviceShortId(pool,{deviceId}) and backfillGoldDeviceShortIds(pool,...); code contains SQL unique/tombstone protections. Investigate lifecycle hook on new enrollment; fix permanent automatic assignment and tests. Avoid manual arbitrary six-character assignment or reusing old X3AQQ6.
- A/B V2 GRANT NOT ACCEPTED YET: new Device ID has 0 grants total, 0 active in lr_ab_grants. Do not claim "B approved/24h ready" on new Owner. Next acceptance: Short ID -> Agent A/B V2 request -> Owner approve B remotely via /account flow -> durable grant -> Helper ready + 24h and policy tests.
- Source Link/Relink fix was deployed to lab successfully; operator/wall source commit 665daa91; helper latest text-only commit 68163e06 installed. No 2FA/Soft OTP/new-login security code was enabled.
- Lab is currently healthy: Operator, Plugin, Wall, Process Supervisor 4/4 active; public /healthz 200, TLS verify 0. Main Gold UAT production staging schema042 untouched.

## 1. CONNECTION, WORKING SOURCE, GIT TRUTH

Use OFFICIAL Light Remote plugin connected to this VPS-ARM; call light_remote_connection_helper first to obtain CURRENT context/session, then use focused light_remote_exec/read_file/output. Never assume the old sessionId remains valid; do not enumerate/retarget other devices unnecessarily. Do not touch unrelated worktrees.
Host: VPS-ARM (Oracle ARM64) under the owner's authorization.
GitHub repo: git@github.com:n8n2erpnext/light-remote-mcp.git
Feature branch: feat/gold-single-owner-transfer-20261101
Current HEAD: 68163e066695fa49f640e47525e3cf0c545b38d5
Important prior runtime commit: 665daa91ff638bddd1921fd3c2ebc3923136bf5d
Feature worktree: /tmp/light-remote-gold-single-owner-20261101
CAUTION: /tmp may vanish after VPS reboot. If missing, locate the Git repo/worktree and recreate from pushed branch, not from unrelated Gold feature worktree.
Git remote push confirmed. At latest check git status clean for tracked files; untracked node_modules and device-agent/__pycache__ existed, generated/temporary, NOT to be committed.
Other Gold worktrees contain unrelated changes. Do not overwrite/squash/cherry-pick over their uncommitted files.
Git history:
  68163e06  docs(gold): record lab Link Relink acceptance and helper guidance
  665daa91  fix(gold): preserve Wall Link and OS-terminal Relink ownership boundary
  a73224a7  feat(gold): local-console-only Linux Server owner relink [SUPERSEDED by 665daa91]
  55efc49d  fix(gold-owner): use shipped Material security icon in Owner panel
  2587f79d  fix(gold-owner): responsive post-transfer Admin authority UX
  fa0699ee  fix(gold-owner): grant narrow SQL045 Operator table permissions
Earlier Owner feature initial commit 6659594d.
IMPORTANT: 68163e06 is a docs/helper-message revision, not a new Operator runtime deployment. Do not equate source HEAD with active runtime binary.

Before commit:
  cd /tmp/light-remote-gold-single-owner-20261101
  git status -sb
  git log -6 --oneline
  git diff --check
  node deploy/scripts/check-project-truth-sync.mjs --stamp
  git add <all intended code and docs>
  node deploy/scripts/check-project-truth-sync.mjs --staged
  git diff --cached --check
  git commit; git push origin feat/gold-single-owner-transfer-20261101
Project Truth mandates Code Map + a NEW dated Worklog milestone for security/device/runtime changes; rerun guard on staged set. Do not claim GitHub CI PASS unless actual run result verified; local regression PASS is established below.

## 2. RUNNING LXD LAB — STRICT ISOLATION

LXD: light-remote-abv2-lab-20261101
OS: Ubuntu 24.04 ARM64; previously COW cloned from a Gold test container.
LXD limits: 2 vCPU / 4 GiB RAM, boot.autostart=false historically; check before reboot. Host /etc/systemd/system read-only historically; reboot recovery may require host firewall narrow rule.
Lab NIC eth0: 10.192.135.62/24; gateway 10.192.135.1; DNS 1.1.1.1 and 8.8.8.8.
Lab nft output rule default DROP, allows required DNS and Zoho SMTP TCP465; persistence unit goldabv2-smtp-egress.service enabled (reboot proof still outstanding). Do not open broad egress or read/print SMTP credentials.
Public Custom MCP: https://goldabv2.light-remote.thaiduy.digital/mcp
Health: https://goldabv2.light-remote.thaiduy.digital/healthz
Account: https://goldabv2.light-remote.thaiduy.digital/account/login
Admin: https://goldabv2.light-remote.thaiduy.digital/admin
Register: https://goldabv2.light-remote.thaiduy.digital/account/register
NetBird-only lab Wall: http://100.94.184.141:15591/login (NOT public HTTP endpoint).
Host Traefik dynamic file: /home/ubuntu/netbird/traefik-dynamic.yaml
Lab LXD public plugin proxy: host 172.30.0.1:15583 -> lab loopback 127.0.0.1:5583.
Lab Wall private proxy: NetBird host 100.94.184.141:15591 -> lab loopback 127.0.0.1:5491.
Host Traefik ingress firewall rule may NOT persist across host reboot (historical /etc read-only). Review original LXD handoff before modifying.
Most recent service names, ALL active:
  light-remote-gold-operator
  light-remote-gold-plugin
  light-remote-gold-wall
  light-remote-gold-process-supervisor
Runtime source paths are intentionally MIXED:
  operator -> /opt/light-remote-abv2-lab/source-665daa91
  wall     -> /opt/light-remote-abv2-lab/source-665daa91
  plugin   -> /opt/light-remote-abv2-lab/source-55efc49d
  process-supervisor -> /opt/light-remote-abv2-lab/source-fa0699ee
Root terminal helper at /usr/local/sbin/light-remote-device, root:root mode 0700, latest message revision 68163e06 (not a service).
Lab uses extremely long lexically-final systemd drop-in override filenames due inherited historical drop-ins. DO NOT blindly replace another .conf or call service install scripts over this lab. Inspect final merged systemctl cat/show first.
LAB Operator has LR_GOLD_SINGLE_OWNER_AUTHORITY=1 and LR_GOLD_SINGLE_OWNER_TRANSFER=1, keep authority ON.
LAB Plugin and Wall have LR_GOLD_INSTANCE_ID=abv2lab01 and LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1=1: V1 BLOCKED ONLY IN LAB. PRODUCTION V1 FALLBACK MUST STAY ON. LR_GOLD_AB_V2_OWNER_APPROVE_HTTP, WALL_SIGNED_APPROVE, DURABLE_GRANT_BRIDGE are enabled on LAB Operator.
Lab PostgreSQL17 + Redis8 run separately from Gold UAT. Current lr_schema_migrations max(version)=43; SQL045 owner tables applied manually ONLY INSIDE lab, to_regclass owner authority present and permissions granted. Never apply 043/044/045 migrations to main Gold UAT or production without signed migration governance.
Main Gold UAT: LXD light-remote-gold-uat, schema version42 verified. Production direct separate LXD light-remote-direct. Neither was changed in this work except read-only inspection.
No passwords, SMTP secret values, Redis URLs, B codes, certificate private keys or session tokens in this handoff; only consult metadata/read-only checks.

### Lab snapshots and backups (verify before restore)
  pre-single-owner-20261101                 2026-11-01 23:43 VN
  pre-smtp-mail-20261101                    2026-11-01 23:57 VN
  pre-owner-ux-v2-20261102                  2026-11-02 00:33 VN
  pre-linux-owner-link-relink-20261102      2026-11-02 02:02 VN
  Pre-SQL045 PG custom backup: /home/ubuntu/handoffs/GOLDABV2_BEFORE_SINGLE_OWNER_20261101.pgcustom
DO NOT casually restore pre-linux-owner-link-relink snapshot: Owner may have relinked new device later (new signed binding established 02:13 VN). Snapshot rollback would erase newer work. First capture CURRENT snapshot and obtain owner approval before any rollback.

## 3. CONFIRMED OWNER HANDOFF + ADMIN UX

Gold lab exactly ONE Owner:
  email th.dangduy@gmail.com
  account_id acct_b8c9d023-9b62-4052-99dd-904f21a6e79c
  email_verified TRUE, account status active
  SQL singleton revision 1, handoff audit count 1
Old legacy account:
  gold-native-uat-20261019@example.invalid
  account_id acct_9e7e305b-c27c-494c-ae82-1b350a832164
  account status admin_disabled
No owner transfer needs repeating. Do not re-enable old fake Owner. The SQL045 singleton typed owner authority must stay ON.
Web Admin owner UX fixed after owner pointed out broken horizontal 3-column dangerous form: Accounts shows compact Owner summary first (email, verified, revision/history), an OWNER account badge, disabled/hidden transfer form when no verified destination. Transfer form shown as two-step responsive layout only when eligible target; old dangerous button layout gone. Admin CSS cache-busted rev=owner-authority-ux-v2, security.svg icon verified. Files:
  plugin-server/admin-portal/index.html
  plugin-server/account-portal/portal.css
  operator-host/executor-routes-account.mjs
  deploy/scripts/selftest-gold-owner-authority-ux.mjs
UI deploy from source-55efc49d (Plugin), Operator from 665daa91 includes response fields. Browser visual acceptance by owner may remain pending; existing HTML/CSS/DOM regression PASS.
SMTP Zoho production sender was owner-copied into LAB at /etc/light-remote-direct/mail.env (mode0640 root:gold-uat); mailConfig=true, verifyMail()=PASS, TLS1.3 cert verified. DO NOT print/copy secret back into ChatGPT. Human registered and verified new Owner account; no need to register it again.

## 4. FINAL LINK/RELINK CONTRACT — USER REQUIREMENT, DO NOT REINTERPRET

Only TWO ownership states:
A. NEW device OR device that old Owner EXPLICITLY REVOKED -> UNOWNED -> Link through existing Wall by ANY valid account, including old owner. Wall code approval remains part of legitimate Link workflow; do not demand "physical console" or VPN for this.
B. ACTIVE assigned device -> already belongs to an account -> Relink MUST be initiated ON THE DEVICE. Windows/macOS Tray or upcoming local app. Linux Server OS administrator Terminal; interactive SSH with valid sudo is OK and EXPECTED for headless servers. Wall alone cannot Relink active device, even if its domain/IP and the account password are known.
Underlying security principle: possession of public/LAN Wall credentials is NOT ownership of host OS; Linux OS sudo admin is trusted to manage its own device. No extra forced local-console seat, no mandatory new OTP, no inferred Agent identities, no unsolicited privilege reductions on remotely approved sessions.

Code fixed in 665daa91:
  device-agent/operator-agent.mjs
    - For ACTIVE bound device: Wall beginEnrollment returns 403 device_relink_requires_local_app_or_terminal.
    - For REVOKED or REMOVED: Wall original Link flow remains; foreign-account Wall login now allowed only after release. Active foreign account login returns device_account_mismatch.
    - Linux Terminal login --relink rotates/stages NEW Ed25519 key, preserves old enrolled key until destination account approves and valid signed certificate verifies; denied/expired must not switch ownership.
    - Relink retains existing filesystem roots, explicit denies and signed-approved capability ceiling. Respect user-approved sudo, DO NOT remove it.
    - Local root-runuser boundary protects CLI from an ordinary remote Wall API triggering new identity; does not require physical console.
  device-agent/relink-linux-server.py (installed as /usr/local/sbin/light-remote-device)
    - Commands link, relink, complete, status; link/relink require interactive sudo terminal and typed LINK or RELINK confirmation, including SSH TTY.
    - Discovers existing OS systemd Agent service; can explicitly specify --unit light-remote-gold-wall.service for lab.
    - Stops active daemon around state mutation, always restarts it even if action fails. Poll completion is successful ONLY when returned state=approved.
    - NOT callable by Wall/MCP as an ownership action, do not run for owner via AI.
  device-agent/local-wall.mjs
    - Gives helpful mismatch instruction for Linux terminal relink; ordinary Link remains.
  operator-host/enrollment-registry.mjs AND operator-host/device-registry.mjs
    - ACTIVE key owned by A cannot be reassigned to B through Wall Link.
    - EXPLICIT REVOKE releases A ownership; same device key may be Link-approved to any valid account. Both registries MUST agree. No manual DB owner edits.
  device-agent/install-linux-service.sh
    - root:root mode0700 installs /usr/local/sbin/light-remote-device on supported Linux hosts.
  deploy/scripts/selftest-linux-server-relink.mjs
    - signed new identity, unchanged prior until approval, certificate tamper fail closed, cross-account active deny, revoked cross-account re-Link success, grants ceilings/local deny preserved, dormant when approved.
  deploy/scripts/selftest-device-agent-cli.mjs
    - active foreign-account Wall login denied, revoked foreign-account login success, revoked Wall Link success, Linux active Wall Relink denied.
Other tests: selftest-gold-windows-tray-relink.mjs, selftest-v10-macos-relink-auth.mjs, selftest-v09-local-wall.mjs, selftest-gold-ab-v2-lab-v1-lock.mjs PASS locally. Git Project Truth check PASS. No confirmed GitHub CI result should be asserted without checking run.
For Linux command context after reinitialization:
  sudo lxc exec light-remote-abv2-lab-20261101 -- /usr/local/sbin/light-remote-device status --unit light-remote-gold-wall.service
  # Terminal relink is ONLY needed if active device STILL belongs to prior owner. At 02:15 VN it already belonged to new Owner. DO NOT run relink redundantly.
  # If legitimate relink were needed in future: SSH with TTY, sudo lxc exec -t ... (check PTY support), run root helper relink, approve one-time Activation URL under target /account, then helper complete; NEVER remotely invoke it on behalf of owner.
CAUTION: The helper's default autodetect should be checked; Gold Lab uses light-remote-gold-wall.service. Explicit --unit is safest in lab.

## 5. UPDATED LIVE DEVICE FACTS — KEY NEXT BLOCKER

Most important current facts from PostgreSQL / Agent:
- OLD disabled owner device: dev_e68276c691ba5413f42d5dde, display_name light-remote-gold-uat, bound to old disabled account.
- OLD Short ID X3AQQ6 maps to that old Device ID. Do not route new Owner helper to X3AQQ6.
- NEW verified Owner device: dev_2e6ca4ded175829131a280e9, display_name light-remote-abv2-lab-20261101, nonrevoked and signed enrollment bound to NEW account. Lab Agent status reports connected, no pending enrollment, policy full, and signed certificate. PG connection row connected 2026-11-01 19:13:18 UTC; hard_expires_at 2026-11-04 19:13:18 UTC; closed_at NULL; owner plan vip. These are DEVICE CONNECTION facts, NOT Agent 24h grant acceptance.
- lr_gold_device_short_ids currently has only DQBH12, Q79WC4, X3AQQ6 for historical devices. Missing NEW device ID entry. Owner's newly linked Agent currently has no Short ID.
- lr_ab_grants has 0 total / 0 active rows for new Device ID. The A/B V2 24h per-Agent grant E2E IS NOT TESTED or accepted yet.
Existing helper discovery SQL JOIN only includes lr_devices joined to lr_gold_device_short_ids and requires matching account. Without a new Short ID, verified new Owner has no eligible discoverable target even though device is connected. DO NOT skip to B flow until Short ID assigned.
Source for Short IDs: lib/gold-device-short-id.mjs (ensureGoldDeviceShortId(pool,{deviceId}), backfillGoldDeviceShortIds(pool,{batchSize,maxDevices})). Generator uses six-character stable ID, SQL unique/tombstone nonreuse and collision retry; this module's top comment is historical and may be stale. Must verify lifecycle invocation. Current code first backfilled existing devices in one batch; apparently newly enrolled devices are not auto-assigned. Recommended fix:
  1. Read exact enrollment and DeviceRegistry call sites in operator-host/executor-routes-account.mjs, operator-host/executor-routes-device-channel.mjs, and lib/gold-device-short-id.mjs; inspect actual runtime source, do not guess.
  2. Add proper lifecycle allocation on successful enrollment/commit (durably, idempotently), ideally coordinated with existing SQL grant/permissions and persistence, no race or invalid Short ID. Preserve the old short ID on its old Device ID; new Device ID gets its own Short ID, stable over rename/reconnect.
  3. Add specific source + PG test covering new verified Owner re-enrollment, first Short ID assignment, repeated allocation/collision/restart, revoked device exclusion, account-scoped discovery.
  4. Snapshot lab BEFORE patch; stage Project Truth + migration lock review; deploy ONLY lab Operator/Plugin if changed; check PostgreSQL assignment and Helper TARGET discovery under new account.
  5. Do not manually SELECT+INSERT a made-up Short ID, do not reuse X3AQQ6, do not rewrite old device account or Key.
Read-only diagnostics, run via VPS ARM and LAB:
  lxc exec light-remote-abv2-lab-20261101 -- runuser -u postgres -- psql -X -At -d light_remote_gold_dev -c "SELECT device_id,owner_account_id,display_name,revoked_ms FROM lr_devices WHERE device_id IN ('dev_2e6ca4ded175829131a280e9','dev_e68276c691ba5413f42d5dde')"
  lxc exec light-remote-abv2-lab-20261101 -- runuser -u postgres -- psql -X -At -d light_remote_gold_dev -c "SELECT short_id,device_id FROM lr_gold_device_short_ids ORDER BY short_id"
  lxc exec light-remote-abv2-lab-20261101 -- runuser -u postgres -- psql -X -At -d light_remote_gold_dev -c "SELECT COUNT(*) FILTER (WHERE closed_at IS NULL AND absolute_expires_at>now()),COUNT(*) FROM lr_ab_grants WHERE device_id='dev_2e6ca4ded175829131a280e9'"
  lxc exec light-remote-abv2-lab-20261101 -- /usr/local/sbin/light-remote-device status --unit light-remote-gold-wall.service
Do not echo secrets. State changes may have happened after writing this file — verify!

## 6. POST-SHORT-ID ACCEPTANCE TEST — A/B V2

Must preserve:
- Owner can approve from /account remotely even when Wall not exposed to public Internet.
- Short ID six stable chars for device + rotating A-code 5 chars, request lifetime 5 min; B 4+4 characters; 24h grant EACH Agent; approved new B restarts that SAME Agent's lease, not other Agents. Agent Session nickname is decorative only; cannot identify "trusted" ChatGPT/Claude model instance reliably.
- Explicit device selection, no silent Main fallback; no bypass of signed owner B; fail closed on disconnected/revoked devices; stale/UNKNOWN jobs not a cause to relax authority.
- Lab deliberately has V1 disabled to force A/B V2 acceptance; main Gold UAT and production V1 remain available.
After new Short ID:
  A. Confirm /account (new verified Owner) sees device as active and proper Short ID; confirm Admin authorized account and V1 disabled in lab.
  B. Connect ChatGPT Custom MCP at https://goldabv2.light-remote.thaiduy.digital/mcp using intended account. Use EXACT new Short ID; trigger Agent-originated request (no guessing B). B approval must work from /account without requiring public Local Wall; inspect the actual owner HTTP + signed Wall bridge if inconsistencies occur.
  C. Check PG/Redis/registry after approval: exact device ID, account, connection, agent client scope, approved_at and absolute expiration <=24h, no grant authorized before durable commit.
  D. Reconnect/resume same Agent, verify ready and no silent device fallback; test B refresh same-Agent cancel/reset, other-Agent unaffected; expiry/revoke closes grants immediately.
  E. Negative tests: previous old X3AQQ6 must NOT target new Owner; unknown Short ID, incorrect/expired B, cross-account attempt, revoked device, stale signature/connection, unverified owner, replay, unauthenticated API all denied.
  F. Leave actual human B approval to OWNER; do not automatically bypass it via source/SQL/test flags. Never print sensitive request tokens or code secrets in handoff/logs.
The exact B v2 acceptance still needs human action, so do not mark complete just from source regressions.

## 7. DEFERRED SECURITY THINKING — NO IMPLEMENTATION NOW

User expressly wants to KEEP A/B V2 as architecture for Work Anywhere and IT Support. Remote /account B approval is necessary; do not force local-only V1 or VPN and do not block OS-approved sudo. A/B V2's main risk is compromised /account login/session could create and self-approve a request; neither arbitrary restrictions on device capabilities nor supposedly stable Agent identity solves this.
Separate COMPLETE research handoff:
  /home/ubuntu/handoffs/LIGHT_REMOTE_ABV2_ACCOUNT_LOGIN_SECURITY_RESEARCH_HANDOFF_20261102.md
  docs/project-book/LIGHT_REMOTE_ABV2_ACCOUNT_LOGIN_SECURITY_RESEARCH_HANDOFF.md
Owner considering (no choice made):
  * Unknown browser/device signs in -> challenge or notice
  * Email Soft OTP to registered verified address for unfamiliar browser (mail sender already exists)
  * Apple's iCloud-like trusted-device approval for new login
  * Concurrent logins far apart in IP/geography/timezone -> risk signal, perhaps step-up, not automatic false-positive geo blocks; VPN/mobile/roaming can invalidate IP geo.
  * Recovery path for one-device user and known trusted-device loss; new-device cookie cannot serve as independent cryptographic approval.
  * Later passkey/2FA, alerts and suspicious-session/account logout.
Status: RESEARCH ONLY. NO OTP, MFA, trusted device, geo-check or account risk service enabled. Do not write code or change A/B V2 until owner explicitly decides.

## 8. CI / DEPLOY / ROLLBACK GUARDS

Local regression previously PASS:
  node deploy/scripts/selftest-linux-server-relink.mjs
  node deploy/scripts/selftest-device-agent-cli.mjs
  node deploy/scripts/selftest-gold-windows-tray-relink.mjs
  node deploy/scripts/selftest-v10-macos-relink-auth.mjs
  node deploy/scripts/selftest-v09-local-wall.mjs
  node deploy/scripts/selftest-gold-ab-v2-lab-v1-lock.mjs
  node deploy/scripts/selftest-gold-owner-authority-ux.mjs
  node deploy/scripts/selftest-gold-single-owner-sql.mjs
  LR_GOLD_SINGLE_OWNER_AUTHORITY=1 LR_GOLD_SINGLE_OWNER_TRANSFER=1 node deploy/scripts/selftest-gold-single-owner-transfer.mjs
  git diff --check
  node deploy/scripts/check-project-truth-sync.mjs --staged
Do NOT claim CI success without reading actual GitHub Actions runs. CI branch and packaging history in prior LXD handoff; no production binary update authorized.

Lab source deploy pattern from last session:
  1. LXD snapshot with unique timestamp BEFORE changes.
  2. Git commit source pushed to exact feature branch.
  3. git archive new SHA -> LXD /opt/light-remote-abv2-lab/source-<short SHA>.
  4. Symlink existing lab node_modules and plugin-server/node_modules; preserve lab-specific migrations.lock.json in deployed source; do NOT accidentally use production credential files.
  5. Update ONLY lexically-final lab systemd service.d drop-in source paths for modified services; systemctl daemon-reload and restart scoped service, check 4/4 active + HTTPS 200, auth protected and SQL owner singleton rev1 audit1 unchanged.
  6. Keep no large build on VPS ARM; GitHub CI for installers. Do not inadvertently ship to Windows/macOS clients or main Gold UAT.
  7. Never copy actual DB or state files from old Owner to new or reset signer just to pass a test.
Systemd restart may produce transient 502 while Plugin binds; verify again, do not immediately declare outage.
Full LXD rollback only with owner consent and a fresh current-state snapshot because earlier snapshots predate REAL new Owner device relink.
Lab is not intended for production customer access; do not expose private Wall publicly. Public plugin HTTPS already reachable via Traefik; protect ingress.

## 9. HISTORICAL HANDOFF REFERENCES (READ IF NEEDED)

- /home/ubuntu/handoffs/LIGHT_REMOTE_GOLD_ABV2_LXD_CUSTOM_MCP_HANDOFF_20261101.md — initial Custom MCP lab, proxy, V1 lock, SQL043, boot/firewall caveats. EARLY "no NIC / no verified Owner" claims are stale.
- /home/ubuntu/handoffs/LIGHT_REMOTE_GOLDABV2_SINGLE_OWNER_HANDOFF_20261101.md — original Owner singleton SQL045, registered/verified new Owner, transferred Owner, Admin UX, SMTP, Linux Link/Relink deployment. EARLY "Owner rev0/no handoff" sections are stale; use this master.
- /home/ubuntu/handoffs/LIGHT_REMOTE_ABV2_ACCOUNT_LOGIN_SECURITY_RESEARCH_HANDOFF_20261102.md — separate deferred security discussion, no implementation.
- /home/ubuntu/handoffs/LIGHT_REMOTE_GOLD_P2_MASTER_HANDOFF_20261030.md — P2 wider architecture.
- /home/ubuntu/handoffs/LIGHT_REMOTE_GOLD_FULL_HANDOFF_2026-10-31.md — previous Gold release status.
- Source truth: docs/project-book/LIGHT_REMOTE_WORKLOG.md, docs/project-book/LIGHT_REMOTE_CODE_MAP.md, .light-remote/CURRENT_CHECKPOINT.json, deploy/scripts/check-project-truth-sync.mjs.
Never infer old statement from one prior handoff is current: confirm git+runtime+owner SQL before proceeding.

## 10. REQUIRED NEXT-SESSION WORKFLOW (NO QUESTIONS NECESSARY)

1. Open this master file IN FULL, use official Light Remote connection helper for current VPS-ARM session, inspect read-only runtime state (4 services, owner rev1/audit1, new signed lab device and its Short ID and grants). Do not assume that relink is pending.
2. FIRST address missing auto Short ID on newly enrolled/new Owner device. If state has since changed, update this checkpoint accordingly and skip completed work. Follow existing module API and never assign Short ID to revoked or old Owner device.
3. Write focused tests and source patch for Short ID lifecycle, run regression + Project Truth, commit/push feature branch, deploy lab only after LXD snapshot. Check newly linked new Owner device becomes discoverable with stable NEW Short ID.
4. Then coordinate actual Owner-mediated A/B V2 B approval and 24h grant test via /account and Custom MCP; do not bypass owner decision, do not make Agent permissions smaller than allowed by local policy.
5. Re-verify durable grant, fail-closed, expiry, per-Agent replacement, Old Owner cannot connect, unchanged Gold UAT, logs/SMTP secrecy, and write updated handoff before release acceptance.
6. DO NOT implement login security research features (OTP/passkey/trusted-device/geo) without a NEW explicit owner decision.

END OF MASTER HANDOFF.
## LATEST ADDENDUM — 2026-11-02: Short ID / ABV2 Helper fixed in LAB
This appendix supersedes prior missing-Short-ID note. Exact current NEW Owner device: dev_2e6ca4ded175829131a280e9, owner acct_b8c9d023-9b62-4052-99dd-904f21a6e79c, SHORT ID R01KAP. Old X3AQQ6 is the disabled legacy Owner's device and must not be targeted. Operator was still allowlisted for old Owner and Device; confirmed official Light_Remote_AB helper produced abv2_helper_account_not_allowed. Source fix fa12eea2b9aaa3958c13cfc710972ec71a21c761 added idempotent Short ID allocation after both enrollment routes + scoped startup recovery. Snapshot pre-new-owner-shortid-20261102 created in lab at ~02:34 VN. Operator source now source-fa12eea2; Operator owner/device ABV2 allowlists changed to new Owner/new Device only, old disabled Owner no longer allowlisted. On restart native PG allocated R01KAP automatically and confirmed singleton owner revision1 audit1.
Official A/B V2 plugin helper read-only targetQuery=R01KAP returned target_resolution single, online=true, correct new Device ID, approvalState=not_issued, helperReady=false. Actual per-plugin list_devices() remains [] until Owner approves B for THIS plugin client; this is intentional authorized-only semantics. No B requested or approved, no 24h grant yet.
LAB WALL still displays stale X3AQQ6 from static LR_GOLD_ABV2_LAB_SHORT_ID override; screenshot confirmed misleading label. An attempt to modify/read broad service environment was blocked by tool safety, so this cosmetic status remains UNFIXED. Re-check and correct through authorized lab-only workflow; never treat X3AQQ6 as current new Owner ID. Main Gold UAT/production untouched. Next: fix stale Wall label, then human Owner B approval for R01KAP to verify 24h grant, list_devices authorization and signed recovery. Do not repeat Owner transfer or Linux Relink.

## 2026-11-02 — GoldABV2 Owner B /account approval NAVIGATION FIX deployed
Owner attempted A/B V2 request on correct Short ID R01KAP; plugin returned v2_pending_unapproved and B, but misleading owner_v2_b_approval_not_enabled nextAction and advised legacy Wall /approve. Confirmed Operator and Plugin B approval flags were actually ON: LR_GOLD_AB_V2_OWNER_PENDING_HTTP=1, OWNER_APPROVE_HTTP=1, ACCOUNT_APPROVE_UI=1, WALL_OWNER_CONSENT=1, WALL_SIGNED_APPROVE=1, HELPER_POLL_ATTACH=1, DURABLE_GRANT_BRIDGE=1. Root causes were stale hardcoded Helper nextAction, V2 no-arg recovery pointing /approve, Wall V2 Owner account link pointing PRODUCTION domain, and Account page onboarding still saying B cannot yet be approved.
Deployed feature branch source commits 37b99a342274f7894aaa3b621e99837e957463b2 then 18730e99c8c52df13f9e2a329bc0e77dff6b3ca2. Latest Operator/Plugin/Wall all run source-18730e99, Process Supervisor unchanged. LXD pre-deployment snapshot: light-remote-abv2-lab-20261101/pre-abv2-owner-b-ux-20261102 (03:54 VN). Source tests: owner approve HTTP signed Wall + one-time consent, CSRF/session/binding, PG/Redis durable 24h per Agent, helper issue/recovery/poll, lab V1 lock, Account UI, dynamic Wall Short ID all PASS; local only, do NOT assert CI PASS without workflow inspection.
V2 Helper now returns owner_enter_b_in_account iff B grant UI/HTTP feature flags enabled. V2 recovery approvalPath=/account. GoldABV2 lab Wall owner link points https://goldabv2.light-remote.thaiduy.digital/account instead of production. Account page shows owner B input under A/B V2 Pending Agent requests. Old V1 Wall /approve is NOT the easiest V2 path: if using Wall V2 it additionally requires one-time consent issued in /account first. New Short ID shown on Wall V2 is owner-scoped PG043 read-only via signed Operator device channel; it never trusts stale LR_GOLD_ABV2_LAB_SHORT_ID=X3AQQ6 in LAB environment, and cosmetic DB failures cannot block B.
Live validation after deploy: public /healthz HTTP200 TLS verify0, /account HTML includes corrected V2 approve instructions HTTP200, /account/assets/ab-v2.js HTTP200, 3 services source-18730e99 and all 4 lab services active, NEW Owner Device R01KAP online, old Owner authority revision1 and audit1, no actual A/B grants (0 active/0 total) for new device, main Gold UAT schema42 unchanged. NO B code entered or approved by AI.
Next ONLY Owner should initiate a FRESH request via official Light_Remote_AB plugin targeting exact R01KAP, sign in at https://goldabv2.light-remote.thaiduy.digital/account as NEW verified Owner, find A/B V2 Pending Agent requests, select NEW device, enter Agent-supplied fresh B and click Approve Agent (24h). Old B has five-minute lifetime and may have expired. Agent then polls exact request via plugin and verifies helperReady and durable 24h per-Agent grant; list_devices only enumerates approved devices. If owner does not see panel, inspect live account session, proper lab domain, browser DevTools /account/api status and current Operator/Plugin logs for AUTH/CSRF errors; NEVER request passwords/cookies/B from owner. Do not re-enroll device, transfer Owner or change A/B V2 security architecture.

## 2026-11-02 ~04:10 VN — Native Wall /approve UX FIX RELEASED (supersedes previous independent blue V2 panel)
Owner showed screenshot of GoldABV2 Local Wall /approve: separate navy/blue "AI access · A/B V2" card appended OUTSIDE native approval page, wrong "this Windows device" subtitle on Linux Server. USER REQUESTED native Wall design system, not an unrelated new screen.

Fixed and DEPLOYED in isolated lab only:
- Source commit 8fb5d377111ad7cfea8557b3807a1ce0cd571631 pushed to feat/gold-single-owner-transfer-20261101.
- device-agent/wall-ab-v2-preview.mjs redesigned to native .card (dark #0a0e12, border #252d36), existing Wall .btn and yellow .primary, Cascadia monospace typography, subtle neutral details, responsive form. No standalone blue theme or Windows-specific device label. Compact standby ("No pending requests"), 24-hour metadata, Refresh, Open Account, Back to Wall, pending requests with the same B + one-time Owner consent requirement.
- device-agent/local-wall.mjs now injects V2 fragment DIRECTLY INSIDE existing centered .wrap (640px) after the original V1 card instead of appending to closing body. In LAB V1-locked mode original card marked hidden; in normal V1-enabled mode V1 card remains functional, V2 fragment appears ONLY when verified V2 backend is present and hides V1 after successful signed V2 feed. No change to backend auth or grants.
- Updated tests deploy/scripts/selftest-gold-ab-v2-lab-v1-lock.mjs, selftest-gold-ab-v2-wall-preview.mjs. Also PASS: selftest-v09-local-wall.mjs, selftest-gold-ab-v2-signed-approval.mjs, selftest-gold-ab-v2-signed-preview.mjs, Project Truth staged check.
- New snapshot pre-v2-wall-native-ux-20261102 taken at approx 04:09 VN on LXD light-remote-abv2-lab-20261101, BEFORE service switch.
- LIVE lab only Wall service source-8fb5d377, Operator and Plugin stay source-18730e99, Supervisor unchanged. 4/4 active, public /healthz 200 verified TLS, unauthenticated /approve on 127.0.0.1:5491 redirects 303 (auth boundary retained), new Owner Device R01KAP online, Owner rev1 audit1, 0 A/B V2 grants, Gold UAT schema42 unchanged. No B entered/approved by assistant; no re-link or Owner transfer.
- RECOMMENDED VISUAL ACCEPTANCE: Owner refreshes http://100.94.184.141:15591/approve while signed in and confirms native dark card centered under original Light Remote brand. Screenshot should no longer show large blue independent panel. If browser cache holds stale HTML use reload; Wall GET has no-store page headers.
- NEXT FUNCTIONAL ACCEPTANCE: Agent starts fresh A/B V2 request targeting exact R01KAP. Owner approves via https://goldabv2.light-remote.thaiduy.digital/account > A/B V2 Pending Agent requests using fresh B, no more than 5-min pending lifetime; then same OAuth plugin client polls and receives durable 24h grant. Do not auto-approve B; Wall V2 B requires additional Account-generated one-time consent. Keep V1 production fallback.

## 2026-11-02 ~04:42 VN — ABV2 DISCOVERY TOTAL/ONLINE/OS/SHORTID RELEASED (supersedes previous "no devices" interpretation)

Owner clarified ORIGINAL source of truth: /home/ubuntu/handoffs/GOLD_AB_V2_DEVICE_DISCOVERY_AGENT_INITIATED_SESSION_HANDOFF_20261028.md. Account-owned, OAuth-verified device metadata can be discovered BEFORE human B approval. Natural language questions "có thiết bị nào online?", "có VPS-ARM không?", "có Windows nào online?", "Short ID R01KAP", duplicate THISPC should return counts/at most five candidates, no grant and no A/B issuance. OLD light_remote_list_devices is STILL only THIS client’s A/B-authorized devices and may correctly return items:[] even while owned machines are online.

Shipped NEW dedicated MCP tool light_remote_discover_devices({query?:string,onlineOnly?:boolean}) with remote:read annotation readOnly true. No query => account-scoped overview, total/matched/online/offline; onlineOnly=true => total ONLINE within filtered query (offlineCount still shown for awareness). Matches by displayName, nodeId/hostname, platform/OS, architecture (including arm64), stable 6-char Short ID case-insensitive; at most FIVE results, hasMore indicator, complete=false if potentially >500 eligible PG rows. Owner can ask follow-up OS/hostname/ShortID without starting A/B. Tool metadata explicitly directs Agent to use it BEFORE asking user to approve B; old list_devices description directs to new tool for account online count.

Security: plugin-server/operator-adapter.mjs signs read-only OAuth target proof with HMAC purpose='discover', OAuth account/client, onlineOnly filter, 30s TTL + Redis anti-replay, same account owner verified allowlist, currently signed device enrollment/allowed capability and live connection state; Operator route POST /v1/plugin/abv2/device-discover validates signed proof and returns minimal metadata. No B plaintext, access grant, session, enrollment, A issuance, owner transfer, capability details or cross-account data. Domain separation preserves pre-existing resolve/issue/recover signature format. No Pro Share guest scope widened. Exact user-requested device remains required before any connection request.

Code source commit **187de2e8584ede52904f9e34b78d776abccd7700**, branch feat/gold-single-owner-transfer-20261101, pushed. CI workflow wired deploy/scripts/selftest-gold-abv2-account-device-discovery.mjs and metadata contract test. Local tests PASS: 100 devices/38 Windows, 19 online Windows, VPS-ARM, lowercase Short ID, arm64, duplicate THISPC, offline status, OAuth account isolation, HMAC tampering/replay/purpose, no early A/B grant; existing Helper target/issue/recovery, V1 lab lock, 24h verified grant regression and MCP tool contract 84 registered PASS. GitHub CI final status NOT verified here.

LXD isolated snapshot light-remote-abv2-lab-20261101/pre-abv2-readonly-device-discovery-20261102 created **04:39 VN** BEFORE source switch. Now LAB Operator and Plugin source-187de2e8, Wall source-8fb5d377, Supervisor source-fa0699ee. 4/4 active; HTTPS goldabv2.light-remote.thaiduy.digital/healthz HTTP200 TLS verify0. New discovery tool registered in running Plugin module: 84 tools, scope remote:read and readOnly=true; old list_devices remains A/B grant-only. OWNER single authority revision1 audit1, main Gold UAT schema42 unchanged, new owner device Short ID **R01KAP** = light-remote-abv2-lab-20261101 (Linux ARM64, online), 0 active/total A/B grants. No user B action occurred in this release; no Owner/device transfer, Main selection, Prod or Gold UAT deployment.

Live existing Helper read-only target queries (no B): R01KAP -> one Linux device ONLINE; "Windows" -> 0; "VPS-ARM" -> 0 because the LAB device is named light-remote-abv2-lab-20261101, NOT VPS-ARM; "arm64" exact previous helper resolver returns 0 because it did not index architecture. New Discovery tool DOES index architecture; do not confuse old targeted resolver with new broad account metadata discovery.

IMPORTANT CURRENT CHATGPT TOOL SCHEMA CACHE: At 04:42 VN current model/tool session still exposes OLD Light_Remote_AB tools list (new discovery tool unavailable until user reconnects/refreshes the AB plugin or starts a new client session). Running Lab plugin source has actually registered new tool successfully. Never claim a new tool can be called from THIS current tool session before schema refresh. After reconnect:
 - "có thiết bị nào online?" => light_remote_discover_devices({onlineOnly:true}), report total online and up to 5 candidates.
 - "có VPS-ARM không?" => light_remote_discover_devices({query:"VPS-ARM"}), report online/offline if found, no pairing.
 - "máy Windows nào online?" => light_remote_discover_devices({query:"Windows",onlineOnly:true}), report total and up to 5.
 - "R01KAP" => light_remote_discover_devices({query:"R01KAP"}).
 - "ARM" / Linux => discovery query "arm64" / "Linux"; if unclear ask narrowing, do not silently choose Main.
 - Only "connect R01KAP" => light_remote_connection_helper({targetQuery:"R01KAP",startAbV2:true}); then OWNER enters B in GoldABV2 /account. Approval grant is 24h per plugin-client, never a discovery prerequisite.
Potential future improvement: dynamic alias/hostname search beyond current nodeId + displayName if owner explicitly requests. No broad org/team RBAC in P0.

Next acceptance requires REFRESHED plugin schema and REAL light_remote_discover_devices calls to verify summary=1 online, Windows=0, R01KAP=one online, arm64=one; only then declare live user-facing Discovery 100% verified. Test list_devices still [] before B, no false offline. Human B approval for real 24h grant separately pending.

## 2026-11-02 — Owner correction FULL Lab runtime acceptance checkpoint

Re-read canonical specification GOLD_AB_V2_DEVICE_DISCOVERY_AGENT_INITIATED_SESSION_HANDOFF_20261028.md. Original product requirement: Agent initiates A/B, Owner enters independent B either at authenticated Local Wall /approve OR authenticated /account; no copy-A from device. The session mistakenly removed Wall approval in source 390192ef; restored source via 38fdc76c. Lab-only explicit 3-key scope LR_GOLD_INSTANCE_ID=abv2lab01 + LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1=1 + LR_GOLD_ABV2_LAB_SIGNED_WALL_B_ONLY=1 is active in BOTH Operator and Wall. In this isolated Lab, Wall authenticated Owner+CSRF+independent B+signed device proof+current Owner/connection/policy+PG durable grant replaces manually entered extra Owner Account consent code. Other environments retain original independent consent gate; no Gold UAT/production change.

Live LXD light-remote-abv2-lab-20261101 sources: Operator /opt/light-remote-abv2-lab/source-38fdc76c-op-overlay-7e098727; Wall /opt/light-remote-abv2-lab/source-38fdc76c-wall-overlay-390192ef; Plugin /opt/light-remote-abv2-lab/source-6da0d29e-plugin-overlay-b36cb451. Process Supervisor unchanged. Four units active, public /healthz HTTP200; verified both Wall and Operator three-key flags. Snapshot pre-owner-wall-b-restore-20261102 exists BEFORE new Wall/Operator cutover; pre-plugin-v2-onboarding-20261102 exists after durable grant for plugin-only rollback. Git branch source commits 38fdc76c and 6da0d29e pushed.

Read-only PostgreSQL observed exactly one nonclosed, unexpired A/B V2 grant for device R01KAP, approved_at 2026-11-02 02:36:50.992+00 (24h absolute expiry). Live Light_Remote_AB list_devices returned R01KAP ONLINE (previously items:[]), helper no-arg returned ready and active scoped session. This proves actual authorization/grant/Helper E2E, but grant DB alone does NOT attribute whether Owner used Wall vs /account; avoid inventing UI source. Lab-only local Wall route test passed authenticated-owner/CSRF denial and signed B approve; manual visual UX confirmation by owner remains distinct.

Lab plugin helper response was stale V1 copy-A even after ready; source 6da0d29e now emits correct Agent-first V2 Discovery -> select exact -> startAbV2 -> Owner B on Wall OR Account -> Helper ready. Live no-arg Helper response showed only V2 steps, production V1 test remains original. Do not create new B or auto-approve simply to re-test existing valid grant; do not touch Gold UAT, production, V4. Current follow-up: Owner may refresh Local Wall /approve and inspect single B field for future pending request; only run a new Owner B test after owner request or expiry. No latest GitHub Actions CI acceptance claimed for these commits.

## 2026-11-02 — Resume A/B V2 live MCP acceptance after restored Wall B

User requested resuming previously unfinished A/B V2 MCP acceptance. Lab current account has 1 online R01KAP Linux ARM64 and zero offline. Direct plugin targetQuery online/arm64/R01KAP resolved this one device, while Windows and VPS-ARM have 0 matches within this Lab account. Discovery did not issue new B/request. Current ChatGPT connector exposes 83 Light_Remote_AB tools; deployed plugin registerPluginTools contract selftest reports 84 tools, but distinct light_remote_discover_devices still absent from the client-cached schema. Compatibility fallback: light_remote_connection_helper({}) when no pending B returns Discovery; list_devices includes separate accountDiscovery while items remains grant-only. Since the real 24h grant exists now, list_devices.items contains R01KAP and no-arg helper returns ready.

Live authorized Lab session s_mvynerzg_bd3955a3b49c0938 accepted safe exec with inlineStdout.complete=true, exact stdout and exitCode=0. light_remote_job and light_remote_output returned the same final stdout and exit 0, demonstrating Agent can verify completion rather than assuming dispatch success. Managed process start initially returned running; process_output later returned finished exitCode=0 with separate stdout/stderr, byte offsets/hasMore. Read-only list_files initially returned a queued job, repeated bounded read returned structured entries successfully. PTY terminal started using default Bash (explicit /bin/sh was unsupported), accepted input and yielded real command output via terminal_output, then orderly stop. No sensitive file content, destructive operation, SCP transfer, real desktop input or advanced execution tools were run; do not claim all 83 tools runtime tested.

Agent nickname live check revealed Operator feature gate LR_GOLD_SESSION_AGENT_NICKNAME=1 was absent: client-sent agentNickname did not stick (session.displayName=null). After creating LXD snapshot pre-agent-nickname-acceptance-20261102, a lab-only Operator systemd override flag was enabled with backup /var/backups/light-remote-abv2-lab/operator-before-agent-nickname-20261102.conf, and service restarted. Same scoped AB plugin context accepted nickname GPT-6 Golden Lotus, session displayName persisted with nameSource=agent, then session resumed to active and noarg Helper ready preserved the name. Existing Gold nickname regression suites PASS. Lab 4/4 services active, HTTPS health 200. No A/B approval created during this followup; no Gold UAT, production or V4 deployment.

Remaining: fresh ChatGPT tool discovery still caches 83 rather than server 84, so refresh/reconnect the installed plugin for direct light_remote_discover_devices test. The fallback already allows querying online counts. A new Wall B visual test requires a new explicit Agent connect request only if owner wants it, because current device already has valid grant. Do not fabricate an expiration or auto-grant. All tests here were limited to GoldABV2 Lab.

## 2026-11-02 — P0 CLOSED on GoldABV2 Lab: nonzero exec structured MCP + conservative pre-spawn guard

Official Light Remote on VPS-ARM resumed successfully. Initially platform safety blocked lxc list, but retry of the exact authorized read command succeeded; no alternate device or execution channel was used to bypass denial. With existing snapshot pre-exec-nonzero-receipt-20261102 and backup /var/backups/light-remote-abv2-lab/plugin-last-override-before-e519175b-20261102.conf, only the Lab Plugin systemd source was changed from 6da0d29e to e519175b. Live MCP exec exit 7 returned normal structured ok:false, error command_exit_nonzero, executionCompleted:true, commandSucceeded:false, exitCode 7 with inline stdout and stderr, and canonical output preserved. Exit 0 returned normal ok:true. All 4 Lab services active and public HTTPS health 200.

Negative test with an invalid requested shell revealed Device Agent pre-spawn failure exit126 was incorrectly counted as completed execution because the basic job receipt lacked signed spawn evidence. Conservative guard committed as 3b61c558 excludes reserved exit values 72/124/126/127/130 from completedExecOutcome; source regressions and 84-tool contract PASS. Candidate source-3b61c558-plugin-overlay-e519175b (one Plugin tools.mjs change) staged with matching SHA and node --check; backed up previous Lab Plugin override in /var/backups/light-remote-abv2-lab/plugin-before-3b61c558-20261102.conf and switched ONLY Lab Plugin. Effective ExecStart now points at 3b61c558, all 4 Lab services active, HTTPS /healthz 200.

REAL MCP E2E after 3b61c558: script stdout+stderr+exit7 returned normal structured command_exit_nonzero with executionCompleted=true, commandSucceeded=false, exitCode=7 and both bounded streams inline. Separate light_remote_job/output returned exactly those streams and exit7. A normal exit0 returned ok:true and inline stdout. Invalid shell returned original MCP error with job exit126 and operation_failed, NO executionCompleted=true; canonical stdout empty and stderr says linux_shell_unavailable, so not claimed to have run. GitHub Actions for 3b61c558: Gold Connection Lifecycle GC Source Gate 41382557992 SUCCESS; Gold documentation library integrity 41382557926 SUCCESS. Original P0 is LIVE ACCEPTED for the isolated Lab, not general production approval.

Rollback: previous 3b61c558 cutover override backup points at e519175b. A separate pre-e519175b backup and LXD snapshot preserve baseline. Gold UAT, production, Operator, Wall and Desktop V4 never changed. Reserved exit numbers can be legitimate application exits, but are intentionally conservative errors until signed spawn phase is added in a future protocol. Remaining scope: direct 84th discovery tool still absent in stale ChatGPT MCP schema; backend helper fallback works; Long Memory binding mismatch needs separate policy review, SCP zero-byte and shell path aliases are P2, not P0.

## 2026-11-02 — A/B V2 optional nickname Helper LIVE ACCEPTANCE

Owner requested retry of previously blocked Light Remote source edit calls. After official VPS-ARM session resume, structured light_remote_edit_file edits worked and the complete optional Agent-chosen nickname flow was implemented/validated. Commit ddd012b1: optional agentNickname in Helper schema, tool description suggests Agent self-choose playful name (never ask Owner, do not assume ChatGPT), forwards it on post-B ready to AccountOperatorAdapter.connectionHelper -> authenticated workingContext before session open/rename, returns backend-confirmed sessionId/sessionNickname/nicknameSource in top-level ready result. Lab-only new sessions use neutral Light Remote Agent fallback, original production V1 fallback unchanged. Source tests for named and unnamed Agent, nickname lifecycle and 84 registered tools PASS. GitHub GC Source Gate and Docs Integrity CI both PASS.

Lab cutover ddd012b1 only: snapshot pre-optional-nickname-helper-20261102, copied two 19 MB sources, SHA and node syntax verification; backed up last scoped Plugin and Operator systemd override under /var/backups/light-remote-abv2-lab; restarted ONLY Lab Operator + Plugin. All 4 Lab services active, HTTPS /healthz 200, feature flag LR_GOLD_SESSION_AGENT_NICKNAME=1 on Lab Operator.

Live A/B client granted list_devices showed R01KAP online, but Helper({}) returned Discovery rather than ready because pending B recovery had expired after restart; grant still valid. Commit 14f8bfed corrected Lab Helper fallback to check existing granted devices and return ready before read-only Discovery when no pending B; tests for pending priority, grant ready, no grant discovery, named and unnamed and V1 fallback PASS, CI 2/2 success. Plugin-only 14f8bfed overlay staged and SHA checked; backed up the Lab Plugin scoped override, switched ONLY Lab Plugin; Operator remained ddd012b1.

LIVE E2E after final cutover: official Light_Remote_AB light_remote_connection_helper({}) returned status ready, sessionId s_mvynerzg_bd3955a3b49c0938, sessionNickname GPT-6 Golden Lotus, nicknameSource agent, and nested session id/displayName/nameSource identical. These are backend verified not invented or manually formatted. The existing durable A/B grant was reused without new B; no Claude session was renamed. 4/4 Lab services active and public health HTTP 200. Runtime source Plugin 14f8bfed and Operator ddd012b1. Rollback LXD snapshot pre-optional-nickname-helper-20261102 and scoped final override backups retained. Not released to Gold UAT main, production, or Desktop V4.

IMPORTANT: The currently cached ChatGPT Light_Remote_AB tool schema still advertises the OLD light_remote_connection_helper signature without agentNickname, even though new server code supports it. A fresh plugin tool metadata refresh is needed for Claude/ChatGPT to see the NEW optional Helper argument and description; existing clients can still call light_remote_context(agentNickname=...) after grant. Do not claim direct live invocation with agentNickname via this stale current MCP schema. Source dynamic MCP tests proved the new parameter and actual live no-arg readiness proved returned sessionId/nickname. This is intentionally nonblocking: omission continues to work.

## 2026-11-02 — Lab deployment of Owner Close revokes A/B grant (94933590)

GitHub CI 2/2 PASS for 94933590 (Gold GC Source Gate and documentation integrity). Created LXD snapshot pre-owner-close-grant-revoke-20261102. Copied prior Lab Operator ddd012b1 overlay to source-94933590-op-overlay-ddd012b1, staged ONLY operator-host/owner-session-close-abv2.mjs, agent-client-registry.mjs, executor-routes-device-channel.mjs, SHA match and syntax PASS. Backed up Operator last systemd dropin to /var/backups/light-remote-abv2-lab/operator-before-owner-close-94933590-20261102.conf. Updated only Lab Operator ExecStart/WorkingDirectory source paths and restarted. New lxc file push initially installed mode0600, causing temporary EACCES on imported helper and service startup failure. Corrected exact three source file modes to0644, then ran node --check as gold-uat and restarted. Operator NRestarts 0, ActiveState active, ALL 4/4 services active and HTTPS health200; no change to Gold UAT main, production, Plugin, Wall or Desktop V4.

New runtime code now enforces exact signed Owner Wall session-close => Agent client bound grant revoke + detach + session close, persisted before HTTP200. Focused source tests PASS; no live destructive close was done to another Agent session during deployment. The user-facing live Owner Close->grant disappearance with new build still needs explicit Owner UI acceptance.

Read-only current Lab PG AFTER cutover still has the historical pre-patch Claude grant dag_v2_89f9... active (approved on the later new B) even though its Agent session was already closed before the patch; ChatGPT dag_v2_bc15... separately active. Older Claude dag_v2_65be... was closed on the newer Owner approval with reason owner_reapproved. Old countdown is therefore REAL active backend authorization, not a Wall cache artifact. No historical SQL grant mutation or mass revocation was executed. It needs carefully scoped reconciliation/Owner-authorized revoke after verifying its exact persisted session/grant identity. Do not hide just the countdown, do not revoke the other Agent.

## 2026-11-02 — Owner-authorized cleanup: keep only GPT-6 on GoldABV2 Lab

Owner explicitly directed closing/revoking all Lab Agent sessions/grants except GPT-6 Golden Lotus. Official Light Remote VPS-ARM pairing was already valid; retrying held session_control succeeded. READ-ONLY PostgreSQL and signed Wall request logs linked Claude agent plugin-444948a9..., grant dag_v2_89f9b141..., Session ID s_mvyqtspk_8b2460102e9b0621, whose Owner Wall Close had occurred before code fix 94933590. Older Claude session s_mvyp6jjk... and grant dag_v2_65bef827... were closed. GPT-6 separate grant dag_v2_bc15b3da... and agent plugin-fb3ed015... were protected. Exactly two active grants existed before maintenance, no live pending B requests and no Claude bindings on other devices.

Created isolated LXD snapshot pre-keep-gpt6-claude-revoke-20261102. Wrote scoped guarded SQL /home/ubuntu/handoffs/abv2_keep_only_gpt6_20261102.sql with exact grant, account, device, Agent and closed Session ID proof; multiple count preconditions, rollback on mismatch, and GPT6 grant preservation check. Successfully dry-ran entire transaction with ROLLBACK before stopping ONLY the isolated Lab Operator and applying transaction COMMIT. Revoked exactly one active Claude grant (owner_closed_historical_session); removed two obsolete Claude device bindings; closed exactly two Claude client records. GPT6 grant and its binding preserved without alteration. Restarted Operator and the dependent Plugin/Wall services; 4/4 Lab services ACTIVE, public HTTPS health 200 on repeat verification.

After restart, PostgreSQL shows exactly ONE active grant, the GPT6 grant. Official Light_Remote_AB Helper returned READY using that existing grant, with no new B. The earlier GPT6 session had expired; Helper created a new active session s_mvys898w_7bece3571695c7ce. Requesting nickname GPT-6 Golden Lotus resulted in server-confirmed displayName GPT-6 Golden Lotus 2, due to older expired name reservation. Other GPT6 session is expired, not active. No Claude session or grant remains active. No Gold UAT main, production, Desktop V4 or source code changed. Optional future UX polish: allow reuse of an expired nickname without deleting that session history.
