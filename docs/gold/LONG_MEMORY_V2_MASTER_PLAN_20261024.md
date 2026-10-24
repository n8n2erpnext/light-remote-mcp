# LIGHT REMOTE GOLD — LONG MEMORY V2
## MASTER PLAN / BASELINE / GATES — 2026-10-24

**Status:** Approved architecture; implementation IN PROGRESS. This is a development plan, not a claim that V2 has shipped.
**Scope:** Extend ONLY the existing Gold branch `feature/gold-m6-integrated-20261023` in `n8n2erpnext/light-remote-mcp`. Single existing LXD `light-remote-gold-uat`, single integrated Gold Wall, no new Continuity app, required Project UI, cloud store, second LXD/Wall, or production change.
**Immutable restore:** annotated tag `gold-restore-before-memory-codex-20261024` peels to `ba579f8830a0654e8321204f17270db8d94c5593`, includes owner-tested Windows build #486. NEVER retarget tag.
**Gold state at plan creation:** cross-session Long Memory V1 PASS in real official MCP (82/82 tools) with `device_hmac_verified`; real handoff ID `3c643f8a-1484-4a5c-8043-5746a3782850`. Gold optional Long Memory/Codex independent flags; Codex app-server ChatGPT Plus observer is opt-in, Task Controller owner-gated. Existing V1 ledger `device-agent/gold-memory-ledger.mjs` has global `gold_checkpoints` table with no scope; bridge root is UAT-pinned. The scope-less table MUST NOT become automatic capture's canonical V2 store.

## WHY
Session A codes Light Remote on VPS-ARM and tests on DESKTOP-VA16D27 + macOS. Session B performs bug bounty on HOMESV. Session C researches 4G firmware on DESKTOP-VA16D27. Multiple ChatGPT Web sessions, 3+ Walls, shared Fleet devices and 1 account MUST NOT mix project memories; Windows can be Light Remote replica AND firmware Home. LightBI is another independent scope. Gold MCP sessionId is NOT a ChatGPT conversation ID; multiple Web chats may share one Gold remote session.

## NON-NEGOTIABLE CONTRACT
- **Scope-first:** immutable UUID `scope_id` / Memory Namespace per job, repo, workspace or subject; project creation NOT mandatory. Check `account_id + scope_id + membership/ACL + revision` before memory read/write. Never classify by title, guessed semantics or an AI suggestion alone. Explicit scope binding > inherited signed task/job work-context > unique owner-approved exact workspace mapping > Unassigned quarantine. Ambiguous → quarantine and ask owner ONCE.
- **Single authoritative writer per scope:** `home_device_id`, `home_epoch`, monotonic `revision`, canonical hash chain, explicit owner-approved migration. Executing devices may differ from Home and submit signed evidence; they DO NOT commit canonical checkpoints to competing local histories. Home offline → source durable Outbox, stale replica read, NO silent Home failover.
- **Local-first replicas:** each permitted device holds independent SQLite records, NEVER sync/copy a live SQLite DB file. Replicas may serve offline verified state with revision/stale status; missing peer is not a cloud backup. Scope membership and sync grants are separate from standard A/B device enrollment.
- **No server Memory payload:** Gold server handles account, routing, device authorization/epochs and transient encrypted forwarding only. No plaintext/ciphertext checkpoint/event payload persisted in PG, Redis, log or disk; bounded RAM buffers/backpressure/timeouts, E2EE by device/scope, prefer P2P/LAN/NetBird before relay. Future optional cloud encrypted replicas can be added without changing protocol.
- **Independent switches:** Long Memory OFF → no capture/sync or surprise DB creation. Capture `Auto | Follow Project | Manual`, Sync `Local only | Selected devices | All explicitly authorized devices`, Codex ON/OFF orthogonal. Manual checkpoints still require scope routing. Follow Project means owner-selected workspace/scope, NOT a mandatory Gold Project subsystem.
- **Truthful provenance:** checkpoint differentiates observed/claimed/test_passed/owner_approved/blocked. Codex suggestion is NOT task completion; owner approval/CAS required. MCP does not read private ChatGPT chat content absent an explicit tool invocation. Auto captures ONLY events Gold can observe.
- **Compatibility:** V1 checkpoints and original local HMAC must keep validating; never ship an unscoped V1 checkpoint as V2 canonical. No HMAC secret copying to replicas; V2 use per-device Ed25519 signatures, per-scope Home authority, SHA-256 hash/revision, AEAD encrypted sync and owner-approved key rotation/revoke.

## CAPTURE PIPELINE
Sources: completed Gold Plugin tool effects; Agent process/exec/PTY lifecycle with bounded result; scoped Git commit/build/test receipts; Task Controller transitions; Codex app-server completed turns IF module ON/owner requested; session close/hold with dirty work; safety timer flushes only pending changes. Strict typed events, no raw secrets/command args if unsafe. Ingest → authorize origin+scope+grant → redact/minimize → append durable local Event Journal → deterministic meaningful-event filter → 90s default coalesce keyed by `scope_id + work_context_id + task_id` → checkpoint summary/decisions/proven results/failures/blockers/next steps/evidence refs → Home commit → replicas. No checkpoint per tool, no writes for read-only unchanged operations. Per-scope quotas/retention, hashes/idempotency.

## LOCAL SCHEMA V2 (versioned migrations; SQLite FK/WAL; do not mutate V1 signatures)
- `lm_scopes(scope_id PK, account_id, home_device_id, home_epoch, capture_mode, sync_policy, key_epoch, status, created_at, updated_at)`.
- `lm_scope_members(scope_id, device_id, role, grant_id, grant_epoch, revoked_at)`.
- `lm_work_bindings(binding_id PK, scope_id, source_type, source_id, proof_type, accepted_at)`: verified workspace/repo/job/task lineage and unique binding.
- `lm_events(event_id PK, scope_id, work_context_id, origin_device_id, origin_seq, origin_signature, event_type, evidence_hash, payload, ingest_state)`.
- `lm_checkpoint_v2(checkpoint_id PK, scope_id, home_epoch, revision, prev_hash, content_hash, home_signature, structured_body, evidence_refs, committed_at)`; unique `(scope_id,home_epoch,revision)`.
- `lm_heads(scope_id PK, home_epoch, revision, head_hash, updated_at)`, `lm_scope_summaries(scope_id PK, head_revision, compact_handoff, digest)`.
- `lm_sync_outbox`, `lm_sync_inbox`, `lm_replica_ack`, `lm_sync_manifest`, `lm_quarantine`, `lm_legacy_map(old_checkpoint_id PK, scope_id NULL, assigned_by, assigned_at)`.
- Enforce scope FK and UNIQUE, transactional writes, indexed `scope_id/revision`, length bounds, no cross-scope joins in handoff. Keep V1 legacy/unassigned untouched and isolated; owner reclassification is auditable sidecar, never rewrite signed content.

## CROSS-SESSION RESTORE
After explicit ChatGPT Gold helper invocation and A/B, identify a trusted `work_context_id` or unique bound scope. If multiple eligible scopes, return concise choice; NEVER dump all checkpoints or guess from shared Gold sessionId. Read local Home or verified replica ONLY where authorized, with head revision, source device, evidence, synced revision and stale/fresh status. If Home offline, replica may show stale with explicit caveat. Extend current official memory MCP tools compatibly with `scopeId/workContextId`, add only minimal binding/sync-status functions; device-side per-OS path binding must not be fixed solely to UAT. Gold cannot auto-inject a ChatGPT Web turn or inspect hidden conversation.

## SYNC AND SECURITY PROTOCOL
Owner grants devices per-scope; same account enrollment alone is insufficient. Each sender signs bounded events; use device keys for provenance, per-scope AEAD key wrapped to authorized peers, key epochs and revoke. Direct P2P first; Gold Relay only forwards E2EE frames and ACK in bounded RAM; server may persist non-content control metadata (enrolled IDs, scope routing grant/epoch) but never Memory payload. Durable per-device outbox handles offline, retry/idempotency event UUIDs; receiver validates signature/grants/scope/epoch/hash then durably commits before ACK. Exchange manifests/head hash/revisions and transfer only delta; compare hash chains and quarantine divergence, NEVER LWW for task/decision. Home migration requires owner-confirmed epoch/fencing; offline ambiguous failover must fail closed to avoid split-brain. Revoke stops future sync but cannot erase plaintext already held on a lost device. Lost all keys/devices without backup means data may be unrecoverable.

## INTEGRATED GOLD WALL
Within ONE existing Gold Wall: Long Memory ON/OFF, capture mode, sync policy, scope list + bind work context, Home/Replica/grants, per-scope history, verification/provenance/revision/stale/behind/pending/conflict/key-missing, explicit owner reclassification/migrate/revoke. Keep a functional admin UI, no landing or second app.

## EXECUTION GATES — STRICT ORDER, MINIMAL END-TO-END ACCEPTANCE
**G0 Baseline/contract:** confirm exact Gold worktree/status, live route, restore peeled commit, V1 schema and transport. Save this plan in repo, version architecture contract. NO Gold production edits.
**G1 Scope isolation (first coding target):** additive scoped SQLite schema, scope creation/binding, Legacy/Unassigned, scoped list/get/handoff with indexes and fail-closed read/write ACL; v1 read/HMAC unchanged. Test Light Remote vs LightBI vs firmware separate; bad/missing binding cannot contaminate canonical handoff. Wall selector + MCP compat to follow when core proven.
**G2 Auto 1-device MVP:** typed source hooks, durable event journal, 90-second coalesce by verified scope, Auto/Follow/Manual control, no-change filter; read-only operations produce zero checkpoint; actual multi-operation task produces exactly one with evidence; Codex OFF OK. Owner sees checkpoint without invoking save.
**G3 Direct sync 2 devices:** device identity/keys, scope grants, signed event + E2EE, outbox/ACK/delta/replica; Windows test -> ARM canonical checkpoint -> Windows replica validates; offline reconnect no duplicate or wrong firmware scope.
**G4 No-store relay:** reuse existing Gold transport, bounded RAM ciphertext forwarding, metadata-only control plane, no retained payload even in logs; cross NAT offline/stale/rejoin reconciliation; explicit epoch fencing/migrate.
**G5 Scoped Web restore & controller:** new ChatGPT session with one verified scope gets exactly its memory and head/lag; task/Codex receipts correlate scope; 3+ devices same account don't contaminate data.
**G6 OS parity/release:** Windows/macOS/Linux Desktop/Server real devices, package path resolve, clear failures, rollback and docs. No synthetic test explosion or claiming Linux LXD implies cross-platform PASS.

**Acceptance scenarios:** (1) 3 scopes/no cross-writes; (2) 20 tool events -> 1 auto checkpoint; (3) ARM+Windows roundtrip canonical E2EE/ACK/restart; (4) Home offline/stale/queue/reconnect; (5) relay no-store audit; (6) independent ChatGPT Web restore using official MCP/no shell; (7) ARM/Windows/macOS/HOMESV and Codex optional/owner-gated task; (8) rollback + v1 HMAC + Gold #486 parity.

**Out of scope:** scraping entire ChatGPT Web transcripts, mandatory Projects, automatic completion of Codex tasks, CRDT merge of owner decisions, cloud payload backup, uncontrolled async browser turns, multiple canonical Homes for same scope, semantic all-account memory search before namespace isolation.

## HANDOFF / PROGRESS
- Restore tag immutable and live Gold UAT unchanged until explicit staged promotion.
- Do not checkpoint THIS plan into global unscoped V1 memory. Save under `docs/gold` and include in Git; when G1 is accepted, write it into the Light Remote Gold scope.
- Update this section after each tested gate with precise file paths, SHA, evidence, unfinished work. Never mark code-only features as deployed.

## IMPLEMENTATION LOG — 2026-10-24, FIRST CODING PASS (G1 partial)
- Confirmed worktree `feature/gold-m6-integrated-20261023`, repo previously clean at `c8377fe9b81fdd9ffe7617a2e2d850966dc1776e`. Annotated restore tag peels to `ba579f8830a0654e8321204f17270db8d94c5593`, unchanged.
- Added `device-agent/gold-memory-scope.mjs`: isolated SQLite tables `lm_scopes, lm_work_bindings, lm_checkpoint_v2, lm_heads, lm_legacy_map, lm_quarantine`; identity-bound create/list/bind/resolve/append/read/handoff, fail-closed Home writer, Ed25519 signed revision/hash chain, no V1 edits, legacy checkpoint unassigned, account/scope SQL filtering.
- Integrated G1 methods into optional `createGoldWallModules({scopeIdentity:{accountId,deviceId}})`; runtime without trusted identity cannot use new scoped API. Long Memory OFF remains inert. New APIs intentionally NOT YET exposed on Wall or MCP.
- Added `deploy/scripts/selftest-gold-memory-scope-v2.mjs`: 3 namespaces, no cross scope reads, owner binding conflict rejection, tamper detection, revision and signature verify on restart, V1 HMAC remains valid.
- Existing `selftest-gold-cross-session.mjs` and `selftest-gold-wall-modules.mjs` still PASS.
- **Remaining G1:** owner-selected scope binding/UI, actual Gold agent trusted identity injection, MCP scoped backward-compatible API, rollout migration on isolated LXD candidate and live UAT acceptance. No Auto/event journal/sync/relay/Cloud implemented yet.
- **Runtime deployment:** NOT PERFORMED. Existing Gold UAT and released clients untouched; code is in worktree only. Record Git SHA in later handoff once committed.
