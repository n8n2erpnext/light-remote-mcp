# RDC → Light Remote Gold: reliability optimization master plan

> **2026-10-21 Pro Team compatibility note:** Multi-Agent M3 scheduler must not reuse Team seats as slots or silently enable Team execution. [Full reviewed team integration design](./RDC_GOLD_MULTI_AGENT_PRO_TEAM_COMPATIBILITY_20261021.md), including 5 seats (owner included), proposed 20 Team sessions/4 per seat and shared Team execution pool 5/2 per seat; Team member tool-call usage charged to Team owner, not personal member plan; separate OAuth member A/B. Existing Team cross-account job execution remains disabled. G0–G6 status independent.

> **Separate feature follow-on (planned 2026-10-21, not part of G0–G6 acceptance):** [Multi-Agent Execution / Job Scheduler Master Plan](./RDC_GOLD_MULTI_AGENT_JOB_SCHEDULER_MASTER_PLAN_20261021.md), grounded in [owner's Linux/Windows real Internet curl build #464 and process baseline](./RDC_GOLD_MULTI_AGENT_EXISTING_LIMITS_BASELINE_20261021.md). No scheduler runtime code or client install was done by creating that plan. G0–G6 status and deferred gates below remain authoritative independently.

> **LATEST 2026-10-21 — G0–G6 engineering checkpoint:** [Gold G Plan code, Gold UAT deployed candidate, platform CI, bounded soak and owner-deferred gates](./RDC_GOLD_G_PLAN_ENGINEERING_CHECKPOINT_20261021.md). G4 canonical PostgreSQL operationId reservation/UNKNOWN, G5 optimistic edit SHA + SCP inline integrity, and G6 bounded soak are developed and running in isolated Gold; no production changes. Historical milestone table below is the original acceptance design, NOT a current status ledger. G1 external platform refusals, some G2 real-client checks and long physical G6 UAT remain deferred to owner and are **not claimed passed**.
Date: 2026-10-19 | Owner-approved G0 | Branch: `feature/light-remote-gold-rebuild-20261018`
Status updated 2026-10-21: **G0 DONE; G1/G2 source fixes and partial owner acceptance; G3 Gold strict+Redis+physical Windows Duplex recovery accepted; G4 durable operationId and receipt reconciliation DEPLOYED; G5 optimistic SHA file edit and existing SCP inline progress DEPLOYED; G6 18/18 bounded TCP soak with CI resource budget PASS.** Installed Gold source `62b0a5528d96fadd29738c552fa77330a7d009d3`, strict ON, inline ON; [engineering checkpoint and owner-deferred gates](./RDC_GOLD_G_PLAN_ENGINEERING_CHECKPOINT_20261021.md). G1 outer platform pre-dispatch refusals, full physical G2 macOS/desktop, external Gold edit-tool schema refresh, Gold Wall UI and multi-day real G6/Team billing acceptance remain OPEN by explicit owner deferral. Production unchanged. This document retains its original milestone design; always read [current handoff](./RDC_HANDOFF_CURRENT.md) before executing work.

## Objective, not feature copying
Learn from observed reliability engineering in Desktop Commander MCP (RDC) to reduce Light Remote false-denial reports, tool misrouting, abandoned jobs, stale readiness, ambiguous timeouts and unhelpful errors. **Do not copy unneeded features or change Light Remote's core architecture simply to resemble RDC.** In particular Light Remote already implements bounded output rings, cursors, process/PTY state and surgical edit: preserve them until a failing benchmark proves a gap.

The owner explicitly approved starting G0 and requested checkpointed docs/handoffs. Owner additionally requested **real SCP upload/download progress on Local Wall** as part of G5. G0 research-only; G1+ requires an evidence-based patch plan review before mutation.

## Pinned source of truth
- RDC upstream: `wonderwhy-er/DesktopCommanderMCP` **f508e524469c26f6366e17dbfd3ee5a69d112127**, 2026-10-14. GitHub: https://github.com/wonderwhy-er/DesktopCommanderMCP/tree/f508e524469c26f6366e17dbfd3ee5a69d112127
- Light Remote: `n8n2erpnext/light-remote-mcp`, Gold branch baseline `4daccb821adbac38be4b6e954ab5f10d266ccdbe`. GitHub: https://github.com/n8n2erpnext/light-remote-mcp/tree/feature/light-remote-gold-rebuild-20261018
- Prior independent RDC notes (read, not copied): `/home/ubuntu/handoffs/LIGHT_REMOTE_POST_RC50_DESKTOP_COMMANDER_DEEP_DIVE_2026-10-12.md`, `/home/ubuntu/handoffs/LIGHT_REMOTE_DESKTOP_COMMANDER_SOURCE_BENCHMARK_2026-10-12.md`.
- `RDC_FEATURE_GAP_MATRIX.md`: verified implementations + selective decisions; `RDC_GOLD_G0_BASELINE_20261019.md`: repeatable read-only baseline; `RDC_GOLD_G0_HANDOFF_20261019.md`: resumption instructions.
- Prior RDC handoff says make a new optimization branch after rc50; **superseded by current owner instruction**: use the EXISTING Gold branch/worktree exclusively.

## Non-negotiable boundaries
1. No writes/restarts/migrations on production `light-remote-direct`, production plugin, Paddle Live or public domain routes. Isolated Gold LXD only for subsequent UAT.
2. PostgreSQL 17 relational tables remain canonical; Redis 8 handles ephemeral state. No SQLite, JSON snapshot business state, or parallel writers. Local Wall identity config and structured operational logs are separate concerns.
3. Per-device Local Wall A/B, OAuth, account+agent+device binding, lease/revocation, local final deny, capability checks and explicit consent stay authoritative. Do not use tool names, benign wrappers or PTY to conceal commands or evade OpenAI safety decisions.
4. A platform-level refusal **before remote job admission** cannot be fixed by lowering device policy; distinguish it from Operator admission and Linux denial.
5. A tool result of HTTP 200 or session `online` is not proof that a command can be dispatched. No PASS on mocks alone or on synthetic-only tests called production evidence.
6. Preserve interface/schema compatibility across official ChatGPT plugin, Gold custom MCP, Windows/macOS/Linux Agent, signed updater, ARM/AMD, Free/Pro Team. Rollback each intervention independently.

## Change selection gate (mandatory, every proposal)
- Existing mechanism? Show exact source paths and baseline.
- User-facing incident? Ground in measured failure count, reproducible fixture or captured error; otherwise label HYPOTHESIS.
- Smallest correction? Prefer metadata, error contract, lifecycle invariant, or a targeted bug fix over new subsystem.
- Safety/compatibility impact? No policy widening or extra device discovery; reversible deployment and constrained feature flag.
- Test evidence? Red reproduction → patch → targeted unit → real Gold MCP/API → restart/reconnect → rollback rehearsal.
- Outcome? Compare same workloads for tool call PASS, true remote dispatch, p50/p95 latency, orphan rate, retry duplicates and peak RSS; do not invent improvement percentages.

## Milestones and execution order
| Gate | Target and minimal work | Baseline and acceptance evidence | Explicit exclusions |
|---|---|---|---|
| **G0 DONE** | Read pinned handoffs + current upstream + Gold source; classify gap, record actual idle baseline; checkpoint docs | Matrix covers R01–R13 and G5 SCP, source links and observed-vs-inferred tags; real read-only Gold health/RSS/HTTP samples; no runtime mutation | No G1–G6 code changes |
| **G1 NEXT, owner review** | MCP tool metadata/schemas, accurate capability admission, pre-dispatch-vs-Operator-vs-Agent error taxonomy | Reproduce official `requiredCapabilities=['docker']` mismatch, capture correlation ID and gate, compare simple RDC/Light Remote benign tool tasks in equivalent contexts; preserve safe denial; versioned tool schema tests | No safety metadata camouflage, PTY bypass, policy relaxation |
| **G2** | Process/PTY spawn/exit/timeout/cancel with explicit state and lost-output indicators | Linux/Win/mac supported baselines: invalid executable, slow I/O, orphan after interrupted wait, PTY signal, large output; RSS/process count bounded | No replacement of NativeProcess/NativeTerminal or buffer reimplementation |
| **G3** | Dispatch-readiness tuple + half-open reconnect/watchdog; channel/Agent/Operator truth | Transport connected but executor unavailable, stale heartbeat, sleep/wake and reconnect; successful recovery without spoofed Online or extra A/B | Do not copy RDC heartbeat constants |
| **G4** | OperationId, owner/epoch/lease and idempotent effect reconciliation across timeouts | lost ACK after effect, two workers race, retry after restart, owner/Team billing exactly-once charge-event; side-effect ambiguity returns UNKNOWN | Do not promise exactly-once external shell effects |
| **G5** | Narrow CAS/edit race; SCP upload/download actual **progress on NetBird Wall**; failure diagnostics | Genuine Gold SCP integrity and resume/cancel; % vs bytes semantics; throttled Wall event + fallback status; wrong-owner secrecy; no command contents leak | No second transfer engine, no JSON registry, no arbitrary tool bypass |
| **G6** | Controlled performance/soak and resource budgeting | same workload before/after on isolated CPU/RSS/network; multiple processes, slow consumers, repeated reconnect, buffer gaps; p50/p95 with meaningful N | Do not increase 4 MiB/16 MiB output cap or adopt RDC 50 MiB without failing baseline |

## G1 investigation design: why RDC might be smoother
RDC offers small task-oriented tool schemas (`start_process`, `read_process_output`), process-state messaging, MCP server instructions and client-aware protocol handling. Light Remote exposes a wider remotely authorized multi-hop tool surface with per-device capabilities and stricter governance. **These are architecture observations, NOT a proven causal explanation for different OpenAI pre-dispatch safety outcomes.** Compare the same benign operations by category (read source, Docker inspect, LXD list, apt policy, filesystem metadata) across tools. Log only tool name, safe description, the provided capability declaration, error layer, elapsed ms and whether a remote job ID exists. Never send disallowed operations to an alternative tool to get them through.

G1 error taxonomy must distinguish: `platform_pre_dispatch_denied` (no remote job; app cannot override), `oauth_scope_denied`, `pairing_or_grant_denied`, `fleet_capability_missing`, `device_local_policy_denied`, `linux_permission_denied`, `remote_timeout_unknown`, `tool_protocol_invalid`, `transient_transport_unavailable`. Present honest cause and next action, with no promise to remove platform safety gates.

## G5 SCP Progress on Wall — design contract BEFORE patching
Existing backend: `lib/light-scp-file.mjs::_view()` has `totalBytes`, `progressBytes`, `progressChunks`, `totalChunks`, `complete` for upload and download. `plugin-server/tools.mjs` has distinct upload and download begin/chunk/status/commit/cancel. Operator `startScpOperation()` returns transfer metadata through bounded job results. `device-agent/local-wall.mjs` already has SSE `/events` and batched job rendering; **no completed user-facing progress widget was found in the inspected Wall code**.

G5 implementation proposal (not yet coded):
1. Determine real transfer state owner and event source for both local and outbound/remote Agent; model transfer by `accountId/deviceId/sessionId/agentId/transferId/mode`; never treat a bare guessed transfer ID as authorization.
2. Create a bounded, server-derived SCP transfer summary in existing event and status pathways: `transferId`, `direction`, `phase`, `progressBytes`, `totalBytes`, `progressChunks`, `totalChunks`, `updatedAt`, `lastErrorCode`, `verified`, without content, paths or secrets unless already permission-filtered. Rate-limit/coalesce events and bound memory.
3. Wall shows authenticated transfer cards with actual percentage **only when** totalBytes>0, otherwise transferred bytes; show rate (derived from acknowledged deltas over monotonic time), optional ETA with smoothing, status: preparing/transferring/verifying/completed/failed/cancelled. A 100% upload means chunks staged, **not** committed until SHA-256 and rename succeed. A download `sentBytes` means server served bytes, **not proof recipient persisted the file**.
4. On Wall reconnect or reload, reconcile from authorized `status`, avoid duplicate cards on repeated events, display stale/unknown instead of freezing an inaccurate percentage; no persistent JSON or extra polling per client at high frequency.
5. Acceptance: 1 KiB/10 MiB/large bounded file, simultaneous uploads/downloads, partial retries/out-of-order chunk, transfer cancelled, changed source, wrong SHA, denied owner, reconnect mid-transfer, NetBird Wall reload and LXD restart behavior. Show byte counts consistent with native SCP views. Actual full upload/commit Gold was previously blocked by `operator_public_key_unavailable`; treat it as a prerequisite, not a PASS.
6. Gold only, reversible release; protect NetBird Wall auth, CSRF and SSE visibility; not exposed on public Gold WebUI unnecessarily.

## Documentation/commit discipline
Checkpoint after each gate: `docs/optimization/RDC_*_HANDOFF_*.md` with exact branch, HEAD, files touched, commands and their exit codes, verified routes, test data lifecycle, PASS/FAIL/BLOCKED and the next action. Save plan and gap matrix in Git. Preserve all pre-existing untracked UAT fixtures. Every claim must distinguish public-source observation, unit test, real Gold, and theoretical hypothesis.
