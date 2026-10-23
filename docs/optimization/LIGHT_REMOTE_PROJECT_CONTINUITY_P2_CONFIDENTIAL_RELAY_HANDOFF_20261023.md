# Light Remote Project Continuity — P2 Confidential MCP Relay checkpoint

Date: 2026-10-23, Asia/Ho_Chi_Minh
Status: SOURCE IMPLEMENTED WITH FOCUSED TESTS; NOT RELEASE READY
Branch: feature/project-continuity-plan-20261023
Last published source baseline before this slice: 31b6b7c22727d8dff358e5da0407abad24a30f9e
Gold pre-feature rollback: checkpoint/gold-pre-project-continuity-20261023 SHA 30766940ac18e55cb735354b40a3af9ba37eddb8
Owner-tested Windows baseline: Tray Client Actions #486, source 3076694
Windows installer: NOT built, as requested by owner (build once feature is fully ready)

## Motivation and architecture decision

The ordinary Operator Job pathways (/v1/fs, /v1/execute, /v1/search) create jobs and may persist their results, receipts, output and summaries in Gold's journals/PostgreSQL. This violates the project's device-local memory storage contract if memory extracts are sent there.

Instead, this slice adds a ONE-SHOT in-memory-only request/response over the already A/B-authenticated, enrolled device's existing Duplex stream.

Experimentally gated chain:

  ChatGPT Web -> official Plugin (remote:read OAuth)
    -> AccountOperatorAdapter.projectMemoryBrief(sessionId, explicit projectId)
    -> POST /v1/plugin/project-continuity/read
    -> ownedSession(accountId, agentId, sessionId), ACTIVE session and device-connection validation
    -> confidentialProjectRequest(bound session.deviceId) on ACTIVE_STREAMS
    -> duplex 'project-request' frame (one-time requestId)
    -> device-agent onProjectRequest -> IPC 'remoteBrief'
    -> local SQLite: memory ON AND remote_project_consent enabled for that Project
    -> Duplex 'project-result' (bounded), then direct HTTP response to Plugin
    -> bounded, source-labelled AI context.

No Gold Job, no Gold job.resultData, no commandResults buffer, no new database table or cached project content in Operator. Pending request state is in process memory only, max 6 per connected stream; one-shot timeout max 15 seconds. Unknown IDs, mismatched session/account, missing stream and offline/disabled/absent consent fail closed.

This is **NOT end-to-end ciphertext to the device**: TLS or other transport security and server process confidentiality remain assumptions to validate. Operator transiently handles plaintext response. Platform request tracing, upstream proxies and exception/observability systems must be independently reviewed before release. Do NOT advertise absolute no-logs or zero-cloud-access until that audit is complete.

## Changed source and precise responsibilities

- operator-host/device-duplex-session.mjs: confidentialProjectRequest + ephemeral correlation in ACTIVE_STREAMS; 6-request backpressure; UUID, timeout, bounded result; no journal or fleet queue.
- lib/device-duplex-client.mjs: accepts a distinct 'project-request' frame and returns 'project-result'; never stores this reply in normal command-results cache; server still retains in-memory result until normal ack.
- device-agent/operator-agent.mjs: only under LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL=1, handles project request through local 'remoteBrief' with strict project/query/budget limits. No fallback to exec, FS, or PTY.
- device-agent/project-continuity-store.mjs: SQLite version 5; remote_project_consent(project_id,enabled,updated_at), default deny. Memory OFF revokes consent, and Memory ON does not silently reactivate it. remoteBrief enforces Memory + consent, UTF-8 byte cap. Direct setRemoteReadConsent requires ownerVerified but is a PRIVATE store method; this is NOT yet a safe public owner authentication protocol.
- device-agent/project-continuity-ipc.mjs: adds bounded remoteBrief read operation; deliberately does NOT expose setRemoteReadConsent or other owner proof/approval via generic IPC.
- operator-host/executor-routes-plugin.mjs: experimental POST endpoint validates account, agent, ACTIVE session and device connection; derives device target from session, never from untrusted body.
- operator-host/executor.mjs: wires the confidential stream request dependency.
- plugin-server/operator-adapter.mjs: owner-scoped session check then confidential read endpoint.
- plugin-server/tools.mjs: registers light_remote_project_context ONLY under LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL=1, with remote:read scope and explicit sessionId/projectId/query/maxChars.
- deploy/scripts/selftest-project-continuity-confidential-relay.mjs: real Duplex server fixture + device client read path, store IPC, consent, timeout, no ordinary Job handler.
- Existing P1/P2 tests updated for schema 5; older Gold Duplex tests remain unchanged.

## Focused verification receipts

- P2_LOCAL_PROJECT_REMOTE_CONSENT_DENY_DEFAULT_PASS
- P2_OPERATOR_DUPLEX_EPHEMERAL_NO_JOB_RECEIPTS_PASS
- P2_DEVICE_READ_ONLY_DUPLEX_RESPONSE_NO_COMMAND_CACHE_PASS
- P2_MCP_OPERATOR_DEVICE_ACCOUNT_SESSION_BINDING_PASS
- P2_CONFIDENTIAL_RELAY_FOCUSED_CHECKS_PASS
- P1_SQLITE_STATES_MODES_FTS_CHECKPOINT_PASS
- P1_WALL_OWNER_CSRF_PROJECTS_API_PASS
- P1_IPC_AUTH_SEPARATE_PROCESS_RESTART_PASS
- P2_LOCAL_MEMORY_CROSS_SESSION_CONTEXT_PASS
- P1B_DELEGATION_CLAIM_UNKNOWN_RECONCILE_PASS
- P2_LOCAL_SQLITE_V3_TO_V5_MIGRATION_PASS
- P3_CODEX_APP_SERVER_MOCK_PROTOCOL_READONLY_DENIAL_PASS
- M6B_DEVICE_DUPLEX_SERVER, M6B_DEVICE_DUPLEX_CLIENT and M6B_COMMAND_TRANSPORT_OWNERSHIP PASS
- G3_EXECUTOR_REJECTION_RETURNS_UNKNOWN_RESULT and G3_FRESH_CHANNEL_EXECUTOR_RECOVERS_WITHOUT_STALL PASS

All are focused source/fixture evidence on ARM and do NOT constitute a real approved-plugin session opened in new ChatGPT Web chat, real Windows physical UAT, or Codex app-server acceptance.

## RELEASE BLOCKERS — do not remove experimental flag or make test installer

1. Secure native owner step-up grant/revoke and local process identity / Windows named-pipe ACL. Generic local IPC token is not owner authority. Store.setRemoteReadConsent must NEVER be made a public MCP or generic IPC action with a user-supplied ownerVerified boolean.
2. Owner UI for remote consent must have signed/fresh owner attestation and durable device-scoped authorization. Physical Windows account privilege separation/restart/revocation must be proven.
3. Review operator/plugin/proxy logging and tracing for any project body leakage; in-memory hop is necessary but not by itself sufficient for E2E privacy. Confirm client access policy and expiration with actual session lease handling.
4. Real ChatGPT cross-conversation MCP memory recovery on isolated official connector, including project opt-in/opt-out and separate devices.
5. Real Codex app-server through authorized official login, not mocked; Codex-only, Memory-only, combined and both OFF.
6. Delegated Worker still lacks a broker-bound signed owner work scope, command-level authorization, cancel, costs/budgets, resource lease bridging and verified terminal receipts.
7. Windows/macOS/Linux service/IPC packaging + physical Windows #486 regression. Only ONE installer candidate once ready.

## Next work

First isolate owner consent from same-user IPC/FS through an authorized owner operation and OS-level service protection, then audit plugin/account binding and data-path observability. Only after those gates use a real connected Plugin session and official Codex account in a UAT setup. Continue recording handoff and checkpoint per implementation turn. Do not touch the frozen Gold checkpoint, force Gold M6 service cutover, release UNKNOWN claims, or publish an installer yet.
