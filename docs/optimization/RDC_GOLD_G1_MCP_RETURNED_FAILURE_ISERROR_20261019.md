# Light Remote Gold G1 — returned operation errors carry MCP isError (2026-10-19)

## Scope and root cause
- Branch: `feature/light-remote-gold-rebuild-20261018`; starting HEAD `ba92f2c`.
- The earlier G1 all-tool RCA reproduced an authorized nonexistent-path `light_remote_stat_path` with top-level `ok:false` and a failed job, but **without** MCP `isError:true`.
- Root cause in `plugin-server/tools.mjs`: ordinary `result()` always emitted only `content` and `structuredContent`; it did not propagate the operation's explicit negative status. Thrown exceptions already used `pluginToolErrorResult()` and `isError:true`.
- Fix: add `isError:true` **only when the sanitized top-level structured result explicitly has `ok === false`**. Preserve existing text and structured payload byte semantics. Successful or status-free output does not add `isError`.
- The same formatter is used for the normal 80 tool registrations and legacy multiplexed compatibility result returns. No schema/scope/device capability/policy/authorization change.

## Evidence
1. Before deployment: Gold MCP `light_remote_stat_path` on `/tmp/gold-mcp-negative-fixture-intentionally-nonexistent-20261019` returned `ok:false`, error `filesystem_path_not_found`, failed job, with result keys only `structuredContent` and `content` (no `isError`).
2. Source edits through official owner-authorized Light Remote `light_remote_edit_file` were accepted; the same normal mechanism was used for both changed source and regression. No tool refusal or bypass occurred in this slice.
3. `deploy/scripts/selftest-gold-plugin-tool-contract.mjs` now asserts negative top-level `ok:false` yields `isError:true`, retaining text + structured data; successful, nested-negative and nonstatus values are not marked errors. Test: `G1_GOLD_MCP_TOOL_METADATA_CONTRACT=PASS registered=80`; syntax and `git diff --check` PASS.
4. Other focused tests PASS: `selftest-gold-mcp-error-boundary.mjs`, `selftest-plugin-account-scope.mjs`, and `selftest-v09-oauth-mcp.mjs`.
5. Deployed **only** `plugin-server/tools.mjs` into `light-remote-gold-uat` at `/opt/light-remote-gold-uat/plugin-server/tools.mjs`, preserved Gold file ownership `gold-uat:gold-uat`, restarted **only** `light-remote-gold-plugin`. The first immediate Gold HTTPS check after restart temporarily showed 502; next check: public Gold Account HTTP 200, Plugin active, production HTTPS 200.
6. After deployment: identical Gold MCP missing-path call now surfaced through the connector as a tool error (`mcp_error_propagated`) with the expected `filesystem_path_not_found` negative payload. Gold `light_remote_connection_helper({})` returned `ready` as positive MCP path.
7. Two unrelated broad source tests were **not** counted PASS: `selftest-plugin-adapter-integration.mjs` cannot boot Gold persistence in the host worktree without `LIGHT_REMOTE_GOLD_INDEPENDENT=1`; `selftest-plugin-legacy-dcr.mjs` failed an assertion about legacy OAuth client acceptance. Neither path was edited here. Investigate separately in its proper runtime; do not imply a full-suite green result.

## Boundaries and next step
- This fixes a proven **Plugin MCP result-semantics bug**, not the third-party OpenAI client **pre-dispatch** refusal. No private classifier reasoning is visible and no bypass was attempted.
- Existing Gold PostgreSQL/Redis business authority, A/B pairing, signed envelope, OAuth scopes, and local final deny remain intact. Production `light-remote-direct` remains unchanged.
- Existing untracked `deploy/gold-uat/` and UAT scripts were untouched.
- G1 remains open for error-status sampling across other tool families, scoped diagnostics, platform refusal evidence, and cross-OS acceptance. G2–G6 remain not started; G5 must later add authenticated SCP percent/phase/progress to the Wall.
