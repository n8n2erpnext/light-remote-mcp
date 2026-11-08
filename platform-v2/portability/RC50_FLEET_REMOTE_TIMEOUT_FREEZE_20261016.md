# rc50 P0-C — real Operator Fleet command and unknown remote outcome drain

Date: 2026-10-16 Asia/Ho_Chi_Minh.
Branch: `feature/rc50-mjs-scale-20261011`.
Baseline: `31a17867f46ed792ed0c10047d39548cfb263b55`.
Scope: actual opt-in dev Operator, not a production Agent migration.

## Defect and threat

The already integrated local HTTP/job/native child freeze census still missed an important race. An outbound Fleet command can be queued or dispatched independently of HTTP lifetime. On `remote_result_timeout`, the Operator calls `fleet.abandon()` and marks the owning job finished, while the Agent may still be running the OS side effect. A later `SIGUSR2` can otherwise report local `frozen` because `operatorJobs` and `fleet.commands` are both zero. No remote ACK or signed effect cancellation was proven. This is a false-positive checkpoint risk.

## Applied to actual `operator-host/executor.mjs`

1. Register `fleetCommands` pending source using the real `FleetRouter.commands.size`. It includes queued and dispatched but unfinished commands; local freeze cannot ACK until that map is empty.
2. Add `unreconciledRemoteEffects` set, registered as a pending source. In the real `finishJob()`, if `localFreezeGate.enabled && job.remote && job.commandId && job.timedOut`, record command ID BEFORE notifying the freeze gate. Unlike job-cache entries, the pending evidence cannot be removed by job pruning.
3. There is deliberately NO auto-clear / timeout TTL / unsafe bypass for this set. An abandoned remote job cannot be interpreted as an Agent-side stop or positive checkpoint. The Operator remains `freezing` with HTTP new work 503 until an explicitly verified, separately designed reconciliation/cutover proof exists.
4. This is a strictly local DEV freeze behavior: the only new latch is populated with `LR_RC50_DEV_LOCAL_FREEZE=1`. It does not change deployed Agent authority, revoke any real device, stop any remote process or create persistent global fencing.

## Red/green and tests

New `platform-v2/test/operator-remote-outcome-freeze.test.mjs`:
- Real `FleetRouter` and actual `LocalIngressFreezeGate` demonstrate outstanding queued/dispatched command holding `freezing`, then ACK only after `fleet.complete` and census notification.
- After a fake but real-`FleetRouter` dispatched command is abandoned for remote timeout, Fleet commands size is zero but the persistent-in-process *uncertainty latch* keeps `freezing` and local marker durable, not `frozen`.
- Real `operator-host/executor.mjs` source integration assertions ensure both external pending sources and the `finishJob` timeout latch are actually wired.
- Before source correction, third test RED because the real source lacked both registrations; after correction focused 3/3 GREEN.

## Limitations / future acceptance

This is **NOT** P0-A or complete P0-C. `unreconciledRemoteEffects` is in-memory only: Operator crash/restart before an owner freeze marker is durable loses the uncertainty signal. Fleet/Agent origin, job/side-effect ACK, remote PTY, SCP, RM V2, downstream webhooks and globally authenticated writer epoch still lack cross-host cutover proof. Persistent unknown-outcome records and remote reconciliation must be part of future authoritative storage and audited watermark. Two fsync registry writers remain blocked at 16/18. No production data, customers, real remote jobs, policy-bypass, main merge, staging/prod deployment or state restore are included.
