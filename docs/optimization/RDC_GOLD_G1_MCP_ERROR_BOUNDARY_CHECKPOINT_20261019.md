# G1 Gold MCP error-boundary reliability checkpoint — 2026-10-19

## Status
**G0 DONE; G1 IN PROGRESS (this error-contract slice PASS); G2–G6 NOT STARTED.**
Branch: `feature/light-remote-gold-rebuild-20261018`. Starting pushed HEAD: `e844f6c`. Official Light Remote controlled authorized VPS-ARM for Gold development; all runtime changes confined to isolated Gold LXD `light-remote-gold-uat`.

## Source RCA
Existing error mapping in `plugin-server/tool-error-classification.mjs` and wrappers in `plugin-server/tools.mjs` return `structuredContent` describing `layer/retryable/nextAction` for execution errors. However:
1. Missing OAuth scopes and unauthenticated MCP calls were returned from `plugin-server/oauth.mjs::authErrorResult()` with only content and a standards-compliant `mcp/www_authenticate` challenge, **without** the structured fields. Assistants/clients therefore could misdiagnose a missing scope as a device capability/safety problem.
2. Legacy multiplexed MCP validation failure in `plugin-server/tools.mjs::callLegacyMultiplexedTool()` returned text and `isError`, no machine-readable origin; this is a **Plugin schema validation** error, not an Operator/Fleet/Agent denial.

This is a compatibility/error attribution improvement, **not** evidence about or a workaround for OpenAI pre-dispatch safety decisions.

## Small Gold-only source patch
- `plugin-server/oauth.mjs`: preserve original text, `isError`, OAuth challenge and `mcp/www_authenticate` metadata; add bounded `structuredContent`:
  - `invalid_token` → `layer=oauth_authorization`, `retryable=false`, `nextAction=authorize_plugin`.
  - `insufficient_scope` → `layer=oauth_authorization`, `retryable=false`, `nextAction=request_required_scope`.
- `plugin-server/tools.mjs`: preserve original legacy invalid-arguments text; add `error=invalid_tool_arguments`, `layer=plugin_validation`, `retryable=false`, `nextAction=correct_tool_input`.
- `deploy/scripts/selftest-gold-mcp-error-boundary.mjs`: fixture-only real helper calls, no account login or remote device dispatch. Verifies missing/insufficient scope, unchanged OAuth challenge header, all structured metadata, legacy malformed arguments, and no alteration to allowed read scope.

## Exact test evidence
- **RED**: before patch, `node deploy/scripts/selftest-gold-mcp-error-boundary.mjs` exit 1 at missing `structuredContent` for `insufficient_scope`.
- **GREEN**: same test prints `G1_MCP_OAUTH_AND_VALIDATION_ERROR_CONTRACT=PASS`.
- `node deploy/scripts/selftest-gold-tool-error-origin.mjs` → PASS.
- `node deploy/scripts/selftest-gold-plugin-tool-contract.mjs` → `G1_GOLD_MCP_TOOL_METADATA_CONTRACT=PASS registered=80`.
- Node syntax check of changed modules and `git diff --check` → PASS.
- Gold deployment: pushed only `plugin-server/oauth.mjs` and `plugin-server/tools.mjs` into Gold LXD, kept `gold-uat` ownership, checked syntax, restarted **only Gold Plugin**. PostgreSQL, Redis, Operator, Plugin, Wall **5/5 active**. Gold `/account` HTTP 200, Gold OAuth metadata HTTP 200, NetBird Wall 303 (login), production HTTP 200 untouched.
- The fixture tests were not presented as signed Gold MCP end-to-end execution. The Gold remote-command envelope blocker remains.

## Critical open blockers — no status inflation
- An intentionally RED source-only test in Git commit `a54c348` exposed a **systemctl newline capability under-classification** in the existing Linux Agent. The attempted direct patch was refused by OpenAI before dispatch; red test had to be reverted by `e844f6c` because `npm test` auto-discovers every `selftest-*.mjs`. Current runtime source is still vulnerable to that inference corner case. This patch did NOT touch that regex or retry the denied operation through shell/PTY/GitHub.
- Gold `operator_public_key_unavailable`: a separately diagnosed X25519 envelope-key configuration blocker; prior attempts to provision were denied. No key/config modification in this checkpoint. **Gold signed MCP tool execution remains BLOCKED** and G1 cannot close on source-only smoke.
- OpenAI pre-dispatch tool refusals do not enter the Plugin; cannot be classified, retried or overridden here. No claims about bypassing or reducing them.

## Next legitimate G1 work
1. Preserve this error-contract patch and test against real Gold MCP OAuth/scope errors when a properly authorized test flow is available; do not send credentials into logs.
2. Resolve prior security regression and Gold envelope-key configuration only through a genuinely authorized, permitted maintenance process; perform real Gold signed MCP execution before marking G1 PASS.
3. Compare genuine platform / Plugin / Operator / Fleet / Agent / Linux error rates on equivalent harmless workloads after the E2E prerequisite is met. Keep G2-G6 untouched.
4. G5 later: render genuine SCP upload/download progress on authenticated NetBird Wall from existing bytes/chunk counters; no transfer engine rewrite.

Rollback of this slice: restore Gold `plugin-server/oauth.mjs` and `plugin-server/tools.mjs` from commit `e844f6c`; restart only Gold Plugin. No schema, key rotation, production or user data changes.
