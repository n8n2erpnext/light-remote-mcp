# Light Remote rc.50 — MJS-only PostgreSQL Free family + owner-billed Team UAT
Date: 2026-10-11 (Asia/Ho_Chi_Minh)

## Scope, non-negotiable invariants
- Keep Node.js ESM `.mjs`, existing Express/MCP/Operator/client protocols; React rewrite remains retired.
- **Never read, import, copy, shadow-sync or migrate production account/session/device/secret/usage/billing/Paddle/ERPNext data** during this phase.
- All testing is on isolated Docker UAT PostgreSQL 17 `lightremote-rc50-v2`, no host-published ports, synthetic IDs and `example.invalid` emails only. PostgreSQL database owner role is used solely for isolated SQL fixture/migration administration, NOT an application connection.
- Production, original rc.50 staging, public plugin, client updaters and live device/Team dispatch remain untouched.
- Active branch: `feature/rc50-mjs-scale-20261011`; previous verified checkpoint `e67f640` (event-level usage ledger v8).
- No least-privilege app DB role yet (`lr_rc50_app` creation was previously blocked); no real Operator-to-PG connection.

## Completed migrations 9, 10, 11

### v9 — Free monthly allowance tied to trusted installation family
File: `platform-v2/sql/009_free_family_quota.sql`.

- Adds `lr_free_families`, `lr_free_family_devices`, `lr_free_family_monthly`; adds traceable `free_family_id` on `lr_usage_events`.
- `lr_charge_free_uat` derives family from SERVER-TRUSTED device mapping. It accepts NO client-provided family ID and checks active Free account, exact device owner, optional job owner, event idempotency, both account-10k and family-10k monthly caps.
- Serializes charges with per-owner/month and per-family/month transaction advisory locks. Supports multiple device-owning accounts under the same family ONLY when trusted enrollment/rotation proof was pre-verified by an independent service. That proof service is **NOT implemented**. Test fixture simulates this condition by a UAT-admin-only SQL mapping; that is NOT a production enrollment procedure.
- Transaction writes event + account monthly aggregate + family monthly aggregate atomically; old event replay does not double-charge. Monthly buckets use UTC month key `YYYY-MM`.

### v10 — Fail-closed cross-path ledger guard
File: `platform-v2/sql/010_free_meter_path_guard.sql`.

- A `BEFORE INSERT` trigger rejects Free usage lacking verified family, cross-actor Free usage, or invalid device-family mapping. Paid usage is forbidden from claiming a Free-family marker.
- Fixes the loophole where generic paid/legacy SQL metering could otherwise bypass the Free family cap.
- Existing v8 paid quota SQL fixture and Python concurrent test are intentionally switched from synthetic Free to synthetic PRO accounts; the Free path is now exclusively the v9 UAT function.
- PostgreSQL function/trigger `PUBLIC EXECUTE` revoked; **not a substitute for proper least-privileged app roles, table DML isolation, or trusted family proof**.

### v11 — Team usage billed to owner with DB-side conditions
File: `platform-v2/sql/011_team_owner_billed_uat.sql`.

- Adds `lr_team_member_budgets` + `lr_team_member_monthly` (monthly combined Team-member budget per subscribed owner).
- `lr_charge_team_member_uat` records usage with `owner_account_id=PRO/VIP device owner` and `actor_account_id=Free/other member`, subject to active owner account, member account, active Team member row, unrevoked valid PRO Team add-on, matching owned device/job, active actor-bound agent session, active `purpose='team-member'` A/B grant tied to same device/agent, and a live owner device connection.
- The Team-member budget is serialized on owner/month, and event/detail+overall owner usage+Team-member usage are written in one transaction. Cap checks are fail-closed and replay uses event_id (not job_id).
- **Important:** DB rows alone are NOT an authenticated OAuth principal nor a locally signed A/B approval. The SQL function has no public execute, and the trusted API/Operator must still independently verify the real calling principal, Local Wall approval, lease fencing and OS-side process cancellation before ANY live Team command is allowed. Live cross-account execution remains intentionally disabled.

## Tests, all synthetic
- `sql/test_free_family_rollback.sql`: two Free accounts mapped by synthetic trusted enrollment to one family; event replay, 10k family cap, account cap, rollover month, plan/device spoof denial, ROLLBACK. PASS.
- `sql/test_free_meter_guard_rollback.sql`: generic/paid SQL path cannot bill Free without family; direct wrong-actor Free event denied; allowed Free event still works, ROLLBACK. PASS.
- `sql/test_team_owner_billed_rollback.sql`: member calls charge owner; 2-call Team budget, replay and changed event rejection; closed/expired A/B, revoked membership, closed agent session, revoked Team entitlement all fail; ROLLBACK. PASS.
- `test/concurrent_free_family.py`: 16 simultaneous calls across two separate Free owners/devices sharing one pre-verified synthetic family, family remaining cap 6 -> exactly 6 accepted, 10 denied; owner counts sum to 6, six event replays return duplicate; finally removes own records. PASS.
- `test/concurrent_team_owner_billing.py`: 8 simultaneous member calls on one owner Team budget 3 -> exactly 3 accepted, 5 denied, owner and team totals=3; replay idempotent; finally removes own records. PASS.
- `src/storage/postgres.mjs`: parameterized `chargeFreeUat()` and `chargeTeamMemberUat()` added. Both **require `verifyTarget()`** to match exactly `light_remote_rc50_uat`, expected role `lr_rc50_app`, non-superuser before calling SQL; no live service imports these modules.
- `test/storage.test.mjs`: unit tests for parameter bindings, fail-closed before initialized, invalid owner/actor/month/grant. PASS.
- Existing `bash platform-v2/scripts/check.sh` PASS (17/17 prior Node tests; 001–007 SQL; existing Team/worker/outbox contention). Four SQL fixture suites for v8–v11, v8 16-way and both new concurrency scripts PASS manually. Legacy usage, renewal, owner index, Free/Team/paddle regression tests PASS.
- At final observed database audit: migration versions 1–11; synthetic counts zero in account, device, job, usage events, Free families/maps/buckets, Team budgets/buckets. `PUBLIC EXECUTE=false` for new functions.
- **Not integrated with GitHub CI:** earlier runner/workflow edits were blocked by tool safety. No bypass attempted; newer SQL/concurrency tests must be run manually until authorized workflow editing is available.

## Remaining critical scale gates
1. Independent signed device rotation/proof-verification flow for Free family linking; enforce safe and auditable family merges under concurrent quota traffic; migration 9 only models a pre-proven trusted mapping.
2. Authorize and provision separate least-privilege DB application role, safely grant only required operations/functions. Current SQL functions are SECURITY INVOKER and still require careful table privileges; do not give a web-facing process the UAT database owner credential.
3. Verified OAuth account + agent-client principal binding, Local Wall A/B approval provenance and real device OS fencing, plus honest Team billing semantics under revocation and reconnect. No live Team member dispatch.
4. Immutable ordered migrations instead of repeated schema bootstrap scripts; isolated backup/restore, retries/failure injection, independent synthetic multi-instance API UAT.
5. 100/500/1000 concurrent synthetic sessions with multiple traffic mixes and p95/p99, memory, locks, queue/worker saturation. Current transaction stress cases are correctness tests, NOT capacity benchmarks.
6. ANY production data access/migration/rollout requires explicit separate owner authorization, zero unresolved identity/entitlement/billing mismatches, rollback and user-session continuity.

## Resume
On owner-approved VPS-ARM Light Remote:
```sh
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform
git status --short && git branch --show-current
bash platform-v2/scripts/check.sh
cd platform-v2
for s in sql/test_usage_event_rollback.sql sql/test_free_family_rollback.sql \
 sql/test_free_meter_guard_rollback.sql sql/test_team_owner_billed_rollback.sql; do
 docker exec -i lightremote-rc50-v2-postgres-1 psql -v ON_ERROR_STOP=1 -U lr_rc50_uat -d light_remote_rc50_uat < "$s"
done
python3 test/concurrent_usage_quota.py
python3 test/concurrent_free_family.py
python3 test/concurrent_team_owner_billing.py
```
