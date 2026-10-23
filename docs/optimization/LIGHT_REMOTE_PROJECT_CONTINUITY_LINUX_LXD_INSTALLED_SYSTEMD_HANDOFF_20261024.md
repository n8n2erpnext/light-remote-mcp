# Light Remote Project Continuity — Installed Linux Server LXD handoff

Date: 2026-10-24, Asia/Ho_Chi_Minh
Branch: feature/project-continuity-plan-20261023
Previous checkpoint: a67fc4afa52ec14d0440eeb3083be4a44837d0c3
Frozen Gold rollback: 30766940ac18e55cb735354b40a3af9ba37eddb8
Windows #486 owner-accepted source: 30766940ac18e55cb735354b40a3af9ba37eddb8
Status: Linux Server installed-service/boot/Memory UAT PASS, isolated container only. Final installer BLOCKED.

## Scope and OS parity

The user requires full Project Memory, Codex Bridge and Task Controller support across Windows Desktop, Linux Server, macOS Desktop and Linux Desktop. Windows and Linux Server are first wave. macOS and Linux Desktop are second wave with the SAME optional four-mode feature contract, not fewer features.

This turn installed and exercised a full local systemd service in a NEW separate ARM LXD container named light-remote-continuity-uat (Ubuntu 24.04.5, 1 vCPU, 768 MiB RAM). It is unrelated to light-remote-gold-uat, light-remote-direct and erpnext. Gold Operator/Plugin/Wall, PostgreSQL/Redis and old M6 UNKNOWN jobs were NOT changed.

## Installed fixed privilege boundary

- Source-only installer: deploy/scripts/uat-install-project-continuity-linux-lxd.sh, refuses other container names and requires an explicit UAT flag; does not overwrite a completed installation.
- Node v22.23.1 ARM64 copied from development host to a dedicated binary path. Only broker/controller ESM modules copied to root-owned read-only /opt/light-remote-continuity. No remote dependencies.
- Dedicated service identity lr-continuity and group lr-continuity-client; distinct test Agent lr-cont-agent in client group, all inside NEW LXD only.
- Broker root /var/lib/light-remote-continuity is mode 2710, private signing envelope and Controller SQLite/trust root 0700/0600, local Unix socket 0660. No TCP listener and no automatic Codex process.
- Persistent systemd unit light-remote-continuity-uat.service enabled and active with NoNewPrivileges, empty CapabilityBoundingSet, ProtectSystem=strict, ProtectHome, PrivateTmp/Devices, AF_UNIX-only and constrained ReadWritePaths.
- Root-only random fixture password stored at /root/light-remote-continuity-uat-fixture.secret inside the dedicated LXD, mode 0600. No actual owner password was requested, copied or committed.

## Real evidence

1. The separate lr-cont-agent caller created a Project, switched Memory ON, stored a source-attributed test fact and used broker owner consent with a fixture secret. Direct attempts to read protected SQLite, signing key and public trust anchor returned EACCES.
2. Restarted the entire LXD. Its systemd unit returned enabled and active. The Agent retrieved the same Memory fact and owner consent, then revoked consent.
3. Restarted only the systemd service. The revoked state persisted while Memory remained available locally.
4. Repeatable safe read-only smoke: bash deploy/scripts/selftest-project-continuity-linux-lxd-installed.sh.
5. Earlier separate two-UID and transient systemd test covered SIGKILL/orphan socket recovery. This installed-container test covers real boot, separate UID, SQLite and consent.

PASS markers:
- LINUX_LXD_FIXED_SERVICE_INSTALL_PASS
- LXD_INSTALLED_SYSTEMD_OWNER_CONSENT_SEED_PASS
- LXD_AGENT_OS_FILE_READ_DENIED_PASS
- LXD_INSTALLED_SYSTEMD_REBOOT_MEMORY_REVOKE_PASS
- LXD_INSTALLED_SYSTEMD_RESTART_REVOKED_STATE_PASS
- LINUX_LXD_INSTALLED_BROKER_FIXED_UID_SOCKET_MEMORY_CONSENT_PASS
- UAT_LXD_REPEATABLE_READ_ONLY_TEST_PASS
- PERMANENT_LXD_LINUX_SERVER_UAT_ACCEPTANCE_PASS

## Installer and environment troubleshooting

- Initial host /tmp staging failed because snap LXD sees a different /tmp path. Staging now uses /home/ubuntu/light-remote-continuity-stage.XXXXXX, cleaned by a trap.
- Staged ESM files arrived 0600 and blocked service identity reading root-owned code. Installer normalizes SOURCE directories to 0755 and .mjs to 0644 without widening any broker private data permissions.
- Retries encountered partial install user/group/fixture. Script tolerates an incomplete installation but refuses to overwrite a successful install marker.
- Minimal Ubuntu LXD image started with a degraded virtual eth0; systemd-networkd-wait-online blocked reaching multi-user.target. Offline-first broker does not need network availability. Disabled and masked ONLY that network wait unit inside light-remote-continuity-uat, not on host/Gold. Full LXD reboot then correctly reached broker auto-start. Installer documents the UAT-only change.
- Initial staging path inside LXD /tmp contained existing non-overwritable files during retry. Removed ONLY the two known staging files; no database or keys were deleted.

## Files from this turn

- NEW deploy/scripts/uat-install-project-continuity-linux-lxd.sh
- NEW deploy/scripts/uat-project-continuity-linux-lxd-client.mjs
- NEW deploy/scripts/selftest-project-continuity-linux-lxd-installed.sh
- Updated docs/optimization/LIGHT_REMOTE_PROJECT_CONTINUITY_MASTER_PLAN_20261023.md
- Updated docs/optimization/LIGHT_REMOTE_PROJECT_CONTINUITY_RELEASE_GATES_20261023.json
- THIS handoff file, force-added because the repo wildcard ignores HANDOFF names.

## Remaining critical gates

1. Linux Server source upgrade/rollback and safe SQLite backup/restore have NOT been accepted. Permanent LXD service/boot identity PASS does not equal release-ready package.
2. The isolated LXD does NOT hold any real Gold Operator signing key, actual approved A/B session, or ChatGPT cross-conversation MCP integration. Earlier signed Operator delegation uses fixtures and actual two-UID test; live end-to-end UAT OPEN.
3. Windows Desktop requires native service SID, explicit named-pipe DACL, CNG/DPAPI and physical parity with Windows #486. Until validated, Windows broker fails closed.
4. macOS Desktop needs launchd privileged daemon, Keychain/TCC, and physical hardware checks. Linux Desktop needs systemd system/user isolation, desktop lifecycle and package tests. Both require the same full feature matrix.
5. Real Codex app-server, Delegated Worker leases/budgets/cancel/terminal receipts and all four module combinations end-to-end remain OPEN.
6. Gold Operator/Plugin/proxy logs/tracing privacy audit and local Node SQLite experimental-runtime packaging are OPEN.
7. Gold M6 UNKNOWN jobs and resource claims unchanged; never force the cutover. No Windows installer or other owner release has been created.

## Next concrete work

Develop safe in-place Linux UAT source upgrade/restart/rollback with backing SQLite preserved, then a real Gold-test Operator signer/A-B/Plugin smoke after explicit owner approval. In parallel implement Windows service SID/DACL/CNG, then macOS/Linux Desktop adapters with identical controller/Memory/Codex capabilities. Record detailed per-turn docs, checkpoint and handoff. Final test build only after release gates PASS.
