# Project Continuity — P2 Owner Step-Up and Signed Remote Memory Consent Handoff

Date: 2026-10-23 (Asia/Ho_Chi_Minh)
Branch: feature/project-continuity-plan-20261023
Status: SOURCE PILOT PASS; NOT A RELEASE / NOT A WINDOWS INSTALLER
Frozen pre-feature Gold source: checkpoint/gold-pre-project-continuity-20261023 -> 30766940ac18e55cb735354b40a3af9ba37eddb8
Owner-tested Windows baseline: Windows Tray Client Actions #486, source 3076694
Previous Project Continuity commit: 18d8165178f45f5139f0988515cf4580dd89819c

## Why this slice

Previous P2 confidential Duplex relay already avoided ordinary Gold jobs and default-denied remote reading, but the standalone SQLite method had an internal ownerVerified=true boolean with no credential-linked end-to-end authorization. That could NEVER be safely exposed through generic IPC. Owner asked to finish this functionality before creating a single real Windows test build.

This slice implements explicit Local Wall credential re-entry, scoped short-lived Ed25519 grant signing, local independent verification, replay denial, revocation and source tests. This mitigates token-only IPC access but DOES NOT establish a protection boundary against agents capable of reading/modifying the same OS user's Local Wall private-key storage. OS-private service and Windows named-pipe ACL remain mandatory.

## Changes

1. device-agent/project-continuity-owner-grants.mjs (NEW, packaged):
   - Ed25519 key pair provisioned only when experimental Agent mode is enabled.
   - Owner signer private PEM in local Wall auth directory; pinned public PEM in local Continuity appdata.
   - Validates local key file mode on POSIX and checks public/private pairing.
   - Signs 'light-remote:continuity:remote-read-consent:v1' with exact Project ID, enabled/disabled, Project revision, verified owner principal, 30-second validity and random nonce.
   - Does NOT place private key or owner password in IPC payload. No logging of credentials.
2. device-agent/project-continuity-store.mjs:
   - SQLite schema v6, consent_grant_nonces table (durable replay receipt).
   - setRemoteReadConsent now ONLY accepts proof, verifies signed purpose, time, project, revision and signature, transactionally consumes nonce, updates consent and increments Project revision. Caller ownerVerified boolean removed from this surface.
   - getProject/listProjects expose remote_read_enabled to Local Wall.
   - Turning Memory OFF still revokes previously granted remote access.
3. device-agent/project-continuity-ipc.mjs:
   - Only signed applySignedOwnerConsent action added. No arbitrary ownerVerified flag, no exposed consent-signing action.
4. device-agent/operator-agent.mjs:
   - Local Wall callback ownerConsentWithStepUp checks current password using auth.verifyCredentials for local mode or authenticateWallAccount for account-only mode.
   - Account-only mode checks authenticated account email agrees with the current authenticated username and existing enrolled account ID.
   - Checks expected revision and Memory ON, signs scope-specific grant in Agent and invokes IPC; never stores supplied password.
   - Experimental Agent startup provisions keypair if necessary; no new service is auto-started.
5. device-agent/local-wall.mjs and project-continuity-page.mjs:
   - Authenticated/CSRF-gated POST /api/project-continuity/setRemoteReadConsent uses ownerConsent callback, not generic continuity.request.
   - Per-identity/IP rolling 5 failures / 10min throttle, generic no-secret-denial error.
   - UI shows remote-sharing ON/OFF, separate explicit owner action and password field. Password is cleared after submission.
   - Owner can revoke consent with reauthentication. Memory OFF revokes without requiring an additional grant.
6. operator-host/executor-routes-plugin.mjs:
   - Confidential success JSON uses private no-store direct HTTP response; DOES NOT invoke Gold sendJson, which forces Gold registry flush and could couple secret response with unrelated persistence work.
7. plugin-server/operator-adapter.mjs and operator-host/executor-routes-plugin.mjs:
   - Bug fix in newly added confidential route: real Gold session identity field is 'sessionId' rather than 'id'. Explicit session ID binding is retained.
8. client/core-files.json: adds new owner-grants source module, no #486 files removed.
9. deploy/scripts/selftest-project-continuity-owner-stepup.mjs (NEW) and confidential-relay test:
   - Actual Local Wall auth and CSRF, credential re-entry, wrong password, wrong signer, tampered signature, cross-project mismatch, expiry, old-revision/replay, revocation, restart persistence, IPC cannot forge owner consent.

## Verified now (source-only on ARM)

- P2_OWNER_SIGNED_30S_SCOPE_AND_REPLAY_DENY_PASS
- P2_LOCAL_WALL_PASSWORD_CSRF_CONSENT_REVOKE_PASS
- P2_REMOTE_CONSENT_RESTART_FAIL_CLOSED_PASS
- P2_LOCAL_PROJECT_REMOTE_CONSENT_DENY_DEFAULT_PASS
- P2_OPERATOR_DUPLEX_EPHEMERAL_NO_JOB_RECEIPTS_PASS
- P2_DEVICE_READ_ONLY_DUPLEX_RESPONSE_NO_COMMAND_CACHE_PASS
- P2_MCP_OPERATOR_DEVICE_ACCOUNT_SESSION_BINDING_PASS
- P2_LOCAL_MEMORY_CROSS_SESSION_CONTEXT_PASS
- P2_LOCAL_SQLITE_V3_TO_V6_MIGRATION_PASS
- P3_CODEX_APP_SERVER_MOCK_PROTOCOL_READONLY_DENIAL_PASS
- P1 controller, Client Core packaging and Windows #486 source regressions must be rechecked in the final gate run.

## Open release gates / constraints

- **CRITICAL:** same-user PEM key storage is only developer-pilot defense in depth. An AI/child process with read access to that directory could steal owner signer key, defeating the step-up. Windows DPAPI/CNG or appropriate OS keystore + distinct service identity, authenticated named-pipe ACL, and deny capabilities across boundaries are required. Do not remove gate 'owner_bound_privileged_ipc_and_windows_acl'.
- Account-only credential re-entry has code but has NOT been tested with a real Light Remote account auth server or Windows/Mac device. Do not claim owner account UAT PASS.
- SQLite on Node 22 experimental; packaged source is not a Windows installer acceptance.
- Existing Gold Operator/plugin/proxy log/tracing/privacy full-path audit remains open; no in-memory bridge alone guarantees E2E encryption or zero log retention.
- Actual approved Plugin listing/MCP tool exposure and ChatGPT new-session context recovery on a physical device remains open.
- Real Codex app-server installed/authorized and long-task Delegated Worker with OS execution scopes, durable job budget/leases and signed terminal receipts remain open.
- No modification or deployment to Gold UAT/production; keep frozen checkpoint unchanged. No Windows build until complete.

## Next concrete slice

Replace same-identity signer PEM with OS-protected owner identity / service separation, validate account-only owner step-up on a connected Gold UAT or isolated test device, audit all relay logging/proxy telemetry, then live ChatGPT cross-conversation Memory. Only afterwards integrate real Codex and worker. Record evidence in release gates; no test explosion or premature installer builds.

Important: This is a HANDOFF source file. It is explicitly added to Git despite the repository wildcard *_HANDOFF_*.md gitignore.
