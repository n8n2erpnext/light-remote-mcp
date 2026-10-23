# Project Continuity — Signed Operator Delegation & Isolated Broker Handoff

Date: 2026-10-23 Asia/Ho_Chi_Minh
Branch: feature/project-continuity-plan-20261023
Previous commit: 2200a0da74fdba00f990a88fdf30bf31dbcf15af
Status: SOURCE PILOT with REAL LINUX TWO-UID fixture; NOT READY FOR WINDOWS INSTALLER
Frozen rollback checkpoint: 30766940ac18e55cb735354b40a3af9ba37eddb8 (Gold pre-feature / owner-tested Windows #486)

## Delivered this turn

The isolated owner broker can now verify a SHORT-LIVED, ONE-TIME Ed25519 delegation, issued only by Gold Operator after official Plugin account ownership and active A/B session checks. This avoids trusting arbitrary sessionId values supplied by an Agent with group-socket access.

The trust material is separately owned. Only a privileged broker administrator may provision a pinned Operator public key along with EXACT accountId and deviceId. The Operator signing private key remains a separate, explicitly configured private file on the Operator host. No automatic key generation, trust download, or generic IPC trust replacement occurs.

Delegation claims: purpose v1, accountId, deviceId, agentId, sessionId, projectId, requestId, SHA-256(query), maxChars, issuedAt and six-second expiry. Broker verifies signature and matching pinned account/device, Project Memory ON plus owner-signed remote consent, and inserts a one-use requestId into protected SQLite schema v8. Duplicate tokens fail after broker restart. Operator uses the SAME requestId in Duplex instead of minting a new unsignable ID. Results do not use Gold Job resultData, commandResults or persistent relay output.

The experimental Agent now forwards the proof to the isolated broker. Missing proof, missing pinned trust, non-isolated legacy remote mode, bad signer, modified request, wrong account/device, expired token and revoked consent FAIL CLOSED. Ordinary controller IPC still never accepts remoteBrief, raw SQL, ownerVerified booleans or privileged task execution.

## Source files changed

- NEW lib/project-continuity-session-proof.mjs: Ed25519 scoped delegation sign/verify.
- operator-host/executor.mjs: explicit LIGHT_REMOTE_CONTINUITY_OPERATOR_SIGNING_KEY_FILE and strict signer file permissions.
- operator-host/executor-routes-plugin.mjs: sign only after account-owned active session and device validation.
- operator-host/device-duplex-session.mjs: signed requestId preservation.
- device-agent/project-continuity-owner-broker.mjs: broker-only trust provisioning and remoteRead; protected SQLite replay nonce.
- device-agent/project-continuity-owner-broker-cli.mjs: manual trust-operator admin command (not IPC).
- device-agent/project-continuity-client.mjs, device-agent/operator-agent.mjs: no legacy remote fallback; forward signed proof only.
- device-agent/project-continuity-store.mjs: additive schema v8 operator_read_nonces.
- client/core-files.json: shared proof module staged, 101 files total.
- NEW deploy/scripts/selftest-project-continuity-operator-delegation.mjs.
- Updated Linux actual two-UID, confidential Duplex, migration/rekey and isolated restart tests.

## Verified evidence

- LINUX_SERVER_SIGNED_OPERATOR_REMOTE_READ_REAL_TWO_UID_PASS
- LINUX_SERVER_BROKER_CONTROLLER_PROTECTED_SQLITE_AND_TRUST_ANCHOR_PASS
- CONTINUITY_OPERATOR_TRUST_PINNING_NO_SILENT_BOOTSTRAP_PASS
- CONTINUITY_SIGNED_SESSION_PROJECT_QUERY_DEVICE_SCOPE_PASS
- CONTINUITY_REMOTE_READ_DURABLE_REPLAY_EXPIRY_REVOKE_PASS
- CONTINUITY_ISOLATED_BROKER_NO_JOB_NO_DIRECT_SQL_PASS
- P2_MCP_OPERATOR_DEVICE_ACCOUNT_SESSION_BINDING_PASS (mocked active route)
- P2_OPERATOR_DUPLEX_EPHEMERAL_NO_JOB_RECEIPTS_PASS
- SQLite v3→v8, P1/P2 Memory, Step-Up, Rekey and Codex mock source regression PASS.
- Duplex reconnect, stage/verify 101 source files, packaged Local Wall, Windows #486 source regression PASS.
- Build gate BLOCKED as expected.

The Linux two-UID fixture runs the broker under nobody and the client/Operator test under ubuntu. Private signing key, database and public trust anchor are not directly readable by the client. The isolated Broker receives only a signed bounded request and owner-consented local memory canary. No permanent OS accounts/systemd services were installed.

## Important release limitations

1. Signed proofs are minted by a synthetic Operator fixture; a REAL official ChatGPT Web conversation, live A/B pairing, Gold Operator signing key and cross-conversation retrieval have NOT been accepted. The trusted Operator must issue a proof only after current active-session checks. Already minted tokens have a six-second remaining revocation window.
2. Operator relay signer key provisioning, privilege separation, key rotation, lost-key recovery, per-device trust updates and HSM/OS-keystore custody remain OPEN. An untrusted Agent cannot mint signatures, but compromise of the trusted Operator signing private key is a separate risk.
3. Gold Plugin/Operator/proxy log and tracing audit remains OPEN. Authorized plaintext is transiently handled by the Operator and ChatGPT; do not claim end-to-end encryption or zero provider retention. No Project Memory content is intentionally written to Gold PostgreSQL/Redis by these source routes.
4. No actual installed Linux Server systemd UAT yet, no native Windows Service SID/named pipe DACL/CNG UAT. On Windows broker startup still fails closed.
5. macOS launchd/Keychain and Linux Desktop system/user systemd parity remain required and OPEN.
6. Real Codex app-server auth, delegated worker admission/budgets/cancel/signed terminal receipts and all four modes end-to-end remain OPEN.
7. No Windows installer or Gold M6 migration. Historical UNKNOWN jobs and owner-tested Windows #486 checkpoint remain untouched.

## Next slice

Stage a clearly isolated Linux Server systemd UAT and test exact process identities, socket ACL, restart, token denial, revocation and no-logs. Separately provision test-only signing keys on a Gold test Operator only after explicit approval, then verify real Plugin pairing and ChatGPT new-chat Project Context on an authorized device. Complete Windows native ACL/security adapter, followed by macOS and Linux Desktop parity. Preserve the four-mode OFF/ON matrix and write one source checkpoint/handoff every turn.
