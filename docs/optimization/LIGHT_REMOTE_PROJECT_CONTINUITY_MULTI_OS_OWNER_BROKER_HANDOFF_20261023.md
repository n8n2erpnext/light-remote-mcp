# Project Continuity — Multi-OS Owner Broker checkpoint

Date: 2026-10-23, Asia/Ho_Chi_Minh
Branch: feature/project-continuity-plan-20261023
Previous commit: f9dba84f51f47a0962ceaebde8cadda5e74e5c98
Status: LINUX SERVER ISOLATED SOURCE PILOT, NOT RELEASE READY
Frozen pre-feature source: checkpoint/gold-pre-project-continuity-20261023 = 30766940ac18e55cb735354b40a3af9ba37eddb8
Windows owner-tested baseline: GitHub Actions Tray Client #486 = 3076694
No Windows installer created.

## Required multi-platform order

FIRST: Windows Desktop and Linux Server, with actual broker/Agent privilege separation and service/IPC UAT.
SECOND: macOS Desktop and Linux Desktop, with the SAME Project Memory, Codex Bridge, Task Controller and owner-consent contract. These are separate OS service implementations, not removed features.

| OS | Broker adapter | Current evidence | Next gate |
|---|---|---|---|
| Windows Desktop | Dedicated Windows service SID, named pipe with explicit DACL, CNG/DPAPI protected key | Source contract; privileged startup intentionally refuses until audited DACL | Implement native ACL/service and physical Win11 UAT preserving #486 |
| Linux Server | systemd system daemon with dedicated user/group, AF_UNIX socket 0660, isolated signer 0700/0600 | REAL ephemeral two-UID smoke on ARM (nobody broker vs ubuntu client): PASS | Integrate canonical Controller boundary and Linux Server candidate, restart, systemd policy |
| macOS Desktop | launchd privileged daemon + user LaunchAgent, Keychain/OS access policy | Contract only, not physically tested | Native launchd/Keychain/Sandbox/TCC packaging and smoke |
| Linux Desktop | systemd system broker + systemd user Agent | Contract only, not physically tested | Broker/user service permissions, logout/restart and packaging smoke |

## New runtime sources

1. device-agent/project-continuity-owner-broker.mjs: standalone opt-in local-only broker, no TCP, no Codex launch. Owns encrypted Ed25519 key in private subdir. Offers health, publicKey, signConsent and rekey through bounded local IPC. No generic filesystem/command interface. Password required for signing and rekey. Global failed-signing rate limiting (caller-supplied principal cannot bypass). Bootstrap cannot be requested over IPC.
2. device-agent/project-continuity-owner-broker-cli.mjs: explicit local bootstrap via password stdin, serve and health commands. No unprompted Agent startup or Gold auto-install.
3. device-agent/project-continuity-platform-contract.mjs: frozen four-platform service and identity contract, shared disabled-by-default module modes, first/second wave.
4. deploy/systemd/light-remote-continuity-owner-broker.service.example: NOT INSTALLED, source-only Linux Server hardening template with system UID and OS sandbox.
5. client/core-files.json: stages the three new portable modules. Windows broker start FAILS CLOSED because Node named pipe DACL is not implemented.
6. deploy/scripts/selftest-project-continuity-linux-isolated-broker.sh: actual ephemeral Linux separate UID, signer inaccessible to Agent; group socket, password-denied request and signature verification; no permanent user/group, service or Gold UAT modification.
7. deploy/scripts/selftest-project-continuity-multios-contract.mjs: all four OS contracts, module independence/defaults and Windows fail-closed.

## Linux Server receipt

Command: bash deploy/scripts/selftest-project-continuity-linux-isolated-broker.sh

PASS:
- LINUX_SERVER_BROKER_SEPARATE_UID_PRIVATE_KEY_DENIED_PASS
- LINUX_SERVER_BROKER_GROUP_SOCKET_SIGNATURE_PASS
- LINUX_SERVER_NO_GOLD_UAT_MUTATION_ACCEPTANCE_PASS

Command: node deploy/scripts/selftest-project-continuity-multios-contract.mjs

PASS:
- CONTINUITY_FOUR_OS_SERVICE_CONTRACT_SOURCE_PASS
- CONTINUITY_WINDOWS_DACL_FAIL_CLOSED_MAC_LINUX_DESKTOP_PENDING_PASS

Broker uses pre-existing nobody identity only within a disposable temp directory. The invoking ubuntu Agent identity cannot read signer/private key or broker trust anchor files, but can call a group-authorized socket when it also knows the owner signing password. No stdout/log payload leaked in the fixture.

## Critical limitations: NOT production-ready

This broker prototype is not yet wired into the device Agent, SQLite Controller or confidential MCP route; current owner-consent Agent path still uses the prior same-user sealed signer. A separated signer alone DOES NOT protect an ordinary-Agent-writable SQLite database or local public key. The controller and signature trust anchor need their own protected identity / broker-backed verification before granting real remote memory access. Do not mislabel this as complete privilege separation.

On Windows, node:net cannot currently set the audited named-pipe security descriptor required here; the new broker refuses to start instead of creating an insecure pipe. This prevents accidental Windows exposure until dedicated service SID / DACL code and physical testing exist.

On macOS and Linux Desktop, contracts exist but OS-specific packaging and physical smoke have NOT been performed.

Signing-key password is still checked separately from Local Wall owner login. Socket group permissions are NOT owner authentication. No network TLS or full proxy/Plugin/Operator logging audit is implied by this local test. Real Codex app-server and Delegated Worker are still missing. All prior Gold M6 UNKNOWN jobs remain untouched.

## Next engineering slice

Integrate authoritative owner broker with a Controller/trust anchor protected under the separate service identity, then stage Linux Server UAT restart and permission checks. In parallel, implement Windows service SID / named pipe ACL; do not force this Unix mechanism onto Windows. After both first-wave platforms reach the same acceptance, port launchd/Keychain macOS and systemd user/system Linux Desktop with the same feature matrix. Keep the release gate BLOCKED and defer ONE integrated owner test installer until all required feature gates PASS.

Docs/handoff should be committed every development turn, including any blockers or tooling failures, and the Gold rollback SHA must remain immutable.
