# INCIDENT: Long-lived Light Remote session + A/B authorization persistence (2026-10-10)

**Status:** Reproduced and diagnosed; source-only orphan-job fix tested on isolated branch. **Production unchanged**.
**Observed:** Owner's `ChatGPT Light Remote` session `s_muz2uu81_6951a80f41de8521`, device `direct-arm-local` (VPS-ARM). Read-only inspection of live LXD Direct Operator / plugin through authorized Light Remote.

## Live findings and evidence
- Session created ~43.5h before inspection; grace preset 60 minutes; `holdReason=active_job`, `expiresAt=null`, reconnects 19.
- Live session registry: `jobsStarted=2107`, `jobsFinished=2070`, `activeJobs=37` at snapshot. 37/37 retrieved via internal job API reported `running`, oldest ~42.3 hours; 20 exec-like, 17 filesystem jobs.
- **36/37 running jobs have `commandId=null`, route `outbound-leaf`: 19 exec + 17 filesystem. The remaining 1 was newly dispatched with a valid command ID. These 36 are orphan records, not proof of active remote commands. DO NOT terminate the 1 valid job by bulk closure.
- Actual active A/B Device Access Grant approved ~48.2h ago, idle grace 30m, but grant expiry at inspection was **~66h in the future**. Active Agent Client binding created ~55h ago, `expiresAt` refreshed to ~24h in future, working context bound. OAuth plugin access JWT 1h; refresh token 30 days.
- `plugin-server/operator-adapter.mjs:stableAgentId` uses `SHA256(accountId + '|' + clientId)`, stable across new ChatGPT conversations. It is **not chat-scoped**.
- `AgentClientRegistry` 24h TTL is renewed on each touch. `DeviceAccessGrantRegistry.renewConnection()` stretches existing grant to the device's renewed connection lease. `DeviceAccessGrantRegistry.reap()` exempts idle expiration while any live session exists on that device.
- `SessionRegistry._state()` immediately reports `hold` whenever `activeJobs.size > 0`, before checking grace. `_view()` returns `expiresAt=null` for that hold. An orphaned job therefore pins session indefinitely. `SessionRegistry.open()` reuses the live session by `accountId/deviceId/agentId` lane.

## Root-cause source defect: dispatch failure leaks jobs
In `operator-host/executor.mjs`, each of 8 remote job routes used to create job, attach to session.activeJobs, **then** call `fleet.enqueue()`, **then** install timeout and job.commandId. If `fleet.enqueue` synchronously throws (offline/draining/queue-full etc.), the server returns an error but leaves in-memory job marked running with no commandId and no timeout. This matches precisely the observed 36 orphan jobs. Do not overclaim which individual exception produced each orphan without additional logs.

## Source-only fix prepared
Isolated worktree: `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/session-orphan-jobs-20261010`; branch `fix/session-orphan-jobs-20261010`, parent at `5379b70` (includes prior `renew` 404 branch).
- `operator-host/executor.mjs`: introduce `enqueueForJob(job, command)`. On enqueue reject, mark job error and call `finishJob(job,1,null)` to remove it from `session.activeJobs`; rethrow original error, preserving 409/429 response. All 8 remote enqueue call sites use guard. No change to successful enqueue.
- `deploy/scripts/selftest-v08-fleet-execution.mjs`: exercise a draining device and assert the session has zero active jobs and equal started/finished jobs after the 409 rejection.
- `deploy/scripts/selftest-session-orphan-job-guard.mjs`: static parity check ensuring no unguarded remote queue dispatch is reintroduced.
- **PASS**: v08-rejected-enqueue-no-orphan-active-job, v08-fleet-execution, v08-fleet-router, v11-outbound-routing, syntax and git diff check. Do not claim a full repo suite.
- Existing 36 orphan jobs require **separately planned live reconciliation**; the source fix stops future leaks after deployment but does NOT clean existing state. Avoid restarting production Direct Operator or killing jobs without owner approval.

## Separate security-policy flaw requiring owner decision
A/B approval currently lives across ChatGPT conversation boundaries because stable OAuth account+client identity is reused. This is by design for persistent plugin clients but conflicts with owner expectation if every new chat should re-pair.
Recommended default policy proposal: **24h absolute A/B authorization TTL** (owner configurable, e.g., 12h/24h), 30–60m inactivity TTL, no renewal beyond absolute grant expiry. New commands after expiry require local A/B; do not silently kill already-accepted long jobs, but cap them independently and prevent indefinite session pinning. Session/job hard maxima must never derive security from a mutable `activeJobs` count alone.
**Chat-bound A/B** cannot be guaranteed merely from `accountId|clientId`; needs a trusted per-conversation identifier/nonce from the ChatGPT client or an explicit owner-authorized session epoch. Do not claim current plugin knows ChatGPT conversation boundaries.
Suggested user choice: A/B for every new conversation (requires trustworthy chat-scoped identity design) **vs** hard 24h re-approval while preserving resume within that period. Do NOT impose either live policy without owner's decision.

## Safe production remediation / follow-up
1. Preserve forensic proof (aggregate only, never export grant tokens/client session secrets). Confirm no true running jobs to interrupt.
2. Deploy guarded enqueue code with normal CI/canary and rollback. Require test for reject cases exec/fs/desktop/process as applicable.
3. Add reconciliation for legacy jobs specifically `remote && !commandId && older than threshold`; finish with auditable terminal status rather than indiscriminate session closure; add safe session expiry behavior and false-positive handling for legitimate long jobs.
4. Implement absolute grant expiry and reauth policy as separately reviewed feature flag. Test OAuth client reconnect, A/B owner proof, device lease renewal, job execution, multi-chat boundaries, plugin context recovery.
5. Do not terminate current 37 jobs, reset account/device bindings or reboot Operator without explicit owner approval and a rollback checkpoint.

Read-only APIs returned only aggregated diagnostics to conversation; some GET job endpoints record diagnostic job-read/tool-call usage (VIP unlimited) as a side effect.
