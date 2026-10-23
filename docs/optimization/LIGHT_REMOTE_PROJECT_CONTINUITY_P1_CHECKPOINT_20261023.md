# Light Remote Project Continuity — P1 Local Engine checkpoint

Date: 2026-10-23 (Asia/Ho_Chi_Minh)
Status: SOURCE PILOT, NOT PRODUCTION OR PHYSICAL WINDOWS UAT
Branch: feature/project-continuity-plan-20261023
Frozen Gold rollback branch: checkpoint/gold-pre-project-continuity-20261023 (30766940ac18e55cb735354b40a3af9ba37eddb8)
Owner-tested Windows #486 source: 30766940ac18e55cb735354b40a3af9ba37eddb8; Actions run 39942315406

## Changed sources

- `device-agent/project-continuity-store.mjs`: SQLite WAL, foreign keys, typed tasks/sections, transactional event log, dependency gating, approval receipts, evidence before DONE, revision CAS, optional memory/FTS5, checkpoint export, SQLite online backup and integrity verification.
- `device-agent/project-continuity-ipc.mjs`: opt-in local-only UNIX socket / Windows named pipe, message bounds, random private token; deliberately NO generic approval/worker transition API.
- `device-agent/project-continuity-service.mjs`: opt-in standalone service command, not started by existing Agent.
- `device-agent/project-continuity-page.mjs`: functional dark Local Wall Projects page, creates project/task, independent Memory and Codex preference toggles, reads canonical checkpoint.
- `device-agent/local-wall.mjs`: additive `/projects` and `/api/project-continuity/*` after existing account login+CSRF, feature-flag gated.
- `device-agent/operator-agent.mjs`: callbacks only when `LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL=1`; otherwise existing Wall unchanged. No auto-launch of Codex or local service.
- `client/core-files.json`: new four runtime modules included; package count 90 (Windows #486) -> 94 (experimental future build only).
- `deploy/scripts/selftest-project-continuity-p1.mjs`: one focused selftest covers state+restart+IPC+Wall auth.
- Master Plan updated to link this handoff.

## What passed on actual ARM Node 22.23.1

- `P1_SQLITE_STATES_MODES_FTS_CHECKPOINT_PASS`: four mode settings, Memory-only, Codex-only, FTS5 search, stale revision denial, dependency auto-unblock, owner approval gate, evidence-required DONE, JSON checkpoint from SQLite.
- `P1_WALL_OWNER_CSRF_PROJECTS_API_PASS`: not logged in redirects, logged in page and JS parse, mutation without CSRF denied, authenticated owner project creation succeeds using local IPC.
- `P1_IPC_AUTH_SEPARATE_PROCESS_RESTART_PASS`: real child process, tokenless access denied, private socket and token modes, SQLite online backup SHA, stop/restart persisted state.
- `P1_ALL_FOCUSED_CHECKS_PASS`.
- `stage-client-core.mjs` stage/verify PASS, 94 files.
- `selftest-packaged-local-wall.mjs` PASS — /, /permissions, /approve, /settings and icon parity.
- `selftest-gold-owner-filesystem-roots.mjs` PASS — original #486 owner Read/Write FS/SCP source behavior.
- `selftest-gold-windows-wall-nonblocking-inventory.mjs` PASS — original #486 responsiveness source behavior.
- All above are SOURCE tests on ARM, NOT owner physical Windows/macOS acceptance.

## Local operating contract

- SQLite is local under the OS app data location. Memory remains disabled by default, and its FTS5 index is lazy.
- PostgreSQL17/Redis8 remain unchanged for Gold cloud runtime. No Client/Operator/Scheduler deployment or migration.
- All Project content stays on user device; Cloud has no new Continuity data persistence path.
- To run manually in an isolated developer root: `node device-agent/project-continuity-service.mjs serve --root /tmp/private-continuity-demo`. Health: `node device-agent/project-continuity-service.mjs health --root /tmp/private-continuity-demo`.
- For an isolated Agent candidate with the service already started, set `LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL=1` to expose authenticated Local Wall `/projects`. Existing Gold builds do not have this flag set.
- A Project workspace is metadata, not an implicit Filesystem permission grant.
- Owner approvals are testable inside the local deterministic store; they are not exposed over generic IPC. Do not accept a caller-supplied ownerVerified boolean from MCP or Codex.
- Enabling Codex preference does NOT log in, create worker processes or extend ChatGPT Web turns. OFF/OFF starts no autonomous job; if an operator manually launched the service, it may remain available for configuration until stopped.

## Remaining P1 blockers (do not mark P1 release complete)

1. Windows named-pipe ACL isolation and per-user background service packaging, installer/uninstall, restart. Linux/macOS service lifecycle and real OS permission parity require physical acceptance.
2. Authenticated owner-bound approval and worker execution admission; task operationId resource leases, idempotent dispatch and receipt reconciliation with Gold M3–M6 remain future slices.
3. Production-grade v2+ schema migrations and safe recovery, memory provenance/redaction/retention and scoped MCP API. P2 will introduce selective ChatGPT context.
4. Codex app-server integration, Supervisor, Delegated Worker, budgeting and owner authorization remain P3/P4; NONE launched by current code.
5. Physical Windows Local Wall /projects, volume Read/Write, SCP and RM parity from a new installer are not established. CI source PASS != owner installation PASS.
6. The Node 22 `node:sqlite` API remains experimental; its Windows bundled-runtime behavior must be verified before release.
7. Runtime full Gold M6 cutover still has unverified old Windows resource claim and historical UNKNOWN work. Do not release or rewrite them.

## Next

P1b should focus on owner-bound local IPC approval, safe execution-state leases/operationId, and explicit service lifecycle, then isolated Windows UI + IPC physical UAT. Keep checkpoint SHA immutable. Do not touch protected production rc.47 or force any Gold M6 deployment.
