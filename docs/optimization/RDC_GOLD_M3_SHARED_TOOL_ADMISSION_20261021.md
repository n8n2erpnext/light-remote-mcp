# Gold M3 — Shared personal Agent Scheduler across tool families

**Date:** 2026-10-21. **Baseline:** [M3 PostgreSQL Scheduler UAT checkpoint](./RDC_GOLD_M3_PERSONAL_AGENT_PG_SCHEDULER_20261021.md). **Team semantics:** [Pro Team owner-billed scope and separate pool](./RDC_GOLD_MULTI_AGENT_PRO_TEAM_COMPATIBILITY_20261021.md).

## Delivery and invariants

This Gold-only source slice reuses the real PostgreSQL `lr_gold_personal_agent_work` account slot and `GoldJobLedger` G4 reservation for multiple tool families; it does **not** increase per-user plan limits, change owner consent or enable Team cross-account execution. The new opt-in functionality is activated only when existing `OPERATOR_PERSONAL_AGENT_SCHEDULER=1` is set. Free retains 1 simultaneously executing personal Agent, Pro/VIP 3, with account-scoped PG-serialized admission.

- Foreground `exec` and the following bounded tool **operations** are now scheduled through the same `schedulePersonalEffect` function: all native filesystem operations, SCP begin/chunk/commit/download activity except `status/cancel`, native process `start`, terminal `start`, search `start`.
- A long-lived process started through `process start` releases its Agent *execution admission* once the launch acknowledgment finishes; its independent M5 worker may continue within separate device worker limits. Active long-running builds and downloads are not *maintenance draining* and another Agent should be able to perform unrelated work.
- Process `input/output/stop/list`, terminal `input/output/resize/signal/stop/list`, search `results/cancel` and SCP `status/cancel` are **control-plane operations** that bypass Agent execution slot queue, to avoid the owner or starting Agent being unable to stop a running process. They still undergo signed identity, owner-scope and per-device policy checks; bypassing queue **does not bypass access rights**.
- The `personal-agent-tool-admission.mjs` pure policy and `selftest-gold-m3-shared-tool-admission.mjs` assert a fixed family/action matrix. Unknown or unsupported actions do not become privilege escalations; device validation still applies.
- Before dispatch, the existing central pump rechecks session, account, approved capabilities and connection, then emits slot grant. Queued jobs have `status=queued` and `queueReason=QUEUED_AGENT_SLOT` rather than fake `running`; after completion the PG slot is released before an Agent behind it is admitted. Queue is limited to 64 pending jobs per account; exceeding returns `m3_personal_queue_capacity_reached`, not `target_node_draining` (no invented ETA).
- Pro Team owner-paid workload and Team member access continue as preview only. **M3-T cross-account remains OFF.** Neither a member's personal subscription nor Team seat pool may be silently treated as an extra personal Agent slot.
- **Desktop input/run/act is intentionally not opened to parallel execution** until M4 provides a device-scoped exclusive pointer/keyboard lock. **M4 build/project/file/CPU/resource locks are still outstanding**, so this slice is not the final conflict-free multi-Agent product.

## Safety / actual evidence gates

Source contract, G4 operation replay, M2 background classification, G3 stale/drain and legacy installer regressions must PASS. After immutable push, CI and staged LXD must confirm signed tool paths: at minimum an owner-approved filesystem read and a real bounded process launch/output/stop without blocking other commands, with corresponding PG admission records. No uncontrolled build/download or unrelated LXD process may be stopped in testing.

**Status at source handoff:** real CI/physical acceptance details to append after immutable build. Do **not** count code-only tests as fully accepted cross-tool execution. Production and Windows/macOS installed clients unchanged.

Rollback: disable `OPERATOR_PERSONAL_AGENT_SCHEDULER` only on isolated Gold Operator; existing M2/M5 background worker feature flags and schema32 remain. Preserve durable journal, PG operation tombstones, and existing full LXD backup. Do not remove SQL 032 or reduce database schema required by the running version.
