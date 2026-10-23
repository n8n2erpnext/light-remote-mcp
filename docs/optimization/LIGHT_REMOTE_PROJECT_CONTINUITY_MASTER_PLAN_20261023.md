# Light Remote Project Continuity — Architecture and Delivery Plan

Date: 2026-10-23 (Asia/Ho_Chi_Minh)
Status: P0 DONE; P1 Local Engine SOURCE PILOT on isolated branch (not yet accepted as a client release)
Planning branch: feature/project-continuity-plan-20261023
Source base: feature/gold-m6-integrated-20261023 at ba579f8830a0654e8321204f17270db8d94c5593
Pre-feature frozen rollback baseline: checkpoint/gold-pre-project-continuity-20261023
P1 working checkpoint: [LIGHT_REMOTE_PROJECT_CONTINUITY_P1_CHECKPOINT_20261023.md](./LIGHT_REMOTE_PROJECT_CONTINUITY_P1_CHECKPOINT_20261023.md)
New source-only checkpoint: [P1b/P2 local/P3 mock](./LIGHT_REMOTE_PROJECT_CONTINUITY_P1B_P2_P3_SOURCE_CHECKPOINT_20261023.md). Feature remains IN DEVELOPMENT; do not build before readiness gates.
P1c source checkpoint: [Controller resource locks and trustworthy memory boundary](./LIGHT_REMOTE_PROJECT_CONTINUITY_P1C_CONTROLLER_RESOURCE_LOCKS_20261023.md). Build remains BLOCKED until native MCP relay + privileged owner ACL + real Codex/worker gates.
P2 confidential transport handoff: [no-job scoped MCP relay](./LIGHT_REMOTE_PROJECT_CONTINUITY_P2_CONFIDENTIAL_RELAY_HANDOFF_20261023.md). Source/fixture PASS only; owner privilege, logging audit and real-client end-to-end still OPEN.
P2 owner step-up handoff: [signed scoped grant and Local Wall reauthentication](./LIGHT_REMOTE_PROJECT_CONTINUITY_P2_OWNER_STEPUP_HANDOFF_20261023.md). SOURCE pilot only; OS signer isolation and account-only physical checks remain OPEN.
P2 sealed signing-key checkpoint: [encrypted owner key and focused privacy audit](./LIGHT_REMOTE_PROJECT_CONTINUITY_P2_SEALED_KEY_PRIVACY_AUDIT_HANDOFF_20261023.md). Owner key now password-encrypted at rest in source, but same-OS-identity tampering and password rekey remain OPEN; Windows build BLOCKED.
P2 rekey/signed receipts source checkpoint: [owner password rewrap, signed remote-read consent verification and safe v7 migration](./LIGHT_REMOTE_PROJECT_CONTINUITY_P2_REKEY_SIGNED_CONSENT_HANDOFF_20261023.md). Rekey/source receipt PASS; separate OS identity, real MCP and Windows test build still OPEN.
Multi-OS Owner Broker: [Windows and Linux Server first; macOS and Linux Desktop second; actual two-UID Linux pilot](./LIGHT_REMOTE_PROJECT_CONTINUITY_MULTI_OS_OWNER_BROKER_HANDOFF_20261023.md). Source and Linux pilot PASS; real first-wave service integration and second-wave physical parity remain OPEN.
Isolated Controller checkpoint: [broker-owned SQLite and pinned trust anchor, Agent local selector, Linux two-UID receipt](./LIGHT_REMOTE_PROJECT_CONTINUITY_ISOLATED_CONTROLLER_MULTI_OS_HANDOFF_20261023.md). Source/Linux ephemeral smoke PASS; broker remote A/B session binding and installed service still OPEN.
Signed Operator delegation: [signed scoped six-second request, durable nonce and Linux two-UID broker remote Memory fixture](./LIGHT_REMOTE_PROJECT_CONTINUITY_SIGNED_OPERATOR_RELAY_HANDOFF_20261023.md). Signed-source proof PASS; live official Plugin/Operator A/B session, key lifecycle and four OS installer acceptance remain OPEN.
Linux Server transient systemd UAT: [actual service UID/AF_UNIX/socket sandbox, restart and SIGKILL orphan recovery](./LIGHT_REMOTE_PROJECT_CONTINUITY_LINUX_SYSTEMD_TRANSIENT_UAT_HANDOFF_20261023.md). PASS on ARM development host; fixed installed systemd service on Gold LXD, Windows native, macOS/Linux Desktop and live Plugin A/B remain OPEN.
Linux Server separate installed LXD UAT: [fixed OS UID/group, offline systemd auto-boot, protected SQLite and consent revoke](./LIGHT_REMOTE_PROJECT_CONTINUITY_LINUX_LXD_INSTALLED_SYSTEMD_HANDOFF_20261024.md). PASS in dedicated light-remote-continuity-uat, NOT Gold; source upgrade/rollback, live A/B, Windows native and secondary OS parity remain OPEN.
Owner UAT Projects WebUI (NetBird-only): [dedicated host port 5587 mapped to isolated LXD loopback, owner auth/CSRF, Projects/Memory/checkpoint and step-up consent](./LIGHT_REMOTE_PROJECT_CONTINUITY_NETBIRD_WEBUI_UAT_HANDOFF_20261024.md). Live HTTP/NetBird-host smoke PASS. LXD graceful restart timed out but normal start restored services. This is UAT only, not a release or cross-OS shipping port.
**Correction: shared Local Wall integration** — [replaced separate Projects server with actual startLocalWall + feature-gated Projects navigation](./LIGHT_REMOTE_PROJECT_CONTINUITY_INTEGRATED_LOCAL_WALL_HANDOFF_20261024.md). UAT host 5587 now serves canonical Wall at / and module /projects. Production Wall 5491 untouched.

Windows owner-tested build: Actions #486, SHA 30766940ac18e55cb735354b40a3af9ba37eddb8

## A. Product contract (authoritative owner requirements)

ONE optional major Light Remote feature, Project Continuity, with TWO independently selectable modules:
1. Project Memory — cross-conversation persistent project knowledge, even without Codex.
2. Codex Bridge — independent Codex Supervisor/Worker, even without Project Memory.
Shared Task Controller is deterministic task state/approval/evidence authority, not an LLM. Task Controller needs only a lightweight local state store when Codex-only is enabled.

Required four-mode matrix:
- Memory OFF / Codex OFF: existing Light Remote behavior stays byte-for-byte compatible; no Continuity background work.
- Memory ON / Codex OFF: ChatGPT Web/new conversation uses official plugin to read and explicitly update project memory and bounded handoff.
- Memory OFF / Codex ON: Codex handles explicitly configured tasks and Controller evidence without reading/creating long-term Project Memory.
- Memory ON / Codex ON: Codex can consult relevant trusted memory and checkpoint work, subject to owner-approved project/work scopes.

All project content, task ledger, approval data, checkpoints and worker state live on the USER DEVICE. Existing Light Remote Cloud/Operator may relay authorized bounded MCP results but must NOT persist full project memory, raw chat archives or local Codex credentials. No separate cloud database for Continuity. Existing Gold server PG17 + Redis8 canonical server business data remain unchanged.

This feature is NOT a bypass for ChatGPT Web turn expiration. A new Web conversation can explicitly recover context through MCP; when Web has stopped, only a separate locally authorized worker can continue actual work. No private ChatGPT cookies, browser token scraping, fake ChatGPT turn renewal or unlimited Plus usage promises.

## B. Frozen Gold and regression boundaries

- Never reset or merge frozen checkpoint; never mutate the protected production rc.47 or Gold UAT LXD until an independent scoped UAT candidate exists.
- Gold integrated source includes M3 Agent admission, M4 resource budgets/locks, M5 Supervisor, M6 Fleet Jobs/receipt telemetry, owner-verifiable multi-OS permissions.
- Current Gold M6 four-service runtime cutover has unresolved historical UNKNOWN entries and owner-approved/unverified Windows orphan-claim recovery. Do NOT erase claims or assume unproven OS process completion to facilitate Continuity.
- Owner-tested Windows #486 combined successful Local Wall responsiveness + filesystem Read/Write drive roots + FS/Search/SCP scope; see docs/optimization/RDC_GOLD_WINDOWS_BUILD_486_ACCEPTED_BASELINE_20261023.md.
- Build future Windows candidates from a descendant of tested #486 SHA or run source+installer equivalence audit. Never repeat #484 -> #485 lost filesystem permissions regression.
- Production plug-in listing/approval and bundled client updates may have independent OpenAI review/rollout requirements; a source MCP tool added in Gold does not instantly imply it exists in every installed client.

## C. Architecture and explicit state ownership

ChatGPT Web / Codex / other AI Client
    -> Existing official Light Remote MCP (authenticated device+session, owner policy)
    -> Existing Operator outbound transport, NO project memory persistence
    -> Device Agent / authenticated Local Wall
    -> NEW separate Local Project Continuity Service (loopback IPC; no Internet listener)
          |-- Task Controller: durable task/section/event/approval/lease state
          |-- Project Memory: optional FTS5/full-text retrieval, facts, evidence, handoff
          |-- Codex Bridge: optional app-server stdio client, supervisor, worker
    -> Existing device execution gateways (FS/process/terminal/SCP/desktop), never bypass

Use a separate local service/process so indexing or Codex activity cannot block Local Wall status, RM frames or Agent reconnect; independent restart and fault containment. The Wall communicates over authenticated local IPC (Windows named pipe/secured loopback IPC; Linux/macOS Unix socket). Resolve OS-specific IPC permissions, service identity and packaging during P1. Never expose unauthenticated direct TCP API on LAN/NetBird.

Task Controller is a deterministic state machine in the local database, not an always-on model and not the same as Gold remote M3/M4/M5/M6 scheduler. At execution admission, BOTH local Controller scope/lease and existing Light Remote owner/device policy must authorize the effect. Use existing resource operationId/job receipts where possible, but no implicit exactly-once promise. For PTY, note that an owner-granted PTY is a shell capability; planning-level command classifications cannot constrain arbitrary shell input, so delegated scope must be restricted by a separate execution boundary or must not expose PTY.

## D. Local data contract

Tentative app-owned path (no repository or cloud directory): per-device OS application-data root / LightRemote / Continuity / projects / <opaque project id>.
- project.json — schema version, name, canonical repo/workspace reference and owner-approved settings. No API keys.
- continuity.db — single canonical local SQLite store, WAL, BEGIN IMMEDIATE, foreign keys, integrity + transactions.
- checkpoint.json — atomic, generated export of an exact DB revision, never independently authoritative.
- handoff.md — generated bounded human/AI context, references events and evidence, not a free-form unverified source of truth.
- optional exports/backup with manifests and SHA256. Secrets in OS credential storage; never plaintext DB, JSON or log.

Tables/relationships as minimum schema proposal:
- projects, project_workspaces, device_authorizations, schema_migrations
- tasks, sections, section_dependencies, section_resources, task_events, approvals
- evidence (source path/ref/hash, type, timestamp, verifier), operation_receipts, worker_lease, codex_threads
- memory_sources, memory_facts, memory_decisions, memory_chunks, memory_fts5 (only when memory enabled)
- checkpoint_revisions, append-only audited event stream (status transitions and owner decisions)

Design strict typed status transitions: READY, RUNNING, CHECKPOINTED, WAIT_OWNER, BLOCKED, DONE, FAILED, with explicit UNKNOWN/INTERRUPTED recovery outcomes where evidence is incomplete. A Codex suggestion is always PROPOSED; only Controller may commit a legal transition. DONE requires suitable evidence, not just an LLM assertion. WAIT_OWNER requires explicit owner interaction through authenticated Wall; never auto-approve. Section dependency DAG must be acyclic; track optimistic revision and cross-worker resource leases. In Codex-only mode Controller retains tasks/leases but does not ingest or offer memory facts. In Memory-only mode tasks may be recorded but no Codex process/network inference is started.

Memory events distinguish: confirmed owner decision, derived fact (with source), observation (with commit/receipt), hypothesis, superseded/stale, rejected. Never silently overwrite historical decisions or assert a hypothesis is verified. Track expiry, conflict and dedupe. JSON export never takes precedence over SQLite. Avoid unnecessary graph or external vector DB in first versions; SQLite FTS5 with project scope + evidence-aware ranking first. Cognee is a reference for provenance/relationships, NOT a required runtime dependency.

Context recovery builds a selective token/size-bounded brief: objective, canonical constraints, recent approved decisions, known code/commit, task and section status, blockers, next safe action, citations to underlying files/receipts. Never ingest the entire conversation by assumption. ChatGPT tool calls cannot observe messages not sent through the plugin; explicit checkpoint update, tool receipt ingestion and owner-authorized document import are the supported sources. No browser scraping.

## E. External API/MCP boundaries (proposed, not yet registered)

Local Wall panel: Projects -> project details, Memory toggle, Codex toggle, source scopes, status, section DAG, checkpoint/resume, owner pending approvals, worker activity and budget. Both switches default OFF on existing installs; persisted independently. Read-only view of stored data requires explicit Memory read rights, and writing memory is separately grantable from FS/PTY/RM controls.

Initial additive public MCP tool surface (avoid one tool per event):
1. light_remote_project_context: list, select, inspect, recover bounded context for explicit project.
2. light_remote_project_memory: search, propose/update confirmed fact, checkpoint when enabled.
3. light_remote_project_tasks: list, add, update, checkpoint, evidence-submit with operationId/revision.
4. light_remote_project_codex: connect/status/propose/dispatch/pause only when Bridge enabled and appropriate owner capability granted.

Final schemas after P1 review. Each request carries explicit device/session/project IDs, bounded result sizes, revision/preconditions, independent permissions and an idempotent operationId for effects. Reject absent or ambiguous project selection, offline/stale session and mismatched owner/OS policy. Server replies contain only the requested bounded extracts and receipts, no full DB snapshots; scrub secrets in structured logs. The client must fail closed locally when Cloud or Operator grants conflict with device-local policy.

Codex plan-level proposals should use a validated JSON schema: projectId, taskId, per-section dependency state, recommendation CONTINUE / WAIT_OWNER / CONTINUE_SECTION_B / DONE, explanation, evidenceRefs, estimated budget and action scope. Validate against the actual local DAG and proofs; reject unsupported or missing fields. Supervisor can inspect and propose, not modify source tree. Delegated Worker can run only approved sections through existing governed execution paths.

## F. Work stages and focused deliverables

### P0 — Isolated design baseline (THIS PHASE)
- Keep frozen checkpoint branch/sha and Windows #486 traceability.
- Create independent worktree/branch, master architecture and acceptance contract; no app code.
- Inventory actual plugin tool schema, Local Wall route and OS packaged Client Core, Gold process resource constraints.
- Gate: branch isolated, design is reviewable, compile/build/deploy untouched, rollback SHA identical.

### P1 — Local state engine + lifecycle (prerequisite for both modules)
- Separate local service with user ownership, IPC, SQLite WAL+FTS5 feature probe, schema migrations/versioning, safe backup and crash recovery.
- Implement deterministic Controller state + revisions, DAG, dependencies, leases, owner approval workflow; memory DB rows can be enabled only when requested.
- Small Local Wall Projects section with two independent toggles, create/delete/select projects, and explicit Read vs Update scopes.
- Gate: OFF/OFF identical to #486; crash-restart preserves active/pending state without inventing DONE; Codex absent is harmless. No daemon auto-spawning when both OFF.
- Integration surfaces: device-agent local route/IPC, client/core-files.json, Windows installer service lifecycle only after isolated stage acceptance.

### P2 — Project Memory MVP + real ChatGPT cross-session
- Implement explicit sources: approved local repo/docs import, tracked tool receipts, explicit memory writes, owner decisions and manual checkpoint.
- SQLite FTS5 bounded recall with evidence/status filtering, not full transcript export; generate checkpoint.json and handoff.md from one snapshot.
- Add authenticated MCP context/memory endpoints; return compact context for a newly opened ChatGPT conversation with no Codex installed.
- Gate LIVE on one isolated device: Session A works on two sections -> checkpoint -> fresh ChatGPT session resumes project, accurately distinguishes confirmed/pending/blocked and citations. Reject cross-project access; reboot restores query.
- This is FIRST independently usable milestone. No auto continuation of Web turn claimed.

### P3 — Codex Bridge Supervisor (Memory ON or OFF)
- Detect user-installed supported Codex app-server and negotiate initialize, thread/start, turn/start, thread/resume, stream and approvals through documented interface. Explicit adapter version check and kill/cleanup.
- FIRST support documented self-supplied OpenAI API key in OS credential store / official Codex auth the owner already authorizes; no private browser token import. Optionally add Sign in with ChatGPT plan usage ONLY if distribution eligibility/permissions approved.
- Codex may read only authorized task/status/evidence and optionally Memory if switch ON, return structured recommendations; all recommendations are untrusted until Controller validates.
- Gate: Codex-only creates/resumes task without Memory DB ingestion; Supervisor-only cannot execute, edit files, approve owner or mutate OS. At resource/budget/external interruption mark WAIT_OWNER/PAUSED, do not spin.

### P4 — Delegated Worker (explicit owner authorization)
- Separate local worker lifetime from ChatGPT Web and tray, with bounded work item (section, workspace/paths, tools, time/cost/calls limits, lease, approval revision).
- Reuse Codex app-server, existing Light Remote execution gateway, actual process receipts and owner permissions; implement run/pause/cancel/restart reconciliation and idempotent dispatch.
- A WAIT_OWNER never becomes auto-approved. Nondependent Section B may proceed only if DAG, file/resource locks and device rights are satisfied; no shared edit lock from Section A.
- Gate: intentional browser/ChatGPT close while an authorized Section B completes; A remains WAIT_OWNER; owner stop prevents new effects; crash recovery marks unknown work honestly, never duplicates an unverified effect. Budget and reconnect limits enforced.

### P5 — Product hardening and release readiness
- Physical Windows baseline #486 parity first: Wall startup/performance, Read/Write roots, FS/Search/SCP, RM V2 frame and input, PTY lifecycle, updater/rollback.
- Linux Server Gold isolated candidate smoke, Linux Desktop and macOS package/permission parity on available CI; physical OS behaviors must remain explicitly OPEN until real devices tested.
- Verify 4 mode combinations, process restart/reboot, export/import, opt-in/opt-out, disk corruption and safe recovery, token budget, signed policy denial; only a SHORT targeted regression matrix, not an unlimited soak.
- Ship as opt-in feature flag disabled by default; staged Gold candidate only when approved. No forced M6 four-service cutover, production rc.47 change or migration by this new feature.

## G. MVP demo and acceptance matrix

First demo after P2:
- Owner creates project P with approved workspace.
- Agent 1 explicitly records a verified fact, approved decision and section A checkpoint with evidence refs.
- Agent 1 session ends. Agent 2/new ChatGPT Web conversation selects same device+project and requests resumable brief, checks correct A/B state and the exact next action, without Codex.
- Delete/revoke an allowed project scope and verify private paths cannot leak through context.
- Disable Memory and verify existing Light Remote FS/PTY/RM remain usable.

After P3/P4, four-mode tests:
OFF/OFF: no new services/API effect; legacy remote tools unchanged.
ON/OFF: cross-session memory/brief works without Codex install or credentials.
OFF/ON: task controller and Codex app-server operate with no memory fact ingestion.
ON/ON: Codex uses bounded verified memory and correct section dependencies.
Also test both approval transitions and duplicate effect after disconnect/restart; stop only the affected section.

## H. Failure, trust, privacy and recovery

- All persisted local task events include sequence, project, actor identity, source receipt/commit hash, wall clock plus monotonic process revision where applicable; do not treat the LLM as source of truth.
- Owner capabilities independent: project.read, project.memory.write, project.task.manage, project.codex.supervise, project.codex.execute. No implicit privilege increase from selecting Full Access if owner has not approved the new permission revision.
- Plugins/cloud transport can carry bounded context only when requested by an authenticated client; retention and logs at intermediaries need verification. Do not make unverified claims of zero network visibility.
- OS credential store for keys; read/write roots and token secrecy enforced. Project imports opt-in; default redaction, no scanning entire home directory.
- SQLite transaction recovery, WAL checkpoint/backup via safe SQLite online backup, no manual copying open WAL only. Checkpoint.json atomic export with DB revision and hash, separately verifiable.
- Task ownership and lease semantics must handle Windows suspend/reboot, stale worker and lost network without false completion or duplicated side effects.
- Never invent exact-once; uncertain effect -> UNKNOWN + reconcile evidence before retry. No SQL force-DONE or silent cleanup.
- Existing Windows build #486 remains owner reference, current Gold M6 release gates remain independent; feature rollout failure rolls back feature flag/process/client release without changing current Gold server PG migrations, approvals or M6 claims.

## I. Open decisions / nonblocking assumptions

- Whether each Project uses one canonical physical device or can intentionally migrate between two owner devices; MVP is per-device/project, explicit export/import later.
- Whether optional local encryption at rest is feasible on each OS (do not market as end-to-end encrypted before demonstrated).
- Whether new MCP tools are approved for existing production plugin listing; create additive schema with compatibility gate.
- Whether commercial distribution is approved for Sign in with ChatGPT plan usage. Public documentation says selected commercial partners; API-key option has no such assumption.
- Path and lifetime for Windows worker service to avoid tray coupling; test physical Windows only after source pilot.
- Future optional Cognee/embeddings/graph only after retrieval quality measurement, not part of MVP.

## J. Next action when planning is accepted

Start P1 on THIS isolated branch in a separate development worktree; only minimal local service + Controller SQLite + toggles. Preserve docs and checkpoint at each bounded phase; do not promote to Gold UAT/production until actual cross-session P2 acceptance. No Project Continuity implementation was started by creating this plan.

## References
Repository:
- docs/optimization/RDC_GOLD_WINDOWS_BUILD_486_ACCEPTED_BASELINE_20261023.md
- docs/optimization/RDC_GOLD_M6_RESUME_INTEGRATED_20261023.md
- docs/optimization/GOLD_MULTIOS_OWNER_PERMISSIONS_20261022.md
- docs/optimization/RDC_GOLD_MULTI_AGENT_JOB_SCHEDULER_MASTER_PLAN_20261021.md
- docs/optimization/RDC_GOLD_M5_INDEPENDENT_PROCESS_SUPERVISOR_20261021.md
- docs/gold/OWNER_FILESYSTEM_ROOTS_20261023.md

OpenAI official:
- https://developers.openai.com/blog/codex-as-a-platform
- https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
Cognee reference only: https://www.cognee.ai/how-cognee-builds-ai-memory
