# Light Remote Gold Project Continuity — First real full-Agent isolated Linux UAT

Date: 2026-10-24 Asia/Ho_Chi_Minh
Branch: feature/project-continuity-plan-20261023
Previous SHA: 3057177af003b7ad36219dc506f8e8e9eb190c9b
Frozen tested Windows Gold #486: origin/checkpoint/gold-pre-project-continuity-20261023, 30766940ac18e55cb735354b40a3af9ba37eddb8
Gold M6 integrated separate worktree: ba579f8830a0654e8321204f17270db8d94c5593
RELEASE STATUS: BLOCKED. No Windows build, no production/Gold UAT service changes.

## Why

The owner requires Project Continuity as optional extensions inside **the SAME fully operational Gold Operator Agent/Wall**, not a new Project Manager UI or a fake light-weight Wall with mock callbacks. Prior UAT 5587 had fake Link Device and empty capability policy because its executable was a synthetic startLocalWall wrapper. That executable is now disabled; its NetBird proxy removed. Underlying isolated SQLite+signing keys preserved. This turn is the first source-verifiable runtime exercise of the REAL Gold Agent in a separate LXD.

## Environment and installed source

Only within light-remote-continuity-uat (isolated Ubuntu ARM64 LXD, 1 vCPU/768 MiB), not light-remote-gold-uat:
- Staged complete feature-branch Gold Client Core with deploy/scripts/stage-client-core.mjs, staged AND independently verified source/destination SHA256. Version 0.9.0-rc.49; 101 files; digest 5576c8966afe8b271e074efd0fd598f9401155ba8a579b2e056cb94142f80fc5.
- All 90 frozen Gold #486 manifest entries retained with the same destination paths; 11 additive Continuity modules.
- Read-only LXD smoke independently hashed EVERY installed file against client-core.json: REAL_GOLD_LXD_101_FILE_ON_DEVICE_SHA256_INTEGRITY_PASS. This proves on-device source integrity, not activation of account-scoped features. Full source paths, local process/PTY, enrollment, Files, permissions, Wall, Fleet, branding/icon/font assets are present in the package. Manifest inclusion is not proof of physical functional parity.
- Root-owned, non-writable source installed at /opt/light-remote-gold-continuity-candidate. No copying real enrolled device identity, account credentials or owner private key from production.
- systemd light-remote-gold-continuity-agent-uat.service launches EXACT device-agent/operator-agent.mjs daemon under lr-cont-agent, not a separate Projects renderer. The device has NOT been enrolled. Environment: OPERATOR_AGENT_STATE points to isolated device.json; wall-auth.json is existing UAT-only credential hash, Wall host 127.0.0.1 port 5587, feature flag LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL=1. Protected Broker is under a separate lr-continuity OS UID and Unix socket, using LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER=1.
- Offline fail-closed UAT systemd drop-in at /etc/systemd/system/light-remote-gold-continuity-agent-uat.service.d/offline-no-production-enrollment.conf pins OPERATOR_AGENT_BASE_URL and OPERATOR_AGENT_HUB_URL to http://127.0.0.1:9. This intentionally PREVENTS accidental enrollment to the Gold production service. Do not remove until a distinct owner-approved Gold UAT endpoint and new authorized device identity are ready.
- The older mock WebUI unit light-remote-continuity-web-uat.service remains stopped/disabled. NetBird proxy continuity-webui-netbird remains REMOVED. No host TCP listener on port 5587; this Wall is LOOPBACK ONLY inside the isolated LXD and is not an owner public UAT endpoint.

## Broker v8 to v9 with cold backup

The first installed Broker still used SQLite schema v8 while the feature source now expects v9 device-level independent Memory/Codex switches. Added deploy/scripts/uat-upgrade-continuity-broker-v9-lxd.sh, guarded by exact LXD instance, Git feature branch, explicit --explicit-isolated-uat-upgrade and exact pre-schema=8. Stopped only isolated full Agent/Broker; created a cold tar backup containing all isolated Broker private data under /root/continuity-lxd-pre-v9-20261024T025935Z.tar.gz (0600 inside LXD); staged latest Broker source from the same full Gold candidate; restarted Broker and full Agent. Verified SQLite user_version=9, retaining historical test Memory and signed consent.

Backup is intentionally stored only inside test container, not copied into Git. Do NOT restore a v8 backup on top of an active v9 service or mutate Gold cloud storage. This is a ONE-TIME test-only upgrader, not a universal production rollback mechanism.

## Actual startup and receipts

- /usr/local/bin/light-remote-continuity-node /opt/light-remote-gold-continuity-candidate/device-agent/operator-agent.mjs status returned platformAdapter=linux, enrolled=false, cloudState=dormant, no deviceId.
- Starting the REAL Gold daemon logged device_executor_probe_readiness_changed state=healthy, local_wall_started, device_agent_started mode=always-alive-service. This is not the previous artificial getLocalStatus callback.
- Native Wall loopback GET /login HTTP 200; unauthenticated / and /projects redirect; unauthenticated /api/project-continuity/getGlobalModules returns 401.
- Authenticated UAT owner login gets the actual Gold Wall root with native brand and navigation, /permissions and project route inside that SAME Wall. GET /api/policy-status reports platformAdapter=linux, unenrolled and cloud dormant; executorProbe.ready=true. Correct Gold behavior before enrollment is NOT to show effective device approval (0 until owner approves), not a Permissions placeholder.
- Authenticated GET /api/project-continuity/getGlobalModules gets global Memory/Codex state and internal default Memory scope; no user-created Project required to flip either device-level module switch. No Project was created by this smoke.
- Dedicated read-only smoke deploy/scripts/selftest-project-continuity-full-gold-agent-lxd.mjs uses the root-only existing random UAT owner fixture and never prints it, never starts remote enrollment, never modifies owner policy or M6 claims.
- REAL daemon systemd restart completed; read-only Gold Wall/Continuity/auth smoke re-PASS, remains loopback only. No host NetBird proxy.
- All four existing Gold UAT Plugin, Operator, Wall and Process Supervisor services remained active.

PASS markers:
  REAL_GOLD_LXD_101_FILE_ON_DEVICE_SHA256_INTEGRITY_PASS
  FULL_GOLD_UAT_PRODUCTION_ENROLLMENT_FAIL_CLOSED_PASS
  FULL_GOLD_AGENT_CANONICAL_BRAND_WALL_NAV_PASS
  FULL_GOLD_AGENT_REAL_UNENROLLED_POLICY_AND_EXECUTOR_PROBE_PASS
  FULL_GOLD_AGENT_DEVICE_WIDE_MODULES_READ_NO_PROJECT_GATE_PASS
  FULL_GOLD_AGENT_LOCAL_WALL_LOGIN_AND_NO_ANON_API_PASS
  FULL_GOLD_AGENT_SERVICE_RESTART_LOOPBACK_ONLY_PASS
  ISOLATED_BROKER_V8_TO_V9_MIGRATION_WITH_BACKUP_PASS

## Not yet proven / release gates still OPEN

1. **No actual enrollment/A-B session**: UAT had no account-bound enrolled identity and no outbound network profile. The real Link Device callback exists in Gold daemon but was not invoked (would initiate real account/enrollment). Permissions are real Gold UI and code, yet local effective capabilities remain unapproved before enrollment. Fleet/PTY/jobs also not exercised with enrolled account.
2. Official ChatGPT Web Plugin cross-conversation Memory relay, signed A/B active-session binding and end-to-end private data retention audit are NOT accepted.
3. Codex Bridge device-level toggle persists in v9; Codex app-server mock tests exist, but actual paid/API owner authenticated Codex worker, cancellation, long-running delegated tasks and receipts are NOT accepted.
4. The device-global toggle is currently reachable through a group-authorized local Broker action. Authenticated Wall and CSRF protect browser mutation, but host-level privileged owner proof still requires a separate gate. A compromised group client must not be treated as verified owner.
5. Windows native Service SID/Named Pipe DACL and CNG/DPAPI first-wave; Linux Server real Gold full enrollment and privilege audit; macOS launchd+Keychain and Linux Desktop system/user second-wave still require physical receipts for four modes.
6. Schema v9 cold backup only establishes UAT forward migration; safe cross-version production rollback/upgrade not accepted.
7. User-facing port 5587 must NOT be republished until the full Gold candidate is actually enrolled/authorized and owner approves access. The existence of a full Gold daemon without enrollment is NOT final product completion.
8. Gold M6 historical UNKNOWN/resource claims and Windows #486 accepted checkpoint are untouched. DO NOT build new Windows installer until release gates allow.

## Next precise engineering slice

Bind this REAL full Gold Agent to a deliberate isolated Gold UAT Operator endpoint with an owner-approved fresh enrollment (never clone a production identity), test actual capability inventory/permissions, A/B, Link Device and one bounded read-only MCP call. Only after real Full Gold baseline PASS, activate and exercise device-global Memory-only then Codex-only in that same Agent; retain Gold off/off regression. Continue multi-OS parity. Log receipts, docs, handoff and checkpoint every turn. Do not substitute synthetic startLocalWall wrappers or new independent project websites.
