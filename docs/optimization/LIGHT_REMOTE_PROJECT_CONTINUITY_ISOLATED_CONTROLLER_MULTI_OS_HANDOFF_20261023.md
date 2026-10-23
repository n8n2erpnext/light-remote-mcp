# Light Remote Project Continuity — Isolated Controller / trust anchor checkpoint

Date: 2026-10-23, Asia/Ho_Chi_Minh
Branch: feature/project-continuity-plan-20261023
Previous commit: ba741ae8770afeb8ba48871c1f2b2c6d8de8ea27
Status: SOURCE PILOT, Linux Server real two-UID ephemeral acceptance; no installer and no Gold deployment
Pre-feature immutable checkpoint: checkpoint/gold-pre-project-continuity-20261023 = 30766940ac18e55cb735354b40a3af9ba37eddb8
Owner-tested Windows #486 baseline = 3076694

## Purpose

Prior first-wave Linux Server test isolated the Ed25519 signing key under the broker UID, but canonical SQLite Controller and project trust anchor were still Agent-writable. This slice moves BOTH the authoritative local Continuity SQLite and pinned public key inside a broker-UID-owned directory for a Linux Server opt-in runtime.

The feature contract remains four-platform: Windows Desktop and Linux Server FIRST, macOS Desktop and Linux Desktop SECOND. Same Project Memory/Codex Bridge/Task Controller behavior on all OSes. Do not silently reduce functionality on secondary platforms.

## Implemented changes

- device-agent/project-continuity-owner-broker.mjs:
  - startIsolatedControllerBroker({runtimeDir,clientGroupMode}) opens protected root/controller/continuity.db only as the broker process identity. Controller root and trust anchor are 0700/0600 POSIX; agent group clients are denied filesystem access.
  - Strict public trust anchor match between broker root and pinned controller root. A mismatch or symlink fails startup. No silent key replacement or fallback to same-UID SQLite.
  - Local group-authorized controller allowlist includes bounded listProjects/getProject/createProject/setModules/createTask/addSection/getTask/checkpoint/memoryPut/memorySearch/memoryRecent/contextBrief. No SQL, arbitrary FS, task privileged transitions or direct remoteBrief.
  - Separate broker action ownerConsent verifies owner signing password; signs a revision/project-scoped Ed25519 grant then applies the signed receipt directly to its own SQLite transaction. Wrong password, wrong revision and absent module deny. Agent does not receive private signing material.
  - Expands bounded local request/reply limits to 20KiB/64KiB to preserve existing Memory's 12KiB note and metadata capability; still no unbounded response.
- device-agent/project-continuity-owner-broker-cli.mjs:
  - Explicit serve --controller 1 opt-in flag. Service starts and stops Controller with broker. No Gold Auto-Install.
- device-agent/project-continuity-client.mjs (new):
  - Agent-facing selector LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER=1 plus explicit LIGHT_REMOTE_CONTINUITY_BROKER_ROOT. With selected broker, no fallback to legacy local SQLite or IPC token.
  - Remote MCP reading deliberately denied with continuity_broker_remote_session_binding_pending. Direct signed grant injection denied.
  - Separate methods projectContinuityOwnerConsent and projectContinuityOwnerRekey issue only bounded broker actions after owner step-up. Default legacy mode unchanged.
- device-agent/operator-agent.mjs:
  - Experimental Local Wall Projects and local owner-reverification callbacks use the broker backend when explicitly enabled. Normal P1 legacy IPC remains when broker mode OFF.
  - Experimental remoteBrief enters the selector but broker mode refuses it until verified session-level authorization arrives. Do not claim ChatGPT cross-session MCP reads from isolated broker yet.
  - Does not provision signing keys in the regular Agent account when broker mode enabled.
- deploy/systemd/light-remote-continuity-owner-broker.service.example:
  - Demonstration --controller 1 for future dedicated systemd service. Source template only, not installed, and not yet a full systemd UAT receipt.
- client/core-files.json stages new source selector, now 100 source files (verify before citation).
- deploy/scripts/selftest-project-continuity-linux-isolated-broker.sh:
  - Actual ARM Linux Server two-UID pilot: broker runs as nobody, caller as ubuntu; caller can access only group socket, not controller SQLite, signer key or pinned public key.
  - Tests four-mode metadata, local Memory writes/read, signed owner consent enable/revoke, denied unsafe control actions, remoteBrief fail-closed, global rate limit, and no sensitive canary in broker output.
  - Ephemeral directories and existing nobody account only; no permanent systemd installation or Gold UAT mutation.
- deploy/scripts/selftest-project-continuity-isolated-controller-restart.mjs (new):
  - Tests broker stop/restart, persisted local SQLite facts and consent, independent Codex-only & both-on modes, full local Memory note size, and pinned public-key mismatch fail-closed.

## Source/test receipts

- LINUX_SERVER_DEVICE_AGENT_OPTIN_BROKER_AND_REMOTE_DENY_PASS
- LINUX_SERVER_BROKER_CONTROLLER_PROTECTED_SQLITE_AND_TRUST_ANCHOR_PASS
- LINUX_SERVER_BROKER_OWNER_CONSENT_ATOMIC_REVOKE_PASS
- LINUX_SERVER_BROKER_GLOBAL_OWNER_GUESS_RATE_LIMIT_PASS
- LINUX_SERVER_BROKER_SEPARATE_UID_PRIVATE_KEY_DENIED_PASS
- LINUX_SERVER_BROKER_GROUP_SOCKET_SIGNATURE_PASS
- LINUX_SERVER_NO_GOLD_UAT_MUTATION_ACCEPTANCE_PASS
- ISOLATED_OWNER_CONTROLLER_RESTART_SQLITE_MEMORY_CONSENT_PASS
- ISOLATED_OWNER_CONTROLLER_PINNED_TRUST_ANCHOR_MISMATCH_FAIL_CLOSED_PASS

## Important limits and safety gates

1. This source pilot is NOT an installed, durable systemd system service on light-remote-gold-uat. Do not claim production readiness. First stage isolated Linux Server candidate explicitly after acceptance. Current test only created temporary files under /tmp with sudo-n nobody.
2. The broker's group-authorized local methods are for local Agent/owner UI. They are NOT session-bound remote read authorizations; remoteBrief still fails closed. Add a trusted A/B identity assertion, consent scope/revocation check, and in-flight-only relay path before live MCP UAT.
3. The owner still enters the broker signing-key password into Local Wall in the Agent process; a malicious same-user Agent can intercept input. A future broker ownership interaction/OS-auth design should minimize this exposure. Distinct OS identity protects the stored key and SQLite from direct same-UID filesystem mutation, not all possible Agent compromise or instruction-level attacks.
4. Root/privileged service account can still tamper with data. No TPM/hardware-based anti-rollback or immutable remote attestation is claimed.
5. Windows needs audited Windows Service SID + named-pipe DACL + native key store and actual Windows #486 parity. In Windows broker mode the new service still FAILS CLOSED until security descriptor exists.
6. macOS needs launchd privileged daemon, Keychain and TCC permissions tested. Linux Desktop needs system/user systemd split tested. The shared source contract does not equate to physical support.
7. Real Codex app-server/worker budget and terminal receipts, Plugin/Operator/proxy logging audit and ChatGPT Web multi-chat UAT remain OPEN.
8. Keep OFF/OFF defaults and release gate BLOCKED. Do not build owner installer, force M6 cutover, release UNKNOWN jobs or mutate production PostgreSQL/Redis.

## Next concrete development slice

Build authenticated A/B session-bound read delegation into the isolated broker, without trusting caller-supplied session IDs or reusing persisted Operator job results. Add exact owner/device/project access and session revocation checks, then stage a disposable systemd Linux Server UAT environment. Parallel task: native Windows SID/DACL broker, then second-wave macOS and Linux Desktop service adapters. Record one integrated release acceptance matrix and save docs/handoff on each turn.
