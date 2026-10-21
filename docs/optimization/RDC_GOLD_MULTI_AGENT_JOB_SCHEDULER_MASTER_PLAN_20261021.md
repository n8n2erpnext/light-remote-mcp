# Light Remote Gold — Multi-Agent Execution & Durable Job Scheduler Master Plan

**Date:** 2026-10-21 (Asia/Ho_Chi_Minh)
**Status:** DESIGN PLAN / ACCEPTANCE CONTRACT, **NOT CODED**, not a production release.
**Source branch:** `feature/light-remote-gold-rebuild-20261018`.
**Authoritative measured baseline:** [RDC_GOLD_MULTI_AGENT_EXISTING_LIMITS_BASELINE_20261021.md](./RDC_GOLD_MULTI_AGENT_EXISTING_LIMITS_BASELINE_20261021.md).
**MANDATORY owner-corrected Pro Team allocation:** [RDC_GOLD_MULTI_AGENT_PRO_TEAM_COMPATIBILITY_20261021.md](./RDC_GOLD_MULTI_AGENT_PRO_TEAM_COMPATIBILITY_20261021.md). Pro is **one individual with multiple sessions**; Pro Team is **up to five invited people whose Team calls are charged to the Team owner's account/add-on**. Team quota, sessions, Agent concurrency and per-member approvals are separate from each member's personal Free/Pro plan. Cross-account Team execution remains OFF until M3-T approved.
**Prior reliability work:** [RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md](./RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md), [RDC_GOLD_G_PLAN_ENGINEERING_CHECKPOINT_20261021.md](./RDC_GOLD_G_PLAN_ENGINEERING_CHECKPOINT_20261021.md), [RDC_HANDOFF_CURRENT.md](./RDC_HANDOFF_CURRENT.md).

## 0. Goal and scope — owner-approved product requirement

Enable **multiple independently authorized Agents** to coordinate across sessions/devices without long-running commands monopolizing the control lane. **Design targets: Free personal = 2 retained sessions / 1 executing Agent; Pro personal = 12 retained sessions / 3 executing Agents; Pro Team = 5 human seats (owner included), 20 retained Team sessions (max 4 per seat), 5 executing Team Agents shared (max 2 per seat, first-per-waiting-seat fairness).** Team member calls count against the **Team owner's** usage/add-on budget, not member's personal Free/Pro quota/Agent slot. These are new entitlement design targets, NOT currently implemented Gold defaults. Team live cross-account execution remains off. Authenticated extra Agents queue fairly; detached background jobs have their own bounded worker quotas.

The user means **ordinary Internet downloads launched with `curl`, `wget`, PowerShell, etc.** and CPU-intensive compile/build/test steps, *not only Light SCP*. Build, download, shell, scripted package managers and file-transfer can all be **long-lived jobs** with progress/status/cancel while other unrelated commands are admitted. Preserve security policy, signed A/B pairing, owner local-final-deny, identity ownership, capability checks and explicit user consent; job mode selection is NEVER a bypass route for rejected operations.

Target environments for implementation/acceptance: **Gold LXD `light-remote-gold-uat` (Linux ARM64)** and **owner Windows `DESKTOP-VA16D27`**, with macOS and Linux Desktop CI and physical follow-up for platform-specific behavior. Production rc.47, Paddle/ERPNext, public clients and billing remain untouched until separate approval.

## 1. Ground truth — avoid false fixes

### Real measurements, October 21
- The official **Windows Tray Client build #464** is GitHub Actions [run 39580015765](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39580015765), commit `eee3a6bd3ad341c606e3396317d1f46084cbaafd`, successful CI. It was **download-tested, not installed**. Windows Agent still installed `0.9.0-rc.49+6729f5d`.
- **On Windows old Agent:** a real `curl.exe` Internet transfer of the #464 artifact launched with `light_remote_exec` ran ~45s, downloaded 47,009,373 bytes, and caused a second harmless `exec` AND `light_remote_process` request to fail `target_node_draining`. Fleet observed `agentDraining=true,ownerDraining=false,dispatchReady=false,inFlight=1`; curl timed out intentionally with exit 28; a new `exec` then succeeded and partial file was deleted.
- **Same Windows, same #464 Internet artifact** launched with `light_remote_process`: downloaded 19,925,833 bytes over deliberately capped ~19s; while still running, an unrelated `light_remote_exec` succeeded immediately. Both approaches really transferred bytes. A managed process can solve the *head-of-line wait* problem today; it is not yet restart-durable.
- **Gold Linux Agent `eee3a6b`:** new signed liveness `pulse` no longer sets false drain, but a second regular `exec` queues behind the first instead of executing in parallel (`inFlight=1,queued=1`). Native managed processes can run concurrently with another `exec` on both OSes.
- Both tested on Gold Pro, `sessionCeiling=2` per leaf, Operator default 5 overall sessions, native managed process default limit 16 live per Agent (Linux 16 accepted; 17th HTTP429). These are **not Agent concurrency entitlements**; no verified Free 1 / Pro 3 admission yet.
- Current Windows native process `stop(force:false)` internally uses `taskkill /T /F`: it is effectively a forced process-tree termination, not graceful cancel. Current process registry is in-memory and its `close()` kills children on Agent shutdown.
- Existing `G3` Gold Operator/Gold Linux signed pulse patch `eee3a6b` and Windows CI #464 PASS are prior work; do not claim completed Windows installed-client verification. **No changes to runtime in this planning phase**.

### Current relevant code (inspect these before implementation)
- `operator-host/fleet-router.mjs`: channel presence, owner/Agent drain, command queue, retry/redelivery, `maxQueuedPerNode`, `inFlight`.
- `device-agent/operator-agent.mjs`: signed poll/duplex, command pulse, serialized `await executeCommand`, Agent sessionCeiling and native process lifecycle.
- `operator-host/executor-routes-device-channel.mjs`: signed device `pulse`, poll and result.
- `operator-host/session-manager.mjs`: sessions (including HOLD consume session capacity), per-account/device/agent session reuse, default global cap 5.
- `operator-host/executor.mjs`: Free/Pro/VIP `planEntitlements`, G4 operationId / PostgreSQL claims, execution job protocols.
- `lib/native-process.mjs`: process registry, per-process ownership, output rings, stop and Windows Job Object helper.
- `plugin-server/tools.mjs` and `plugin-server/tool-helper.mjs`: current `exec` / process / terminal / output / stop API; G1 tool surface.
- `device-agent/local-wall.mjs`, `device-agent/fleet-wall-runtime.mjs`: current Wall SSE / local approvals / management surfaces.
- Pro Team implementation details are reviewed in [the mandatory Team compatibility report](./RDC_GOLD_MULTI_AGENT_PRO_TEAM_COMPATIBILITY_20261021.md); Team membership seats and Team dispatch policies are separate from personal Agent admission.

## 2. Target topology and invariant separation

```
 A/B-authorized Agents A, B, C, D (may remain connected)
       | MCP: per Agent identity + device consent + opId
       v
 GOLD OPERATOR
   Authentication / plan entitlement / local-final-deny boundary
   Scoped Agent Admission: personal Free 1 / Pro 3; Team shared 5 (2/seat)
   Per-agent fair work queue + per-device Resource Lock & budget scheduler
   PostgreSQL canonical jobs, attempts, ownership, events, results, leases
   Redis wake-up / short-lived hints / bounded ephemeral queues
       | Signed Agent transport (poll/duplex/pulse, NOT drain-on-busy)
       v
 DEVICE AGENT (control plane: authentication, signed channel, Local Wall)
       | bounded local job-control protocol, no privilege expansion
       v
 DEVICE JOB SUPERVISOR (separate OS process/service; worker plane)
   interactive / general shell / download(curl,wget,PS)/build / PTY as needed
   Job ID, process-group containment, bounded log/progress, cancel
```

Invariants:
1. `session` = identity + connection/grace. `agent_execution_slot` = currently admitted active Agent on an account. `worker_slot` = running task on a device. `resource_lock` = exclusive/shared use of specific resource. **Do not conflate these.**
2. `RUNNING` is not `DRAINING`. Valid reasons should distinguish `QUEUED_AGENT_SLOT`, `QUEUED_WORKER_CAPACITY`, `RESOURCE_LOCKED`, `DEVICE_UNAVAILABLE`, `OWNER_DRAINING`, `POLICY_DENIED`, `UNKNOWN_AFTER_RESTART`. Only owner/maintenance/update/revocation triggers a real drain (under applicable policy).
3. Authentic Agent identity must be derived from verified session + device grant, not a client-supplied `agentId` string that can be forged or used to multiply Free slots. Lease/admission must be atomic **across all devices and Operator instances**.
4. A confirmed grant/capability is necessary but not sufficient: still require device local final deny and OS permission. Neither a managed process, alternative tool name nor `-EncodedCommand` workaround may evade a policy denial.
5. Durable business truth is **relational PostgreSQL**, with Redis for short-lived wakeups and leases, never an authoritative JSON/SQLite business snapshot. Local OS process runtime metadata is not a second business database.
6. Every mutating operation uses existing **G4 `operationId`** identity, durable reservation before effects, terminal receipt and fenced attempt identity. Unknown after restart is never blindly retried.
7. Local Wall owner always retains final authority to terminate work and initiate maintenance drain. A canceled job may release resources only **after** the worker confirms termination/cleanup, not immediately when Cancel is requested.
8. **Team identity and capacity**: a future Team job uses the owner-paid Team execution context (5 Agent slots Team-wide, max 2 per invited seat, 20 sessions Team-wide/max 4 per seat), **not the invited member's personal subscription quota or Agent slots**. Actor identity and per-Agent A/B remain independent from billing owner. Owner's Team-scoped work shares Team capacity, while owner's private unshared-device work uses Pro personal quotas. Team live execution is off until separately approved M3-T.

## 3. Public/API contract (backward compatible)

Proposed optional `exec` fields, preserving legacy calls:
- `executionMode: auto | foreground | background` (default `auto` for new Gold implementation, behind feature flag; explicit legacy mapping retained during rollout).
- `waitMs` continues to mean how long the tool waits for a result, **not** how long the Agent holds the device's single command-poll lane.
- Launch every `auto` shell command in an owned worker *from the start*. Await a bounded short completion interval; if it runs longer, return canonical `jobId` in `RUNNING` state and continue the Agent poll. **Do not attempt to move a live process out of synchronous `exec` after spawning**, and don't assume script text reliably identifies all long builds/downloads.
- `background` returns quickly with `jobId`, not a completed-result claim. For downloads/builds it records worker/resource accounting even if the agent-execution slot is released.
- `foreground` preserves interactive streaming/wait semantics where needed but must not monopolize all other Agents or switch drain. PTY/interactive terminals remain a separate explicitly authorized lane.
- Existing `job`/`output` requests continue with stable `jobId`, pagination/cursor, bounded rings and lost-output indicators. Add `job_cancel`, `job_list`, `job_progress` via separately scoped permissions; don't silently reinterpret old `processId`/session ownership.

Proposed response sample, **not yet implemented**:
```json
{"ok":true,"jobId":"j_<opaque>","state":"RUNNING","executionMode":"background",
 "ownerScope":"account/device/session/agent","queueReason":null,"canCancel":true,
 "progress":{"doneBytes":null,"totalBytes":null,"verified":false}}
```
For `curl/wget`, prefer trustworthy bytes or live log markers; no invented percentage when total size unknown. Download worker runs `curl` on the target device; no artifact data is tunneled via Operator merely for this feature. A raw shell script may not provide reliable per-file byte progress, so a fallback to stdout/stderr plus elapsed time is correct.

Job lifecycle: `ACCEPTED → QUEUED → DISPATCHED → RUNNING → (COMPLETED | FAILED | TIMED_OUT | CANCEL_REQUESTED → CANCELLED | UNKNOWN)`. `UNKNOWN` (effect may already have occurred) must not be mapped to `FAILED` or auto-replayed. Normalize exit codes separately from transport/cancellation outcomes. Queue admission should return an informative queued state, not `target_node_draining` when the only issue is capacity.

## 4. Delivery sequence — consolidate related steps, one gate acceptance at a time

| Gate | Deliverables (Gold only) | Minimum exit criteria / actual evidence | Rollback boundary |
|---|---|---|---|
| **M0 BASELINE — DONE** | Both authorized devices, #464 real Internet curl negative test + managed-process positive control, session/process limits and policy audit; commit source docs | Source/baseline and 1:1 original URLs stored in handoff; no production/client mutation | Documentation only |
| **M1 Correct BUSY vs DRAIN** | Retain signed `pulse`; distinguish maintenance drain, executor readiness, slot saturation and running; carry Agent version protocol negotiation; Windows #464 Gold installed-UAT only with prior rollback after explicit owner go-ahead | Windows real #464 `curl exec` + second request must become `QUEUED` or run, **never false DRAIN**. Verify explicit owner drain still blocks admission. Both signed poll and Duplex tested; no double dispatch. No claim of concurrent execution yet | Version-negotiated feature switch; restore signed Windows build |
| **M2 Unified long-running Job API (first usable MVP)** | Unify `exec` and managed worker admission/receipt, `auto/background/foreground`, immediate durable Job ID for long curl/wget/build; keep existing NativeProcess tool semantics. Process output/status/cancel API scoped to owner; Release Agent control lane after start | On both Gold Linux and Windows: real bounded #464 `curl.exe` via `exec(auto)` becomes managed running job; while download running, short `exec` starts/completes; exact output/bytes/status; no orphan after cancel; no extra privilege | Gold-only new job mode toggle off -> legacy exec; no schema breaking removal |
| **M3 Personal Free/Pro Agent scheduler + fairness** | **Free=2 retained sessions/1 executing Agent; Pro=12 retained sessions/3 executing Agents**, per individual account across devices. Preserve A/B, HOLD/resume, fair bounded queue and independent device worker quotas. Prepare server-derived Team context but leave it disabled | Free: one active, next queues. Pro: 12 retained sessions co-exist, three distinct authorized Agents executing, fourth queues. HOLD never occupies execution slot. No accidental Team activation or billing change | Personal feature flag; Team separate |
| **M3-T Pro Team execution gate — OFF UNTIL APPROVED** | Trusted OAuth member A/B/shared-device checks + Team-scoped Scheduler; **5 human seats incl. owner, 20 retained Team sessions/4 per seat, 5 executing Team Agents/2 per seat**, first-per-waiting-member fairness; Team calls all billed/metered to **owner**, not invited member's personal quota. Explicitly migrate old preview `maxWorkers=3` independently from OS worker quota | UAT: five members each execute 1 Agent if device budgets permit; sixth queues. Free member's personal quota unchanged, owner Team usage charged exactly once, revocation/resource locks PASS. Cross-account execution remains OFF until separately authorized | Separate Team feature flag, entitlement migration, billing tests, owner approval |
| **M4 Resource safety + capacity** | Per-device budget for CPU/memory/disk/worker slots; file/project/build/package-manager/desktop ownership and shared-vs-exclusive locks, normalized paths, G5 CAS for file writes; per-account background-job caps and fairness | Pro A downloads #464, B builds a **separate** small synthetic workspace, C reads log concurrently; two conflicting builds of same project serialize with explicit `RESOURCE_LOCKED`. A lightweight command remains usable under one heavy job. Device-local resource budget must prevent 3 builds on 2-vCPU Gold LXD from exhausting host | Default conservative project locks; disable parallel path while preserving single-job semantics |
| **M5 Supervisor durability + cancellation** | Device Job Supervisor separated from transport Agent (systemd/Windows service/launchd), owned child containment, secure local command IPC, durable execution receipts, operator reconciliation, signed progress/events, bounded log buffers; cancel graceful/force semantics | Agent disconnect/restart while approved background download runs does not orphan/duplicate job; supervisor can keep running if allowed by owner policy. OS restart: resumable download only with verified source/range/checksum; ambiguous build returns UNKNOWN. Windows `Cancel` must not claim graceful until it actually signals first (today `taskkill /T /F` even for force=false). Owner Wall and owner Agent can cancel permitted jobs, foreign Agent denied. | Independent supervisor service rollback, existing binary restore and safe drain/cancel policy |
| **M6 Product UI and release sign-off** | Local Wall and Fleet Wall: jobs by owner Agent, device, state, worker class, elapsed, CPU/RAM where measurable, actual progress/logs, queue reason, Cancel/Force Stop permissions, drain countdown; operator event reconciliation, metrics and user-facing docs | Browser real Wall reload while download continues; cancel current job; 3 Agent genuine concurrency; maintenance drain preserves/reroutes work safely; Windows/Linux/macOS CI PASS and limited physical OS tests, signed-build provenance verified. Rollback + no duplicate effects after reconnect. | Staged Gold LXD then approved clients only; production separately authorized |

**MVP acceptance boundary:** M1 + M2 + M3 + minimum owner job list/cancel from M5/M6 + conservative M4 locks. This means Free/Pro Agent scheduling and independent long-running curl/build actually work on Gold with basic control; service persistence/restart robustness is a required hardening gate before claiming final durable background jobs/production readiness. **Do not call source-only tests a complete product.**

### Required package/account behavior
- **Free individual:** 2 retained active/hold sessions across their own devices; 1 executing Agent. Extra authorized Agents queue, personal monthly call quota remains separate.
- **Pro individual:** 12 retained sessions across own devices and **3 concurrently executing Agent identities**; sessions are not executing slots. Higher tiers need explicit mapped limits.
- **Pro Team (future separately enabled):** 5 member seats **including owner**, 20 shared Team sessions (max 4/seat), 5 active Team Agents shared across owner Team devices (max 2/seat). First-per-waiting-member fairness. **Team execution does NOT consume a member's personal Free/Pro Agent slot or call quota. All Team calls count to the Team owner's account/add-on**, respecting its configured member-call budget. Owner's Team-scoped jobs count into Team pool. Details: [Team compatibility review](./RDC_GOLD_MULTI_AGENT_PRO_TEAM_COMPATIBILITY_20261021.md).
- A single Agent can submit multiple background jobs only up to the separate account/device job quotas; transferring to background does not permit unlimited process farming.
- A session `hold` or reconnect does not occupy an active Agent slot but counts toward separate retained-session limits. Existing `sessionCeiling=2` per device and global 5 are old Gold baselines; M3/M3-T must migrate them to new scoped, bounded capacities without silently discarding valid sessions or blocking five Team users.

### Safe queue/resource behavior
- `ACCOUNT_AGENT_SLOT_FULL` → queued with position/estimate policy (no fabricated ETA), rather than drain.
- `DEVICE_WORKER_CAPACITY` → queued with reason and optional hardware/budget signals.
- `RESOURCE_LOCKED` → queued behind owning Job with minimally disclosed identity information only when caller is authorized.
- `OWNER_DRAINING` → reject new admissions, allow existing to finish or ask owner how to cancel, preserve old behavior on maintenance.
- `DEVICE_LOCAL_POLICY_DENIED`, OS permission failure, or platform pre-dispatch refusal → retain clear denial/origin; **no fallback to alternate tool to circumvent a denied command**.
- Do not infer mutable resource safety from arbitrary command text alone: use resource intents for known structured tools, explicit workspace/project lock for builds, and conservative fallback for unknown mutating shell commands. Prevent path alias/symlink escape and wrong-owner resource disclosure.

## 5. Persistence, leases and recovery design (relational, no duplicate effects)

Suggested canonical PG tables (exact naming/migration after review): `agent_execution_leases`, `job_requests`, `job_attempts`, `job_events`, `job_results`, `job_resource_locks`, `job_cancellation_requests`, `job_artifacts`. Use foreign-key ownership to account/device/session/Agent and unique scoped `operationId` + attempt/fencing; indexes for active account Agent slots and per-device work. For future Team jobs, persist distinct verified actor, Agent, owner, billed account, grant/expiry, and owner-pool identities; the caller must not choose or overwrite these values.

- Atomically reserve (1) operationId/job identity, (2) a permitted account Agent admission slot (when needed), (3) device worker/resource budget, and (4) job-attempt lease; **across Operator instances** (transaction/advisory lock or guarded row update), rather than only in-memory Fleet state.
- Redis holds ephemeral ready/wakeup indices and lease acceleration. PG is authoritative; Redis failure must not create permissive local quota fallback.
- When a job is detached, release its *Agent execution slot* only after successful admission to a bounded worker slot, while retaining origin Agent ownership and explicit cancel authorizations.
- Durable job result protocol needs **start-ack** distinct from **completion-ack**, with a no-blind-retry G4 operationId mapping. Agent poll/duplex gets free to accept more jobs after start-ack, not after complete. The Operator must not confuse a job's still-running state with a command transport blocked waiting for its effect.
- Independent per-device Supervisor must run under service-account authority, securely bind to approved Agent with local IPC and owner policy; **no new OS privilege**. On Agent service restart the Supervisor can continue a job where allowed. On Supervisor/OS restart, reconcile known PIDs/process containment, logs and checkpoints; if survival is not verifiable mark `UNKNOWN`/terminal instead of inventing `RUNNING`.
- Explicit owner policies for `on_agent_disconnect`, `on_service_update`, `on_owner_drain`, `on_lease_expiry`, `on_os_restart`. Do not promise automatic build resume or arbitrary `curl` resume without validating HTTP Range, ETag/Last-Modified, final checksum and destination semantics.
- Bounded stdout/stderr chunk/cursor, long-log offset and truncation flags; source-data redaction and no leaking command secrets in shared Wall views. Transfer progress only from trusted confirmed bytes; unknown total = bytes and time, not percentage.

## 6. Cancellation control contract

Actor-specific authorization: owner of device (Wall) may cancel device-scoped jobs according to owner policy; job-submitting Agent may cancel own job; other Agents require explicit delegated management permission. Deny cross-account, revoked A/B grant and wrong device/session IDs. Always audit actor, reason, job ID, requested mode, timestamps and result without exposing sensitive command text to an unauthorized viewer.

Two distinct user actions:
- **Cancel (graceful request):** set `CANCEL_REQUESTED`, signal the owned job, wait bounded grace and cleanup; Windows must implement a true supported graceful signaling path for applicable console/GUI processes or clearly return `graceful_not_supported` and request explicit Force Stop. Never silently call `taskkill /F` and label it graceful.
- **Force Stop:** explicit confirmed owner/Agent authority and only the owned OS process tree; kill-on-close job object, PID/process-start fencing, no PID reuse accident, release locks only after verified exit/timeout reconciliation.

Canceling `exec` (not just `process`) becomes a first-class `job_cancel` operation. Existing process and terminal stop APIs remain backward-compatible. Files `.partial` can be kept for authorized resume or removed; neither option should silently treat a partial download as a final artifact.

## 7. Test matrix and rollout gates (bounded, real evidence)

| Scenario | Expected evidence |
|---|---|
| Windows old-Agent baseline `curl.exe` on build #464 + second command | Existing reproducible false drain (already captured); **do not repeat unnecessarily** |
| Windows patched Agent (only after owner permits installation) same real build #464 curl + second exec | No false drain; M1 only proves accepted/queued. M2 requires second command actually completes **while curl still running** |
| Linux Gold concurrent managed curl/build & short exec | No head-of-line block, no unbounded resource use |
| Free two separately paired Agents, one account, one + two devices | Exactly one active executing Agent account-wide, others queued fairly; don't count HOLD sessions as active |
| Pro three separately paired Agents + fourth contender | Three admitted when capacity allows, fourth queued, no unauthorized access; contention on same project locks correctly |
| Pro Team owner + 4 invited members (separate Team flag/UAT only) | Up to 20 Team sessions, 4/member; five distinct Team member Agents admitted when OS/device resources permit, sixth queues; max 2 per member and per-member fairness. Free invited member's personal quota untouched; owner Team usage charged once; separate Local Wall A/B and owner resource locks enforced; on revoke, affected jobs fenced. Cross-account Team dispatch remains OFF until approved |
| User cancels curl/build from Local Wall; Agent cancels own; foreign Agent attempts cancel | Correct authorization, confirmed process-tree stop/cleanup, no cross-owner leakage |
| Transport down/reconnect/restart, duplicate opId and cancellation race | PG state reconciles, no duplicate side effect, UNKNOWN on uncertainty, owner drain respected |
| Browser Local Wall/Fleet Wall progress and Job Manager | Real bytes/logs/status, reload consistency, Cancel/Force Stop visible and working |
| macOS/Linux Desktop/Windows services and remote Linux Server | Platform-specific process/session handling, signed updates, no regression to old tools |
| Quota/OS permission/security refusals | Consistent error classification; policy never widened to achieve pass |

Run source unit tests for state transitions + minimal real end-to-end A/B; no endless broad synthetic soaks. Preserve existing G4/G5/G6 fixture passes and bounded CI budgets. Each gate records exact SHA, target device/OS, authoritative PASS/FAIL/BLOCKED and rollback artifact. No surprise production/client rollout.

## 8. Execution discipline and decisions

1. **Do NOT deploy/build/install as part of drafting this plan.** Current owner expressly asked for an engineering plan after discussing the measured Linux and Windows limits.
2. First M1 implementation gate re-checks Gold HEAD and Windows installed version and reproduces ONLY missing positive acceptance of patched Windows; don't change production or install unsigned CI build without matching owner instruction.
3. Next M2 implementation must yield a visible working skeleton (job list/status/cancel + real background curl/build) before adding sophisticated scheduling; don't hide product progress under excessive test loops.
4. Then M3 account-wide concurrency and M4 conservative locks, followed by M5 durable Supervisor and M6 full Wall/release acceptance. Where M4/M5 are necessary for a safe MVP, implement the minimum contract before opening Pro parallel writes.
5. Checkpoint after each gate to `docs/optimization` and `RDC_HANDOFF_CURRENT.md`. Keep unrelated Gold UAT untracked files unmodified.
6. **Do not automatically close G1/G2/G6 prior physical or external-platform gates** just because this new plan exists; those remain separate documented acceptance.
7. Owner-facing target outcome: `curl/wget/build running → first Agent receives jobId → another eligible Agent/command can execute → owner can observe/cancel → no false drain → no unsafe conflict or unbounded resource use`.
