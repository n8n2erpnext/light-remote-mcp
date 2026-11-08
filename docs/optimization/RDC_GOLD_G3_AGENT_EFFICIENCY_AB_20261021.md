# G3 — Agent work rhythm & output efficiency, production-vs-Gold A/B (2026-10-21)

## Owner goal and scope

Test both owner-authorized official plugins to make Light Remote Gold faster/more stable for ChatGPT/Codex and Claude Agent workflows, especially fewer MCP round-trips and less context/token clutter. **Production is read-only and NEVER redeployed, restarted, or configured by this benchmark**. Targeted environments: official Light Remote on direct VPS-ARM host (Linux ARM64), Light Remote Gold in isolated `light-remote-gold-uat` LXD (Linux ARM64 on same VPS-ARM physical CPU). These share a host but are NOT identical service topologies, so benchmark is real end-to-end comparative workflow, not an isolated CPU microbenchmark.

ChatGPT/Claude **model decoding token/s is not configurable by Light Remote**. Tool response bytes/context and number of MCP turns are measurable; raw exact model input/output token accounting would require model-side/tokenizer usage instrumentation absent from current Plugin. **Never claim the plugin increases intrinsic model token generation throughput.**

## Paired real-tool benchmark (canonical workflow)

Both plugins were already paired via explicit owner Local Wall A/B authorization. Official and Gold helpers ready; sessions explicitly resumed and Gold ARM LXD device selected (not Windows) to use the same Linux ARM64 shell script on the same VPS-ARM host.

Workloads: alternate a short `printf 'LIGHT_REMOTE_BENCH_OK\n'` and 64 fixed deterministic text rows (2,880 stdout bytes). Per test both tools were called sequentially: `light_remote_exec` plus `light_remote_output(full=true)`; validate `state=ok`, `exitCode=0`, output marker; measure time at tool caller, not Agent execution-only. Interleave production-first and Gold-first to reduce ordering bias. 8 **valid paired samples** per plugin, 16 successful jobs, 32 MCP tool calls. Additional interrupted attempt exceeded the orchestrator's per-script tool-call cap and was discarded from statistics; do not include that attempt.

Valid P samples ms: `[5504,5269,6483,5776,6198,5462,5395,5559]`.
Valid Gold samples ms: `[3520,3006,2411,2859,2515,2860,2425,2678]`.

Nearest-rank percentile summary:

| Metric | Production | Gold UAT |
|---|---:|---:|
| Correct jobs/total | 8/8 | 8/8 |
| p50 complete exec + output | 5,504 ms | **2,678 ms** |
| p95 complete exec + output (N=8) | 6,483 ms | **3,520 ms** |
| Aggregate 8-job elapsed tool time | 45,646 ms | **22,274 ms** |
| Canonical tool calls/job | 2 | 2 |
| Short test serialized JSON exec+output | 283 bytes | 283 bytes |
| Medium test serialized JSON exec+output | 3,208 bytes | 3,208 bytes |

Gold p50 ~51.3% lower, p95 ~45.7% lower and cumulative time ~51.2% lower in THIS particular N=8 scenario. No malformed outputs, missing job, or retry in those 16 valid benchmark jobs. This is a small, single-user sequential sample; do not generalize to global service SLA. **Current Gold is faster at tool rhythm, NOT more token-efficient with legacy 2-tool-call flow (payload bytes identical).**

## Safe Gold-only opt-in agent-output fast path (proposed source enhancement)

Files: `plugin-server/exec-inline-output.mjs`, `plugin-server/tools.mjs`, regression `deploy/scripts/selftest-g3-agent-inline-stdout.mjs`. New optional `inlineStdout:boolean` argument on `light_remote_exec`; default **false** so existing production-like tool behavior is identical.

When and ONLY when `inlineStdout=true` and canonical `exec` already returned `ok=true, job.state=ok, running=false, exitCode=0`, Plugin adapter uses existing `AccountOperatorAdapter.output` (which **checks owning session/device and sanitizes restricted text**) to fetch bounded stdout. If stdout fully fits **1536 bytes**, return `inlineStdout:{complete:true,output,totalBytes}` along with original `jobId`, `state` and `exitCode`, allowing Agent to skip the second MCP `light_remote_output` tool call. For longer output, running jobs, read errors, or revoked permissions, do not inject bulk output; preserve canonical jobId and signal `complete:false` for normal output retrieval. Bounded max 2KB, default 1536. No authorization relaxation, hidden retries or automatic re-run of shell commands.

Source regression PASS:
- Default compatibility never reads/inlines data.
- Successful short authorized stdout can return in one tool response.
- Large output never floods context; fallback points to regular output.
- Running/denied operations not changed.
- Transient output retrieval errors preserve original jobId and remain recoverable.
- Tool schema declares optional opt-in.
- Static module import and JS syntax PASS; full `plugin-server/selftest.mjs` launched on raw host lacks mandatory Gold independent-mode environment and is **not** counted as PASS; run Gold-scoped smoke in LXD instead.

**Important release boundary:** The source enhancement is **not yet enabled in the already-installed external ChatGPT connector schema**. Updating the Gold MCP server and reloading/reviewing its exposed tool schema may be necessary before ChatGPT can pass `inlineStdout` directly. Do not assert real token savings or speed gains from this new feature until deployed and measured end-to-end against the new schema.

## Duplex fault-recovery completion (separate G3 gate)

Previously Gold-only Preview proxy was restarted after guarded proof of a **real physical Windows #453 command inFlight=1, dispatchTransport=device-duplex-v1, attempts=1, strict ON**. Windows command ran `Start-Sleep -Seconds 90` and emitted a harmless marker. Gold Preview health 10/10 PASS. Operator final activity:
- one initial `node_command_dispatched` with `device-duplex-v1`;
- **one `node_command_redelivered` of the same command ID** after reconnect (`attempts=2`);
- **one `node_command_completed` with `dispatchTransport=device-duplex-v1`, `resultTransport=device-duplex-v1`, attempts=2**;
- exactly one `job_finished`, stdout marker correct, exitCode 0.
Thus **physical Device Duplex late receipt/reconnect PASS**. The same command was transmitted twice, so no claim of no redelivery; deduped completion observed. Exactly-once effects for arbitrary filesystem writes are NOT proven by a read-only sleep job.

## Next and rollback

- Leave production source/config unchanged. Gold strict admission remains ON via isolated LXD systemd override; prior immutable candidate/source backups kept.
- After source-only tests, commit/push Gold files and optionally stage/backup/cutover Gold Plugin to expose `inlineStdout` on the Gold tool, keeping strict ON and 10-sample health. Do not attempt to pass unavailable tool args through a fixed installed schema or bypass policy.
- Follow-up A/B using the **actual opt-in new Gold schema** (same short jobs) is required before saying one-call Gold is faster/token lighter. For currently published Gold connector, benchmark above is canonical 2-call behavior.
- Keep 4 inherited untracked UAT artifact paths untouched. G3 remains in progress until product-level Gate owner acceptance; G4 not started.
