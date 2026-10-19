# RDC → Gold G1: Capability Provenance Checkpoint — 2026-10-19

## Status and branch
**G1 PARTIALLY IMPROVED; Gold end-to-end MCP execution still BLOCKED** by the previously recorded Operator envelope-key configuration, and a provider pre-dispatch refusal previously occurred. G2 not started.
Branch: `feature/light-remote-gold-rebuild-20261018`; preceding checkpoint `34adb0d18801784ad3e878ff6dd3226654481e24`.
Development via the **official** Light Remote connector on authorized VPS-ARM; deployment only inside isolated LXD `light-remote-gold-uat`.

## What the actual source audit determined
- Operator `startJob()` checks a required capability against `targetRoute(...).capabilities` **before job_started** and records `job_admission_denied`.
- `targetRoute` builds allowed Fleet capabilities as the intersection of **live Agent-advertised capabilities** (`FleetRouter.touch`) and **current enrollment-approved** capabilities; it never grants authority solely from `inspect_device` or a UI.
- The single old error `target_node_capability_missing` covered at least two distinct legitimate reasons: the approval does not include that capability, or the Agent has not advertised that capability on its currently authenticated channel. They must remain **fail-closed** but deserve different sanitized diagnostics.
- A truly missing Docker capability on the Gold demo Agent (not enrolled/advertised there) is an expected denial, not evidence of the previously reported production Docker false-positive. The prior production mismatch remains unverified with the latest builds.

## Source patch (no privilege change)
1. New `operator-host/leaf-capability-admission.mjs` computes the same capability intersection plus bounded missing-capability provenance:
   - `agent_not_advertising` when enrollment permits a capability but Fleet's authenticated Agent did not report it.
   - `enrollment_not_approved` when it was not approved, regardless of Agent advertisement.
2. `operator-host/executor.mjs`: reuses the helper for the existing effective Fleet capability list and on denied remote jobs enriches the **existing sanitized job_admission_denied activity event** with `missingCapabilityReasons`, without changing the existing HTTP 409 code, session, A/B, device policy or hard deny. This helps diagnose source of truth instead of increasing privileges.
3. `plugin-server/operator-adapter.mjs`: exposes only the two approved enum reasons corresponding to sanitized `missingCapabilities` in already authorized `light_remote_recent_activity`; does not expose private policy or unrelated devices.
4. New `deploy/scripts/selftest-gold-leaf-capability-origin.mjs` validates actual in-memory FleetRouter route and all approved/advertised combinations, deny reason, duplicate/malformed capabilities, offline state. No network, customer accounts or mutation outside fixture.

## MCP registry metadata audit — checkpoint extension

A new fixture `deploy/scripts/selftest-gold-plugin-tool-contract.mjs` instantiates the actual `registerPluginTools()` against a no-op MCP registry to inspect **all 80 registered Gold tools** (including tools emitted dynamically from action arrays). No OAuth exchange, device/session access or remote command occurs. It checks:
- Unique tool names, nonempty titles/descriptions, recognized OAuth scopes.
- Presence and boolean type of all four MCP annotations.
- No contradictory `readOnlyHint && destructiveHint`, no `readOnlyHint` paired with execute/write scopes.
- Exact read/write/execute/terminal scopes and read-only/destructive annotations for 12 representative command, process, file, device and SCP tools.
Result: **G1_GOLD_MCP_TOOL_METADATA_CONTRACT=PASS registered=80**. This is *not* evidence that an OpenAI pre-dispatch refusal is solved. No annotation or tool name was changed to disguise intent. The G0 source count of 66 static `add(...)` sites was never a count of all dynamically registered tools.

## Tests and actual rollout evidence
- `node --check` of all changed source: PASS.
- `node deploy/scripts/selftest-gold-leaf-capability-origin.mjs`: `G1_GOLD_CAPABILITY_PROVENANCE_FAIL_CLOSED=PASS`.
- `node deploy/scripts/selftest-gold-tool-error-origin.mjs`: PASS (previous G1 classifier).
- `node deploy/scripts/selftest-v09-device-policy.mjs`: owner toggle, grantable boundary, signed envelope, persistence and migration all PASS.
- Deployed changed Operator and Plugin module files to **Gold LXD only**, restarted **Gold Operator + Plugin**. Gold services PostgreSQL, Redis, Operator, Plugin and Wall all active.
- Immediately after restart public Gold briefly answered HTTP 502 (startup window), then read-only probe: **Gold /account HTTP 200, Gold OAuth discovery HTTP 200, NetBird Wall HTTP 303**, no Operator/Plugin errors from 2-minute journal probe.
- Production unchanged and remained HTTP 200 after earlier Gold deployment (no release or production service changes).
- No Gold end-to-end shell job or MCP admission was claimed: `operator_public_key_unavailable` remains a blocking prerequisite from previous checkpoint. The prior attempt to write Gold key-path configuration was denied by the platform. **Do not retry through a different tool, shell, or PTY to evade that refusal.**

## What to do next
1. Use the legitimate owner/operator maintenance workflow (not alternate tool to bypass denial) to make Gold Operator's existing envelope-key configuration valid; preserve private material in Gold-only storage, never in ChatGPT/Git. If unavailable, leave E2E blocked and don't claim recovery.
2. With normal authorization, compare explicitly declared vs inferred capability across the same authorized command in Gold, inspect activity `missingCapabilityReasons` for genuine Fleet denials, and check correct distinction from `platform_pre_dispatch`.
3. Continue G1 tool metadata/schema audit and benign RDC vs Light Remote comparison with equivalent transport and authorization conditions. Keep source evidence and labeled sample sizes.
4. Preserve `deploy/gold-uat/`, `deploy/scripts/check-gold-db.mjs`, `deploy/scripts/uat-gold-account-device.mjs`, `deploy/scripts/uat-gold-http-api.mjs` as previously untracked, untouched fixtures.
5. Future G5 requirement stays: authorized real SCP progress on NetBird Wall based on `progressBytes/totalBytes`, with checksum-verified commit phase; not part of G1.

## Rollback
Only Gold files changed in this deployment: `operator-host/leaf-capability-admission.mjs`, `operator-host/executor.mjs`, `plugin-server/operator-adapter.mjs`. Restore these three from the prior checked-out Gold branch commit and restart only Gold Operator+Plugin; no schema migration, secrets or production changes.
