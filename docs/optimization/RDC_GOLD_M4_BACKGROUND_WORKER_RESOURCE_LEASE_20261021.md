# Gold M4 — Background process resource lease

Date: 2026-10-21. Baseline: [M4 Resource Locks](./RDC_GOLD_M4_RESOURCE_LOCKS_20261021.md); [M5 Isolated Worker](./RDC_GOLD_M5_ISOLATED_SYSTEMD_WORKER_20261021.md).

Migration **034** adds `process_id`, `worker_state` and launch time to the typed relational `lr_gold_device_resource_claims` table. A signed `process:start` launch receipt releases the personal Agent slot but retains the device/project/worker claim for a still-running `lp_...` process. No launch ACK means `terminal_unknown` and the claim stays held, never blindly retried. Signed, account/device-bound terminal results alone can release the matching claim.

Device Agent now collects a bounded list of terminal M5/NativeProcess receipts without scripts, paths or output and sends these via existing signed poll/pulse/duplex heartbeat channels. Operator verifies the channel binding and process identity before freeing the claim and resuming device waiters. A signed owner `process:output/stop/list` terminal receipt is also a valid reconciliation trigger. `running/stopping/UNKNOWN` does not release.

**Security scope:** feature flag `OPERATOR_DEVICE_RESOURCE_LOCKS` on Gold UAT only; Pro Team cross-account remains OFF. No production or installed client changes. Resource intent uses lexical paths and does not guarantee symlink/junction aliases. Terminal/SCP lifecycle leases, cgroup CPU/RAM enforcement, desktop pointer lock, user-facing reconciliation and reboot-resume remain separate gates.

**Tests required:** verify migration034 checksum and installer, real PostgreSQL fixture (retained lock after launch, other project admitted, same project queued, worker budget, authenticated finish release, unknown fail-closed), signed UAT Linux process heartbeat and no drain, CI, full backup, rollback.

**Rollback:** inspect active workers first, disable M4 UAT-only feature flag, preserve PostgreSQL 034 and UNKNOWN claims. Do not downgrade to a binary demanding schema033 without planned DB restoration.
