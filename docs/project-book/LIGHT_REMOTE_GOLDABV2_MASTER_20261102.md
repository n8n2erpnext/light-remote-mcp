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
