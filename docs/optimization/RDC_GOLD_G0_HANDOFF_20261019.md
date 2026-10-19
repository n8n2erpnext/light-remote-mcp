# RDC → Gold reliability optimization — G0 checkpoint/handoff (2026-10-19)
**Milestone G0: completed as documentation and read-only baseline. G1–G6: NOT implemented.**
**Branch:** `feature/light-remote-gold-rebuild-20261018` — EXISTING branch, not a new worktree.
**Git baseline before this docs-only checkpoint:** `4daccb821adbac38be4b6e954ab5f10d266ccdbe`.

## What the next session must read IN ORDER
1. `docs/optimization/RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md` — owner-approved gates, constraints, and precise G5 SCP progress contract.
2. `docs/optimization/RDC_FEATURE_GAP_MATRIX.md` — 13 previously researched topics + current Gold capability/SCP gaps, each classified preserve/verify/fix-on-repro/reject.
3. `docs/optimization/RDC_GOLD_EXECUTION_RCA_MAP.md` — exact RDC vs Light Remote command/authorization/dispatch path, G1 error-origin map and G5 SCP Wall data flow.
4. `docs/optimization/RDC_GOLD_G0_BASELINE_20261019.md` — actual read-only Gold health, HTTP timing/RSS measurements and limitations.
4. `docs/releases/LIGHT_REMOTE_TOOL_SAFETY_MULTILAYER_AUDIT_20261019.md` — real official plugin direct-tool sweep and three distinct unresolved error classes.
5. `docs/releases/GOLD_LEGACY_STORAGE_PRO_TEAM_HTTP_PG17_UAT_20261019.md` and `docs/releases/GOLD_AB_AGENT_CLIENT_PG_FIX_20261019.md` — durable Gold storage and Pro Team context; keep it intact.
6. Prior independent notes: `/home/ubuntu/handoffs/LIGHT_REMOTE_POST_RC50_DESKTOP_COMMANDER_DEEP_DIVE_2026-10-12.md` and `/home/ubuntu/handoffs/LIGHT_REMOTE_DESKTOP_COMMANDER_SOURCE_BENCHMARK_2026-10-12.md`.

## Current source pins and repository links
- Desktop Commander MCP, source HEAD as checked 2026-10-19: `f508e524469c26f6366e17dbfd3ee5a69d112127` (commit date Oct 14). https://github.com/wonderwhy-er/DesktopCommanderMCP/tree/f508e524469c26f6366e17dbfd3ee5a69d112127
- Light Remote Gold source was read directly from connected GitHub using `n8n2erpnext/light-remote-mcp`, `feature/light-remote-gold-rebuild-20261018`, HEAD baseline `4daccb8`.
- The owner requested study of RDC operational stability and OpenAI pre-dispatch outcomes; **do NOT claim RDC's fewer refusals are proven by source code**. No model/platform private internals accessible. Compare equivalent, safe, authorized workloads, and track where refusals occur. No evasion by alternate tools/PTy.
- Owner correction: Light Remote already bounds process and PTY output (4 MiB default, 16 MiB max) — PRESERVE. No unmotivated new buffer and no inherited RDC 50 MiB.
- Owner amendment: G5 includes live SCP upload/download **percent/progress on NetBird Wall**. Native SCP has `progressBytes/totalBytes`; build only authorized transfer status transport/rendering after verifying missing paths. Never show 100%-as-success prior to checksum commit.

## G0 evidence collected TODAY
- Verified baseline clean tracked branch; preserved these previously untracked files: `deploy/gold-uat/`, `deploy/scripts/check-gold-db.mjs`, `deploy/scripts/uat-gold-account-device.mjs`, `deploy/scripts/uat-gold-http-api.mjs`.
- VPS-ARM measured sequential **6** Gold HTTPS `/account` responses: **6 × HTTP 200**, 41.652–59.497 ms total (VPS-local, sample only; no valid p95 claim).
- At idle snapshot Gold Plugin RSS 111844 KiB, Operator 86476 KiB, Wall 85380 KiB; no load comparison or peak memory claimed.
- Gold LXD `light-remote-gold-uat`: PostgreSQL, Redis, Operator, Plugin and Wall active. NetBird Wall `http://100.94.184.141:5591/` 303 to login; public production HTTPS 200; no service mutations.
- Existing Gold Plugin `plugin-server/tools.mjs`: 66 source `add(server,'light_remote_*` registrations (not a claim about live discovery).
- Source comparisons confirmed existing ByteRing/truncation, expectedReplacements, SCP status counters and Wall event stream; G0 introduced NO runtime/client/proxy code changes.

## OPEN findings carried into G1/G5
1. **G1 upstream/provider pre-dispatch**: specific read-only `find/grep` command once got a platform gate denial with **no device job**. Requires accurately documenting boundary and reporting legitimate false positive; Light Remote server cannot override upstream provider safety.
2. **G1 official explicit Docker capability**: read-only exec with `requiredCapabilities=['docker']` returned `target_node_capability_missing`; ordinary Docker inspect succeeded. Gold device inventory enrichment from prior `4daccb8` is already fixed; admissions remains open.
3. **G5 real SCP**: source regressions for missing per-chunk SHA pass after `4daccb8`, but full Gold upload/commit was blocked by `operator_public_key_unavailable`. Must fix genuine key path before claiming E2E and implementing UI.
4. **G3/G4**: RCA for stale readiness and cross-restart idempotency must distinguish device transport, Operator job and effect confirmation. No speculative retry of non-idempotent commands.
5. **G6**: N=6 HTTP timing and one RSS sample are NOT a statistically valid benchmark.

## Next authorized action
Show owner concise G0 matrix and await review of G1 priority. Then record an explicit G1 start checkpoint; run equivalent benign, single-layer test cases on official Light Remote, Gold and RDC only when connected and authorized. Find cause through source and targeted traces **before** patch. If a policy/test invocation is denied, mark BLOCKED and do not try via another channel.

## Deployment and rollback
- G0: docs-only. Rollback by reverting the documentation checkpoint on the Gold branch; **no runtime service rollback needed**.
- Future patch rollbacks must name exact affected Gold LXD file/services and keep production `light-remote-direct` untouched.
- Store handoff and baseline under Git `docs/optimization/`. No passwords, A/B codes, access keys, internal private sessions or customer data in docs.

## Completion verification for G0
- [x] Read two prior handoffs
- [x] Verified RDC current commit via connected GitHub
- [x] Read comparable RDC and Gold sources via connected GitHub
- [x] Recorded 13-topic + SCP Gap Matrix
- [x] Wrote master plan and G5 transfer-progress acceptance
- [x] Collected read-only Gold runtime baseline
- [x] No code patch or production deployment in G0
- [ ] G1 not yet begun; present matrix to owner before starting
