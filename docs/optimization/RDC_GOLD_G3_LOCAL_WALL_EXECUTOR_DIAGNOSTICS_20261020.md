# G3 Gold — Local Wall executor readiness diagnostics

Date: 2026-10-20 | Branch: `feature/light-remote-gold-rebuild-20261018` | Baseline: `7694539`.

## Product gap
The independent `ExecutorReadinessProbe` introduced in G3 already influences authenticated Agent heartbeat/dispatch, but the Agent's Local Wall status and device header did **not** expose current subprocess canary health or distinguish it from an in-flight command stall. Operators could see an online duplex channel without seeing why Fleet refused admission.

## Code
- `device-agent/operator-agent.mjs::statusView`: both unenrolled/enrolled status paths now include `executorReady` (true / false / null) and `executorProbe` (state, checks, failures, consecutive failures, stale, lastCheckedAt, etc) from the in-process monitor. Explicit false includes a hung in-flight duplex command even if independent process-spawn probe is healthy. The authenticated Agent's `/api/status` Local Wall handler already calls `getLocalStatus()` in its daemon process; no new route or permission authority.
- `device-agent/local-wall.mjs`: existing device header shows Executor `ready/unavailable/unknown`, spawn-probe state, check count, consecutive failures, with existing HTML escaping. No raw shell command, exception stack, process output, keys, or user secrets displayed. No new external resources; existing local Material icons continue.
- The CLI `status` command runs in a separate process, so its probe result can be `unknown` if it has no active daemon monitor. The **daemon Local Wall** is the authoritative live in-process snapshot; do not claim a separate CLI's probe status represents the running daemon.

## Test
New real HTTP `deploy/scripts/selftest-g3-local-wall-executor-readiness.mjs` starts the actual Local Wall on ephemeral loopback with a test status provider, GETs `/api/status` and page HTML, checks four states:
- `G3_WALL_EXPOSES_RUNNING_AGENT_PROBE=PASS`
- `G3_WALL_EXPOSES_EXECUTOR_UNAVAILABLE=PASS`
- `G3_WALL_SEPARATES_CANARY_FROM_COMMAND_STALL=PASS`
- `G3_WALL_EXPOSES_STALE_EXECUTOR_EVIDENCE=PASS`

VPS-ARM runtime: 4/4 PASS; previous G2 wall regression `selftest-g2-wall-headers-sent-crash.mjs` 3/3 PASS.

Inside actual Ubuntu ARM64 `light-remote-gold-uat`: staged source modules and existing branding/icons to `/tmp/g3-wall-readiness-20261020` **only**, launched real Node HTTP Local Wall and exercised the four states: 4/4 PASS. A first staging attempt lacked bundled SVG icons and correctly failed the existing `materialIcon` contract; staging corrected by copying assets as packaged. **No UAT service or installed Wall was restarted or replaced**.

## Packaging, evidence and limits
- `client/core-files.json` already stages Agent Local Wall; this change applies to Gold shared core on macOS (Intel/ARM64), Linux Desktop (x64/ARM64) and Windows when an approved build is installed. New test wired into OS package smoke and Gold Operator CI. Source `761a67a`: [Gold Operator CI #7](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39430566763) **4/4 SUCCESS** (Operator contract with all four Wall markers logged, bounded soak, server bundle x64/ARM64). [Linux Desktop #289](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39430566731) **2/2 SUCCESS**, each x64/ARM64 job log contains all four Wall markers. [macOS #247](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39430566675) and [Windows #451](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39430566736) still running/queued at this checkpoint; no final acceptance claimed.
- This displays Agent self-report and independent spawn-canary evidence, **not proof that every PTY/Desktop/FS operation is executable**. It does not modify production entitlement or Local Wall auth, and no live owner-approved Gold enrollment is claimed.
- G3 still open for real disposable live Gold Agent with normal authenticated owner approval and bounded service-lifetime soak. Preserve unrelated UAT files.
