# rc50 P0-C — final DEV journal shutdown blocks live native OS effects

Date: 2026-10-16 (Asia/Ho_Chi_Minh)
Branch: feature/rc50-mjs-scale-20261011
Baseline: 7d96bb790ec561ed7a5661a85527d1e123f5b5b2

## Concrete defect

The rc.50 opt-in remote-effect WAL from 7d96bb7 keeps an exclusive journal owner lock. The real Operator `shutdown()` previously released that lock when the journal and Fleet command maps were empty and the local freeze state remained open. However, a successful native `process start` or `terminal start` already marks its short HTTP job finished, while the OS child/PTY can continue executing. Such a SIGTERM could incorrectly release the journal owner lock and exit 0 even though its own persistent OS effects were not drained.

## Actual source correction

- New `operator-host/dev-journal-clean-shutdown.mjs`: a mandatory, fail-closed census of real `localFreezeGate.snapshot()`, unfinished `jobs`, Fleet queue/in-flight map, `unreconciledRemoteEffects`, durable `remoteEffectJournal.pending`, and actual live `NativeProcessRegistry.list()` + `NativeTerminalRegistry.list()` rows.
- The actual `operator-host/executor.mjs` SIGTERM/SIGINT shutdown callback invokes `assertDevJournalCleanShutdown()` **immediately before** `remoteEffectJournal.releaseClean()`. A live child, in-flight HTTP request, unfinished job, unreadable/malformed census, pending remote outcome or frozen/audit-seal state results in an error, nonzero exit and **owner lock preserved**. It does not kill owner-created processes or invent a remote Agent exit proof.
- This new policy only runs with the existing `LR_RC50_DEV_REMOTE_EFFECT_JOURNAL=1` UAT opt-in. Production with that opt-in disabled retains existing shutdown behavior. No control-plane/global writer authority is claimed.

## Evidence

`platform-v2/test/operator-dev-shutdown-census.test.mjs` runs an actual Linux Node child through `NativeProcessRegistry` and a deterministic PTY provider through `NativeTerminalRegistry`; it verifies BOTH are counted after their start-jobs have finished. Stop PTY while child still alive → unsafe; stop child → safe only after all other census sources are clear. Injects pending durable journal effect and unfinished PID-less job → unsafe. Missing/invalid census → explicit failure. Source integration test binds the actual Operator shutdown call before lock release. No production device, customer job, credential or real remote Agent touched.

Caveats: this is a safe lock-release predicate for one isolated DEV Operator, not a global quiesce authority. A generic Agent ACK still does not prove remote process/terminal exit, so remote WAL entries cannot be reconciled automatically. Existing 16/18 writer fsync proof and five P0 gates remain NOT_READY. Cross-host portable restore/rollback under global epoch, Agent-side signed proof and independently owned wall trust chain remain outstanding. Previously policy-blocked source paths remain untouched.
