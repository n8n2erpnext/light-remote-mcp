# Gold G3 — UAT source-parity cutover and strict-readiness gate

Date 2026-10-20 | branch `feature/light-remote-gold-rebuild-20261018`
**Deployed immutable source:** `a74ec1b2203da16ed2469f137684246e35a76ff5` (Gold-only). **G3 stays IN PROGRESS.**

## Actual cutover result
Successfully switched the isolated `light-remote-gold-uat` LXD Operator, Plugin and Wall to the versioned candidate root
`/opt/light-remote-gold-uat-candidates/a74ec1b2203da16ed2469f137684246e35a76ff5`, with systemd override files `90-g3-candidate.conf`.
No prod unit, main or other LXD workload updated.

The rollout script performed a preflight on installed Gold Operator Unix IPC and recorded **no active sessions, queued or in-flight commands**. Script then started units in dependency order and validated **10 consecutive one-second health samples**. Reported
`G3_GOLD_CANDIDATE_CUTOVER=PASS`, `G3_GOLD_STABLE_HEALTH_10_SAMPLES=PASS` and `G3_GOLD_STRICT_ADMISSION=OFF_FOR_LEGACY_COMPATIBILITY`.
Separate post-cutover checks: PostgreSQL, Redis, Operator, Plugin, Wall **5/5 active**; Operator Unix socket HTTP **200**; public Gold Account portal HTTP **200**; unauthenticated account-me HTTP **401**.

## Source parity now proved, not inferred
Previous audit erroneously hashed the legacy fixed installation path even when systemd ran a different entrypoint. Updated `deploy/scripts/uat-gold-g3-readiness-audit.mjs` to resolve actual running Gold Operator MainPID and validate allowlisted entrypoint from `/proc/<pid>/cmdline`, then hash the FleetRouter of *that runtime*. No ID or credential displayed.
Executed inside Gold LXD with source hash obtained from worktree after cutover:
- `sourceParity=true`
- `outboundLeaves=2`, `freshOutboundChannels=2`
- `explicitExecutorSignals=1`, `unknownOnFreshChannels=1`
- `optimisticAdmissionWithoutExecutorProof=1`
- `gate=BLOCKED_EXECUTOR_EVIDENCE`

This is progress: **Operator version mismatch resolved**, but the remaining old Agent lacks explicit independent Executor signal. Strict mode intentionally remains OFF; do not promote to G4 or claim all connected Agents support G3.

## Full failure investigation / rollback evidence
Before the successful cutover we exercised the rollback script in genuine Gold LXD through successive errors:
1. Candidate parent directory inaccessible to unprivileged `gold-uat` service -> systemd `status=200/CHDIR`; old units restored, 5/5.
2. Candidate dependency resolution missing `plugin-server/node_modules/express` and incorrectly changed Gold data root caused `gold_pg_outside_gold_root`; rollback restored 5/5.
3. Wall `PartOf=...` startup ordering / health probe too early. Later candidate Operator and Plugin had started properly, but Wall naturally exited with systemd `Deactivated successfully` rather than crashing. Root cause was **missing CLI `daemon` argument** in generated candidate Gold Wall `ExecStart`: Node emitted default `status` JSON and exited code zero. We mistakenly called this a lifecycle defect until inspecting the generated systemd invocation and source CLI default.
4. Fixed script to emit `ExecStart=/usr/bin/node <candidate>/device-agent/operator-agent.mjs daemon` *only* for Wall; exact argv now validated. Required ten stable health observations before reporting PASS.
All unsuccessful cutovers returned to the old unit paths with 5/5 services active and IPC HTTP 200. No schema migration was run.

## Rollout and rollback assets
- `deploy/scripts/gold-g3-stage-candidate.sh`: extract immutable SHA-pinned source into private UAT candidate root, check dependency lock, link existing runtime dependencies and secrets, no service restart. Run inside Gold LXD only.
- `deploy/scripts/gold-g3-uat-backup.sh`: creates a **private LXD-only** protected backup of complete code, systemd config, local state and `light_remote_gold_dev` PostgreSQL custom-format dump, checks archive listings and SHA256. Backup stored under `/var/backups/light-remote-gold-uat/pre-g3-a74ec1b2203da16ed2469f137684246e35a76ff5`; treat as secret material, never share.
- `deploy/scripts/gold-g3-uat-cutover.sh`: explicit `G3_GOLD_CUTOVER=1`, requires matching prepared candidate and verified backup, checks zero in-flight/queued/active sessions, source deps, Gold Wall real argv, ordered systemd startup, IPC strict=false and 10 consecutive samples; automatic rollback if acceptance fails.
- `deploy/scripts/gold-g3-uat-rollback.sh`: explicit `G3_GOLD_ROLLBACK=1`, remove only Gold `90-g3-candidate.conf` overrides, original units, check IPC. **Rollback does not restore database**, because deployment executes no database schema migration; the independent DB dump remains available for deliberate recovery.
- CI Gold Operator contract lints shell scripts and asserts the Wall `daemon` argv regression plus stable health markers; never executes cutover in CI.

All source changes are in the separate Gold branch. **Preexisting untracked** Gold UAT helper files and production have not been altered.

## Next acceptance gate
The remaining old Agent (one of two outbound leaves) reports channel freshness but no explicit `executorReady`. Do not flip `OPERATOR_REQUIRE_EXECUTOR_READY=1` until all required UAT Agents are upgraded / gracefully drained and validated. Follow-up must use normal authorized signed enrollment (no safety bypass), verify dispatch/late result/reconnect under real Gold Operator, sample sustained RSS/latency, then enable strict admission on **Gold UAT only** and prove unknown heartbeat is denied. Mac/Linux Desktop distribution CI is separate from deploying an owner device.

**Current state:** Gold service source parity PASS; rollout PASS; Executor readiness gate **BLOCKED_EXECUTOR_EVIDENCE**; G3 **not accepted**, G4 not started.


## Post-commit verification (2026-10-20)
- Follow-up Gold branch tooling commit `2ca5ccd3f0c65e9b31ebc367bbfdb62ae1c73114` (deployment source remains pinned at `a74ec1b`, **not** silently reinstalled). [Gold Operator Regression #12](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39446677559): **6/6 SUCCESS** — Operator source contract, synthetic Agent enrollment, real daemon lifecycle, bounded soak, Linux server bundles x64 and ARM64. The Operator job log has `G3_GOLD_UAT_CUTOVER_DAEMON_AND_ROLLBACK_CONTRACT=PASS`, `G3_STRICT_GOLD_UNKNOWN_EXECUTOR_DENIES_DISPATCH=PASS` and `gold-g3-operator-contract=PASS`.
- Live Gold UAT post-cutover rechecked after elapsed runtime: **5/5 active**, actual Operator SHA parity TRUE, 2/2 outbound channels fresh. To classify the blocker, inspected Fleet and compared only to the local Wall's own enrolled ID inside the container (no IDs printed): **Gold Local Wall `executorReady=true`**, other pre-existing enrolled outbound leaf **`executorReady=null`**; no in-flight/queued work on either at check. This is not an Operator bug or a reason to enable strict mode. A legacy Agent upgrade/drain is required before strict admission.
- Do not confuse CI source commit `2ca5ccd` with installed version `a74ec1b`. Tooling scripts affect future deployments; they do not upgrade the currently running modules. Full signed current-version remote Agent E2E and sustained memory observations remain open.
