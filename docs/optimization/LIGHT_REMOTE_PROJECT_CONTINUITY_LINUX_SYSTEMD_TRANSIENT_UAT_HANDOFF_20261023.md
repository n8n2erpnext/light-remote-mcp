# Light Remote Project Continuity — Linux Server real systemd lifecycle UAT checkpoint

Date: 2026-10-23, Asia/Ho_Chi_Minh
Branch: feature/project-continuity-plan-20261023
Prior verified commit: 850c9f86323739a465e8a8d00401f1d3661c8bd8
Current state: REAL ARM LINUX SYSTEMD TRANSIENT ACCEPTANCE PASS; NOT INSTALLED IN GOLD UAT
Frozen pre-feature checkpoint: 30766940ac18e55cb735354b40a3af9ba37eddb8
Owner-tested Windows #486 source: 30766940ac18e55cb735354b40a3af9ba37eddb8
Release gate: BLOCKED — no Windows installer, no production deployment.

## User requirement and preserved platform order

Light Remote Project Continuity must provide the SAME Project Memory, Codex Bridge, Task Controller and consent contract on Windows Desktop, Linux Server, macOS Desktop and Linux Desktop.

First-wave physical acceptance: Windows Desktop and Linux Server. Second wave: macOS Desktop and Linux Desktop. Platform-specific service/IPC/credential adapters may differ; functionality must not.

This iteration focuses on first-wave Linux Server and is not evidence of Windows, macOS or Linux Desktop acceptance.

## Actual work performed

A disposable systemd-run system service was exercised on the ARM development host using the existing nobody service UID, ubuntu group-authorized client, a fresh directory under /run, protected Controller SQLite and owner signing files. The service used systemd properties equivalent to the intended Linux Server broker hardening template: NoNewPrivileges, CapabilityBoundingSet empty, ProtectSystem strict, ProtectHome, PrivateTmp, PrivateDevices, kernel protection, AF_UNIX only and ReadWritePaths scoped to the disposable broker directory. No permanent user/group was created, no installed unit was enabled and no changes were made to Gold production or light-remote-gold-uat.

The client, using the ubuntu identity, created a Project, enabled only Memory, wrote a private test fact and authorized remote consent with a local fixture credential. The first transient service was gracefully stopped, the second independently started with the same protected SQLite DB and confirmed memory/consent persistence, then explicitly revoked consent. The second service was SIGKILLed; a third transient service recovered the dead UNIX socket and confirmed the revocation and Memory remained durable after that crash.

The service health check requires actual systemd MainPID running as UID 65534, socket permissions 0660 and a successful local IPC handshake. Merely seeing a stale socket file is NOT treated as service readiness. Automatic boot/start after machine reboot and real installation into the Gold LXD candidate remain OPEN.

## Source changed

- device-agent/project-continuity-owner-broker.mjs — new recoverStaleOwnerBrokerSocket(runtimeDir), checks trusted broker-owned directory and socket owner, mode, type and inode; probes that no listener is active before unlink. Refuses live socket, foreign file, symlink and unexpected inode/owner; does not automatically remove unverified files.
- device-agent/project-continuity-owner-broker-cli.mjs — opt-in serve --recover-stale 1; normal startup remains fail-closed if recovery is not explicitly enabled.
- deploy/systemd/light-remote-continuity-owner-broker.service.example — recommends the guarded startup flag alongside isolated Controller mode. SOURCE TEMPLATE ONLY, NOT INSTALLED.
- deploy/scripts/selftest-project-continuity-linux-systemd-transient.sh — new bounded three-service systemd-run UAT with real UID, group socket, graceful restart, SIGKILL and orphan socket recovery. Cleans up all transient units and files.
- deploy/scripts/selftest-project-continuity-owner-broker-socket-recovery.mjs — new focused negative tests for live socket and symlink/regular-file attack surfaces.
- device-agent/project-continuity-platform-contract.mjs — Linux Server acceptance metadata updated to reflect transient systemd smoke evidence, not production installation.
- docs/optimization/LIGHT_REMOTE_PROJECT_CONTINUITY_MASTER_PLAN_20261023.md and release gates — this checkpoint and remaining blockers recorded.

## Focused PASS evidence

- REAL_SYSTEMD_SERVICE_UID_SOCKET_SANDBOX_PASS
- REAL_SYSTEMD_BROKER_SEPARATE_UID_MEMORY_WRITE_PASS
- REAL_SYSTEMD_RESTART_SQLITE_CONSENT_REVOKE_PASS
- REAL_SYSTEMD_CRASH_RECOVERY_PERSISTED_REVOCATION_PASS
- REAL_SYSTEMD_SIGKILL_ORPHAN_SOCKET_RECOVERY_PASS
- REAL_LINUX_SERVER_TRANSIENT_NO_PERSISTENT_UNITS_PASS
- CONTINUITY_BROKER_ACTIVE_SOCKET_NOT_REMOVED_PASS
- CONTINUITY_BROKER_SYMLINK_AND_REGULAR_FILE_FAIL_CLOSED_PASS

The previous real Linux two-UID signed Operator remote Memory proof, SQLite v8 migrations, consent and revocation, Client Core source packaging, Duplex reconnect, Windows #486 source regressions and mocked Codex supervisor should continue to pass. This checkpoint is distinct from actual live ChatGPT Plugin A/B enrollment.

## Critical limitations / release gates not waived

1. This was on the ARM development host through disposable systemd-run units, NOT a permanent systemd service in light-remote-gold-uat, and NOT a boot/reboot persistence test. A fixed service UID/group and real installation/upgrade/rollback contract still need acceptance on isolated Linux Server UAT.
2. Owner-signed Ed25519 consent and Operator-signed six-second A/B assertion have fixture verification, not actual Gold Operator key provisioning and live official ChatGPT Web cross-conversation UAT. Trust rotation/revocation and full Plugin/Operator/proxy log audit still OPEN.
3. On Windows the native Windows Service SID, Named Pipe DACL and CNG/DPAPI trust boundary remain unimplemented and broker fails closed. No Windows installer candidate has been produced.
4. macOS launchd/Keychain and Linux Desktop user/systemd adapters remain explicit second-wave gates, not silently dropped.
5. Codex-only, Memory-only, combined and both OFF must all remain operational. Real Codex app-server, delegated worker budgets, terminal receipts and cancel/recovery remain OPEN.
6. Stale socket cleanup is best-effort local startup hygiene, not distributed fencing. It must not weaken group/client owner checks; crash recovery never retries with insecure/default rights.
7. Node 22 node:sqlite remains an experimental API. A stable pinned/bundled runtime per OS is still a release prerequisite.
8. Do not change historical Gold M6 UNKNOWN jobs, force M6 cutover, or mutate Gold PostgreSQL/Redis as part of Project Continuity.

## Next concrete slice

Integrate protected Linux Server service identity into an explicitly isolated UAT deployment with fixed service runtime folder and verified owner account permissions, then exercise actual Agent + Operator identities with a real signed A/B session and audit no-logs. In parallel implement native Windows service SID / named pipe DACL plus CNG/DPAPI, including Windows #486 rollback parity. Subsequently develop and physically test macOS launchd/Keychain and Linux Desktop systemd user/system parity. Save docs/handoff after every implementation turn. Only one integrated owner test build after all gates.
