# RDC vs Light Remote Gold — execution path and reliability RCA map (G0)
**Status: source analysis, not a new runtime patch.**
Source pins: RDC `f508e524`; LR Gold `4daccb8`. Relative file paths below refer to those pins.

## Why matching one shell command is NOT matching architecture
RDC `src/server.ts` publishes task-oriented MCP tools (e.g. `start_process`, `read_process_output`) plus instructions to the client; `src/tools/improved-process-tools.ts` feeds `src/terminal-manager.ts` with short MCP waits and independently living processes. Local process mode can often run without Light Remote's additional OAuth/Agent/Fleet hops. RDC has its own remote mode (`src/remote-device/remote-channel.ts`), which must be compared separately from RDC local mode. **No evidence here that the OpenAI safety layer gives RDC privileged treatment.**

Light Remote's real `light_remote_exec` path, per source:
1. **ChatGPT client / platform pre-dispatch:** provider may accept or refuse the attempted tool call before Plugin is invoked. Light Remote cannot inspect or change private provider policy; no device job exists on refusal.
2. **Plugin** `plugin-server/tools.mjs`: Zod and optional `requiredCapabilities`, OAuth scope metadata, `guarded()`, response sanitization. Metadata and user-provided capability lists must agree with actual semantics.
3. **Operator adapter** `plugin-server/operator-adapter.mjs:158-160`: binds `sessionId`, `agentId`, `nodeId`, `operationId`, `requiredCapabilities` into an authenticated/sealed `/v1/execute` command. No permission to substitute a different device.
4. **Operator admission** `operator-host/executor.mjs:408-459`: checks session and connection, decides local vs remote, infers capabilities from platform adapter, enforces hard-deny and compares against Fleet `targetRoute(...).capabilities` for outbound devices. Failure `target_node_capability_missing` happens **before `job_started`** and should be recorded as `job_admission_denied`; it is not a Linux `EACCES`.
5. **Device Agent / OS:** a successfully admitted remote job is enqueued and must pass device proof and local final deny. Tool result may have Linux exit code, process signal, timeout or remote transport uncertainty.
6. **Results:** durable/ephemeral job state, stdout/stderr offset, queue and SSE/Wall events, tool response. Timeout returning to ChatGPT does not imply process effect stopped.

This is a key engineering difference: even identical `docker ps` commands may traverse different capability inferences and hop count if the caller supplied `requiredCapabilities`. A wrong `targetRoute` capability list can refuse the job while `inspect_device` correctly shows the device's separate effective capability set.

## RDC reliability mechanisms worth testing, not copying
- `src/server.ts`: client instructions; small tool-specific Zod schemas and annotations. Hypothesis: fewer ambiguous tool selections. Do **not** water down destructive annotations to influence a platform checker.
- `src/terminal-manager.ts`: process wait ceiling, long-running PID handle, split initial response/read-later output, bounded buffers. LR already implements handles/bounded read: verify identical *outcome semantics*, not buffer size.
- `src/utils/withTimeout.ts`: contrast timer race vs cancellation-aware I/O. LR should report uncertainty where lower-level abort is not guaranteed.
- `src/remote-device/remote-channel.ts`: jittered reconnect, half-open/rejoin wedge detection, bounded heartbeat/update writes. Compare with Fleet using injected latency/half-open, do not copy reconnect constants.
- `src/utils/toolHistory.ts` and `src/remote-device/diagnostics/report.ts`: bounded history and defensive redaction. LR requires account-grant-aware filtering and no secret leakage.
- RDC's general command blocklist/allowed-directory scheme is not a substitute for LR's device-local capability and A/B authorization.

## Precise G1 error-layer experiments (future, not executed G0)
| Safe case | Original observation | First evidence to capture |
|---|---|---|
| Read-only `git status` from authorized workspace | passed before | MCP accepted?, job admitted?, status/error origin |
| Read-only `docker ps` with default inferred capabilities | passed | source-inferred cap set and Fleet route cap set |
| Same `docker ps` with explicit `['docker']` | once refused `target_node_capability_missing` | `nodeId`, **authorized** route capability list/epoch, sanitized `job_admission_denied`; never dump private policy or A/B |
| Same authorized `lxc list` / `systemctl is-active` with and without declared capability | mostly passed in previous sweep | compare local vs remote admission branch |
| Read-only source search | previously refused pre-dispatch | capture refusal *without replay via alternate tool*; no remote job ID |
| 2-chat sequential MCP initialize/read/reconnect | not yet measured | session restoration and discovery parity |
| Identical benign RDC local vs remote vs LR Gold intent | not yet measured | comparable environment, tool descriptions, platform policy; never assume identical host policy |

For all: status types `platform_pre_dispatch`, `plugin_validation`, `oauth_authorization`, `operator_admission`, `device_policy`, `os_execution`, `transport_unknown`. Avoid false attribution to OpenAI based solely on a backend `403`.

## G5 SCP progress data-flow tracing (future design)
- `lib/light-scp-file.mjs::_view` reports `progressBytes/totalBytes` and chunk counts; upload commit validates complete data and SHA-256, while download reports bytes served.
- `plugin-server/tools.mjs` exposes `download_status` and `upload_status` for an authorized transfer. The status is not presently a Wall progress stream.
- `operator-host/executor.mjs:545-566` creates **one job per SCP begin/chunk/status/commit** with `toolMeta` and result data; a UI must **aggregate jobs by authorized transfer ID**. One chunk job completion is NOT transfer completion.
- `device-agent/local-wall.mjs:93-109` has bounded rendered job entries, SSE `/events`, job ingestion and periodic status. The minimal solution likely adds a **safe transfer projection** to existing job events + status, rather than new transfer engine or new persistent JSON. Verify outbound data path and auth scope BEFORE implementation.
- Use transfer phases `queued → transferring → verifying → complete/failed/cancelled`; 100% bytes does not imply verified write; report stale/unknown when reconciliation cannot determine the final state.

## Release implications
Source observations cannot prove platform pre-dispatch acceptance; there is no legitimate API to disable the OpenAI checker through Light Remote. Direct Gold evidence and a clear trace at each authorized hop must precede G1 changes. All code edits and deployment for G1–G6 will be on **existing Gold branch only** and separately checkpointed after owner review.
