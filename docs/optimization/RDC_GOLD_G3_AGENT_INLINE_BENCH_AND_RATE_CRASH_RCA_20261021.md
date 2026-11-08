# GOLD G3 — Agent inline-output A/B acceptance and Redis error-handler crash fix
Date: 2026-10-21 (Asia/Ho_Chi_Minh)

## Scope / absolute production boundary

Branch `feature/light-remote-gold-rebuild-20261018`. All source changes and deployments were to isolated **`light-remote-gold-uat`** on VPS-ARM. Official **Light Remote production** was queried **read-only** for the comparison and used for bounded read-only benchmark shell commands; it was **never redeployed, restarted or reconfigured**. No Cloudflare Proxy/WAF/Workers introduced. Existing GitHub Release→R2 storage retained.

Deployed source candidate inside Gold LXD now: **`dc02792e7372c4a388251eef701cf1931da2dc05`**. Operator strict admission `OPERATOR_REQUIRE_EXECUTOR_READY=1` **remains ON**. Gold Plugin specifically opted into `LIGHT_REMOTE_GOLD_INLINE_STDOUT_DEFAULT=1` via the existing isolated `96-g3-inline-stdout.conf` systemd drop-in. Default is OFF for non-Gold or unconfigured Gold. Legacy explicit `light_remote_output` always remains supported.

## Agent workflow benchmark — official production vs Gold inline

Two real connected and owner-authorized official MCP tools were tested on **same VPS-ARM CPU** with Linux ARM64 scripts, but on different deployments (official direct host vs Gold in LXD). The test is *end-to-end Agent tool-workflow latency*, not isolated CPU/hardware/machine-learning benchmark. Interleaved producer order across **8 valid short-command pairs per plugin**, `printf 'G3_AB_INLINE_ROUND_XX\n'`. Production flow is `light_remote_exec` followed by `light_remote_output` (2 tool calls); Gold inline automatically returns `inlineStdout.complete=true` on `light_remote_exec` (1 tool call). Each of 16 jobs was successful with correct stdout, no retry.

Measured wall-clock time at tool caller in milliseconds, including all required tool calls:

| Pair | Official Production (2 calls) | Gold UAT (1 call) |
|---:|---:|---:|
| 41 | 5335 | 1928 |
| 42 | 5322 | 1836 |
| 43 | 6494 | 2418 |
| 44 | 5672 | 1998 |
| 45 | 5703 | 1873 |
| 46 | 5419 | 2889 |
| 47 | 9140 | 3980 |
| 48 | 8235 | 4596 |

Nearest-rank **p50**: Production **5672 ms**; Gold **1998 ms** (about **64.8% less** in this N8 sample). Nearest-rank **p95**: Production **9140 ms**, Gold **4596 ms** (about 49.7% less). Aggregate wait across 8 jobs: Production **51,320 ms**, Gold **21,518 ms** (about 58.1% less). Each corresponding serialized `structuredContent` response: Production `exec`+`output` **283 bytes**, Gold inline `exec` **204 bytes** (about **27.9% less**). Required MCP calls per successful small job: **2→1** (50% fewer). This is **not model decoding token/s** and is not exact OpenAI/Claude billable token usage; the 204/283 byte counts are serialized structured result only, not the entire model context, MCP metadata, or duplicate text+structured content. This N8 sequential single-user benchmark establishes relative workflow improvement, not a global capacity or multi-day stability SLA. Both platforms showed higher late-sample latency.

Previously captured legacy two-call mixed short/2,880-byte medium comparison (8 valid pairs each): Production p50 5,504 ms, Gold p50 2,678 ms; payload sizes identical per workload. The inline fast-path is an **additional reduction in tool calls** for short output.

## Live Gold fallback / permission guarantees

- On active Gold Plugin with existing ChatGPT connector schema (without needing to expose new parameter): a read-only short exec returned `inlineStdout:{complete:true,output:...,totalBytes:36}`, original jobId, exitCode=0. A second live post-fix short exec likewise returned `complete:true`.
- Long output of **2,880 bytes** returned `inlineStdout:{complete:false,totalBytes:2880,reason:'use_light_remote_output'}`, no embedded stdout. Explicit canonical `light_remote_output` subsequently returned all 2,880 bytes.
- In-flight `sleep 7` exec initially returned `state=running` without inlineStdout, as intended. A subsequent test encountered socket hangup from the Operator bug below, so this specific pending job was NOT accepted as a clean completion test; the associated user-owned Gold plugin session was explicitly closed before redeploy.
- Post-fix intentional command `printf ...; exit 3` returned `state=error,exitCode=3` with no inline stdout injection, and Operator stayed running.
- Opt-in inline uses `AccountOperatorAdapter.output` canonical ownership/device authorization/redaction, does not retry commands, respects ≤1,536B default (hard cap 2,048B). Running/denied/error jobs retain unchanged canonical jobId/behavior.

## Critical discovered Operator crash / root cause

During post-inline fallback testing, Gold MCP returned **`socket hang up`**. Read-only Gold LXD journal showed **`ReferenceError: DeviceChannelRateLimitError is not defined`** in `operator-host/executor.mjs` HTTP catch block, and `light-remote-gold-operator` had restarted once. Earlier Redis transition defined/exported `TrustedChannelRateLimitError` but the old catch handler still used `DeviceChannelRateLimitError` for status and Retry-After metadata. An error response could therefore throw another error and crash the Operator. This is a confirmed **Gold crash**, not just transport jitter and not proof of a Cloudflare problem.

**Fix commit `dc02792e7372c4a388251eef701cf1931da2dc05`**:
- Import and use actual `TrustedChannelRateLimitError` in both HTTP status mapping and 429 Retry-After response mapping.
- Preserve deterministic **503** when `trusted_channel_rate_storage_unavailable` or `trusted_channel_rate_invalid_response` occurs. Never silently disable Redis rate limiting.
- Add Gold CI regression `deploy/scripts/selftest-g3-operator-rate-error-handler.mjs`: undefined old class absent; 429 class/scope/retry contract PASS; Redis outage/invalid response 503 fail-closed PASS; earlier Redis limiter and inline stdout regression PASS.
- Commit pushed to GitHub branch. Immutable SHA candidate staged with package-lock parity; verified backup including code/systemd/local-state/PostgreSQL dump, then cutover **only** Gold Operator/Plugin/Wall. Cutover 10 consecutive Gold health samples PASS, **strict ON preserved**, previous candidate rollback overrides preserved.

**Physical post-fix negative test:** malformed JSON POST directly to Gold Operator UNIX IPC `/v1/device-channel/status` returned HTTP **400**, and Operator PID stayed identical and active. Gold Plugin short inline exec and intentionally nonzero exitCode=3 also returned normally. Gold services 5/5 active, `light-remote-gold-operator NRestarts=0` after cutover; source `dc02792...` verified active, signed channel Fleet 2/2 fresh+ExecutorReady. Inline env is still `LIGHT_REMOTE_GOLD_INLINE_STDOUT_DEFAULT=1`. Gold/production remain separate.

## Physical Duplex command result acceptance from previous G3 round

A real installed Windows #453 `device-duplex-v1` in-flight read-only command underwent **Gold-only Nginx Preview restart** with preflight `inFlight=1` and strict ON. Operator recorded initial Duplex dispatch, **one redelivery** of the **same command ID** (attempts=2), one Duplex-transport result, one completion, and job exitCode=0. Demonstrates physical recovery of late receipt under fault, **not** no redelivery or universal exactly-once side effects.

## Required follow-up

1. Maintain Gold source `dc02792...`, strict ON and inline ON while testing. Do not alter production.
2. Run longer-duration and concurrent multi-agent benchmark with controlled N, CPU/RSS p50/p95, throughput, error rate and retry rate before claiming multi-user SLA. Consider large-output overhead of optional inline fallback; it may add an extra internal read before regular `light_remote_output`.
3. For permanent release, decide whether to keep Gold-specific default via explicit config or expose `inlineStdout` as an explicit connector schema option, with docs and capability gating. The current option is **Gold UAT only**.
4. Consider a regression that exercises the actual HTTP exception handler (rather than only static checks) in CI. The live malformed-JSON negative test provides physical evidence today.
5. Existing four unrelated untracked `deploy/gold-uat/` and UAT scripts remain untouched. G4 not started; G3 performance and durability gate not declared globally done.
