# Gold PR4 — independent code acceptance, 2026-10-26

## Protected branches
- Pre-PR/Audit good baseline: `backup/gold-good-pre-pr4-20261026` = `371f1ce786fa484b86a77a7272ce16e6591e2a99`. Four critical runtime sources have identical SHA256 to Gold UAT's running source.
- Original rebuild branch `feature/light-remote-gold-rebuild-20261018` = `8c28dffd6aba0db7aff82c3278b5d2d0d8e1680b`. Pre-existing uncommitted worktree files were not touched.
- Working audit branch `audit/gold-pr4-isolated-20261026` branched from PR #4 head `59c884d2c9b379e32feaca5bd01ccffb7d6b28f1`. No merge into PR #4, rebuild, or main. Production unchanged.

## Independent regression results
- 44 focused Gold tests for Memory, Codex, M5/M6, Process/Fleet and Wall executed on isolated VPS-ARM worktree: **44 PASS, 0 FAIL**.
- Two initial failures proved to be test mismatches rather than runtime bugs. Wall cache helper requires a positional repository-root parameter; rerun with `"$PWD"` PASS.
- Legacy Codex API test expected a visible API-key input on `/` and active Platform API endpoints, contrary to the accepted ChatGPT Plus-first design. Updated that TEST ONLY: /codex-cli and /long-memory routes, no key input, legacy API routes return 410, existing encryption fixture and owner CSRF retained. Test PASS. No production/Gold feature code changed.
- Evidence: `/tmp/gold-pr4-isolated-final-44.log` on VPS-ARM. Syntax and Git diff checks PASS.

## Distinct physical cutover gate
- Four actual Gold UAT services still ACTIVE on unmodified good runtime source `371f1ce`.
- UAT DB migration ledger 37, 1 historical Windows Gold orphan resource claim, 10 protected pre-dispatch UNKNOWN tombstones, no owner-recovery audit.
- Exact PR HEAD staging plus checksum-verified rollback backup exist; preflight of previously staged `d3e5fdd` shows parity/schema 37 PASS but fails closed with `M6_PG_WORK_BUSY:1`. Independent Fleet read had one active session.
- Earlier owner-release typed confirmation was refused by tool safety. Do not bypass using SQL/other input channels, fabricate a terminal ACK, close unrelated Fleet sessions, or restart running services.
- **Verdict: isolated CODE ACCEPTANCE PASS, physical CUTOVER/PR MERGE NOT ACCEPTED.** Before merge, independently authorized owner recovery, Fleet idle, fresh preflight and actual service acceptance are mandatory. No change to the good baseline.

## Addendum — real PostgreSQL 17 integration acceptance (isolated, 2026-10-26)
- Isolated branch now contains opt-in `deploy/scripts/integration-gold-m6-postgres-scratch.mjs` plus runner `deploy/scripts/run-gold-m6-postgres-scratch.sh`. This was intentionally named **integration-** (not `selftest-`) so the default portable suite does not accidentally connect to a DB or require PostgreSQL on every OS.
- The runner is fail-closed on hostname `light-remote-gold-uat`, root container privileges, PG17 tools, temporary private socket `/tmp/gold-pr4-pg-*`, separate scratch DB `gold_pr4_scratch_acceptance`, and always cleans up its disposable cluster. It never opens the real `light_remote_gold_dev` database.
- Full source commit `ee64344e4a1c749d72eb275d44d6724e72f4f806` staged independently with verified SHA-256 manifest in `/opt/light-remote-gold-uat-candidates/ee64344e4a1c749d72eb275d44d6724e72f4f806` without activating any service.
- Real PostgreSQL 17 integration: **PASS** for historical revoked-device owner-scoped lookup; wrong-owner denial; online-channel/boot-time guards; atomic rollback when audit insertion fails; valid owner-attested fixture outcome `unknown` with no fabricated terminal ACK; signed terminal receipt atomic release and idempotent replay. Fixture data is synthetic and not any actual user job.
- Result markers: `AUDIT_CANDIDATE_FULL_SHA256_PASS=PASS`, `GOLD_M6_REAL_POSTGRES_SCRATCH_PASS`, `GOLD_PR4_SCRATCH_INTEGRATION_PASS_ISOLATED_CLUSTER=PASS`, `POSTGRES_TEMP_CLUSTER_CLEANED=PASS`.
- Together with **44/44 earlier targeted source regressions**, isolated code audit is completed. These tests do **not** resolve the real Windows orphan claim, active Fleet session, owner-authenticated release requirements, or physical four-service UAT cutover. No merge, no production change. Leave Gold baseline `371f1ce` untouched.
