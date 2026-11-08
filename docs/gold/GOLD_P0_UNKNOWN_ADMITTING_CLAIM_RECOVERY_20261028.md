# Gold P0 — unknown admitting claim continuity (2026-10-28)

## Verified baseline
- Isolated Gold fix branch at 80a8e7d; PostgreSQL schema 038 on Gold UAT.
- Read-only resource census: Win11 project:unknown running with signed terminal absent; HOMELAB project:c:/users/admin/downloads running with signed terminal absent; Win11 project:c:/users/vkphu/appdata/local/temp admitting with NULL process_id, job 5100f840-0670-49f3-b4c2-8df636d116f6 already unknown/operator_restart_reconcile.
- All resource locks remain held. Work queue had zero queued/running and Gold process-supervisor had zero direct children at preflight.

## Source patch — strictly observational fencing
- On Operator boot, `GoldPersonalAgentScheduler.recoverStartup()` performs one PostgreSQL statement: lost queued/running personal jobs become unknown, and all `admitting` claims with no process ID tied either to those jobs or a previously unknown/operator_restart_reconcile job become `terminal_unknown`.
- This changes a claim's diagnostic *state* only. It does NOT delete/release a claim, write terminal receipt, stop a process, or cause automatic replay. All lock conflict checks still count terminal_unknown as held.
- M3 no-M4/schema32 fallback retains its original SQL; PostgreSQL failure propagates and cannot report a successful recovery.
- Tests: added selftest-gold-m3-recovery-unknown-claim.mjs; P0 durable ACK, Job Control, M6 owner recovery targeted PASS; PostgreSQL 38 read-only EXPLAIN parses the production CTE without executing it.

## Safe follow-ups
- Stage same-SHA Gold UAT candidate only after branch commit and validated snapshot/rollback; verify 4 systemd units and read back *held* claim states. Check no active personal jobs or supervised children before restart.
- Do not use owner orphan recovery on current Win11 claim: last verified boot predated claimed_at. Existing CLI requires exactly one claim but current DB has three; future owner-specific CLI selection must remain explicitly scoped, password and post-claim boot verified, and authorized through Operator, never direct SQL.
- Pro Team live separate A/B Agent overlap, Wall Cancel/Kill graphical confirmation and genuine signed old background terminal receipts remain open. Production/Windows installation are out of scope.

## First UAT cutover, observed failure and corrective fix

- Candidate 047bd1d was staged, four units restarted healthy, but legacy claim remained admitting, so the guarded cutover automatically rolled back to 80a8e7d. Snapshot and old systemd overrides preserved.
- RCA: SQL `FROM lost` made an empty new-recovery CTE suppress ALL existing historical `unknown` claim matches. The fix removes that join and uses `IN (SELECT job_id FROM lost) OR EXISTS (...)` as independent qualifying paths. Regression now forbids the empty-CTE join. No claim was deleted.
