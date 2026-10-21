# Gold M5 — owner-managed process control from Local Wall (first functional slice)

**Date:** 2026-10-21. **Scope:** Linux/Windows/macOS device Agent Local Wall source and real HTTP/OS process selftest. Not independent durable Supervisor, not Team live cross-account support, not production rollout.
**Previous accepted M2:** [real curl, wget and Windows build #464 background exec acceptance](./RDC_GOLD_M2_LONG_COMMAND_BACKGROUND_FIRST_SLICE_20261021.md).
**Master plan:** [multi-Agent and job scheduler](./RDC_GOLD_MULTI_AGENT_JOB_SCHEDULER_MASTER_PLAN_20261021.md).

### Functional code change
1. **Local Wall /processes** — standalone owner Process Manager page (not a decorative dashboard). Lists actual device-local managed process runtime with process ID, OS PID, Agent session, running/stop/exit state, bounded stdout/stderr byte counts, refresh every 3 seconds, Stop and Force Stop for running processes. Command content is not injected in HTML and no secrets are present in process-list DTO.
2. **Owner-only API** — `GET /api/processes`, `POST /api/processes/stop`. Both require the existing **authenticated Local Wall session**, even for a loopback deployment configured without local login. Stop additionally requires CSRF and a syntactically valid native process handle and a boolean `force`. No broad device OS PID-kill API.
3. **Actual process ownership** — daemon attaches to its same-process `NativeProcessRegistry`; a stop ID is looked up in that registry, verified against the currently enrolled account/device and passed to `NativeProcessRegistry.stop` with the **exact recorded account/device/session/Agent** owner. Other device/account/process IDs cannot be targeted through untrusted request-provided identity or OS PID. Stop action logs only processId/force/state (no script or tokens).
4. **Explicit wall-only limitation** — when a separate wall-only companion process does **not** share the daemon's process registry, it MUST NOT advertise a fake list or allow stop. UI hides Processes link for authless/ineligible Wall; direct /processes endpoint returns 501 if unsupported. Secure local IPC from a separate Wall to the actual Agent is a future Supervisor integration gate, not papered over with a second empty registry.
5. **Honest cancellation semantics** — Windows `force:false` currently calls native `taskkill /T /F`; page explains this is forced termination, not guaranteed graceful cancellation. Actual graceful vs force distinction is still an M5 hardening task. Existing device/Agent permission model untouched.

### Verification
- New `deploy/scripts/selftest-gold-m5-owner-process-wall.mjs` starts an **actual bounded OS child process** through the existing NativeProcessRegistry, launches a real authenticated Local Wall HTTP server and tests unauthenticated 401/redirect, authenticated Process Manager HTML with no embedded command, authenticated read, malformed process ID rejection, CSRF/invalid force rejection, exact process stop and verified OS process state `stopped`; cleanup/finally closes server and child tree.
- `G2_WALL_PTY_AUTH_AND_LAZY_OUTPUT`, `G2_WALL_PTY_BOUNDED_CURSOR`, `G3_WALL_EXPOSES_RUNNING_AGENT_PROBE`, `G3_WALL_EXPOSES_EXECUTOR_UNAVAILABLE`, `G3_WALL_SEPARATES_CANARY_FROM_COMMAND_STALL`, `G3_WALL_EXPOSES_STALE_EXECUTOR_EVIDENCE`, and M2 long command classifier tests all PASS (2026-10-21 local source test).
- GitHub Gold G3 Operator regression workflow includes new M5 owner process test. CI status and real installed-client validation to be appended separately after commit.
- No installed client changed during this source slice. Existing unrelated UAT untracked files remain untouched.

### Remaining M5 / M6
- Owner Fleet Wall across machines and **persistent Supervisor** with separate service+state/lifetime beyond Agent restart; client version negotiation and dynamic local process registry page UI.
- Graceful Windows process-tree termination and exact post-cancel receipts, plus worker cancellation scope from Agent `jobId` to `processId`.
- True progress for arbitrary curl/wget/build (currently bounded actual stdout/stderr byte counts only, **not** download percentage) and actual Operator-level Job Manager list/cancel.
- Product plan-specific Agent concurrency slots Free1/Pro3/Team5 and resource locks are independently outstanding.
