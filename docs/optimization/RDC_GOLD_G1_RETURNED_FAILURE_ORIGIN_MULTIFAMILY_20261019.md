# Gold G1 — Returned failure origin across MCP tool families (2026-10-19)

**Status: VERIFIED SOURCE + GOLD-LXD LIVE; G1 still IN PROGRESS.** Worktree `feature/light-remote-gold-rebuild-20261018`, starting HEAD `2e7d327`. Production and the official production MCP were not modified.

## Goal / reproducible issue
The prior G1 fix made `result()` mark top-level `ok:false` as MCP `isError:true`. But most ordinary tool callbacks wrap Operator/Agent responses in `operationView()`, which previously retained only `ok/data/job`. The thrown-error path exposed `layer/retryable/nextAction` while *returned* job failures did not. An AI client cannot reliably distinguish absent file, unknown process, unknown SCP transfer and device/Fleet policy from the negative result without string-parsing arbitrary nested data.

Before this patch, 7 authorized Gold MCP benign probes: directory listing succeeded; nonexistent allowed file, process, terminal, search, SCP download and SCP upload IDs all produced MCP errors but no top-level origin metadata.

## Narrow implementation
- `plugin-server/tools.mjs::operationView()` now classifies **only explicit returned negative `ok:false`** by the existing allowlisted `classifyPluginToolError()`. Negative response adds top-level `error/layer/retryable/nextAction` and bounded `httpStatus` when available; keeps original `ok/data/job`. A successful operation is not treated as an error just because nested data contains `ok:false`.
- `plugin-server/tool-error-classification.mjs`: add exact error codes only: `invalid_process_id`, `invalid_terminal_id`, `invalid_search_id`, `scp_transfer_not_found`. A path error already had a classifier. No free-form error message, secret, path or tool payload is interpolated into origin metadata.
- `deploy/scripts/selftest-gold-tool-error-origin.mjs`: matrix verifying filesystem, process, terminal, search, SCP, Fleet-negative classification, original job/data preservation, absence of negative metadata on success, and untrusted-text redaction in metadata.
- No grant/capability changes, no private safety filter instrumentation, no new retries, no A/B/OAuth bypass, no PostgreSQL/Redis data or schema changes, and no production changes.

## Live Gold MCP acceptance (real signer, not fake source harness)
After deploying the two runtime modules **inside `light-remote-gold-uat` only** and restarting Gold Plugin, the existing A/B-authorized Gold session was resumed normally. The benign nonexistent-resource probes produced genuine MCP errors with:
- `filesystem_path_not_found`: `layer=filesystem`, `nextAction=verify_path`.
- `invalid_process_id`: `layer=process`, `nextAction=verify_process_id`.
- `invalid_terminal_id`: `layer=terminal`, `nextAction=verify_terminal_id`.
- `invalid_search_id`: `layer=search`, `nextAction=verify_search_id`.
- `scp_transfer_not_found`: `layer=transfer`, `nextAction=verify_transfer_id`.
These are intentionally negative validation fixtures, not end-to-end successful process or SCP transfers. Gold signed `light_remote_exec` with explicit `requiredCapabilities=['filesystem']` returned job `state=ok,exitCode=0` and output `G1_GOLD_POSITIVE_READ_OK`. Gold `connection_helper({})` returned ready.

## Regression and service verification
All 8 focused test scripts PASS:
1. `selftest-gold-tool-error-origin.mjs`
2. `selftest-gold-plugin-tool-contract.mjs` — 80 registered tools
3. `selftest-gold-mcp-error-boundary.mjs`
4. `selftest-gold-leaf-capability-origin.mjs`
5. `selftest-gold-policy-revision-diagnostics.mjs`
6. `selftest-gold-outbound-exec-capability-parity.mjs` — 13 cases
7. `selftest-gold-linux-systemctl-whitespace-boundary.mjs` — 22 cases
8. `selftest-gold-journalctl-unit-capability.mjs` — 40 cases

Source syntax and `git diff --check` PASS. LXD PostgreSQL, Redis, Operator, Plugin, Wall **5/5 active**. Gold HTTPS /account **200**, production HTTPS **200**. The immediate first HTTPS request after Gold Plugin restart temporarily returned 502; subsequent full health check was 200.

## Remaining G1 / important limitations
- The OpenAI/client **pre-dispatch** refusal (no Plugin invocation/job) remains **unexplained and unresolved**. An accepted returned failure with a job is a separate layer. This patch cannot change private provider gates, and must not be sold as a fix for them.
- Error classification was live-tested only for the five benign negative families above plus positive Gold exec, **not all 80 tools or Windows/macOS command paths**. The 80-tool contract assertion is metadata coverage, not runtime E2E.
- Unknown/uncategorized failure remains `layer=unknown`, `retryable=false`; do not guess authorization failure or automatically replay a mutation.
- G1 next: extend **authorized, non-destructive** cross-family/cross-OS observations and compare RDC only with truly online paired equivalent devices. Record client pre-dispatch outcome separately from Plugin/Operator/Agent stage and sanitized status. Address additional *reproduced* mismatches; do not widen permissions.
- G2–G6 not started. G5 SCP progress (bytes/percent/phase/integrity shown on authenticated NetBird Wall) is a separate deliverable.
- Existing unrelated untracked `deploy/gold-uat/` and scripts remain untouched.

Resume from `docs/optimization/RDC_HANDOFF_CURRENT.md` and this checkpoint.
