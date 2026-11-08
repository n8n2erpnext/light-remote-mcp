# Gold P0 checkpoint — uniform runtime, PG38 concurrency, M6 orphan selection

## Runtime actually verified
- Production untouched. Isolated LXD Gold UAT `light-remote-gold-uat` runs all four services from `c0c6977eb9c940c7af67f1d9887bf3f02de7d78b`: Operator / Plugin / Wall / Process Supervisor each active, exact ExecStart and nonzero MainPID.
- Staged 3 changes from 813d6a5 after plugin-only c0c6977 Wall Kill hotfix. No personal `queued/running` jobs and no direct Supervisor children before restart.
- Gold LXD snapshot `p0-before-uniform-c0c6977-20261028` and rollback manifest `/home/ubuntu/handoffs/GOLD_P0_4SERVICE_C0C6977_CUTOVER_20261028.txt` kept.
- After cutover: PostgreSQL 038 3 resource claims fully retained (`running:2`, `terminal_unknown:1`).

## Real PG38 synthetic regression
- Ran 4 independent fixture test modules against the actual Gold UAT PostgreSQL app-role DB/Redis, with randomized scoped fixture owner/device IDs, no OS jobs, no real customer accounts:
  1. `selftest-gold-m3-pro-3plus1-device.mjs`: one device foreground slot; queued FIFO; no overlap.
  2. `selftest-gold-m3-device-team-isolation-pg.mjs`: three distinct devices; shared Team device slot across accounts; HOL isolation; queue 16, account cap 48, retry and expiry.
  3. `selftest-gold-m4-worker-lease-pg.mjs`: launch lease persists after personal slot release; foreign and unknown deny release; simulated verified process terminal; terminal_unknown fail-closed.
  4. `selftest-gold-m4-download-resource-pg.mjs`: foreground must first hand off into managed background launch; separate project admitted concurrently only after foreground frees, conflicting project denied, verified fixture terminal frees lock.
- Initially test #4 failed because old fixture incorrectly assumed concurrent foreground on same device. Source scheduler was correct; changed ONLY fixture in commit `1aa4789f6b758009bb3e2ebb4835c522499ced1d`, not scheduler runtime. Re-executed all 4: PASS. Fixture cleanup yielded zero rows; historical three claims unchanged.
- Source commit 1aa4789 is regression-only and not deployed as runtime; four-service UAT runtime remains c0c6977.

## Historical resource claim evidence — NO release performed
- `db964413-f80f-4869-96aa-fa9b56dded09`: DESKTOP-VA16D27 revoked historical device, running background claim, no terminal ACK and no live connection.
- `4537c568-4a5e-49ff-a752-657f55cea52a`: baolong123 online, running background claim, no terminal ACK; session-scoped managed process listing empty and historical process output returned `process_not_found` (NOT terminal evidence).
- `5100f840-0670-49f3-b4c2-8df636d116f6`: baolong123, `terminal_unknown`, no process ID, job `unknown/operator_restart_reconcile`, ledger `interrupted`.
- Do not release any of these by SQL or time-based guess. Only matching signed terminal receipt or audited owner-attested boot/reinstallation AFTER original claim and offline eligibility can justify the designated recovery route.

## M6 CLI selection bug fix in source
- Existing `gold-m6-owner-orphan-recovery-cli.mjs` selected ALL claims and asserted exactly one row. With 3 legitimate claims, owner could not recover any exact orphan even with valid evidence.
- Added pure `gold-m6-orphan-claim-selection.mjs`: compulsory `--job-id <exact uuid>` and tightly validated `WHERE c.job_id=...`. No default/first/device-wide fallback or arbitrary SQL input.
- Preserved interactive root-only TTY, password, original account ownership, post-claim boot validation, separate Operator authorization, audited `UNKNOWN` outcome and NO fake terminal ACK. No owner credentials requested or used in this work.
- Regression `selftest-gold-m6-orphan-claim-selection.mjs` verifies strict syntax, negative input/injection, explicit selection and existing guardrails; M6 owner orphan/metrics test suites PASS.
- This is source-only until separately staged/accepted. No owner orphan recovery was invoked.

## Remaining P0 physical gates
- Two-Windows owner Wall Kill with signed cancelled/130 is PASS in prior handoff.
- Real Pro Team independent OAuth/A-B Agent accounts + seat entitlement, cross-account resource/Cancel isolation is NOT physically verified; synthetic DB fixtures cannot substitute.
- Owner-attested orphan recovery requires real account ownership and verified post-claim reboot/reinstall evidence, currently unavailable. Never invent a boot time.
- Intermediate Stopping animation visual timing was not captured. No production deployment or Windows installation.
- Owner explicitly deferred A/B V2 redesign.
