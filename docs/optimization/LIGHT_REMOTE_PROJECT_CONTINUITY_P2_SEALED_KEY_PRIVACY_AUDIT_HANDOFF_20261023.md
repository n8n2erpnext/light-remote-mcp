# Light Remote Project Continuity — P2 Sealed Owner Key & Privacy Audit Checkpoint

Date: 2026-10-23, Asia/Ho_Chi_Minh
Branch: feature/project-continuity-plan-20261023
Previous checkpoint: 534c664ebe096addb967faecb4a732a4f25a19c1
State: SOURCE PILOT ONLY — NOT RELEASE READY
Gold frozen rollback SHA: 30766940ac18e55cb735354b40a3af9ba37eddb8
Windows owner-tested Actions #486 source: 30766940ac18e55cb735354b40a3af9ba37eddb8
No Windows installer built or installed.

## Scope of this turn

Audit of the owner step-up implementation and of confidential Memory relay logging. Found the unencrypted Ed25519 PEM at rest could be copied by another operation acting under the same OS user. Removed plaintext private-key-at-rest provision and introduced credential-protected signing without altering Gold production services. Also verified that confidential Duplex event telemetry does not directly embed the test's private-content canary. This is source-level evidence, **not an assertion that all infrastructure logs have been audited**.

## Source changes

- `device-agent/project-continuity-owner-grants.mjs`:
  - Replaced `continuity-owner-private.pem` with `continuity-owner-private.enc.json` (schema v1, AES-256-GCM authenticated envelope).
  - Encryption key derived from owner-reentered password with scrypt (N=32768, r=8, p=1, per-key random 16-byte salt). A unique 12-byte IV, 16-byte tag and domain-separated AAD protect the stored PKCS8 key.
  - Normal Agent startup without a password no longer generates a plaintext private key; first successful explicit owner consent provisions an encrypted key.
  - Signing decrypts temporarily after Local Wall credential verification and fails closed on wrong unlock password; private PEM is never persisted.
  - POSIX private key file mode is 0600; private signer directory must not expose access to group/others; known key files and dirs cannot be direct symlinks.
  - Public/private pairing remains verified after opening the envelope.
- `device-agent/operator-agent.mjs`: passes reentered owner credential only into the signing routine; never logs or sends password to Continuity IPC.
- `device-agent/project-continuity-store.mjs`: supports first owner grant when independent SQLite service started before a public key exists; pins public key in process once loaded, still requires signed grant/revision/nonce.
- `deploy/scripts/selftest-project-continuity-owner-stepup.mjs`: verifies cold-start key-free behavior, late signer initialization, no `BEGIN PRIVATE KEY` in stored envelope, scrypt/AES metadata, wrong unlock fails, rejected symlink, file mode, signed grant scope, expiry, anti-replay, Local Wall CSRF/password and revocation/restart.
- `deploy/scripts/selftest-project-continuity-confidential-relay.mjs`: ephemeral content canary is returned to caller but not included in Duplex `onEvent` telemetry or Gold Job result. This is a focused test, not global log/tracing proof.

## Evidence already observed on ARM

- `P2_OWNER_SIGNED_30S_SCOPE_AND_REPLAY_DENY_PASS`
- `P2_LOCAL_WALL_PASSWORD_CSRF_CONSENT_REVOKE_PASS`
- `P2_REMOTE_CONSENT_RESTART_FAIL_CLOSED_PASS`
- `P2_LOCAL_PROJECT_REMOTE_CONSENT_DENY_DEFAULT_PASS`
- `P2_OPERATOR_DUPLEX_EPHEMERAL_NO_JOB_RECEIPTS_PASS`
- `P2_DEVICE_READ_ONLY_DUPLEX_RESPONSE_NO_COMMAND_CACHE_PASS`
- `P2_MCP_OPERATOR_DEVICE_ACCOUNT_SESSION_BINDING_PASS`
- `P2_CONFIDENTIAL_RELAY_FOCUSED_CHECKS_PASS`
- Late signer startup and wrong-password unlock assertions are included in owner-stepup test.

## Security/operational limits — do NOT relax release gate

1. **Critical same-identity execution problem remains.** Encryption at rest reduces key theft without the password, but a same-UID process with write access to SQLite/public PEM, or malware intercepting the password during entry, can still tamper with records/key trust or impersonate owner. Need distinct privileged OS service identity and Windows named-pipe security descriptor/ACL (plus keystore binding), assessed on a real host.
2. **Password changes:** the encrypted signer is bound to the prior login password. Implement a verified owner rekey/recovery operation before release; do not silently discard or rotate private key. Old plaintext-PEM developer pilots must not be auto-migrated without explicit owner consent.
3. **Privacy limits:** Operator still transiently processes plaintext Memory context. Browser/ChatGPT may persist owner-requested excerpts in the conversation. Source tests indicate no ordinary Gold Job journaling or event payload echo, but upstream HTTP access logging, tracing, reverse proxies, error reporting, backups and Cloud app retention require separate audit before broad claims.
4. **Live acceptance:** no real connected ChatGPT new-conversation memory retrieval yet; no real Codex app-server owner login; no Delegated Worker admission/lease/receipt integration; no Windows physical install or #486 parity proof.
5. Keep `LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL` off by default and `test_build_allowed=false`.
6. `node:sqlite` on Node 22 is still experimental. Pin and test bundled Windows runtime before official release.
7. Gold UAT M6 remains separately unresolved; never release UNKNOWN claims or force its cutover to unblock this feature.

## Next slice

Design an **authenticated OS-separated owner consent broker** that owns encrypted signing material and performs step-up, with user-specific service identity and least-privileged IPC; add password rekey support with old and new credential checks; test private key and local DB mutation boundaries. Then audit proxy/plugin/job telemetry on isolated Gold test infrastructure and run a true ChatGPT cross-session MCP test. Keep a per-turn checkpoint and handoff. One integrated owner Windows test installer only after remaining release gates PASS.
