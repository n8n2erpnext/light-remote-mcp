# Gold P0 — Windows 11 held-claim owner recovery, 2026-10-29

## Confirmed live issue (read-only)
Windows11 baolong123, enrolled device dev_466415d4e6396a81c1296a4c, online. PostgreSQL38 has two owner-held historical claims:

1. Job 4537c568-4a5e-49ff-a752-657f55cea52a, worker_state=running, resource_key=project:unknown, claimed_at=2026-10-28 08:57:16.771154 UTC, process_id=lp_6ocR6lqCgwZbnnJQIwufe9fZ, launch job status=ok; no signed terminal receipt.
2. Job 5100f840-0670-49f3-b4c2-8df636d116f6, worker_state=terminal_unknown, resource_key=project:c:/users/vkphu/appdata/local/temp, claimed_at=2026-10-28 13:03:05.267186 UTC, process_id=NULL, launch job status=interrupted; no signed terminal receipt.

The first claim's project:unknown exclusivity blocks new shell/files operations. Cancelling the new queued jobs before dispatch was verified. Do not bypass with a different tool, direct SQL, fake signed ACK, unrelated task or alternative connection. Installed Windows11 version is user-reported; no shell preflight was dispatched.

## P0 root cause
Existing M6 audited owner-only recovery supports ONLY worker_state=running/launch_status=ok with a valid processId. It rejects terminal_unknown no-PID records, leaving one permanent Win11 lock even if an authenticated owner intentionally abandons the older orphan. Also the owner recovery route refuses when the original device is connected or the Gold channel is fresh: Win11 currently online, so recovery is not presently eligible.

## Source fix (no releases performed)
- GoldDeviceResourceLocks.abandonOwnerAttestedOrphan now considers a second state, worker_state=terminal_unknown with process_id=NULL and launch_status=interrupted, in addition to the original running launched process. All other states are rejected.
- For both states, keep exact account/device/job selection, PostgreSQL transaction + device advisory lock, owner-observed post-claim reboot timestamp, channel not fresh, no existing signed terminal acknowledgement, atomic DELETE + audited UNKNOWN disposition + no terminal receipt.
- Terminal receipt check now uses the *exact job ID* OR the trusted process ID when present, so a null process ID cannot hide an existing receipt.
- Exact DELETE adds worker_state=$4 to avoid racing against an unexpected change.
- Interactive owner CLI accepts either eligible state and prints its current state; still requires owner account login, password typed privately inside owner-controlled TTY, post-claim observed boot, explicit ABANDON_UNKNOWN_RESULT confirmation. Never place owner password in ChatGPT/AI/tool arguments.
- Historical revoked device lookup now permits both active owner-held claim states under existing revoked-device constraints. Authenticated Operator route still refuses recovery while current Agent is connected/fresh.

## Test evidence
- selftest-gold-p0-win11-terminal-unknown-owner-recovery.mjs: exact owner-scoped terminal_unknown, null PID job-based ACK check, audit state, no terminal receipt, rollback on audit error, wrong claim state, signed receipt existing, stale boot, wrong IDs, active channel rejected. PASS.
- Existing selftest-gold-m6-owner-orphan-recovery.mjs and orphan selection contract PASS; M4 resource conflict regression PASS.
- No live claims removed. No production or installed Windows modifications.

## Owner-required recovery gate (NOT performed)
- First verify a genuine Windows11 reboot with LastBootUpTime strictly after 2026-10-28T13:03:05.267 UTC (= 2026-10-28 20:03:05 in Ho Chi Minh City) and verify the old processes cannot survive that reboot.
- Owner explicitly approves abandoning each job's **unknown** outcome. This never certifies that the old job succeeded or failed.
- Ensure original Win11 Gold Agent is truly offline; Operator refuses a connected/fresh original channel. Do not kill/stage other jobs or sidestep resource locks to accomplish this.
- Owner uses only authorized authenticated Operator owner-recovery UI/CLI after Gold UAT deploy, with exact --job-id once per claim. Password entered exclusively in interactive terminal; not provided to AI.
- After audited owner actions, verify zero Win11 claims, corresponding audit events, zero fabricated terminal ACKs, normal new work admission, and then run full Win11 physical process/Cancel/timeout/Wall tests. The Pro Team multi-Agent gate remains separately HOLD due to insufficient devices.
