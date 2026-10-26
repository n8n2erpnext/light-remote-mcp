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
