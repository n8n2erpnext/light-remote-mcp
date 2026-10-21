# RDC → Light Remote Gold — G Plan engineering checkpoint / owner handoff
Date: 2026-10-21 (VN). Branch: `feature/light-remote-gold-rebuild-20261018`.
**Gold-only changes; production was inspected read-only, never reconfigured or restarted.**

## Current immutable Gold deployment
- Isolated LXD: `light-remote-gold-uat` on VPS-ARM.
- Running Operator/Plugin/Wall candidate: **`62b0a5528d96fadd29738c552fa77330a7d009d3`**. Includes G4 PostgreSQL effect reconciliation, G5 `expectedSha256` optimistic edit and scoped MCP nonretryable conflict result, G6 bounded source soak CI budget.
- Verified stage+backup: package-lock parity, immutable .git-source-sha, code + systemd + local-state + custom PostgreSQL pg_dump; rollback override retained for earlier candidate.
- Cutover **`G3_GOLD_CANDIDATE_CUTOVER=PASS`**, stable 10/10 health samples, strict Executor admission ON preserved. One transient `G3_GOLD_VALIDATE_EXECUTOR_PROOF_MISSING` during Agent reconnect; stable health gate returned PASS.
- Post-deploy: Gold services **5/5 active** (PG, Redis, Operator, Plugin, Wall), Fleet **2/2 outbound leaves fresh/ExecutorReady**, 0 pending jobs when idle, `LIGHT_REMOTE_GOLD_INLINE_STDOUT_DEFAULT=1`, Gold public HTTPS 200.
- Actual Gold MCP post-cutover session: structured **write → edit → read → delete** in authorized `/tmp` all PASS and fixture deleted; `exec` stdout inline returned `complete:true` with exit 0.
- Actual Gold LXD installed candidate invoked as unprivileged `gold-uat` ran `selftest-g5-native-fs-cas.mjs` PASS: stale SHA blocks overwrite, fresh hash edit passes, temp file cleaned. Installed candidate `selftest-gold-tool-error-origin.mjs` PASS: 403 and 409 are structured, nonretryable. These are **isolated guest native-code tests**, not proof the externally connected Gold MCP schema already advertises `expectedSha256`.

## Milestone disposition

| Milestone | Gold engineering status | Proof and remaining user acceptance |
|---|---|---|
| G0 — pinned RDC comparison | Source/docs complete | `RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md`, gap matrix and G0 baseline |
| G1 — MCP errors and capabilities | Scoped source fixes deployed | Local filesystem denial 403 and edit-conflict 409 no longer opaque MCP exceptions, correct `retryable:false`. Intermittent outer ChatGPT pre-dispatch refusals not proven eliminated; user returns for permission testing |
| G2 — native process/PTY lifecycle | Linux/Win/mac source and hosted CI, partial owner physical | Process tree cleanup, output rings, PTY/drain regressions accepted earlier; full macOS physical / some interruption user testing deferred |
| G3 — readiness, reconnect, signed Duplex | Gold strict+Redis+Duplex source and physical Windows core accepted; extended physical soak deferred | Windows #453 real Duplex reconnect and late receipt, strict ON, Redis rate-limit hardening, Gold nginx stream ingress fix, 5/5/2/2 health; no promise of universal exactly-once external effects |
| G4 — durable operationId + receipt | **Gold code deployed, actual same-job+409 MCP verified** | PG transactional reserve before effect in all 7 job families; duplicate same operationId reuses jobId; stale/conflicting after restart returns 409 `originalJobId` no blind replay. Existing event-id usage accounting source regressions pass; real Team/paid charge UAT deferred |
| G5 — edit CAS + SCP diagnostics | **Gold core deployed; CAS/SCP regressions pass** | Optional `expectedSha256` and stale-409, existing SCP 256KiB SHA-transfer and inline-per-job progress, resume/cancel/source-changed/owner fixtures; external Gold tool schema refresh + owner Wall visual check deferred |
| G6 — performance and bounded soak | **18/18 TCP child scenarios PASS, CI budget added** | Six cycles × three localhost TCP real subprocess fixtures in 124.5s, p95 6.225/6.358/8.228s, sampled peaks 57–64MiB, per-case 27s/192MiB test limits; multi-day real enrolled Agent and multi-user SLA measurements deferred |

## Cross-platform build evidence

For source **`0210cabb4a7dbd9ed839ff97a25dcb83b1894ed4`** (G5/G6 native filesystem/soak changes), GitHub Actions all **completed/success**:
- [Gold G3 Operator Regression #39560340397](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39560340397)
- [Linux Client Packages #39560340376](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39560340376)
- [Windows Tray Client #39560340365](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39560340365)
- [macOS Client Packages #39560340334](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39560340334)

These builds do **not** automatically install on owner Windows/macOS/Linux clients or update production. `62b0a55` only adjusted Gold MCP result presentation; a Gold Operator workflow trigger now includes `plugin-server/tools.mjs`, `tool-error-classification.mjs`, `selftest-gold-tool-error-origin.mjs`, so such patches will run regressions on next branch push.

## Explicit gaps NOT to mislabel as PASS
1. Connected Gold MCP tool interface currently exposes `light_remote_edit_file` **without** the new `expectedSha256` optional arg; update/review/publish connector tool schema with owner action, then run one stale-SHA conflict and one successful SHA edit through the structured Gold MCP tool (not through PTY/another route).
2. Owner-authenticated Gold Wall browser visual inspection of inline SCP rows (no SCP dashboard cards), PTY and multi-tab status cache.
3. Installed-client physical macOS and Linux Desktop (Windows installed #453 prior baseline), real multi-agent long-duration workload with latency, RSS, reconnect/orphan counts.
4. Legitimate OS permission denials inside LXD (sudo `no_new_privileges`, cannot control host LXD) are not reasons to loosen security. Owner explicitly deferred this category; no LXD/sudo bypass test planned.
5. Intermittent outer ChatGPT platform pre-dispatch refusals remain unproven eliminated. Never claim a model-side filter has been patched.
6. UAT Team seat/billing exactly-once charge-event positive real account acceptance is not established by SQL source tests.

## How to continue without drift
Gold branch worktree: `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/light-remote-gold-rebuild-20261018`.
Read this checkpoint, `RDC_HANDOFF_CURRENT.md`, `RDC_GOLD_MASTER_HANDOFF_20261021.md`, and `RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md`. The **running candidate SHA and production boundary** take precedence over old historical paragraphs in the master handoff.

Use official Light Remote paired VPS-ARM `connection_helper({})` and `session_control` on hold; use Gold plugin only with its separately approved device/session. Before touching Gold services: check Fleet strict ON, 2/2 fresh+ready, **0 active/queued/in-flight**. Immutable archive → stage → backup → guarded cutover with 10 health samples and rollback snapshot. Leave production, Cloudflare WAF/proxy, Paddle Live, and other devices alone.

Unrelated pre-existing untracked fixtures **do not stage/remove**:
`deploy/gold-uat/`, `deploy/scripts/check-gold-db.mjs`, `deploy/scripts/uat-gold-account-device.mjs`, `deploy/scripts/uat-gold-http-api.mjs`.

**Engineering core has reached the G6 bounded-source-test stage; this is not a declaration that all physical owner acceptance is DONE.**
