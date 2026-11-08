# Gold M6 — Fleet Wall owner cancel, queued-only (2026-10-22)

**Status: implemented in Gold source; not deployed/physically accepted.** Continues commits `8799b8e` (Fleet Jobs overview) and `801545b` (durable PostgreSQL history). Team and personal 3+1 physical concurrency UAT remain **paused by owner** until additional people/devices are available. Pro Team cross-account remains OFF.

## Scope and design

- Authenticated Fleet Wall `/jobs` has a button **Cancel queued** only for jobs displayed as queued, with a confirmation dialog. Clicking sends `POST /api/jobs/cancel` with owner-wall CSRF; no raw command or foreign account data is disclosed.
- Main device signs `fleet-job-cancel` with its enrolled Ed25519 device identity and valid Fleet authority. It occupies the bounded **control** rate lane, not the observer lane. Operator `verifiedChannelContext` and `verifiedFleetContext` enforce signed source, correct main device and account; owner job/device scope is derived on server, not from browser input.
- Operator `cancelQueuedPersonalJob()` requires matching real in-memory pending dispatch entry, personal-scheduled account + enrolled device ownership, not finished. Missing/foreign job => 404; stale/accepted/running/UNKNOWN/terminal job => 409; no signed Fleet authority => existing auth failure.
- `GoldPersonalAgentScheduler.cancelQueued()` shares the account-scoped **PostgreSQL advisory transaction lock** with `admit()`, demands `state='queued'`, refuses any existing device resource claim and atomically marks `finished/disposition=cancelled_before_dispatch`. An already admitted/OS-running job cannot be relabelled as canceled. No worker resource lock is manually released.
- Only after PostgreSQL confirms cancellation does Operator mark its own pending job `cancelled`, emit a terminal receipt, remove pending dispatch and update canonical job ledger. `finishJob`'s existing async scheduler complete call becomes an idempotent no-op for already-finished SQL rows. History reads canceled status.
- **Explicitly not implemented:** cancel/force-stop running job from Fleet Wall; that requires verified signed worker terminal receipt, owner-final-deny, and durable process-lease reconciliation. Existing device Local Wall remains the owner-authorized process Stop/Force Stop surface. A finished process-launch job is NOT evidence that detached OS process exited.

## Verification

- Node syntax checks: `executor.mjs`, `executor-routes-device-channel.mjs`, `gold-personal-agent-scheduler.mjs`, Fleet Wall runtime and page PASS.
- `selftest-gold-fleet-jobs-m6.mjs`: queued-only transactional outcome, refused resource claim, browser inline JS syntax + CSRF, previous durable SQL/history and owner projection PASS. Lightweight fixture; does not claim physical job cancellation.
- `git diff --check` PASS. Existing Gold Operator CI workflow executes M6 suite on branch push. CI status must be separately checked.
- **Physical Gold UAT POST /api/jobs/cancel, owner sign-in/CSRF, signed channel, job terminal in PostgreSQL, no OS child, and restart behavior all PENDING.** Do not call M6 fully accepted from source tests.

## Rollout/rollback

Keep source branch `feature/light-remote-gold-rebuild-20261018`; no runtime/production or data/schema migration performed in this slice. Gold UAT cutover needs backup, controlled session/job drain (without killing unrelated owner sessions), exact candidate hash and health/rollback, then one benign queued-only cancel physical acceptance. Reverse via source revert or UAT-only candidate rollback. No Pro Team quota/billing, local owner approvals, Windows/macOS installed binaries or signed grants modified.
